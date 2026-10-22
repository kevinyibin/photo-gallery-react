/**
 * 工具栏新增的实用动作 —— 独立于原有模块，不改动既有业务代码路径：
 *   1. rescan()             重新扫描当前文件夹（增量入库，依赖已授权的目录句柄）
 *   2. startSlideshow()     从当前视图首张开始幻灯片播放
 *   3. exportViewCsv()      导出当前视图清单为 CSV
 *   4. toggleAppFullscreen() 整页全屏切换
 *
 * 所有结果反馈统一走 toast（core/feedback）。
 */
import { state, notify } from './store';
import { scanDirHandle } from './scanner';
import { openPreview, startSlide } from './preview';
import { ratingOf } from './ratings';
import { tagsOf } from './meta';
import { familyLabel } from './colors';
import { cameraLabel, lensLabel, focalText, fmtShutter, fmtF, fmtSize } from './utils';
import { toast } from './feedback';
import type { MediaItem } from './types';

/* ============================ 重新扫描 ============================ */

/** 目录句柄的读权限是否仍然有效（失效时尝试重新申请一次） */
async function ensurePermission(h: any): Promise<boolean> {
  try {
    let perm: string = h.queryPermission ? await h.queryPermission({ mode: 'read' }) : 'granted';
    if (perm === 'prompt') {
      perm = h.requestPermission ? await h.requestPermission({ mode: 'read' }) : 'prompt';
    }
    return perm === 'granted';
  } catch (e) {
    return false;
  }
}

/**
 * 重新扫描当前文件夹：只处理新增 / 变化的文件，已入库的按签名去重。
 * 手动添加文件（无目录句柄）的场景无法重扫，引导用户改用「选择文件夹」。
 */
export async function rescan() {
  const h: any = state.rootHandle;
  if (!h) {
    toast.warning('当前图库来自手动添加的文件，请改用「选择文件夹」导入以便重新扫描');
    return;
  }
  if (!(await ensurePermission(h))) {
    toast.warning('文件夹访问权限已失效，请重新选择文件夹');
    return;
  }
  const before = state.items.length;
  state.scanning = true;
  state.scanCount = 0;
  notify('overlay');
  try {
    await scanDirHandle(h, [], h.name);
    const added = state.items.length - before;
    if (added > 0) toast.success(`重新扫描完成，新增 ${added} 个文件`);
    else toast.success('重新扫描完成，没有发现新增文件');
  } catch (err: any) {
    toast.error('重新扫描失败：' + ((err && err.message) || '读取目录异常'));
  } finally {
    state.scanning = false;
    notify('overlay');
  }
}

/* ============================ 幻灯片 ============================ */

/** 从当前视图的第一张开始自动播放（灯箱内按空格可暂停 / 继续） */
export function startSlideshow() {
  if (!state.view.length) { toast.warning('当前视图没有可播放的作品'); return; }
  openPreview(0);
  startSlide();
  toast.info('幻灯片已开始播放 —— 空格暂停 / 继续，Esc 退出');
}

/* ============================ 导出清单 ============================ */

const CSV_HEAD = [
  '文件名', '所在目录', '类型', '大小', '评分', '喜欢', '标签',
  '相机', '镜头', '焦距', '光圈', '快门', 'ISO', '拍摄时间', '主色调'
];

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function rowOf(it: MediaItem): string[] {
  const e = it.exif;
  return [
    it.name,
    it.dirKey,
    it.kind === 'video' ? '视频' : '照片',
    fmtSize(it.size),
    ratingOf(it) ? String(ratingOf(it)) : '',
    it.liked ? '是' : '',
    tagsOf(it).join(' '),
    cameraLabel(e),
    lensLabel(e),
    focalText(e),
    e && e.fNumber ? 'ƒ' + fmtF(e.fNumber) : '',
    e && e.exposure ? fmtShutter(e.exposure) : '',
    e && e.iso ? String(e.iso) : '',
    (e && (e.dateTimeOriginal || e.dateTime)) || '',
    it.fam ? familyLabel(it.fam) : ''
  ];
}

/** 导出「当前筛选结果」的完整清单（CSV，UTF-8 BOM 兼容 Excel） */
export function exportViewCsv() {
  const rows = state.view;
  if (!rows.length) { toast.warning('当前视图没有可导出的作品'); return; }
  const lines = [CSV_HEAD.map(csvCell).join(',')].concat(rows.map(it => rowOf(it).map(csvCell).join(',')));
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  try {
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `作品清单-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast.success(`已导出 ${rows.length} 条作品清单`);
  } catch (err: any) {
    toast.error('导出失败：' + ((err && err.message) || '浏览器拒绝下载'));
  }
}

/* ============================ 整页全屏 ============================ */

/** 图库整页全屏（与灯箱内的 F 全屏互不干扰：灯箱打开时由灯箱处理） */
export function toggleAppFullscreen() {
  if (state.lbOpen) { toast.info('详情页内请按 F 切换全屏'); return; }
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      const el = document.documentElement as any;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) { toast.warning('当前浏览器不支持全屏'); return; }
      const r = req.call(el);
      if (r && typeof r.catch === 'function') r.catch(() => toast.warning('浏览器拒绝了全屏请求'));
    }
  } catch (e) {
    toast.warning('浏览器拒绝了全屏请求');
  }
}

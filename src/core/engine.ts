/**
 * 引擎编排 —— 视图刷新、EXIF 解析队列、主色调提取队列、启动引导、顶栏动作。
 * 与原版本的全局函数一一对应；所有 UI 更新通过 notify 频道广播。
 */
import { ST_KV, ST_RATE, ST_META, K_UI, K_SESSION, ST_HANDLE, K_ROOT } from './constants';
import { persist } from './persist';
import { state, dom, notify, notifyAll, setLeft } from './store';
import { computeView, buildNodes, layout, relayout, scheduleLayout } from './view';
import { buildTree } from './tree';
import { hydrateMeta } from './meta';
import { bindCurrentItemGetter } from './rawlink';
import { currentItem, openFromHash, bindSessionSavers } from './preview';
import { parseExif } from './exif';
import { setPalette, bindRelayout } from './thumbs';
import { samplePalette } from './colors';
import { photoFacetActive, scheduleFacetRefresh } from './facets';
import { syncTrashState, bindLibraryRefresh } from './library';
import { bindModalRefresh } from './modal';
import { bindEngineActions, bindQueueReset, scanDirHandle } from './scanner';
import { applyUI, applySession, showRestore, saveUI, saveSessionDebounced, bindRefresh } from './session';
import type { MediaItem } from './types';

/* ============================ 刷新 ============================ */

/** 全量刷新：重算视图 + 重建节点 + 重排 + 全频道广播 */
export function refresh() {
  computeView();
  buildNodes();
  layout();
  notifyAll();
  // 废纸篓在刷新过程中可能被清空：自动退回图库（与原版本 updateTrashUI 的副作用一致）
  syncTrashState();
}

/** 只重算视图并渲染，不动目录树 / 空状态（扫描增量与局部刷新用） */
export function refreshView() {
  computeView();
  buildNodes();
  layout();
  notify('grid', 'status');
}

/* 把 refresh 注入各模块（纯引用赋值，模块载入期执行一次） */
bindLibraryRefresh(refresh);
bindModalRefresh(refresh);
bindRefresh(refresh);
bindEngineActions({ refresh, refreshView, scheduleExifAll });
bindQueueReset(resetExifColorQueues);
bindRelayout(scheduleLayout);
bindCurrentItemGetter(currentItem);

/* ============================ EXIF 解析队列 ============================ */
/* 扫描完成后在后台低并发解析每张照片的 EXIF（只读取文件头部 512KB），
   解析结果即时反馈到筛选面板与缩略图摘要；失败静默降级为“未记录”。 */
const exifQueue: MediaItem[] = [];
let exifActive = 0;
let exifFlushed = false;
const EXIF_CONC = 4;
const EXIF_SLICE = 512 * 1024;

export function scheduleExifAll() {
  for (const it of state.items) {
    if (it.kind === 'image' && !it.exifParsed && !it.exifQueued) {
      it.exifQueued = true;
      exifQueue.push(it);
    }
  }
  state.exifTotal = 0;
  for (const it of state.items) if (it.kind === 'image') state.exifTotal++;
  exifFlushed = false;
  pumpExif();
  notify('facets', 'status');
  // 没有待解析的 EXIF 时（例如全部是已处理过的文件）直接开始色彩分析（需已在设置中开启）
  if (state.exifDone >= state.exifTotal && state.colorEnabled) scheduleColorAll();
}

function pumpExif() {
  while (exifActive < EXIF_CONC && exifQueue.length) {
    const it = exifQueue.shift()!;
    exifActive++;
    parseExifOne(it).then(() => { exifActive--; pumpExif(); });
  }
  if (!exifActive && !exifQueue.length && state.exifTotal && !exifFlushed) {
    exifFlushed = true;
    notify('facets', 'status');          // 全部解析完成：最终刷新一次分类导航
    if (state.colorEnabled) scheduleColorAll();      // EXIF 完成后再跑色彩分析，避免同时抢占解码资源
  }
}

function parseExifOne(it: MediaItem): Promise<void> {
  return it.file.slice(0, EXIF_SLICE).arrayBuffer().then(buf => {
    it.exifParsed = true;
    state.exifDone++;
    return parseExif(buf).then(ex => { it.exif = ex; }).catch(() => { it.exif = null; });
  }).then(() => {
    afterExif(it);
  }).catch(() => {
    it.exifParsed = true;
    state.exifDone++;
    afterExif(it);
  });
}

function afterExif(it: MediaItem) {
  it._shotTs = null;
  notify('grid');            // 瓦片摘要即时更新
  scheduleFacetRefresh();    // 节流刷新筛选面板 / 状态栏 / 筛选结果
  if (currentItem() === it && state.lbOpen) notify('lightbox');
}

/* ============================ 主色调提取队列 ============================ */
/* 与 EXIF 队列类似：扫描完成后后台低并发跑（只把图片解码到 24×24 再采样），
   结果写入 meta 缓存，下次打开同一目录无需重算。 */
const colorQueue: MediaItem[] = [];
let colorActive = 0;
let colorFlushed = false;
const COLOR_CONC = 2;

export function scheduleColorAll() {
  if (!state.colorEnabled) return;   // 色调分析默认关闭，仅当用户在设置中开启后才执行
  // 缩略图流程可能已经顺带完成采样：这里重新统计总数与已完成数，避免进度永远差几张
  let total = 0, done = 0;
  for (const it of state.items) {
    if (it.kind !== 'image') continue;
    total++;
    if (it.palDone) { done++; continue; }
    if (!it.palQueued) { it.palQueued = true; colorQueue.push(it); }
  }
  state.colorTotal = total;
  state.colorDone = done;
  colorFlushed = false;
  pumpColor();
  notify('facets', 'status');
}

/** 设置开关：开启后立即开始分析；关闭后清空队列并复位排队标记（便于再次开启时重新排队） */
export function setColorEnabled(on: boolean) {
  on = !!on;
  if (state.colorEnabled === on) return;
  state.colorEnabled = on;
  saveUI();
  if (on) {
    for (const it of state.items) if (!it.palDone) it.palQueued = false;
    scheduleColorAll();
    setLeft('已开启图片色调分析，将在后台提取主色调');
  } else {
    colorQueue.length = 0;
    for (const it of state.items) if (!it.palDone) it.palQueued = false;
    state.colorTotal = 0;
    state.colorDone = 0;
    setLeft('已关闭图片色调分析');
  }
  notify('facets', 'status');
}

function pumpColor() {
  while (colorActive < COLOR_CONC && colorQueue.length) {
    const it = colorQueue.shift()!;
    colorActive++;
    extractColor(it).then(() => { colorActive--; pumpColor(); });
  }
  if (!colorActive && !colorQueue.length && state.colorTotal && !colorFlushed) {
    colorFlushed = true;
    notify('facets', 'status');
  }
}

function extractColor(it: MediaItem): Promise<boolean> {
  if (it.palDone) { state.colorDone++; return Promise.resolve(false); }   // 缩略图流程已顺带采样
  if (typeof createImageBitmap !== 'function') {
    it.palDone = true;
    state.colorDone++;
    return Promise.resolve(false);
  }
  // 只解码到极小的位图：成本远低于生成缩略图
  return createImageBitmap(it.file, { resizeWidth: 24, resizeQuality: 'low', imageOrientation: 'from-image' } as ImageBitmapOptions)
    .then(bmp => {
      let ok = false;
      if (bmp.width >= 2 && bmp.height >= 2) ok = setPalette(it, samplePalette(bmp));
      if (bmp.close) { try { bmp.close(); } catch (e) {} }
      state.colorDone++;
      if (!ok) { it.palDone = true; }
      return ok;
    })
    .catch(() => { it.palDone = true; state.colorDone++; return false; });
}

function resetExifColorQueues() {
  exifQueue.length = 0;
  colorQueue.length = 0;
  state.exifDone = 0;
  state.exifTotal = 0;
  state.colorDone = 0;
  state.colorTotal = 0;
}

/* ============================ 顶栏 / 侧栏动作 ============================ */

let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** 搜索框输入（160ms 防抖，与原版本一致） */
export function onSearchInput(v: string) {
  state.filter.q = v;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    refresh();
    if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
    saveSessionDebounced();
  }, 160);
}

export function setKind(kind: 'all' | 'image' | 'video' | 'like') {
  state.filter.kind = kind;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function setSort(v: string) {
  state.sort = v;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveUI();
  saveSessionDebounced();
}

export function setRatingFilter(v: string) {
  state.filter.rating = v;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function setMode(mode: 'flow' | 'group') {
  state.mode = mode;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveUI();
  saveSessionDebounced();
}

/** 统一入口：改瓦片宽度 → 重排 + 渲染 + 记忆 */
export function setColWidth(v: number) {
  state.colWidth = Math.max(130, Math.min(420, Math.round(v)));
  relayout();
  saveUI();
}

export function setShowName(on: boolean) {
  state.showName = !!on;
  relayout();
  saveUI();
}

export function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  saveUI();
  notify('topbar');
}

export function resetFilters() {
  state.filter = {
    kind: 'all', dir: '', q: '', rating: 'all',
    camera: null, lens: null, focal: null, year: null, color: null, tag: null
  };
  buildTree();
  refresh();
  saveSessionDebounced();
}

export function setDirFilter(dirKey: string) {
  state.filter.dir = dirKey;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function setSideTab(tab: 'facet' | 'tree') {
  state.sideTab = tab;
  notify('sidebar');
  saveSessionDebounced();
}

export function setMoreOpen(on: boolean) {
  state.moreOpen = on;
  saveUI();
  notify('sidebar');
}

export function setDrawerOpen(on: boolean) {
  state.drawerOpen = on;
  notify('sidebar');
}

export function setDropActive(on: boolean) {
  state.dropActive = on;
  notify('overlay');
}

export { scheduleLayout, relayout, setLeft };

/* ============================ 启动 ============================ */
export async function boot() {
  const ui = await persist.get(ST_KV, K_UI);
  applyUI(ui);
  try {
    const m = await persist.all(ST_RATE);
    if (m && m.size) {
      const map = new Map<string, { r: number; ts: number }>();
      m.forEach((v: any, k: string) => { if (v && v.r) map.set(k, { r: v.r, ts: v.ts || 0 }); });
      state.ratings = map;
    }
  } catch (e) {}
  // 标签 + 主色调缓存（meta 存储；老版本没有该存储时返回空 Map，无需迁移）
  try {
    const mm = await persist.all(ST_META);
    if (mm && mm.size) {
      const map = new Map();
      mm.forEach((v: any, k: string) => {
        if (!v) return;
        map.set(k, { tags: Array.isArray(v.tags) ? v.tags : [], pal: Array.isArray(v.pal) ? v.pal : [], ts: v.ts || 0,
          like: v.like, trash: v.trash, rawMoved: v.rawMoved, rawTrash: v.rawTrash, rawMovedName: v.rawMovedName });
      });
      state.meta = map;
      state.items.forEach(hydrateMeta);
    }
  } catch (e) {}
  refresh();

  const sess = await persist.get(ST_KV, K_SESSION);
  const handle = await persist.get(ST_HANDLE, K_ROOT);
  if (handle && handle.kind === 'directory') {
    let perm = 'prompt';
    try { perm = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'prompt'; } catch (e) {}
    if (perm === 'granted') {
      // 已授权：静默恢复上次打开的文件夹（含子目录 / 滚动位置 / 选中项）
      state.scanning = true; state.scanCount = 0; notify('overlay');
      await scanDirHandle(handle, [], handle.name);
      state.scanning = false; notify('overlay');
      applySession(sess || {});
      showRestore(sess, handle);
      openFromHash();
      return;
    }
    showRestore(sess, handle);
  } else if (sess && sess.rootName && sess.rootKind !== 'manual') {
    showRestore(sess, null);
  }
  openFromHash();
  notifyAll();
}

/** 应用就绪提示（App 挂载后调用一次） */
export function initStatus() {
  setLeft('就绪 —— 拖入文件夹开始浏览，全部处理均在本地完成');
  boot();
}

/**
 * 图库操作 —— 喜欢 / 废纸篓 / 彻底删除 / 批量选择。
 * 与原版本行为一致；UI 同步通过 notify 完成。
 */
import { state, dom, notify, setLeft } from './store';
import { sigOf } from './utils';
import { toast } from './feedback';
import { writeMeta, likedOf, trashCount, purgeMetaOf } from './meta';
import { purgeRatingOf, setRatingMany } from './ratings';
import { thumbCache } from './thumbs';
import { buildTree } from './tree';
import { bindRawOnLike, bindRawOnUnlike, bindRawOnTrash, bindRawOnRestore, bindRawOnPurge } from './rawlink';
import { currentItem, closePreview, doClosePreview, markCurrent, preloadAround } from './preview';
import { openModal } from './modal';
import { ConfirmText } from '../components/dialogs';
import type { MediaItem } from './types';

/* refresh 由 engine 注入，避免硬循环 */
let refreshRef: () => void = () => {};
export function bindLibraryRefresh(fn: () => void) { refreshRef = fn; }

/* ============================ 喜欢 ============================ */

/** 标记 / 取消喜欢；同步详情页按钮、网格角标与多图单元格 */
export function setLike(it: MediaItem | null, on: boolean) {
  if (!it) return;
  on = !!on;
  if (it.liked === on) return;
  it.liked = on;
  writeMeta(it);
  notify('lightbox', 'grid');
  if (on) bindRawOnLike(it);   // Sony ARW 联动：喜欢时把 RAW 原件移入「精选RAW」
  else bindRawOnUnlike(it);    // 取消喜欢：把 RAW 原件移回原文件夹
  // 「喜欢」分类视图中取消喜欢：作品即时移出当前视图并定位到相邻项
  if (!on && state.filter.kind === 'like') afterViewShrunk();
  setLeft(on ? `已标记喜欢：${it.name}（受保护，不可删除）` : `已取消喜欢：${it.name}`);
}

export function toggleLike(it: MediaItem | null) { if (it) setLike(it, !likedOf(it)); }

/* ============================ 废纸篓 ============================ */

/** 移入废纸篓；喜欢的图片受保护，返回 false */
export function moveToTrash(it: MediaItem | null): boolean {
  if (!it || it.trashed) return false;
  if (likedOf(it)) {
    setLeft(`「${it.name}」已标记喜欢，受保护不可删除`);
    toast.warning(`「${it.name}」已标记喜欢，受保护不可删除`);
    return false;
  }
  it.trashed = true;
  writeMeta(it);
  bindRawOnTrash(it);   // Sony ARW 联动：同名 RAW 一并标记（恢复时自动取消）
  return true;
}

export function restoreFromTrash(it: MediaItem | null): boolean {
  if (!it || !it.trashed) return false;
  it.trashed = false;
  bindRawOnRestore(it);   // Sony ARW 联动：取消 RAW 的删除标记
  writeMeta(it);
  return true;
}

/** 彻底删除：从库中移除并清理持久化记录；喜欢的图片受保护跳过。返回删除数 */
export function purgeItems(list: MediaItem[]): number {
  const ok: MediaItem[] = [], blocked: MediaItem[] = [];
  for (const it of list) (likedOf(it) ? blocked : ok).push(it);
  if (blocked.length) setLeft(`${blocked.length} 个文件已标记喜欢，受保护未删除`);
  if (!ok.length) return 0;
  const ids = new Set<number>();
  for (const it of ok) {
    ids.add(it.id);
    bindRawOnPurge(it);   // Sony ARW 联动：同步删除已标记的 RAW 原件
    if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
    if (it.poster) { URL.revokeObjectURL(it.poster); it.poster = null; }
    thumbCache.delete(it.id);
    state.sigSet.delete(it.dirKey + '/' + it.name + '|' + it.size);   // 与 ingest 的签名规则保持一致
    purgeMetaOf(it);
    purgeRatingOf(it);
    state.selected.delete(it.id);
  }
  state.items = state.items.filter(it => !ids.has(it.id));
  buildTree();
  refreshRef();
  return ok.length;
}

/** 进入 / 退出废纸篓查看模式 */
export function setTrashMode(on: boolean) {
  on = !!on;
  if (state.trashMode === on) return;
  if (on && !trashCount()) { setLeft('废纸篓是空的'); return; }
  state.trashMode = on;
  if (!on && state.lbOpen) doClosePreview();
  state.selected.clear();
  refreshRef();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  setLeft(on ? '废纸篓：可批量查看、恢复或彻底删除（喜欢的图片不可删除）' : '已返回图库');
  notify('batch', 'topbar');
}

/** 废纸篓被清空（全部恢复 / 彻底删除）时自动退回图库 */
export function syncTrashState() {
  if (state.trashMode && !trashCount()) setTrashMode(false);
}

/** D / Delete 键：正常模式移入废纸篓；废纸篓模式中弹确认后彻底删除；喜欢的图片始终受保护 */
export function deleteKeyAction() {
  const it = currentItem();
  if (!it) return;
  if (likedOf(it)) {
    setLeft(`「${it.name}」已标记喜欢，受保护不可删除`);
    toast.warning(`「${it.name}」已标记喜欢，受保护不可删除`);
    return;
  }
  if (state.trashMode) {
    openModal({
      title: '彻底删除',
      content: <ConfirmText>确定彻底删除「{it.name}」？此操作不可恢复。</ConfirmText>,
      okText: '彻底删除',
      onOk: () => {
        if (purgeItems([it])) {
          setLeft(`已彻底删除：${it.name}`);
          afterViewShrunk();
        }
        return true;
      }
    });
    return;
  }
  if (moveToTrash(it)) {
    setLeft(`已移入废纸篓：${it.name}`);
    afterViewShrunk();
  }
}

/** 当前图片被移出视图后（入废纸篓 / 彻底删除）：刷新视图并定位到相邻图片，没有可看的就关闭详情页 */
export function afterViewShrunk() {
  const idx = state.previewIndex;
  refreshRef();
  if (!state.lbOpen) return;
  if (!state.view.length) { closePreview(); return; }
  state.previewIndex = Math.min(idx, state.view.length - 1);
  markCurrent(state.view[state.previewIndex]);
  preloadAround(state.previewIndex);
  notify('lightbox');
}

/* ============================ 批量选择 ============================ */

export function setSelectMode(on: boolean) {
  state.selectMode = !!on;
  if (!state.selectMode) state.selected.clear();
  notify('grid', 'batch', 'topbar');
}

export function toggleSelect(it: MediaItem) {
  if (state.selected.has(it.id)) state.selected.delete(it.id);
  else state.selected.add(it.id);
  notify('batch', 'grid');
}

export function selectedItems(): MediaItem[] {
  return state.view.filter(it => state.selected.has(it.id));
}

export function selectAllInView() {
  state.selected.clear();
  for (const it of state.view) state.selected.add(it.id);
  notify('batch', 'grid');
}

export function clearSelection() {
  state.selected.clear();
  notify('batch', 'grid');
}

export function applyBatchRating(v: number) {
  const list = selectedItems();
  if (!list.length) { setLeft('请先选择要标记的文件'); return; }
  setRatingMany(list, v);
  setLeft(`已将 ${list.length} 个文件标记为 ${v ? v + ' 星' : '未评分'}`);
}

/* ---- 批量：移入废纸篓 / 恢复 / 彻底删除 ---- */
export function batchTrash() {
  const list = selectedItems();
  if (!list.length) { setLeft('请先选择要移入废纸篓的文件'); return; }
  let moved = 0, blocked = 0;
  for (const it of list) {
    if (likedOf(it)) { blocked++; continue; }
    if (moveToTrash(it)) moved++;
  }
  refreshRef();
  setSelectMode(false);
  setLeft(`已移入废纸篓 ${moved} 项` + (blocked ? `（${blocked} 项已标记喜欢，受保护跳过）` : ''));
  // 结果反馈统一走 toast（状态栏只做常驻摘要）
  if (moved) toast.success(`已移入废纸篓 ${moved} 项` + (blocked ? `，${blocked} 项受保护跳过` : ''));
  else if (blocked) toast.warning(`所选 ${blocked} 项已标记喜欢，受保护未移入废纸篓`);
}

export function batchRestore() {
  const list = selectedItems();
  if (!list.length) { setLeft('请先选择要恢复的文件'); return; }
  let n = 0;
  for (const it of list) if (restoreFromTrash(it)) n++;
  refreshRef();
  setSelectMode(false);
  setLeft(`已从废纸篓恢复 ${n} 项`);
  if (n) toast.success(`已从废纸篓恢复 ${n} 项`);
  else toast.warning('所选文件不在废纸篓中，无需恢复');
}

export function batchPurge() {
  const list = selectedItems();
  if (!list.length) { setLeft('请先选择要彻底删除的文件'); return; }
  const blocked = list.filter(likedOf).length;
  const n = list.length - blocked;
  if (!n) {
    setLeft('所选图片均已标记喜欢，受保护不可删除');
    toast.warning('所选图片均已标记喜欢，受保护不可删除');
    return;
  }
  openModal({
    title: '彻底删除',
    content: (
      <ConfirmText>
        将彻底删除选中的 {n} 个文件（从图库与所有记录中移除），此操作不可恢复。
        {blocked ? <><br />另有 {blocked} 项已标记喜欢，受保护将被跳过。</> : null}
      </ConfirmText>
    ),
    okText: '彻底删除',
    onOk: () => {
      const done = purgeItems(list);
      setSelectMode(false);
      if (done) setLeft(`已彻底删除 ${done} 项`);
      return true;
    }
  });
}

/* 供组件读取喜欢状态 */
export { likedOf, trashCount, sigOf };

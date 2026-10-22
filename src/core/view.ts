/**
 * 视图计算与瀑布流布局 —— 与原版本算法逐行一致：
 * 过滤 + 排序 → 渲染节点（含分组头）→ 最短列瀑布流定位。
 * 渲染本身由 React 组件完成，这里只产出 nodes / pos / gridH。
 */
import { state, dom, notify } from './store';
import { cmpName, shotTs, cameraLabel, lensLabel, focalBinOf, exifYear } from './utils';
import { ratingOf } from './ratings';
import { tagsOf } from './meta';
import type { GridNode, LayoutPos } from './types';

export function computeView() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  const rf = f.rating;
  const facOn = !!(f.camera && f.camera.size) || !!(f.lens && f.lens.size) ||
                !!(f.focal && f.focal.size) || !!(f.year && f.year.size);
  const colorOn = !!(f.color && f.color.size);
  const tagOn = !!(f.tag && f.tag.size);
  const arr = state.items.filter(it => {
    // 废纸篓：正常视图隐藏已删除项；废纸篓模式只显示已删除项
    if (state.trashMode ? !it.trashed : it.trashed) return false;
    // 「喜欢」单独分类：只看已标记喜欢的作品
    if (f.kind === 'like') { if (!it.liked) return false; }
    else if (f.kind !== 'all' && it.kind !== f.kind) return false;
    if (f.dir && !(it.dirKey === f.dir || it.dirKey.startsWith(f.dir + '/'))) return false;
    if (q) {
      let hay = (it.name + ' ' + it.dirKey).toLowerCase();
      if (it.exif) hay += ' ' + cameraLabel(it.exif).toLowerCase() + ' ' + lensLabel(it.exif).toLowerCase();
      if (tagsOf(it).length) hay += ' ' + tagsOf(it).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (rf !== 'all') {
      const r = ratingOf(it);
      if (rf === '0') { if (r !== 0) return false; }
      else if (r < (+rf)) return false;
    }
    // 摄影条件筛选：任一条件激活时，仅显示带对应 EXIF 的照片（视频与无 EXIF 的文件不计入）
    if (facOn) {
      if (it.kind !== 'image' || !it.exif) return false;
      if (f.camera && f.camera.size && !f.camera.has(cameraLabel(it.exif))) return false;
      if (f.lens && f.lens.size && !f.lens.has(lensLabel(it.exif))) return false;
      if (f.focal && f.focal.size && !f.focal.has(focalBinOf(it.exif))) return false;
      if (f.year && f.year.size && !f.year.has(String(exifYear(it.exif) || ''))) return false;
    }
    // 主色调筛选：仅对已提取调色板的照片生效（视频未做色彩分析）
    if (colorOn) {
      if (it.kind !== 'image' || !it.fam || !f.color!.has(it.fam)) return false;
    }
    // 标签筛选：多标签可按“含任一 / 同时含全部”组合
    if (tagOn) {
      const tg = tagsOf(it);
      if (state.tagMode === 'all') {
        for (const t of f.tag!) if (tg.indexOf(t) < 0) return false;
      } else {
        let hit = false;
        for (const t of f.tag!) { if (tg.indexOf(t) >= 0) { hit = true; break; } }
        if (!hit) return false;
      }
    }
    return true;
  });
  const s = state.sort;
  arr.sort((a, b) => {
    if (s === 'size') return (b.size - a.size) || cmpName(a.name, b.name);
    if (s === 'date') return (b.mtime - a.mtime) || cmpName(a.name, b.name);
    if (s === 'path') return cmpName(a.dirKey, b.dirKey) || cmpName(a.name, b.name);
    if (s === 'rating') return (ratingOf(b) - ratingOf(a)) || cmpName(a.name, b.name);
    if (s === 'shot' || s === 'shotAsc') {
      const ta = shotTs(a), tb = shotTs(b);
      if (!ta && !tb) return cmpName(a.name, b.name);
      if (!ta) return 1;
      if (!tb) return -1;
      return (s === 'shot' ? tb - ta : ta - tb) || cmpName(a.name, b.name);
    }
    return cmpName(a.name, b.name);
  });
  arr.forEach((it, i) => { it._vi = i; });
  state.view = arr;
}

export function buildNodes() {
  const nodes: GridNode[] = [];
  if (state.mode === 'group') {
    const map = new Map<string, typeof state.view>();
    for (const it of state.view) {
      if (!map.has(it.dirKey)) map.set(it.dirKey, []);
      map.get(it.dirKey)!.push(it);
    }
    const dirs = Array.from(map.keys()).sort(cmpName);
    for (const d of dirs) {
      nodes.push({ type: 'group', key: 'g:' + d, dir: d, count: map.get(d)!.length });
      for (const it of map.get(d)!) nodes.push({ type: 'item', key: it.key, item: it });
    }
  } else {
    for (const it of state.view) nodes.push({ type: 'item', key: it.key, item: it });
  }
  state.nodes = nodes;
}

/* ============================ 瀑布流布局 ============================ */
export function layout() {
  const nodes = state.nodes;
  const grid = dom.grid;
  const W = grid ? grid.clientWidth : 0;
  if (!W) return;
  const gap = state.gap;
  const cw = state.colWidth;
  const cols = Math.max(1, Math.floor((W + gap) / (cw + gap)));
  const colW = Math.floor((W - gap * (cols - 1)) / cols);
  const capH = state.showName ? 38 : 0;

  const heights = new Array(cols).fill(0);
  const pos: LayoutPos[] = new Array(nodes.length);
  let cursor = 0;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'group') {
      const h = 48;
      pos[i] = { x: 0, y: cursor, w: W, h };
      cursor += h;
      for (let c = 0; c < cols; c++) heights[c] = cursor;
      continue;
    }
    const it = n.item;
    const ar = it.aspect || 1.35;
    const imgH = Math.round(colW / ar);
    const h = imgH + capH;
    let c = 0;
    for (let k = 1; k < cols; k++) if (heights[k] < heights[c] - 0.5) c = k;
    pos[i] = { x: c * (colW + gap), y: heights[c], w: colW, h, imgH };
    heights[c] += h + gap;
    if (state.mode === 'group') cursor = Math.max.apply(null, heights);
  }
  state.pos = pos;
  const total = state.mode === 'group' ? cursor : Math.max.apply(null, heights);
  state.gridH = nodes.length ? Math.max(0, total - gap) + 14 : 0;
}

let rafPending = false;

/** 带滚动锚点的重排：图片测得真实宽高后回填，避免视口跳动 */
export function relayout() {
  const st = dom.scrollEl;
  if (!st) { layout(); notify('grid'); return; }
  const top = st.scrollTop;
  let anchor = -1, delta = 0;
  for (let i = 0; i < state.pos.length; i++) {
    const p = state.pos[i];
    if (p && p.y + p.h >= top) { anchor = i; delta = p.y - top; break; }
  }
  layout();
  if (anchor >= 0 && state.pos[anchor]) {
    const nt = state.pos[anchor].y - delta;
    if (Math.abs(nt - st.scrollTop) > 1) st.scrollTop = Math.max(0, nt);
  }
  if (state.pendingScroll != null) applyPendingScroll();
  notify('grid');
}

/** rAF 合并的重排请求（缩略图回填等高频场景） */
export function scheduleLayout() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; relayout(); });
}

/** 恢复上次滚动位置：瀑布流高度会随缩略图尺寸回填逐步增长，需多次尝试才能到位 */
export function restoreScroll(top: number) {
  state.pendingScroll = Math.max(0, top | 0);
  applyPendingScroll();
  [60, 200, 500, 1200].forEach(d => setTimeout(applyPendingScroll, d));
}

export function applyPendingScroll() {
  if (state.pendingScroll == null) return;
  const st = dom.scrollEl;
  if (!st) return;
  const max = Math.max(0, st.scrollHeight - st.clientHeight);
  const t = Math.min(state.pendingScroll, max);
  st.scrollTop = t;
  if (Math.abs(t - state.pendingScroll) < 4 || max <= 0) state.pendingScroll = null;
  notify('grid');
}

export function scrollToIndex(idx: number) {
  const nodeIdx = state.nodes.findIndex(n => n.type === 'item' && n.item === state.view[idx]);
  const p = state.pos[nodeIdx];
  if (p && dom.scrollEl) dom.scrollEl.scrollTop = Math.max(0, p.y - 80);
}

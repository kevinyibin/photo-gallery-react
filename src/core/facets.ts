/**
 * 作品筛选面板数据 —— 相机 / 镜头 / 焦距 / 年份 / 主色调 / 标签的聚合统计与切换。
 * 渲染由 FacetPanel 组件完成。
 */
import { state, dom, notify } from './store';
import { cmpName, cameraLabel, lensLabel, focalBinOf, exifYear } from './utils';
import { tagsOf } from './meta';
import { refresh, refreshView } from './engine';
import { saveSessionDebounced } from './session';

export const FACET_KEYS = ['camera', 'lens', 'focal', 'year', 'color', 'tag'] as const;
export type FacetKey = typeof FACET_KEYS[number];

export function photoFacetActive(): boolean {
  const f = state.filter;
  return !!((f.camera && f.camera.size) || (f.lens && f.lens.size) ||
            (f.focal && f.focal.size) || (f.year && f.year.size) ||
            (f.color && f.color.size) || (f.tag && f.tag.size));
}

export function activeFacetCount(): number {
  const f = state.filter as any;
  let n = 0;
  FACET_KEYS.forEach(k => { if (f[k] && f[k].size) n += f[k].size; });
  return n;
}

export interface FacetData {
  cam: Map<string, number>;
  len: Map<string, number>;
  foc: Map<string, number>;
  yr: Map<string, number>;
  col: Map<string, number>;
  tag: Map<string, number>;
  photos: number;
  withInfo: number;
}

export function buildFacetData(): FacetData {
  const cam = new Map<string, number>(), len = new Map<string, number>(),
        foc = new Map<string, number>(), yr = new Map<string, number>();
  const col = new Map<string, number>(), tag = new Map<string, number>();
  let photos = 0, withInfo = 0;
  for (const it of state.items) {
    // 标签对图片与视频都适用，单独统计
    for (const t of tagsOf(it)) tag.set(t, (tag.get(t) || 0) + 1);
    if (it.kind !== 'image') continue;
    photos++;
    if (it.fam) col.set(it.fam, (col.get(it.fam) || 0) + 1);
    const e = it.exif;
    if (!e) continue;
    withInfo++;
    const c = cameraLabel(e); if (c) cam.set(c, (cam.get(c) || 0) + 1);
    const l = lensLabel(e); if (l) len.set(l, (len.get(l) || 0) + 1);
    const fb = focalBinOf(e); if (fb) foc.set(fb, (foc.get(fb) || 0) + 1);
    const y = exifYear(e); if (y) yr.set(String(y), (yr.get(String(y)) || 0) + 1);
  }
  return { cam, len, foc, yr, col, tag, photos, withInfo };
}

/** 排序辅助：面板内使用 */
export function sortFacetRows(map: Map<string, number>, sortFn?: (a: [string, number], b: [string, number]) => number) {
  const rows = Array.from(map.entries());
  return sortFn ? rows.sort(sortFn) : rows;
}
export const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1] || cmpName(a[0], b[0]);

/** 节流刷新筛选面板；筛选激活时同步刷新结果列表（照片会随解析进度逐步出现） */
let facetTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleFacetRefresh() {
  if (facetTimer) return;
  facetTimer = setTimeout(() => {
    facetTimer = null;
    notify('facets', 'status');
    if (photoFacetActive()) refreshView();
  }, 600);
}

export function toggleFacet(fk: FacetKey, v: string) {
  const f = state.filter as any;
  let s: Set<string> | null = f[fk];
  if (!s) s = f[fk] = new Set<string>();
  if (s.has(v)) s.delete(v); else s.add(v);
  if (!s.size) f[fk] = null;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function clearFacet(fk: FacetKey) {
  (state.filter as any)[fk] = null;
  refresh();
  saveSessionDebounced();
}

/**
 * 只保留这一项（右键菜单「只看 xx」）：把该维度替换为单项集合。
 * 与 toggleFacet 的区别是「替换」而非「叠加」，用于从多选快速收敛到一个值。
 */
export function setFacetOnly(fk: FacetKey, v: string) {
  const f = state.filter as any;
  const cur: Set<string> | null = f[fk];
  if (cur && cur.size === 1 && cur.has(v)) return;
  f[fk] = new Set([v]);
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function clearAllFacets() {
  state.filter.camera = state.filter.lens = state.filter.focal = state.filter.year = null;
  state.filter.color = state.filter.tag = null;
  refresh();
  if (dom.scrollEl) dom.scrollEl.scrollTop = 0;
  saveSessionDebounced();
}

export function toggleTagMode() {
  state.tagMode = state.tagMode === 'any' ? 'all' : 'any';
  refresh();
  saveSessionDebounced();
}

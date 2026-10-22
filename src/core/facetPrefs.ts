/**
 * 侧栏筛选维度的「顺序 + 显隐」偏好 —— 读写与变更的唯一入口。
 *
 * 存储位置：与其它 UI 偏好同一条记录（kv 存储的 'ui' 键，见 core/session 的
 * saveUI / applyUI）。顺序是保序数组、隐藏是数组（读回时还原成 Set），
 * 二者都由 constants 里的 normalize* 做归一化，避免旧配置 / 脏数据打穿渲染。
 *
 * 为什么放在独立模块：FacetPanel（渲染）与 SettingsDialog（配置）都要用，
 * 但都不应该直接写 state + saveUI —— 把「改状态 + 通知频道 + 落库」收在一处，
 * 避免某处漏掉持久化导致刷新后配置丢失。
 */
import { state, notify } from './store';
import { saveUI } from './session';
import {
  DEFAULT_FACET_ORDER, FACET_GROUPS, facetLabel, isFacetGroup,
  normalizeFacetOrder, normalizeFacetHidden, type FacetGroup
} from './constants';

/** 当前生效的显示顺序（渲染前再归一化一次，任何脏数据都退化为出厂顺序） */
export function facetOrder(): FacetGroup[] {
  return normalizeFacetOrder(state.facetOrder);
}

/** 当前被隐藏的维度集合（返回副本，调用方改动不会污染全局状态） */
export function hiddenFacets(): Set<FacetGroup> {
  return new Set(normalizeFacetHidden(Array.from(state.facetHidden)));
}

export function isFacetHidden(k: FacetGroup): boolean {
  return state.facetHidden.has(k);
}

/** 维度展示名（设置列表用） */
export { facetLabel, FACET_GROUPS };
export type { FacetGroup };

/**
 * 一次性写入「顺序 + 显隐」：更新 state → 通知筛选面板重渲染 → 立即落库。
 * 所有变更最终都汇聚到这里，保证内存与持久化永远同源。
 */
export function setFacetGroups(order: FacetGroup[], hidden: Iterable<FacetGroup>) {
  state.facetOrder = normalizeFacetOrder(order);
  state.facetHidden = new Set(normalizeFacetHidden(Array.from(hidden)));
  notify('facets');
  saveUI();
}

/** 拖拽排序：把 from 插到 to 的位置（同 key 或越界时不做任何事） */
export function reorderFacet(from: FacetGroup, to: FacetGroup) {
  if (from === to) return;
  const order = facetOrder();
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  order.splice(j, 0, order.splice(i, 1)[0]);
  setFacetGroups(order, state.facetHidden);
}

/** 上移 / 下移（delta = -1 / +1；键盘操作与按钮共用） */
export function moveFacet(k: FacetGroup, delta: number) {
  const order = facetOrder();
  const i = order.indexOf(k);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  order.splice(j, 0, order.splice(i, 1)[0]);
  setFacetGroups(order, state.facetHidden);
}

/** 单项显隐切换 */
export function toggleFacetHidden(k: FacetGroup, hidden?: boolean) {
  const set = hiddenFacets();
  const next = hidden == null ? !set.has(k) : !!hidden;
  if (next) set.add(k); else set.delete(k);
  setFacetGroups(state.facetOrder, set);
}

/** 恢复出厂：默认顺序 + 全部显示 */
export function resetFacetGroups() {
  setFacetGroups(DEFAULT_FACET_ORDER.slice(), []);
}

/** 兜底校验（设置面板从持久化恢复时用） */
export { isFacetGroup };

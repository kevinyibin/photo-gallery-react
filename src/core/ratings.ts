/**
 * 评分 —— 与原版本一致：0-5 星，防抖落库。
 * 评分已弱化：网格卡片不再展示评分，仅在详情页 / 批量条 / 更多筛选中体现。
 */
import { ST_RATE } from './constants';
import { persist } from './persist';
import { state, notify } from './store';
import { sigOf } from './utils';
import type { MediaItem } from './types';

export function ratingOf(it: MediaItem): number {
  const r = state.ratings.get(sigOf(it));
  return r ? (r.r || 0) : 0;
}

/* --- 评分写入防抖：批量标记时合并为一次落库 --- */
const rateDirty = new Map<string, true>();
let rateTimer: ReturnType<typeof setTimeout> | null = null;

export function flushRatings() {
  rateTimer = null;
  const keys = Array.from(rateDirty.keys());
  rateDirty.clear();
  keys.forEach(sig => {
    const v = state.ratings.get(sig);
    if (v && v.r) persist.set(ST_RATE, sig, { r: v.r, ts: v.ts });
    else persist.del(ST_RATE, sig);
  });
}

function persistRating(sig: string) {
  rateDirty.set(sig, true);
  if (rateTimer) return;
  rateTimer = setTimeout(flushRatings, 400);
}

export function setRating(it: MediaItem | null, v: number) {
  if (!it) return;
  const sig = sigOf(it);
  const val = Math.max(0, Math.min(5, v | 0));
  if (val === 0) state.ratings.delete(sig);
  else state.ratings.set(sig, { r: val, ts: Date.now() });
  persistRating(sig);
  notify('lightbox', 'status', 'tree');
}

/** 彻底删除时清理评分记录 */
export function purgeRatingOf(it: MediaItem) {
  state.ratings.delete(sigOf(it));
  persistRating(sigOf(it));
}

export function setRatingMany(list: MediaItem[], v: number) {
  for (const it of list) {
    const sig = sigOf(it);
    const val = Math.max(0, Math.min(5, v | 0));
    if (val === 0) state.ratings.delete(sig);
    else state.ratings.set(sig, { r: val, ts: Date.now() });
    persistRating(sig);
  }
  notify('lightbox', 'status', 'tree');
}

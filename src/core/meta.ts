/**
 * 标签 + 主色调 + 喜欢 + 废纸篓（meta 存储）。
 * 存储复用 sigOf 签名（路径|名称|体积），与评分同一套键规则。
 * 喜欢 / 废纸篓标记随 meta 一并持久化。
 */
import { ST_META } from './constants';
import { persist } from './persist';
import { state, notify, setLeft } from './store';
import { sigOf, esc } from './utils';
import { familyOfHex } from './colors';
import { thumbCache } from './thumbs';
import { buildTree } from './tree';
import { ratingOf } from './ratings';
import type { MediaItem, MetaRecord } from './types';

const NO_TAGS: string[] = [];

/** 把 meta 记录挂到 item 上（载入会话或新建条目时调用一次） */
export function hydrateMeta(it: MediaItem) {
  const m = state.meta.get(sigOf(it));
  it.tags = (m && m.tags && m.tags.length) ? m.tags : (it.tags || []);
  if (!it.pal && m && m.pal && m.pal.length) {
    it.pal = m.pal;
    it.fam = familyOfHex(m.pal[0]);
  }
  if (!it.tags) it.tags = [];
  // 喜欢 / 废纸篓标记随 meta 一并恢复
  it.liked = !!(m && m.like);
  it.trashed = !!(m && m.trash);
  // Sony ARW 联动状态
  it.rawMoved = (m && m.rawMoved) || '';
  it.rawTrash = !!(m && m.rawTrash);
  it.rawMovedName = (m && m.rawMovedName) || '';
}

export function tagsOf(it: MediaItem | null): string[] { return (it && it.tags) || NO_TAGS; }
export function hasTag(it: MediaItem, t: string): boolean { return tagsOf(it).indexOf(t) >= 0; }

/** 写回 meta（内存 + 脏标记防抖落库） */
export function writeMeta(it: MediaItem | null) {
  if (!it) return;
  const sig = sigOf(it);
  const tags = (it.tags || []).slice();
  const pal = it.pal || [];
  const like = !!it.liked, trash = !!it.trashed;
  const rawMoved = it.rawMoved || '', rawTrash = !!it.rawTrash, rawMovedName = it.rawMovedName || '';
  if (!tags.length && !pal.length && !like && !trash && !rawMoved && !rawTrash) {
    state.meta.delete(sig);
    metaDirty.set(sig, null);
  } else {
    const rec: MetaRecord = { tags, pal, like, trash, rawMoved, rawTrash, rawMovedName, ts: Date.now() };
    state.meta.set(sig, rec);
    metaDirty.set(sig, rec);
  }
  persistMeta();
}

const metaDirty = new Map<string, MetaRecord | null>();
let metaTimer: ReturnType<typeof setTimeout> | null = null;
let metaBulk = false;          // 批量操作期间暂停自动落库，改由分块写入统一提交

export function flushMeta() {
  metaTimer = null;
  const keys = Array.from(metaDirty.keys());
  metaDirty.clear();
  keys.forEach(sig => {
    const v = state.meta.get(sig);
    if (v) persist.set(ST_META, sig, v); else persist.del(ST_META, sig);
  });
}

function persistMeta() {
  if (metaBulk) return;                 // 批量场景：留给 flushMetaBulk 统一提交
  if (metaTimer) return;
  metaTimer = setTimeout(flushMeta, 400);
}

/**
 * 分块提交脏记录（批量打标签时避免一次开巨大事务）：
 * 每 400 条一个事务，逐块推进并回调进度；失败的块按 sig 归因到具体文件。
 */
export function flushMetaBulk(onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: Map<string, string> }> {
  const keys = Array.from(metaDirty.keys());
  metaDirty.clear();
  const CHUNK = 400;
  const failed = new Map<string, string>();
  let done = 0;
  return new Promise(resolve => {
    const step = () => {
      if (done >= keys.length) { if (onProgress) onProgress(done, keys.length); return resolve({ ok: keys.length - failed.size, failed }); }
      const part = keys.slice(done, done + CHUNK);
      const puts: any[][] = [], dels: string[] = [];
      part.forEach(sig => {
        const v = state.meta.get(sig);
        if (v) puts.push([sig, v]); else dels.push(sig);
      });
      const jobs: Promise<any>[] = [];
      if (puts.length) jobs.push(persist.setMany(ST_META, puts).then(n => { if (n < 0) puts.forEach(p => failed.set(p[0], '存储写入失败')); }));
      if (dels.length) jobs.push(persist.delMany(ST_META, dels).then(n => { if (n < 0) dels.forEach(s => failed.set(s, '存储删除失败')); }));
      Promise.all(jobs).then(() => {
        done += part.length;
        if (onProgress) onProgress(done, keys.length);
        setTimeout(step, 0);
      });
    };
    step();
  });
}

export function setMetaBulk(on: boolean) { metaBulk = on; }

/* ---- 标签：单图增删改 ---- */
export function normalizeTag(t: unknown): string {
  return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 24);
}

/** 解析输入框内容：逗号 / 分号 / 空格 / 换行 均可分隔 */
export function parseTags(str: string): string[] {
  const out: string[] = [];
  String(str || '').split(/[,，;；\s]+/).forEach(t => {
    const v = normalizeTag(t);
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  return out.slice(0, 12);
}

export function addTags(it: MediaItem, list: string[]): number {
  let changed = 0;
  for (const t of list) {
    if (!t || hasTag(it, t)) continue;
    it.tags = tagsOf(it).concat([t]);
    changed++;
  }
  if (changed) writeMeta(it);
  return changed;
}

export function removeTags(it: MediaItem, list: string[]): number {
  const before = tagsOf(it).length;
  it.tags = tagsOf(it).filter(t => list.indexOf(t) < 0);
  if (it.tags.length !== before) writeMeta(it);
  return before - it.tags.length;
}

export function replaceTags(it: MediaItem, list: string[]) {
  const before = tagsOf(it).join('');
  it.tags = list.slice();
  if (it.tags.join('') !== before) writeMeta(it);
}

/* ---- 标签：全局改名 / 删除 ---- */
export function allTagCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of state.items) {
    for (const t of tagsOf(it)) m.set(t, (m.get(t) || 0) + 1);
  }
  return m;
}

export function renameTagEverywhere(oldT: string, newT: string): { ok: number; failed: any[]; tag?: string } {
  const t = normalizeTag(newT);
  if (!t || t === oldT) return { ok: 0, failed: [] };
  const touched: MediaItem[] = [];
  for (const it of state.items) if (hasTag(it, oldT)) touched.push(it);
  for (const it of touched) {
    it.tags = tagsOf(it).map(x => (x === oldT ? t : x));
    writeMeta(it);
  }
  return { ok: touched.length, failed: [], tag: t };
}

export function deleteTagEverywhere(t: string): { ok: number; failed: any[] } {
  const touched: MediaItem[] = [];
  for (const it of state.items) if (hasTag(it, t)) touched.push(it);
  for (const it of touched) {
    it.tags = tagsOf(it).filter(x => x !== t);
    writeMeta(it);
  }
  if (state.filter.tag && state.filter.tag.has(t)) {
    state.filter.tag.delete(t);
    if (!state.filter.tag.size) state.filter.tag = null;
  }
  return { ok: touched.length, failed: [] };
}

/** 彻底删除时清理 meta 记录（内存 + 脏标记） */
export function purgeMetaOf(it: MediaItem) {
  const sig = sigOf(it);
  state.meta.delete(sig);
  metaDirty.set(sig, null);
  persistMeta();
}

/* ============================ 喜欢标记 + 废纸篓 ============================ */
export function likedOf(it: MediaItem | null): boolean { return !!(it && it.liked); }
export function trashedOf(it: MediaItem | null): boolean { return !!(it && it.trashed); }

export function trashCount(): number {
  let n = 0;
  for (const it of state.items) if (it.trashed) n++;
  return n;
}

/** 标签建议 HTML（弹窗主体用，沿用原版本的字符串模板） */
export function tagSuggestHtml(limit?: number): string {
  const all = Array.from(allTagCounts().keys()).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
  if (!all.length) return '';
  return '<div class="tg-sugs">' + all.slice(0, limit || 40)
    .map(t => `<span class="tg-sug" data-t="${esc(t)}">${esc(t)}</span>`).join('') + '</div>';
}

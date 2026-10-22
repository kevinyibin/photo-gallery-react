/**
 * 缩略图管线 —— 与原版本一致：
 * createImageBitmap 降采样优先（失败回退 <img>）、LRU 缓存、请求去重、
 * 并发限制、滚出视口的请求精确取消、视频离屏抽帧封面。
 * 与 React 的衔接：瓦片组件通过 requestThumb / requestPoster 拿结果，
 * 缓存命中时同步返回；生成完成后通过回调通知组件。
 */
import { THUMB_LIMIT, THUMB_CONC, POSTER_LIMIT, POSTER_CONC } from './constants';
import { state, notify } from './store';
import { fmtDur } from './utils';
import { samplePalette, familyOfHex } from './colors';
import { writeMeta } from './meta';
import { scheduleFacetRefresh } from './facets';
import type { MediaItem } from './types';

export interface ThumbRec { url: string; w: number; h: number; aspect: number; tw: number; it?: MediaItem; }

export const thumbCache = new Map<number, ThumbRec>();   // item.id -> rec
const thumbWaiters = new Map<number, ((rec: ThumbRec | null, dropped?: boolean) => void)[]>();
const thumbQueue: MediaItem[] = [];
let thumbActive = 0;

/** 目标缩略图宽度（按当前瓦片尺寸的 2 倍取样，兼顾清晰度与内存） */
export function thumbTarget(): number {
  return Math.max(240, Math.min(640, Math.round(state.colWidth * 2)));
}

function touchThumb(it: MediaItem, rec: ThumbRec) {
  const id = it.id;
  rec.it = it;
  thumbCache.delete(id);
  thumbCache.set(id, rec);
  // LRU 淘汰：跳过当前仍在视口内显示的项目，否则会把正在显示的 blob 撤销成空白
  let guard = thumbCache.size;
  while (thumbCache.size > THUMB_LIMIT && guard-- > 0) {
    const first = thumbCache.keys().next().value as number;
    const old = thumbCache.get(first);
    if (old && old.it && old.it._shown) {
      thumbCache.delete(first);
      thumbCache.set(first, old);   // 移到队尾，稍后再考虑
      continue;
    }
    if (old && old.url) URL.revokeObjectURL(old.url);
    thumbCache.delete(first);
  }
}

export type ThumbCallback = (rec: ThumbRec | null, dropped?: boolean) => void;

/** 请求缩略图；返回同步命中的缓存（未命中返回 null，结果走回调） */
export function requestThumb(it: MediaItem, cb: ThumbCallback): ThumbRec | null {
  const cached = thumbCache.get(it.id);
  if (cached && cached.tw >= thumbTarget()) return cached;
  const w = thumbWaiters.get(it.id);
  if (w) { w.push(cb); return null; }
  thumbWaiters.set(it.id, [cb]);
  thumbQueue.push(it);
  pumpThumb();
  return null;
}

function pumpThumb() {
  while (thumbActive < THUMB_CONC && thumbQueue.length) {
    const it = thumbQueue.shift()!;
    thumbActive++;
    makeThumb(it).then(rec => {
      thumbActive--;
      if (rec) touchThumb(it, rec);
      else it._tries = (it._tries || 0) + 1;
      const ws = thumbWaiters.get(it.id) || [];
      thumbWaiters.delete(it.id);
      ws.forEach(fn => { try { fn(rec!); } catch (e) {} });
      pumpThumb();
    });
  }
}

/**
 * 精确清理生成队列：只丢弃已滚出视口的请求（由网格组件给出当前可见集合判断）。
 */
export function pruneQueues(visibleIds: Set<number>) {
  const drop = (queue: MediaItem[], waiters: Map<number, any[]>) => {
    if (!queue.length) return;
    const kept: MediaItem[] = [];
    for (const it of queue) {
      if (visibleIds.has(it.id)) { kept.push(it); continue; }
      const ws = waiters.get(it.id) || [];
      waiters.delete(it.id);
      ws.forEach(fn => { try { fn(null, true); } catch (e) {} });
    }
    queue.length = 0;
    for (const it of kept) queue.push(it);
  };
  drop(thumbQueue, thumbWaiters);
  drop(posterQueue, posterWaiters);
}

/** 清空全部缩略图 / 封面队列与缓存（清空图库时用） */
export function resetThumbPipelines() {
  posterLRU.forEach(p => { if (p && p.url) URL.revokeObjectURL(p.url); });
  posterLRU.clear();
  thumbCache.forEach(rec => { if (rec && rec.url) URL.revokeObjectURL(rec.url); });
  thumbCache.clear();
  thumbQueue.length = 0;
  thumbWaiters.clear();
  posterQueue.length = 0;
  posterWaiters.clear();
}

function canvasToRec(c: HTMLCanvasElement, w: number, h: number, tw: number): Promise<ThumbRec | null> {
  return new Promise(resolve => {
    try {
      c.toBlob(b => {
        if (!b) return resolve(null);
        resolve({ url: URL.createObjectURL(b), w, h, tw, aspect: w / h });
      }, 'image/jpeg', 0.82);
    } catch (e) { resolve(null); }
  });
}

/** 生成缩略图：优先 createImageBitmap 降采样（避免整图解码），失败回退到 <img> */
function makeThumb(it: MediaItem): Promise<ThumbRec | null> {
  const target = thumbTarget();
  if (!it.file) return Promise.resolve(null);
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(it.file, {
      resizeWidth: target,
      resizeQuality: 'medium',
      imageOrientation: 'from-image'   // 按 EXIF 方向纠正，避免缩略图与原图方向不一致
    } as ImageBitmapOptions)
      .then(bmp => {
        // SVG / 无固有尺寸的图会得到 0 尺寸位图，交给 <img> 兜底
        if (!bmp.width || !bmp.height || bmp.width < 2 || bmp.height < 2) {
          if (bmp.close) { try { bmp.close(); } catch (e) {} }
          return thumbViaImg(it, target);
        }
        const w = bmp.width, h = bmp.height;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d')!;
        g.fillStyle = '#ffffff';           // 透明图填充白底，避免转 JPEG 后发黑
        g.fillRect(0, 0, w, h);
        g.drawImage(bmp, 0, 0);
        // 位图已经解码完成，顺手采样主色调，省掉色彩队列的一次重复解码（仅在设置中开启色调分析后执行）
        if (state.colorEnabled && !it.palDone) setPalette(it, samplePalette(bmp));
        if (bmp.close) { try { bmp.close(); } catch (e) {} }
        return canvasToRec(c, w, h, target);
      })
      .catch(() => thumbViaImg(it, target));
  }
  return thumbViaImg(it, target);
}

function thumbViaImg(it: MediaItem, target: number): Promise<ThumbRec | null> {
  return new Promise(resolve => {
    if (!it.url) it.url = URL.createObjectURL(it.file);
    const img = new Image();
    img.onload = () => {
      // 无固有尺寸（部分 SVG）时用默认画布比例，避免算出 0×0 的空白缩略图
      const nw = img.naturalWidth || target, nh = img.naturalHeight || Math.round(target * 0.75);
      const scale = Math.min(1, target / Math.max(nw, nh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(nw * scale));
      c.height = Math.max(1, Math.round(nh * scale));
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      if (state.colorEnabled && !it.palDone) setPalette(it, samplePalette(c));
      canvasToRec(c, c.width, c.height, target).then(resolve);
    };
    img.onerror = () => resolve(null);
    img.src = it.url;
  });
}

/* --- 视频封面：离屏 video 抽帧 → canvas 导出 --- */
export const posterLRU = new Map<number, { url: string; it: MediaItem }>();
const posterWaiters = new Map<number, ((ok: boolean, dropped?: boolean) => void)[]>();
let posterActive = 0;
const posterQueue: MediaItem[] = [];

function touchPoster(it: MediaItem, url: string) {
  const id = it.id;
  posterLRU.delete(id);
  posterLRU.set(id, { url, it });
  // 同缩略图：不撤销仍在视口内显示的封面
  let guard = posterLRU.size;
  while (posterLRU.size > POSTER_LIMIT && guard-- > 0) {
    const first = posterLRU.keys().next().value as number;
    const old = posterLRU.get(first);
    if (old && old.it && old.it._shown) {
      posterLRU.delete(first);
      posterLRU.set(first, old);
      continue;
    }
    if (old && old.url) URL.revokeObjectURL(old.url);
    posterLRU.delete(first);
  }
}

export function requestPoster(it: MediaItem, cb: (ok: boolean, dropped?: boolean) => void) {
  const w = posterWaiters.get(it.id);
  if (w) { w.push(cb); return; }
  posterWaiters.set(it.id, [cb]);
  posterQueue.push(it);
  pumpPoster();
}

function pumpPoster() {
  while (posterActive < POSTER_CONC && posterQueue.length) {
    const it = posterQueue.shift()!;
    if (!it.file) {
      const ws = posterWaiters.get(it.id) || [];
      posterWaiters.delete(it.id);
      ws.forEach(fn => fn(false, true));
      continue;
    }
    posterActive++;
    extractPoster(it.file).then(res => {
      posterActive--;
      if (res.poster) { it.poster = res.poster; touchPoster(it, res.poster); }
      else it._ptried = (it._ptried || 0) + 1;   // 抽帧失败最多重试 2 次
      if (res.w && res.h) { it.w = res.w; it.h = res.h; it.aspect = res.w / res.h; }
      if (res.dur) it.dur = res.dur;
      const ws = posterWaiters.get(it.id) || [];
      posterWaiters.delete(it.id);
      ws.forEach(fn => { try { fn(!!res.poster); } catch (e) {} });
      if (res.w && res.h && res.poster) scheduleLayoutFromThumbs();
      pumpPoster();
    });
  }
}

export interface PosterResult { poster: string | null; w: number; h: number; dur: number; }

function extractPoster(file: File): Promise<PosterResult> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    let dur = 0, vw = 0, vh = 0;

    const finish = (poster: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (seekTimer) clearTimeout(seekTimer);
      try { v.removeAttribute('src'); v.load(); } catch (e) {}
      URL.revokeObjectURL(url);
      resolve({ poster, w: vw, h: vh, dur });
    };

    // 抽帧：优先用 seeked 回调，超时则直接抓当前帧兜底
    const grab = () => {
      if (done) return;
      if (!v.videoWidth) return finish(null);
      vw = v.videoWidth; vh = v.videoHeight;
      try {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 460 / Math.max(vw, vh));
        c.width = Math.max(1, Math.round(vw * scale));
        c.height = Math.max(1, Math.round(vh * scale));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => finish(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.72);
      } catch (e) { finish(null); }
    };

    let seekTimer: ReturnType<typeof setTimeout> | null = null;
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      dur = v.duration || 0; vw = v.videoWidth; vh = v.videoHeight;
      const t = Math.min(1, (isFinite(dur) && dur > 0 ? dur : 1) * 0.2);
      // 若目标时间已等于当前时间，seeked 不会触发，用定时器兜底
      seekTimer = setTimeout(grab, 2500);
      try { v.currentTime = t; } catch (e) { if (seekTimer) clearTimeout(seekTimer); finish(null); }
    };
    v.onseeked = () => { if (seekTimer) clearTimeout(seekTimer); grab(); };

    const timer = setTimeout(() => finish(null), 20000);
    v.src = url;
  });
}

/* ---- 记录调色板：更新内存、标记落库、同步可见卡片与筛选面板 ---- */
export function setPalette(it: MediaItem, pal: string[] | null): boolean {
  if (!pal || !pal.length) { it.palDone = true; return false; }
  it.pal = pal;
  it.fam = familyOfHex(pal[0]);
  it.palDone = true;
  writeMeta(it);
  notify('grid');
  scheduleFacetRefresh();
  return true;
}

/* 避免与 view 模块形成硬循环：布局重排由 view 模块注册回调注入 */
let relayoutFn: (() => void) | null = null;
export function bindRelayout(fn: () => void) { relayoutFn = fn; }
export function scheduleLayoutFromThumbs() { if (relayoutFn) relayoutFn(); }

export { fmtDur };

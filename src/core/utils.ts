/**
 * 纯工具函数 —— 与原版本 utils 段一一对应（无 DOM / 无状态依赖）。
 */
import { IMAGE_EXT, VIDEO_EXT, FOCAL_BINS } from './constants';
import type { ExifData, MediaItem } from './types';

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function kindOf(name: string): 'image' | 'video' | null {
  const e = extOf(name);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  return null;
}

export function fmtSize(b: number): string {
  if (!b && b !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (i === 0 ? String(b) : b.toFixed(b < 10 ? 2 : 1)) + ' ' + u[i];
}

export function fmtDur(s: number): string {
  if (!isFinite(s) || s <= 0) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

export function fmtDate(t: number): string {
  if (!t) return '—';
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** HTML 转义（用于拼接进弹窗等 innerHTML 的内容） */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function cmpName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/** requestIdleCallback 降级 */
export const idle: (fn: () => void) => void =
  typeof window !== 'undefined' && (window as any).requestIdleCallback
    ? (window as any).requestIdleCallback.bind(window)
    : fn => { setTimeout(fn, 120); };

export function now(): number {
  return window.performance && performance.now ? performance.now() : Date.now();
}

/* ============================ EXIF 工具 ============================ */

export function focalBinLabel(k: string): string {
  for (const b of FOCAL_BINS) if (b.key === k) return b.label;
  return k;
}

export function focalBinOf(e: ExifData | null): string {
  const f = e && (e.focal35 || e.focal);
  if (!f || f <= 0) return '';
  for (const b of FOCAL_BINS) if (f <= b.max) return b.key;
  return '';
}

export function normStr(s: unknown): string {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** 相机显示名：合并厂商与型号，避免 "Canon Canon EOS R6" 这类重复 */
export function cameraLabel(e: ExifData | null): string {
  if (!e) return '';
  const make = normStr(e.make), model = normStr(e.model);
  if (make && model) {
    return model.toLowerCase().indexOf(make.toLowerCase()) === 0 ? model : make + ' ' + model;
  }
  return make || model || '';
}

export function lensLabel(e: ExifData | null): string {
  if (!e) return '';
  const mk = normStr(e.lensMake), md = normStr(e.lensModel);
  if (mk && md) {
    return md.toLowerCase().indexOf(mk.toLowerCase()) === 0 ? md : mk + ' ' + md;
  }
  return md || mk || '';
}

export function exifYear(e: ExifData | null): number {
  if (!e || !e.dateTimeOriginal) return 0;
  const y = parseInt(e.dateTimeOriginal.slice(0, 4), 10);
  return (y >= 1900 && y <= 2100) ? y : 0;
}

export function exifDateToTs(s: string | undefined): number {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return 0;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return isFinite(t) ? t : 0;
}

/** 拍摄时间戳（缓存）；无 EXIF 拍摄时间的作品排序时排在最后 */
export function shotTs(it: MediaItem): number {
  if (it._shotTs == null) {
    it._shotTs = (it.exif && it.exif.dateTimeOriginal) ? (exifDateToTs(it.exif.dateTimeOriginal) || -1) : -1;
  }
  return it._shotTs > 0 ? it._shotTs : 0;
}

export function fmtF(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '') || String(v);
}

export function fmtShutter(s: number): string {
  if (s >= 1) return (Math.abs(s - Math.round(s)) < 0.05 ? String(Math.round(s)) : s.toFixed(1)) + ' s';
  const inv = 1 / s;
  if (Math.abs(inv - Math.round(inv)) < 0.08) return '1/' + Math.round(inv) + ' s';
  return s.toFixed(2).replace(/\.?0+$/, '') + ' s';
}

export function fmtEV(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (r > 0 ? '+' : '') + r + ' EV';
}

export function fmtExifDate(s: string | undefined): string {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
  if (!m) return normStr(s);
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + (m[6] ? ':' + m[6] : '');
}

export function focalText(e: ExifData | null): string {
  if (!e) return '';
  const f = e.focal ? Math.round(e.focal) : 0;
  const f35 = e.focal35 ? Math.round(e.focal35) : 0;
  if (f && f35 && Math.abs(f35 - f) > 1) return f + ' mm（等效 ' + f35 + ' mm）';
  if (f) return f + ' mm';
  if (f35) return f35 + ' mm';
  return '';
}

/** 缩略图卡片第二行的一句话拍摄参数摘要 */
export function exifSummary(it: MediaItem): string {
  const e = it.exif;
  if (!e) return '';
  const p: string[] = [];
  const f = e.focal35 || e.focal;
  if (f) p.push(Math.round(f) + 'mm');
  if (e.fNumber) p.push('ƒ/' + fmtF(e.fNumber));
  if (e.exposure) p.push(fmtShutter(e.exposure));
  if (e.iso) p.push('ISO ' + Math.round(e.iso));
  return p.join(' · ');
}

/**
 * 会话无关的稳定签名：路径 + 名称 + 体积（不依赖 id，重扫后仍可命中）
 * 评分与 meta（标签 / 喜欢 / 废纸篓）共用这一套键规则。
 */
export function sigOf(it: MediaItem): string {
  return (it.dirKey || '') + '|' + it.name + '|' + it.size;
}

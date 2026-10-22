/**
 * EXIF 解析 —— 通用功能选用社区成熟方案 exifr（活跃维护、覆盖 JPEG/TIFF/PNG/HEIC/AVIF），
 * 解析结果归一化为应用内部的 ExifData 形状（字段校验范围与原版本完全一致）。
 * exifr 不支持的场景（如 WebP EXIF 块）回退到内置的 PhoExif 轻量解析器。
 */
import exifr from 'exifr';
import type { ExifData } from './types';
import { parseExifLite } from './exifLite';

/** 需要提取的字段（exifr 的 pick 选项：只读取这些段，避免全量解析） */
const PICK = [
  'Make', 'Model', 'ModifyDate',
  'LensMake', 'LensModel',
  'FNumber', 'ExposureTime', 'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity',
  'ExposureCompensation', 'ExposureBiasValue',
  'FocalLength', 'FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm',
  'DateTimeOriginal', 'CreateDate'
];

function pickKey(o: any, ...keys: string[]): any {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function str(v: any): string | undefined {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s || undefined;
}

function numIn(v: any, lo: number, hi: number): number | undefined {
  const n = +v;
  return isFinite(n) && n > lo && n < hi ? n : undefined;
}

/** 把 exifr 返回的 Date / 字符串统一成 EXIF 原始格式 "YYYY:MM:DD HH:MM:SS"（本地时区分量） */
function toExifDate(v: any): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) {
    if (!isFinite(v.getTime())) return undefined;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}:${p(v.getMonth() + 1)}:${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = String(v).trim();
  // 兼容 "YYYY-MM-DD HH:MM:SS" 写法
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
  return undefined;
}

/** 归一化 exifr 输出 → 内部 ExifData（校验范围与原 parseTIFF 相同） */
function normalize(o: any): ExifData | null {
  if (!o || typeof o !== 'object') return null;
  const out: ExifData = {};
  out.make = str(pickKey(o, 'Make'));
  out.model = str(pickKey(o, 'Model'));
  out.dateTime = toExifDate(pickKey(o, 'ModifyDate'));
  out.lensMake = str(pickKey(o, 'LensMake'));
  out.lensModel = str(pickKey(o, 'LensModel'));

  const exposure = numIn(pickKey(o, 'ExposureTime'), 0, 1e5);
  if (exposure) out.exposure = exposure;
  const fNumber = numIn(pickKey(o, 'FNumber'), 0.3, 200);
  if (fNumber) out.fNumber = fNumber;
  const iso = numIn(pickKey(o, 'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity'), 0, 1e6);
  if (iso) out.iso = iso;
  const bias = pickKey(o, 'ExposureCompensation', 'ExposureBiasValue');
  if (bias != null && isFinite(+bias) && Math.abs(+bias) <= 10) out.exposureBias = +bias;
  const focal = numIn(pickKey(o, 'FocalLength'), 0, 3000);
  if (focal) out.focal = focal;
  const focal35 = numIn(pickKey(o, 'FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm'), 0, 3000);
  if (focal35) out.focal35 = focal35;

  out.dateTimeOriginal =
    toExifDate(pickKey(o, 'DateTimeOriginal')) ||
    toExifDate(pickKey(o, 'CreateDate')) ||
    undefined;

  // 与原版本一致：拍摄时间为空时回退文件级 DateTime
  if (!out.dateTimeOriginal && out.dateTime) out.dateTimeOriginal = out.dateTime;

  const got = out.make || out.model || out.lensModel || out.focal || out.fNumber ||
              out.exposure || out.iso || out.dateTimeOriginal || out.exposureBias != null;
  return got ? out : null;
}

/**
 * 解析文件头部缓冲中的 EXIF。
 * 优先 exifr（成熟方案），失败或无结果时回退内置 PhoExif（覆盖 WebP EXIF 等边界）。
 */
export async function parseExif(buffer: ArrayBuffer): Promise<ExifData | null> {
  try {
    const raw = await exifr.parse(buffer, {
      pick: PICK as any,
      // 关闭不需要的段，降低解析成本
      tiff: true, ifd0: true, exif: true,
      gps: false, interop: false, makerNote: false, userComment: false,
      sanitize: true, reviveValues: true, translateKeys: true, translateValues: false, mergeOutput: true
    } as any);
    const norm = normalize(raw);
    if (norm) return norm;
  } catch (e) { /* 落到兜底解析器 */ }
  try { return parseExifLite(buffer); } catch (e) { return null; }
}

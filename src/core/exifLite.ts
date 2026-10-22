/**
 * PhoExif —— 轻量 EXIF 解析器（纯前端，零依赖）
 * 支持 JPEG(APP1)、WebP(EXIF 块)、PNG(eXIf 块)。
 * 只提取作品集需要的字段：相机 / 镜头 / 焦距(含等效) / 光圈 / 快门 /
 * ISO / 曝光补偿 / 拍摄时间。解析失败或无 EXIF 时返回 null，由调用方优雅降级。
 *
 * 本文件是原 exif.js 的 ES Module 移植版（逻辑逐行一致），
 * 作为 exifr 的兜底解析器（exifr 不支持的 WebP EXIF 等场景）。
 */
import type { ExifData } from './types';

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

export function parseExifLite(buffer: ArrayBuffer): ExifData | null {
  const dv = new DataView(buffer);
  if (dv.byteLength < 8) return null;
  const b0 = dv.getUint16(0), b2 = dv.getUint32(0);
  if (b0 === 0xFFD8) return parseJPEG(dv);          // JPEG
  if (b2 === 0x89504E47) return parsePNG(dv);       // PNG
  if (b2 === 0x52494646) return parseWebP(dv);      // RIFF (WebP)
  return null;
}

/* ---------- 容器 ---------- */

function parseJPEG(dv: DataView): ExifData | null {
  let off = 2;
  const L = dv.byteLength;
  while (off + 4 <= L) {
    if (dv.getUint8(off) !== 0xFF) return null;
    const m = dv.getUint8(off + 1);
    if (m === 0xD9 || m === 0xDA) return null;                 // EOI / SOS：没找到 EXIF
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { off += 2; continue; }
    const segLen = dv.getUint16(off + 2);
    if (segLen < 2) return null;
    if (m === 0xE1 && off + 10 <= L) {                          // APP1
      let s = '';
      for (let i = 0; i < 6; i++) s += String.fromCharCode(dv.getUint8(off + 4 + i));
      if (s === 'Exif\0\0') return parseTIFF(dv, off + 10);
    }
    off += 2 + segLen;
  }
  return null;
}

function parsePNG(dv: DataView): ExifData | null {
  let p = 8;
  const L = dv.byteLength;
  while (p + 8 <= L) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (type === 'eXIf') return parseTIFFAt(dv, p + 8);
    if (type === 'IEND') return null;
    p += 12 + len;                                              // len + type + data + crc
  }
  return null;
}

function parseWebP(dv: DataView): ExifData | null {
  if (dv.byteLength < 12 || dv.getUint32(8) !== 0x57454250) return null;   // 'WEBP'
  let p = 12;
  const L = dv.byteLength;
  while (p + 8 <= L) {
    const four = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const size = dv.getUint32(p + 4, true);
    if (four === 'EXIF') return parseTIFFAt(dv, p + 8);
    p += 8 + size + (size & 1);                                 // RIFF 块按偶数对齐
  }
  return null;
}

/* 有些文件的 EXIF 载荷前会有 "Exif\0\0" 前缀，剥掉再解析 TIFF */
function parseTIFFAt(dv: DataView, q: number): ExifData | null {
  if (q + 6 <= dv.byteLength) {
    let s = '';
    for (let i = 0; i < 6; i++) s += String.fromCharCode(dv.getUint8(q + i));
    if (s === 'Exif\0\0') q += 6;
  }
  return parseTIFF(dv, q);
}

/* ---------- TIFF / IFD ---------- */

interface IfdEntry { tag: number; type: number; count: number; vo: number; }

function parseTIFF(dv: DataView, base: number): ExifData | null {
  if (base + 8 > dv.byteLength) return null;
  const mark = dv.getUint16(base);
  let le: boolean;
  if (mark === 0x4949) le = true;            // "II" 小端
  else if (mark === 0x4D4D) le = false;      // "MM" 大端
  else return null;
  if (dv.getUint16(base + 2, le) !== 0x2A) return null;

  const ifd0Off = dv.getUint32(base + 4, le);
  const ifd0 = readEntries(dv, base, le, ifd0Off);
  if (!ifd0) return null;

  const out: ExifData = {};
  let exifOff = 0;
  for (const e of ifd0) {
    if (e.tag === 0x010F) out.make = str(valAt(dv, base, le, e));
    else if (e.tag === 0x0110) out.model = str(valAt(dv, base, le, e));
    else if (e.tag === 0x0132) out.dateTime = str(valAt(dv, base, le, e));
    else if (e.tag === 0x8769) exifOff = +valAt(dv, base, le, e) || 0;   // ExifSubIFD 指针
  }

  if (exifOff) {
    const sub = readEntries(dv, base, le, exifOff);
    if (sub) {
      for (const s of sub) {
        let v: any;
        switch (s.tag) {
          case 0x829A: v = num(valAt(dv, base, le, s)); if (v > 0 && v < 1e5) out.exposure = v; break;         // ExposureTime
          case 0x829D: v = num(valAt(dv, base, le, s)); if (v > 0.3 && v < 200) out.fNumber = v; break;        // FNumber
          case 0x8827: v = num(valAt(dv, base, le, s)); if (v > 0 && v < 1e6) out.iso = v; break;              // ISOSpeedRatings
          case 0x9003: out.dateTimeOriginal = str(valAt(dv, base, le, s)) || undefined; break;                 // DateTimeOriginal
          case 0x9004: if (!out.dateTimeOriginal) out.dateTimeOriginal = str(valAt(dv, base, le, s)) || undefined; break;
          case 0x9204: v = valAt(dv, base, le, s); if (v != null && isFinite(v) && Math.abs(v) <= 10) out.exposureBias = +v; break; // ExposureBias
          case 0x920A: v = num(valAt(dv, base, le, s)); if (v > 0 && v < 3000) out.focal = v; break;          // FocalLength
          case 0xA405: v = num(valAt(dv, base, le, s)); if (v > 0 && v < 3000) out.focal35 = v; break;        // FocalLengthIn35mmFilm
          case 0xA433: out.lensMake = str(valAt(dv, base, le, s)); break;
          case 0xA434: out.lensModel = str(valAt(dv, base, le, s)); break;
        }
      }
    }
  }

  // 拍摄时间为空时回退 IFD0 的 DateTime（文件级修改时间，聊胜于无）
  if (!out.dateTimeOriginal && out.dateTime) out.dateTimeOriginal = out.dateTime;

  const got = out.make || out.model || out.lensModel || out.focal || out.fNumber ||
              out.exposure || out.iso || out.dateTimeOriginal || out.exposureBias != null;
  return got ? out : null;
}

function readEntries(dv: DataView, base: number, le: boolean, off: number): IfdEntry[] | null {
  const abs = base + off;
  if (off < 8 || abs + 2 > dv.byteLength) return null;
  const n = dv.getUint16(abs, le);
  if (abs + 2 + n * 12 > dv.byteLength) return null;
  const list: IfdEntry[] = [];
  for (let i = 0; i < n; i++) {
    const e = abs + 2 + i * 12;
    list.push({
      tag: dv.getUint16(e, le),
      type: dv.getUint16(e + 2, le),
      count: dv.getUint32(e + 4, le),
      vo: e + 8
    });
  }
  return list;
}

function valAt(dv: DataView, base: number, le: boolean, ent: IfdEntry): any {
  const ts = TYPE_SIZE[ent.type] || 1;
  const size = ts * ent.count;
  const dataOff = size <= 4 ? ent.vo : base + dv.getUint32(ent.vo, le);
  if (dataOff < 0 || dataOff + Math.min(size, 8) > dv.byteLength) return null;
  switch (ent.type) {
    case 2: {                                                  // ASCII（读到 NUL 为止）
      let s = '';
      for (let i = 0; i < ent.count && dataOff + i < dv.byteLength; i++) {
        const c = dv.getUint8(dataOff + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    case 1: case 7: return dv.getUint8(dataOff);
    case 3: return dv.getUint16(dataOff, le);
    case 4: return dv.getUint32(dataOff, le);
    case 9: return dv.getInt32(dataOff, le);
    case 5: { const nu = dv.getUint32(dataOff, le), de = dv.getUint32(dataOff + 4, le); return de ? nu / de : null; }
    case 10: { const nu2 = dv.getInt32(dataOff, le), de2 = dv.getInt32(dataOff + 4, le); return de2 ? nu2 / de2 : null; }
  }
  return null;
}

function str(v: any): string | undefined {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s || undefined;
}

function num(v: any): number | null {
  const n = +v;
  return isFinite(n) ? n : null;
}

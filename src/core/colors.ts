/**
 * 主色调：色系归类与调色板采样（纯函数，与原版本逐行一致）。
 */
import { COLOR_FAMILIES } from './constants';

const FAMILY_MAP: Record<string, { key: string; label: string; css: string }> = (() => {
  const m: Record<string, any> = {};
  COLOR_FAMILIES.forEach(f => { m[f.key] = f; });
  return m;
})();

export function familyLabel(k: string): string { return FAMILY_MAP[k] ? FAMILY_MAP[k].label : k; }
export function familyCss(k: string): string { return FAMILY_MAP[k] ? FAMILY_MAP[k].css : '#cccccc'; }

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = ((b - r) / d + 2);
  else h = ((r - g) / d + 4);
  return [h * 60, s, l];
}

export function rgbHex(r: number, g: number, b: number): string {
  const f = (v: number) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
  return '#' + f(r) + f(g) + f(b);
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

export function familyOfHex(hex: string): string {
  const c = hexToRgb(hex);
  const hsl = rgbToHsl(c[0], c[1], c[2]);
  const h = hsl[0], s = hsl[1], l = hsl[2];
  if (s < 0.12) return l >= 0.78 ? 'white' : (l <= 0.22 ? 'black' : 'gray');
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

/**
 * 从任意可绘制源（ImageBitmap / canvas / Image）采样调色板：
 * 先缩到 24×24 再按「色相分档 + 中性色按亮度分档」聚合，取占比最高的 5 个色簇。
 */
export function samplePalette(src: CanvasImageSource): string[] | null {
  const N = 24;
  try {
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, N, N);
    g.drawImage(src, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;                 // 透明像素忽略
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const hsl = rgbToHsl(r, gg, b);
      // 中性色按亮度三档，彩色按 15° 一档
      const key = hsl[1] < 0.12
        ? (hsl[2] >= 0.78 ? 'n3' : (hsl[2] <= 0.22 ? 'n1' : 'n2'))
        : ('h' + Math.floor(hsl[0] / 15));
      let acc = buckets.get(key);
      if (!acc) { acc = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, acc); }
      acc.n++; acc.r += r; acc.g += gg; acc.b += b;
    }
    if (!buckets.size) return null;
    return Array.from(buckets.values())
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map(a => rgbHex(a.r / a.n, a.g / a.n, a.b / a.n));
  } catch (e) { return null; }
}

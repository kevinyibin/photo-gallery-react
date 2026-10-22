/**
 * 常量 —— 与原版本保持一致：格式集合、性能参数、持久化键、焦距分档、色系定义。
 */

export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'jfif', 'jpe', 'tif', 'tiff', 'svg', 'heic', 'heif', 'ico']);
export const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogv', 'ogg', '3gp', 'mpg', 'mpeg', 'ts', 'flv']);
export const MAX_FILES = 40000;

/* ---- 性能参数 ---- */
export const THUMB_LIMIT = 600;   // 缩略图缓存条数（LRU）
export const THUMB_CONC = 4;      // 缩略图并发生成数
export const POSTER_LIMIT = 400;  // 视频封面缓存条数
export const POSTER_CONC = 3;
export const PRELOAD_RANGE = 2;   // 预览时邻近预加载张数
export const SCAN_FLUSH = 120;    // 扫描时每批入库数量（边扫边显示）

/* ---- 持久化 ---- */
export const DB_NAME = 'lmb-media';
export const DB_VER = 2;          // v2 仅新增 meta 存储，结构与原版本一致（数据可直接复用）
export const ST_KV = 'kv';
export const ST_RATE = 'rating';
export const ST_META = 'meta';    // sig -> { tags, pal, like, trash, rawMoved... }
export const ST_HANDLE = 'handle';
export const K_UI = 'ui';
export const K_SESSION = 'session';
export const K_ROOT = 'root';

/* ---- 焦距区间（按 35mm 等效焦距优先归档） ---- */
export const FOCAL_BINS = [
  { key: 'uw',  label: '超广角 ≤24mm',    min: 0,   max: 24 },
  { key: 'w',   label: '广角 25-50mm',    min: 25,  max: 50 },
  { key: 'std', label: '标准 51-85mm',    min: 51,  max: 85 },
  { key: 'st',  label: '中长焦 86-135mm', min: 86,  max: 135 },
  { key: 't',   label: '长焦 136-300mm',  min: 136, max: 300 },
  { key: 'xt',  label: '超长焦 >300mm',   min: 301, max: 1e9 }
];

/* ---- 侧栏筛选维度（标题不再带图标；顺序与显隐可在「设置」中调整） ---- */
export type FacetGroup = 'rating' | 'tag' | 'color' | 'camera' | 'lens' | 'focal' | 'year';

/** 维度的稳定标识与展示名。顺序即出厂默认顺序（也是归一化时的兜底顺序）。 */
export const FACET_GROUPS: { key: FacetGroup; label: string }[] = [
  { key: 'rating', label: '评分' },
  { key: 'tag',    label: '标签' },
  { key: 'color',  label: '主色调' },
  { key: 'camera', label: '相机机身' },
  { key: 'lens',   label: '镜头' },
  { key: 'focal',  label: '焦距区间' },
  { key: 'year',   label: '拍摄年份' }
];

export const DEFAULT_FACET_ORDER: FacetGroup[] = FACET_GROUPS.map(g => g.key);

const FACET_GROUP_MAP = new Map<string, string>(FACET_GROUPS.map(g => [g.key, g.label]));

export function isFacetGroup(v: unknown): v is FacetGroup {
  return typeof v === 'string' && FACET_GROUP_MAP.has(v);
}

export function facetLabel(k: FacetGroup): string {
  return FACET_GROUP_MAP.get(k) || k;
}

/**
 * 归一化持久化的维度顺序 —— 老配置 / 脏数据都不能让面板出现空壳或重复项：
 * 1) 丢弃未知项（未来删掉某个维度时，旧配置里残留的 key 直接忽略）；
 * 2) 去重（手改 localStorage / 并发写入造成的重复）；
 * 3) 补齐缺失项（新增维度自动追加到末尾，用户升级后立刻可见）。
 */
export function normalizeFacetOrder(raw: unknown): FacetGroup[] {
  const out: FacetGroup[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) if (isFacetGroup(v) && out.indexOf(v) < 0) out.push(v);
  }
  for (const k of DEFAULT_FACET_ORDER) if (out.indexOf(k) < 0) out.push(k);
  return out;
}

/** 归一化隐藏列表：只保留已知维度并去重 */
export function normalizeFacetHidden(raw: unknown): FacetGroup[] {
  const out: FacetGroup[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) if (isFacetGroup(v) && out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/* ---- 主色调色系定义 ---- */
export const COLOR_FAMILIES = [
  { key: 'red',    label: '红', css: '#e2483d' },
  { key: 'orange', label: '橙', css: '#f08a3c' },
  { key: 'yellow', label: '黄', css: '#e5c23c' },
  { key: 'green',  label: '绿', css: '#4fa860' },
  { key: 'cyan',   label: '青', css: '#3aa9ac' },
  { key: 'blue',   label: '蓝', css: '#4079cf' },
  { key: 'purple', label: '紫', css: '#8a63d2' },
  { key: 'pink',   label: '粉', css: '#e07fb0' },
  { key: 'white',  label: '白', css: '#eef0f3' },
  { key: 'gray',   label: '灰', css: '#9aa1ab' },
  { key: 'black',  label: '黑', css: '#3a4048' }
];

/** Sony RAW（.ARW）联动：喜欢时移入的目录名 */
export const RAW_LIKED_DIR = '精选RAW';

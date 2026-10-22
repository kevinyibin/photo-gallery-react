/**
 * 类型定义 —— 摄影作品集（React 版）
 * 与原原生 JS 版本的数据结构一一对应，便于对照维护。
 */
import type { FacetGroup } from './constants';

/** 解析后的 EXIF 拍摄信息（字段语义与原版本保持一致） */
export interface ExifData {
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  /** 实际焦距（mm） */
  focal?: number;
  /** 35mm 等效焦距（mm） */
  focal35?: number;
  fNumber?: number;
  /** 快门速度（秒） */
  exposure?: number;
  iso?: number;
  /** 曝光补偿（EV） */
  exposureBias?: number;
  /** 拍摄时间，EXIF 原始格式 "YYYY:MM:DD HH:MM:SS" */
  dateTimeOriginal?: string;
  /** 文件级修改时间（IFD0 DateTime），作为拍摄时间的兜底 */
  dateTime?: string;
}

/** 单个媒体条目（照片 / 视频） */
export interface MediaItem {
  id: number;
  /** 渲染 key："i" + 序号 */
  key: string;
  name: string;
  kind: 'image' | 'video';
  size: number;
  /** 文件修改时间戳 */
  mtime: number;
  file: File;
  /** File System Access API 句柄（目录扫描模式才有） */
  handle: FileSystemFileHandle | null;
  /** 相对根目录的路径段 */
  path: string[];
  /** 目录键：path.join('/') */
  dirKey: string;
  /** 宽高比（宽/高），0 = 未测得 */
  aspect: number;
  w: number;
  h: number;
  /** 原图 ObjectURL（懒创建） */
  url: string | null;
  /** 视频封面 ObjectURL */
  poster: string | null;
  /** 视频时长（秒） */
  dur: number;
  exif: ExifData | null;
  exifParsed: boolean;
  exifQueued: boolean;
  /** 拍摄时间戳缓存（null = 未计算） */
  _shotTs: number | null;
  /** 标签 */
  tags: string[];
  /** 主色调调色板（hex 数组） */
  pal: string[] | null;
  /** 主色系 key */
  fam: string;
  palDone: boolean;
  palQueued: boolean;
  liked: boolean;
  trashed: boolean;
  /** Sony ARW 联动：'liked' 表示 RAW 已移入「精选RAW」 */
  rawMoved: string;
  /** RAW 随照片标记删除 */
  rawTrash: boolean;
  /** RAW 移入精选目录后的文件名（取消喜欢时移回用） */
  rawMovedName: string;
  /** 视图内序号（computeView 写入） */
  _vi?: number;
  /** 正在视口内显示（缩略图 LRU 淘汰跳过） */
  _shown?: boolean;
  /** 缩略图失败重试计数 */
  _tries?: number;
  /** 封面抽帧失败计数 */
  _ptried?: number;
  /** 预览预加载的 Image 对象 */
  _pre?: HTMLImageElement | null;
}

/** 过滤条件 */
export interface FilterState {
  kind: 'all' | 'image' | 'video' | 'like';
  dir: string;
  q: string;
  rating: string;
  camera: Set<string> | null;
  lens: Set<string> | null;
  focal: Set<string> | null;
  year: Set<string> | null;
  color: Set<string> | null;
  tag: Set<string> | null;
}

/** 目录树节点 */
export interface TreeNode {
  name: string;
  key: string;
  children: Map<string, TreeNode>;
  files: number;
  images: number;
  videos: number;
  size: number;
  open: boolean;
}

/** 渲染节点：作品条目或分组标题 */
export type GridNode =
  | { type: 'item'; key: string; item: MediaItem }
  | { type: 'group'; key: string; dir: string; count: number };

/** 布局盒子（瀑布流定位结果） */
export interface LayoutPos {
  x: number;
  y: number;
  w: number;
  h: number;
  imgH?: number;
}

/** meta 持久化记录（标签 / 调色板 / 喜欢 / 废纸篓 / RAW 联动状态） */
export interface MetaRecord {
  tags: string[];
  pal: string[];
  like?: boolean;
  trash?: boolean;
  rawMoved?: string;
  rawTrash?: boolean;
  rawMovedName?: string;
  ts: number;
}

/** 会话记忆 */
export interface SessionData {
  rootName: string;
  rootKind: string;
  dir: string;
  kind: string;
  rating: string;
  q: string;
  sort: string;
  mode: string;
  tab: string;
  fac: {
    camera: string[];
    lens: string[];
    focal: string[];
    year: string[];
    color: string[];
    tag: string[];
  };
  tagMode: string;
  scroll: number;
  cur: string;
  ts: number;
}

/** 通用弹窗配置 */
export interface ModalConfig {
  title: string;
  /** 弹窗主体（受控 React 组件，替代原版本的 HTML 字符串模板） */
  content: import('react').ReactNode;
  okText?: string | null;
  cancelText?: string;
  /** 返回 false 表示校验未通过，弹窗保持打开（配合内联错误展示） */
  onOk?: (() => boolean | void) | null;
}

/** 全局可变状态（与原版本 state 对应；UI 层通过订阅 channel 感知变化） */
export interface AppState {
  items: MediaItem[];
  view: MediaItem[];
  nodes: GridNode[];
  pos: LayoutPos[];
  /** 瀑布流总高度（layout 计算，写入 grid 容器） */
  gridH: number;
  sigSet: Set<string>;
  tree: TreeNode | null;
  filter: FilterState;
  tagMode: 'any' | 'all';
  sort: string;
  mode: 'flow' | 'group';
  colWidth: number;
  gap: number;
  showName: boolean;
  theme: 'light' | 'dark';
  seq: number;
  previewIndex: number;
  /** 灯箱（详情页）是否打开——替代原版本的 els.lightbox.hidden 读取 */
  lbOpen: boolean;
  slideOn: boolean;
  slideLoop: boolean;
  slideInterval: number;
  slidePaused?: boolean;
  fullscreen: boolean;
  ratings: Map<string, { r: number; ts: number }>;
  meta: Map<string, MetaRecord>;
  selectMode: boolean;
  selected: Set<number>;
  root: { name: string; kind: string };
  currentSig: string;
  pendingScroll: number | null;
  restore: { sess: Partial<SessionData>; handle: FileSystemDirectoryHandle | null } | null;
  pendingSession: SessionData | null;
  sideTab: 'facet' | 'tree';
  /** 侧栏筛选维度的显示顺序（设置里可拖拽调整，随 UI 设置持久化） */
  facetOrder: FacetGroup[];
  /** 被隐藏的侧栏筛选维度（隐藏只影响渲染，不清除该维度已选的筛选条件） */
  facetHidden: Set<FacetGroup>;
  exifDone: number;
  exifTotal: number;
  colorDone: number;
  colorTotal: number;
  moreOpen: boolean;
  busy: string | null;
  lbLayout: 1 | 2 | 4 | 9;
  colorEnabled: boolean;
  trashMode: boolean;
  lbMetaOn: boolean;
  /** 移动端详情面板抽屉是否展开（class "open"） */
  lbMetaMobileOpen: boolean;
  rootHandle: FileSystemDirectoryHandle | null;
  dirHandles: Map<string, FileSystemDirectoryHandle>;
  /** 状态栏左侧文案 */
  statusLeft: string;
  /** 通用弹窗配置（null = 关闭） */
  modal: ModalConfig | null;
  /** 移动端筛选抽屉 */
  drawerOpen: boolean;
  /** 拖放遮罩 */
  dropActive: boolean;
  /** 扫描中遮罩 + 计数 */
  scanning: boolean;
  scanCount: number;
}

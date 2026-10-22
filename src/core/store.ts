/**
 * 全局状态层 —— 由自研「单一可变 state + 频道订阅」重构为 Zustand。
 *
 * 设计要点（保持既有渲染语义，明确状态边界）：
 * - useGalleryStore 是唯一的全局状态容器（成熟库 Zustand 提供订阅 / 通知生命周期），
 *   其中持有两块内容：
 *   1) state  —— 与原版完全相同的单一可变 AppState（引擎原地修改，零迁移成本）；
 *   2) ver    —— 每个渲染频道的单调递增版本号。引擎修改 state 后调用
 *      notify(...channels)，即对相应频道版本 +1，触发订阅该频道的组件重渲染。
 * - useChannel(ch) 基于 zustand 的 selector 订阅（useSyncExternalStore 语义），
 *   相比原版的全局 tick，只有被通知频道的版本号变化才触发重渲染，粒度更细。
 * - 为什么保留可变 state：媒体管线（缩略图回填 / EXIF 队列 / 瀑布流重排）
 *   在异步回调里高频原地修改条目字段，强改为不可变更模型会重写全部引擎
 *   并引入行为回归风险；Zustand 对可变持有对象不做限制，行为完全等价。
 *
 * 状态边界约定：
 * - 全局状态：本文件 AppState 的全部字段（库数据 / 筛选 / 视图 / 灯箱 / 会话 /
 *   遮罩等），由引擎统一修改；
 * - 组件局部状态：仅瞬时交互数据 —— 灯箱缩放拖动（Lightbox）、侧栏拖宽（App）、
 *   瓦片加载态（Tile）、滚动位置（Gallery）、弹窗输入（dialogs）等，一律 useState。
 * - DOM 几何 / 命令式操作仍通过 dom 注册表持有 ref，不进入 React 渲染所有权。
 */
import { create } from 'zustand';
import type { AppState } from './types';
import { DEFAULT_FACET_ORDER } from './constants';

/* ============================ 全局状态 ============================ */
export const state: AppState = {
  items: [],
  view: [],
  nodes: [],
  pos: [],
  gridH: 0,
  sigSet: new Set(),
  tree: null,
  filter: {
    kind: 'all', dir: '', q: '', rating: 'all',
    camera: null, lens: null, focal: null, year: null,
    color: null, tag: null
  },
  tagMode: 'any',
  sort: 'shot',
  mode: 'flow',
  colWidth: 230,
  gap: 14,
  showName: true,
  theme: 'light',
  seq: 0,
  previewIndex: -1,
  lbOpen: false,
  slideOn: false,
  slideLoop: true,
  slideInterval: 3500,
  fullscreen: false,
  ratings: new Map(),
  meta: new Map(),
  selectMode: false,
  selected: new Set(),
  root: { name: '', kind: '' },
  currentSig: '',
  pendingScroll: null,
  restore: null,
  pendingSession: null,
  sideTab: 'facet',
  facetOrder: DEFAULT_FACET_ORDER.slice(),
  facetHidden: new Set(),
  exifDone: 0,
  exifTotal: 0,
  colorDone: 0,
  colorTotal: 0,
  moreOpen: false,
  busy: null,
  lbLayout: 1,
  colorEnabled: false,
  trashMode: false,
  lbMetaOn: true,
  lbMetaMobileOpen: false,
  rootHandle: null,
  dirHandles: new Map(),
  statusLeft: '就绪',
  modal: null,
  drawerOpen: false,
  dropActive: false,
  scanning: false,
  scanCount: 0
};

/* ============================ 渲染频道 ============================ */
export type Channel =
  | 'grid'      // 网格 / 瓦片 / 布局
  | 'facets'    // 作品筛选面板
  | 'tree'      // 目录树 + 侧栏底部统计
  | 'status'    // 状态栏
  | 'topbar'    // 顶栏按钮态
  | 'sidebar'   // 侧栏整体（tab、抽屉等）
  | 'lightbox'  // 详情页
  | 'batch'     // 批量操作条
  | 'modal'     // 弹窗
  | 'overlay'   // 扫描 / 拖放遮罩
  | 'empty';    // 空状态 / 恢复提示

export const ALL_CHANNELS: Channel[] = ['grid', 'facets', 'tree', 'status', 'topbar', 'sidebar', 'lightbox', 'batch', 'modal', 'overlay', 'empty'];

const zeroVer = Object.fromEntries(ALL_CHANNELS.map(c => [c, 0])) as Record<Channel, number>;

/** 全局状态容器：state（可变域状态）+ ver（各频道版本号） */
export const useGalleryStore = create<{
  state: AppState;
  ver: Record<Channel, number>;
}>()(() => ({ state, ver: { ...zeroVer } }));

/* 引擎调用：通知对应频道的组件重新渲染（频道版本号 +1） */
export function notify(...channels: Channel[]) {
  useGalleryStore.setState(prev => {
    const ver = { ...prev.ver };
    for (const ch of channels) ver[ch]++;
    return { ver };
  });
}

export function notifyAll() {
  notify(...ALL_CHANNELS);
}

/**
 * 组件订阅一个或多个频道，返回这些频道的版本号之和（变化即触发重渲染）。
 * 版本号只增不减，求和结果单调变化，可安全用作 useSyncExternalStore 快照。
 */
export function useChannel(...channels: Channel[]): number {
  return useGalleryStore(s => channels.reduce((a, c) => a + s.ver[c], 0));
}

/* ============================ DOM 引用注册表 ============================ */
/* 仅用于：读取几何（clientWidth / getBoundingClientRect）、写 scrollTop、
   触发隐藏的 file input —— 这些场景不适合走 React 状态。 */
export const dom: {
  scrollEl: HTMLElement | null;
  grid: HTMLElement | null;
  lightbox: HTMLElement | null;
  lbStage: HTMLElement | null;
  lbInner: HTMLElement | null;
  lbMeta: HTMLElement | null;
  dirInput: HTMLInputElement | null;
  fileInput: HTMLInputElement | null;
} = {
  scrollEl: null,
  grid: null,
  lightbox: null,
  lbStage: null,
  lbInner: null,
  lbMeta: null,
  dirInput: null,
  fileInput: null
};

/* ============================ 状态栏左侧文案 ============================ */
export function setLeft(t: string) {
  state.statusLeft = t;
  notify('status');
}

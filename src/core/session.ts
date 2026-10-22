/**
 * 会话记忆 + UI 设置持久化 —— 与原版本字段结构完全一致（老数据可直接恢复）。
 */
import { K_UI, K_SESSION, ST_KV, ST_HANDLE, K_ROOT, normalizeFacetOrder, normalizeFacetHidden } from './constants';
import { persist } from './persist';
import { state, dom, notify, notifyAll, setLeft } from './store';
import { toast } from './feedback';
import { buildTree, openTreePath } from './tree';
import { markCurrent, bindSessionSavers } from './preview';
import { layout, restoreScroll, scrollToIndex } from './view';
import { sigOf } from './utils';
import type { SessionData } from './types';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveSessionDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 600);
}

export function saveSession() {
  if (!state.root.name) return;
  persist.set(ST_KV, K_SESSION, {
    rootName: state.root.name,
    rootKind: state.root.kind,
    dir: state.filter.dir,
    kind: state.filter.kind,
    rating: state.filter.rating,
    q: state.filter.q,
    sort: state.sort,
    mode: state.mode,
    tab: state.sideTab,
    fac: {
      camera: state.filter.camera ? Array.from(state.filter.camera) : [],
      lens: state.filter.lens ? Array.from(state.filter.lens) : [],
      focal: state.filter.focal ? Array.from(state.filter.focal) : [],
      year: state.filter.year ? Array.from(state.filter.year) : [],
      color: state.filter.color ? Array.from(state.filter.color) : [],
      tag: state.filter.tag ? Array.from(state.filter.tag) : []
    },
    tagMode: state.tagMode,
    scroll: Math.round(dom.scrollEl ? dom.scrollEl.scrollTop : 0),
    cur: state.currentSig || '',
    ts: Date.now()
  });
}

export function saveUI() {
  persist.set(ST_KV, K_UI, {
    sort: state.sort,
    mode: state.mode,
    colWidth: state.colWidth,
    showName: state.showName,
    theme: state.theme,
    slideInterval: state.slideInterval,
    slideLoop: state.slideLoop,
    moreOpen: state.moreOpen,
    lbLayout: state.lbLayout,
    lbMetaOn: state.lbMetaOn,
    colorEnabled: state.colorEnabled,
    // 侧栏筛选维度：顺序（数组，保序）+ 隐藏（数组，读取时还原成 Set）
    facetOrder: state.facetOrder.slice(),
    facetHidden: Array.from(state.facetHidden)
  });
}

/** 主题写入 <html data-theme>（documentElement 不属于 React 渲染范围，可直接写） */
export function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function applyUI(ui: any) {
  if (!ui) return;
  if (ui.sort) state.sort = ui.sort;
  if (ui.mode) state.mode = ui.mode;
  if (ui.colWidth) state.colWidth = Math.max(130, Math.min(420, +ui.colWidth));
  if (ui.showName != null) state.showName = !!ui.showName;
  if (ui.theme) {
    state.theme = ui.theme;
    applyTheme(state.theme);
  }
  if (ui.slideInterval) state.slideInterval = +ui.slideInterval;
  if (ui.slideLoop != null) state.slideLoop = !!ui.slideLoop;
  if (ui.moreOpen != null) state.moreOpen = !!ui.moreOpen;
  if ([1, 2, 4, 9].indexOf(+ui.lbLayout) >= 0) state.lbLayout = +ui.lbLayout as any;
  if (ui.colorEnabled != null) state.colorEnabled = !!ui.colorEnabled;
  if (ui.lbMetaOn != null) state.lbMetaOn = !!ui.lbMetaOn;
  // 侧栏筛选维度：缺失时保留出厂顺序（老配置没有这两个字段，行为与升级前一致）
  state.facetOrder = normalizeFacetOrder(ui.facetOrder);
  state.facetHidden = new Set(normalizeFacetHidden(ui.facetHidden));
}

/** refresh 由 engine 注入，避免硬循环 */
let refreshRef: () => void = () => {};
export function bindRefresh(fn: () => void) { refreshRef = fn; }

export function applySession(sess: Partial<SessionData> | null) {
  if (!sess) return;
  state.filter.dir = sess.dir || '';
  state.filter.kind = (sess.kind as any) || 'all';
  state.filter.rating = sess.rating || 'all';
  state.filter.q = sess.q || '';
  /* 恢复摄影筛选条件（相机 / 镜头 / 焦距 / 年份 / 主色调 / 标签） */
  const fac = sess.fac || ({} as SessionData['fac']);
  state.filter.camera = fac.camera && fac.camera.length ? new Set(fac.camera) : null;
  state.filter.lens = fac.lens && fac.lens.length ? new Set(fac.lens) : null;
  state.filter.focal = fac.focal && fac.focal.length ? new Set(fac.focal) : null;
  state.filter.year = fac.year && fac.year.length ? new Set(fac.year) : null;
  state.filter.color = fac.color && fac.color.length ? new Set(fac.color) : null;
  state.filter.tag = fac.tag && fac.tag.length ? new Set(fac.tag) : null;
  if (sess.tagMode === 'any' || sess.tagMode === 'all') state.tagMode = sess.tagMode;
  if (sess.tab === 'tree' || sess.tab === 'facet') state.sideTab = sess.tab;
  if (sess.sort) state.sort = sess.sort;
  if (sess.mode) state.mode = sess.mode as any;
  openTreePath(state.filter.dir);
  buildTree();
  refreshRef();
  let idx = -1;
  if (sess.cur) idx = state.view.findIndex(it => sigOf(it) === sess.cur);
  if (idx >= 0) { state.previewIndex = idx; markCurrent(state.view[idx]); }
  if (sess.scroll) restoreScroll(sess.scroll);
  else if (idx >= 0) { layout(); scrollToIndex(idx); }
  setLeft(`已恢复上次浏览：${sess.rootName || state.root.name}` + (state.filter.dir ? ' · ' + state.filter.dir : ''));
  notifyAll();
}

export function showRestore(sess: Partial<SessionData> | null, handle: FileSystemDirectoryHandle | null) {
  if (!sess && !handle) {
    state.restore = null;
    notifyAll();
    return;
  }
  state.restore = { sess: sess || {}, handle: handle || null };
  notifyAll();
}

/* scanDirHandle / pickFolder 由 scanner 注入 */
let scanDirHandleRef: (h: FileSystemDirectoryHandle, path: string[], rootName?: string) => Promise<void> = async () => {};
let pickFolderRef: () => void = () => {};
export function bindScannerActions(
  scan: (h: FileSystemDirectoryHandle, path: string[], rootName?: string) => Promise<void>,
  pick: () => void
) { scanDirHandleRef = scan; pickFolderRef = pick; }

function setScanOverlay(on: boolean, count = 0) {
  state.scanning = on;
  state.scanCount = count;
  notify('overlay');
}

export async function doRestore() {
  const r = state.restore;
  if (!r) return;
  if (r.handle) {
    let perm = 'prompt';
    try { perm = await (r.handle as any).queryPermission({ mode: 'read' }); } catch (e) { perm = 'prompt'; }
    if (perm !== 'granted' && (r.handle as any).requestPermission) {
      try { perm = await (r.handle as any).requestPermission({ mode: 'read' }); } catch (e) { perm = 'denied'; }
    }
    if (perm !== 'granted') {
      setLeft('未获得该文件夹的读取授权，请重新选择文件夹');
      toast.warning('未获得该文件夹的读取授权，请重新选择文件夹');
      return;
    }
    setScanOverlay(true, 0);
    await scanDirHandleRef(r.handle, [], r.handle.name);
    setScanOverlay(false);
    applySession(r.sess);
    return;
  }
  // 非 File System Access 来源：无法自动打开，引导用户重新选择同一个文件夹
  state.pendingSession = r.sess as SessionData;
  setLeft(`请重新选择「${r.sess.rootName || '上次浏览的文件夹'}」以恢复浏览位置`);
  pickFolderRef();
}

/* 模块载入时把保存函数注入 preview（纯引用赋值，无运行期依赖） */
bindSessionSavers(saveSessionDebounced, saveUI);

/**
 * 目录扫描与文件入库 —— 与原版本一致：
 * 支持 File System Access API（可授权持久化、可恢复）、<input webkitdirectory>、
 * 拖拽（DataTransfer + webkitGetAsEntry）三种来源；边扫边入库渲染。
 */
import { MAX_FILES, SCAN_FLUSH, ST_HANDLE, K_ROOT, ST_KV, K_SESSION } from './constants';
import { persist } from './persist';
import { state, dom, notify, notifyAll, setLeft } from './store';
import { toast } from './feedback';
import { extOf, kindOf } from './utils';
import { hydrateMeta } from './meta';
import { buildTree } from './tree';
import { rawIndex, rawKey, baseOfName } from './rawlink';
import { resetThumbPipelines } from './thumbs';
import { applySession, saveSession, showRestore, bindScannerActions } from './session';
import type { MediaItem } from './types';

/* refresh / EXIF 调度由 engine 注入 */
let refreshRef: () => void = () => {};
let refreshViewRef: () => void = () => {};
let scheduleExifAllRef: () => void = () => {};
export function bindEngineActions(fns: { refresh: () => void; refreshView: () => void; scheduleExifAll: () => void }) {
  refreshRef = fns.refresh;
  refreshViewRef = fns.refreshView;
  scheduleExifAllRef = fns.scheduleExifAll;
}

export interface ScannedFile { file: File; path: string[]; handle?: FileSystemFileHandle | null; }

function setScan(on: boolean, count = 0) {
  state.scanning = on;
  state.scanCount = count;
  notify('overlay');
}

export function setScanSub(n: number) {
  state.scanCount = n;
  notify('overlay');
}

/** 从 DataTransfer 递归读取（webkitGetAsEntry 路径） */
export async function scanDataTransfer(dt: DataTransfer) {
  const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
  const entries = items.map(i => ((i as any).webkitGetAsEntry ? (i as any).webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) {
    // 兜底：部分浏览器不支持目录条目，只能拿到平铺的文件列表
    const flat = Array.prototype.slice.call(dt.files || []) as File[];
    ingest(flat.map(f => ({ file: f, path: ((f as any).webkitRelativePath || '').split('/').slice(0, -1) })));
    finishScan(flat.length ? ((flat[0] as any).webkitRelativePath || '').split('/')[0] : '拖入的文件');
    return;
  }
  const collected: ScannedFile[] = [];
  let count = 0;
  const tick = () => {
    count++;
    if (collected.length >= SCAN_FLUSH) { ingest(collected.splice(0)); flushScan(); }
    if (count % 40 === 0) setScanSub(count);
  };
  await Promise.all(entries.map(e => walkEntry(e, [], collected, tick)));
  ingest(collected);
  finishScan(entries[0] ? entries[0].name : '拖入的文件', 'input');
}

function walkEntry(entry: any, path: string[], out: ScannedFile[], tick: () => void): Promise<void> {
  return new Promise(resolve => {
    if (!entry) return resolve();
    if (entry.isFile) {
      entry.file((f: File) => {
        if (tick) tick();
        out.push({ file: f, path });
        resolve();
      }, () => resolve());
      return;
    }
    if (!entry.isDirectory) return resolve();

    const reader = entry.createReader();
    const all: any[] = [];
    const readBatch = () => {
      reader.readEntries(async (batch: any[]) => {
        if (!batch.length) {
          // 逐层递归（限制并发，避免一次打开过多 handle）
          for (const child of all) {
            await walkEntry(child, path.concat([entry.name]), out, tick);
          }
          resolve();
        } else {
          for (const b of batch) all.push(b);
          readBatch();
        }
      }, () => resolve());
    };
    readBatch();
  });
}

/** File System Access API：更现代、可授权持久化的方式 */
export async function scanDirHandle(dirHandle: FileSystemDirectoryHandle, path?: string[], rootName?: string) {
  let count = 0;
  const tick = () => {
    count++;
    if (count % 40 === 0) setScanSub(count);
  };
  // 记录根句柄与各层目录句柄：Sony ARW 联动（移动 / 删除 RAW 原件）依赖它们
  state.rootHandle = dirHandle;
  state.dirHandles = new Map();
  rawIndex.clear();
  const out: ScannedFile[] = [];
  const dirs: [FileSystemDirectoryHandle, string[]][] = [[dirHandle, path || []]];
  // 目录层并发遍历 + 分批入库：边扫边出图，避免大目录长时间白屏
  while (dirs.length) {
    const batch = dirs.splice(0, 6);
    await Promise.all(batch.map(async pair => {
      const h = pair[0], cur = pair[1];
      state.dirHandles.set(cur.join('/'), h);
      let it: AsyncIterableIterator<[string, any]>;
      try { it = (h as any).entries(); } catch (e) { return; }
      for (;;) {
        let next: IteratorResult<[string, any]>;
        try { next = await it.next(); } catch (e) { break; }
        if (next.done) break;
        const name = next.value[0], eh = next.value[1];
        if (eh.kind === 'file') {
          // 索尼 RAW 原件（.ARW）：不进入图库，只登记索引供喜欢 / 删除联动
          if (extOf(name) === 'arw') {
            rawIndex.set(rawKey(cur.join('/'), baseOfName(name)), { name, handle: eh, dirKey: cur.join('/') });
            tick();
            continue;
          }
          let f: File | null = null;
          try { f = await eh.getFile(); } catch (e) { continue; }
          tick();
          out.push({ file: f, path: cur, handle: eh });
          if (out.length >= SCAN_FLUSH) { ingest(out.splice(0)); flushScan(); }
        } else if (eh.kind === 'directory') {
          dirs.push([eh, cur.concat([name])]);
        }
      }
    }));
  }
  ingest(out);
  finishScan(rootName || dirHandle.name || '文件夹', 'handle');
}

/**
 * 扫描过程中把已发现的文件即时入库并渲染，
 * 让首屏在大目录场景下也能立刻出图，而不是等扫描全部结束
 */
function flushScan() {
  if (!state.items.length) return;
  if (state.nodes.length === 0) { buildTree(); refreshRef(); }
  else refreshViewRef();
  setScanSub(state.items.length);
}

export function finishScan(rootName?: string, kind?: string) {
  state.root = { name: rootName || '', kind: kind || 'input' };
  buildTree();
  refreshRef();
  setLeft(`已载入 ${state.items.length} 个媒体文件` + (state.root.name ? ` —— ${state.root.name}` : ''));
  if (state.pendingSession) {
    const s = state.pendingSession;
    state.pendingSession = null;
    if (!s.rootName || s.rootName === state.root.name) { scheduleExifAllRef(); applySession(s); return; }
  }
  saveSession();
  scheduleExifAllRef();
}

/* ============================ 数据入库 ============================ */
/** 只负责写入 state.items（去重），不做重排，供扫描增量调用 */
export function ingest(list: ScannedFile[]): number {
  if (!state.sigSet) state.sigSet = new Set();
  let added = 0;
  for (const rec of list) {
    const kind = kindOf(rec.file.name);
    if (!kind) continue;
    if (state.items.length >= MAX_FILES) break;
    const dirKey = rec.path.join('/');
    const sig = dirKey + '/' + rec.file.name + '|' + rec.file.size;
    if (state.sigSet.has(sig)) continue;
    state.sigSet.add(sig);
    state.seq++;
    const it: MediaItem = {
      id: state.seq,
      key: 'i' + state.seq,
      name: rec.file.name,
      kind,
      size: rec.file.size,
      mtime: rec.file.lastModified,
      file: rec.file,
      handle: rec.handle || null,
      path: rec.path,
      dirKey,
      aspect: 0, w: 0, h: 0,
      url: null, poster: null, dur: 0,
      exif: null, exifParsed: false, exifQueued: false, _shotTs: null,
      tags: [], pal: null, fam: '', palDone: false, palQueued: false,
      liked: false, trashed: false,
      rawMoved: '', rawTrash: false, rawMovedName: ''
    };
    state.items.push(it);
    hydrateMeta(it);
    added++;
  }
  return added;
}

/** 外部入口（选择文件夹 / 添加文件 / 拖拽）：入库 + 重建树 + 刷新 */
export function addFiles(list: ScannedFile[], opts?: { keepFilter?: boolean }): number {
  opts = opts || {};
  const before = state.items.length;
  const added = ingest(list);
  if (!opts.keepFilter) {
    state.filter.dir = '';
    state.filter.q = '';
  }
  if (added) {
    buildTree();
    refreshRef();
    scheduleExifAllRef();
  }
  if (!added) {
    const msg = before ? '没有新增文件（可能都是重复项）' : '未发现可识别的图片或视频';
    setLeft(msg);
    toast.warning(msg);      // 导入无结果是重要反馈，除状态栏外统一弹提示
  } else {
    setLeft(`已载入 ${state.items.length} 个媒体文件`);
  }
  return added;
}

export function clearAll() {
  for (const it of state.items) {
    if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
  }
  resetThumbPipelines();
  state.items = [];
  state.view = [];
  state.nodes = [];
  state.pos = [];
  state.gridH = 0;
  state.sigSet = new Set();
  state.tree = null;
  state.filter.dir = '';
  state.filter.q = '';
  state.filter.rating = 'all';
  state.filter.camera = state.filter.lens = state.filter.focal = state.filter.year = null;
  state.filter.color = state.filter.tag = null;
  state.selected.clear();
  state.selectMode = false;
  state.trashMode = false;
  rawIndex.clear();
  state.dirHandles = new Map();
  state.rootHandle = null;
  state.root = { name: '', kind: '' };
  state.currentSig = '';
  buildTree();
  refreshRef();
  setLeft('已清空');
  toast.success('已清空图库与持久化记录');
  resetExifColorQueuesRef();
  persist.del(ST_HANDLE, K_ROOT);
  persist.del(ST_KV, K_SESSION);
  showRestore(null, null);
  notifyAll();
}

/* EXIF / 色彩队列复位由 engine 注入 */
let resetExifColorQueuesRef: () => void = () => {};
export function bindQueueReset(fn: () => void) { resetExifColorQueuesRef = fn; }

/* ============================ 选择文件夹 ============================ */
export async function pickFolder() {
  if ((window as any).showDirectoryPicker) {
    try {
      const h: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: 'lmg', mode: 'read' });
      persist.set(ST_HANDLE, K_ROOT, h);   // 记住句柄，下次启动可直接恢复
      state.root = { name: h.name, kind: 'handle' };
      setScan(true, 0);
      await scanDirHandle(h, [], h.name);
      setScan(false);
      if (state.pendingSession) {
        const s = state.pendingSession;
        state.pendingSession = null;
        if (!s.rootName || s.rootName === h.name) { applySession(s); return; }
      }
      saveSession();
      return;
    } catch (err: any) {
      setScan(false);
      if (err && err.name === 'AbortError') return;
      // 用户拒绝或不支持，回退到 input
    }
  }
  if (dom.dirInput) {
    dom.dirInput.value = '';
    dom.dirInput.click();
  }
}

/** 隐藏的目录 input 回调（App 组件绑定） */
export function onDirInputChange(input: HTMLInputElement) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  setScan(true, 0);
  const rootName = ((files[0] as any).webkitRelativePath || '').split('/')[0];
  ingest(files.map(f => ({ file: f, path: ((f as any).webkitRelativePath || '').split('/').slice(0, -1) })));
  finishScan(rootName, 'input');
  setScan(false);
}

/** 隐藏的多选文件 input 回调（App 组件绑定） */
export function onFileInputChange(input: HTMLInputElement) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  addFiles(files.map(f => ({ file: f, path: [] })));
  finishScan('手动添加的文件', 'manual');   // manual：不参与“恢复上次文件夹”
}

export function pickFiles() {
  if (dom.fileInput) {
    dom.fileInput.value = '';
    dom.fileInput.click();
  }
}

/* 把扫描入口注入 session（恢复上次浏览用） */
bindScannerActions(scanDirHandle, pickFolder);

/**
 * 预览灯箱（详情页）引擎 —— 打开 / 关闭 / 导航 / 幻灯片 / 全屏 / hash 历史。
 * 与 React 的衔接：组件订阅 'lightbox' 频道，依据 state.previewIndex / state.lbOpen 渲染；
 * 缩放、拖动、旋转等纯局部交互由 Lightbox 组件内部实现，
 * 并通过 lbControls 暴露给全局键盘处理。
 */
import { PRELOAD_RANGE } from './constants';
import { state, dom, notify, setLeft } from './store';
import { toast } from './feedback';
import { sigOf } from './utils';
import type { MediaItem } from './types';

let pushedHash = false;          // 详情页是否通过 pushState 打开（决定返回时走 history 还是直接关闭）
let pendingClose = false;
let fsExitAt = 0;

export function currentItem(): MediaItem | null {
  return state.view[state.previewIndex] || null;
}

/** 键盘等外部入口需要的灯箱局部控制（由 Lightbox 组件注册） */
export const lbControls: {
  current: {
    stepZoom: (f: number, cx?: number, cy?: number) => void;
    resetZoom: () => void;
    rotatePreview: () => void;
    toggleLbMeta: () => void;
  } | null;
} = { current: null };

/**
 * 打开大图（唯一入口）。
 *
 * 顺序很重要：**先落状态并通知渲染，再做事后增强（预热 / 预加载）**。
 * 之前把预热放在 notify 之前，只要某张图的 `file` 不可用（句柄失权、被回收、
 * 合成/异常数据），`URL.createObjectURL` 一抛异常就会把整个函数打断 ——
 * 表现就是「点了没反应」。现在开图本身绝不会被预热失败连累。
 *
 * 幂等：重复调用同一序号（双击 / pointerup + click 双保险）不会重复 pushState，
 * 避免多出一条历史记录导致「按一次返回没退出大图」。
 */
export function openPreview(idx: number) {
  if (idx < 0 || idx >= state.view.length) return false;
  const it = state.view[idx];
  const wasOpen = state.lbOpen && state.previewIndex === idx;
  state.previewIndex = idx;
  state.lbOpen = true;
  document.body.classList.add('lb-open');
  markCurrent(it);
  notify('lightbox');           // 先让大图出来
  // 之后才是「让它更快/更顺」的工作，任何一项失败都不影响已经打开的大图
  warmPreview(it);
  preloadAround(idx);
  // 用 hash 记录详情页位置：浏览器返回键 / 手势即可回到图库
  if (!wasOpen) {
    const h = '#p=' + it.key;
    try { if (location.hash !== h) history.pushState({ p: 1 }, '', h); } catch (e) {}
    pushedHash = location.hash === h;
  }
  saveSessionDebouncedRef();
  return true;
}

/**
 * 预热原图 —— 缩略图卡片 hover / 点击打开后调用。
 *
 * 只做三件事：建 blob URL、实例化 Image、decode()。三者都是浏览器原生缓存，
 * 不占额外内存配额（同一 URL 只解码一次）。`_pre` 与 preloadAround 共用同一标记，
 * 因此预热过的图片在邻近预加载时会被跳过，不会重复解码。
 *
 * 解压后的位图是真正吃内存的部分，所以预热队列只保留最近 WARM_LIMIT 张：
 * 超出的丢弃 `_pre` 引用（对象 URL 保留，重新解码成本很低），避免长时间划动后堆积。
 *
 * **本函数不抛异常**：它只是锦上添花，不能反过来把主流程搞挂。
 */
const WARM_LIMIT = 12;
const warmQueue: MediaItem[] = [];

export function warmPreview(it: MediaItem | null) {
  try {
    if (!it || it.kind !== 'image') return;
    if (!it.url) {
      if (!(it.file instanceof Blob)) return;    // 句柄失权 / 非法数据：直接放弃预热
      it.url = URL.createObjectURL(it.file);
    }
    if (it._pre) {
      // 已在队列里：移到队尾（最近使用）
      const i = warmQueue.indexOf(it);
      if (i >= 0) { warmQueue.splice(i, 1); warmQueue.push(it); }
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = it.url;
    it._pre = img;
    if (img.decode) img.decode().catch(() => {});
    warmQueue.push(it);
    while (warmQueue.length > WARM_LIMIT) {
      const old = warmQueue.shift()!;
      // 正在大图里看的这一张不清（否则切图回来要重新解码）
      if (state.lbOpen && state.view[state.previewIndex] === old) continue;
      old._pre = null;
    }
  } catch (e) { /* 预热失败不影响任何既有行为 */ }
}

/** 页面加载时若地址带 #p=<key>（刷新 / 收藏），直接恢复详情页 */
export function openFromHash() {
  if (location.hash.indexOf('#p=') !== 0) return;
  const key = location.hash.slice(3);
  const idx = state.view.findIndex(it => it.key === key);
  if (idx >= 0) {
    state.previewIndex = idx;
    state.lbOpen = true;
    document.body.classList.add('lb-open');
    markCurrent(state.view[idx]);
    preloadAround(idx);
    notify('lightbox');
    pushedHash = false;   // 初始 hash 非本会话压入，关闭时不走 history.back()
  } else {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
}

export function closePreview() {
  // 全屏状态下先退出全屏，等 fullscreenchange 后再真正关闭，
  // 否则元素在仍为全屏元素时被隐藏，容易留下残留的全屏状态
  if (isFullscreen()) { pendingClose = true; exitFullscreen(); return; }
  // 本会话内通过 pushState 打开的详情页：回退一层历史，popstate 中统一关闭
  if (pushedHash && location.hash.indexOf('#p=') === 0) { history.back(); return; }
  doClosePreview();
}

export function doClosePreview() {
  stopSlide();
  state.lbOpen = false;
  document.body.classList.remove('lb-open');
  // 清理详情页 hash 与移动端信息面板状态
  pushedHash = false;
  state.lbMetaMobileOpen = false;
  if (location.hash.indexOf('#p=') === 0) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  notify('lightbox');
}

export function markCurrent(it: MediaItem | null) {
  state.currentSig = it ? sigOf(it) : '';
  notify('grid');
}

export function goto(d: number) {
  if (!state.view.length) return;
  let n = state.previewIndex + d * navStep();   // 多图模式按整页翻动
  if (n < 0) n = state.view.length - 1;
  if (n >= state.view.length) n = 0;
  state.previewIndex = n;
  markCurrent(state.view[n]);
  preloadAround(n);
  notify('lightbox');
  // 切换作品只替换当前历史记录，返回键仍回到图库
  try { history.replaceState({ p: 1 }, '', '#p=' + state.view[n].key); } catch (e) {}
  saveSessionDebouncedRef();
}

/** 多图对比：单击单元格设为当前图片 */
export function setPreviewIndex(i: number) {
  if (i === state.previewIndex) return;
  state.previewIndex = i;
  markCurrent(state.view[i]);
  preloadAround(i);
  notify('lightbox');
  const it = state.view[i];
  if (it) { try { history.replaceState({ p: 1 }, '', '#p=' + it.key); } catch (e) {} }
  saveSessionDebouncedRef();
}

/** 切换详情页布局：1=单图 2/4/9=多图对比（记忆到 UI 设置） */
export function setLbLayout(n: number) {
  n = +n;
  if ([1, 2, 4, 9].indexOf(n) < 0) n = 1;
  if (state.lbLayout === n) return;
  state.lbLayout = n as 1 | 2 | 4 | 9;
  saveUIRef();
  notify('lightbox');
  saveSessionDebouncedRef();
}

/** 单图每次切 1 张；多图按整页翻动 */
export function navStep(): number { return state.lbLayout > 1 ? state.lbLayout : 1; }

/** 邻近预加载：提前解码前后各 N 张原图，切换时几乎无等待。
 *  逐张 try/catch：个别文件的 URL 建不出来（句柄失权 / 非法数据）不能连累其它张，
 *  更不能把调用方（openPreview / goto）打断。 */
export function preloadAround(idx: number) {
  const n = state.view.length;
  if (!n) return;
  for (let d = 1; d <= PRELOAD_RANGE; d++) {
    [idx + d, idx - d].forEach(j => {
      try {
        const it = state.view[((j % n) + n) % n];
        if (!it || it.kind !== 'image' || it._pre) return;
        if (!it.url) {
          if (!(it.file instanceof Blob)) return;
          it.url = URL.createObjectURL(it.file);
        }
        it._pre = new Image();
        it._pre.src = it.url;
        if (it._pre.decode) it._pre.decode().catch(() => {});
      } catch (e) { /* 单张失败忽略 */ }
    });
  }
}

/* ---------------------------- 幻灯片 ---------------------------- */
export function startSlide() {
  if (!state.view.length) return;
  state.slideOn = true;
  notify('lightbox');
}

export function stopSlide() {
  state.slideOn = false;
  notify('lightbox');
}

export function toggleSlide() { state.slideOn ? stopSlide() : startSlide(); }

export function setSlideLoop(on: boolean) {
  state.slideLoop = on;
  notify('lightbox');
  saveUIRef();
}

export function setSlideInterval(v: number) {
  state.slideInterval = v;
  notify('lightbox');
  saveUIRef();
}

export function slideStep(d: number) {
  const n = state.view.length;
  if (!n) return stopSlide();
  let idx = state.previewIndex + d * navStep();   // 多图模式按整页翻动
  if (idx >= n) {
    if (!state.slideLoop && d > 0) { stopSlide(); setLeft('幻灯片播放结束（已到列表末尾）'); return; }
    idx = 0;
  } else if (idx < 0) {
    if (!state.slideLoop) { stopSlide(); return; }
    idx = n - 1;
  }
  state.previewIndex = idx;
  markCurrent(state.view[idx]);
  preloadAround(idx);
  notify('lightbox');
  saveSessionDebouncedRef();
}

/** 右侧详细信息面板：桌面端可隐藏 / 显示（I 键，记忆到 UI 设置）；移动端仍是底部抽屉 */
export function toggleLbMeta() {
  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
    state.lbMetaMobileOpen = !state.lbMetaMobileOpen;
    notify('lightbox');
    return;
  }
  state.lbMetaOn = !state.lbMetaOn;
  saveUIRef();
  notify('lightbox');
}

/* ---------------------------- 全屏 ---------------------------- */
export function fsElement(): Element | null {
  return document.fullscreenElement || (document as any).webkitFullscreenElement || null;
}
export function isFullscreen(): boolean { return !!fsElement(); }

export function enterFullscreen() {
  if (isFullscreen()) return;
  const el = dom.lightbox as any;
  if (!el) return;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen()
      : (el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null);
    if (p && p.catch) p.catch(() => { setLeft('浏览器拒绝了全屏请求'); toast.warning('浏览器拒绝了全屏请求'); onFsChange(); });
  } catch (e) { setLeft('当前环境不支持全屏'); toast.warning('当前环境不支持全屏'); }
}

export function exitFullscreen() {
  if (!isFullscreen()) return;
  try {
    const d = document as any;
    const p = d.exitFullscreen ? d.exitFullscreen() : (d.webkitExitFullscreen ? d.webkitExitFullscreen() : null);
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

export function toggleFullscreen() { isFullscreen() ? exitFullscreen() : enterFullscreen(); }

/** fullscreenchange 事件统一入口（含浏览器原生 ESC 退出） */
export function onFsChange() {
  const on = isFullscreen();
  state.fullscreen = on;
  if (!on) {
    fsExitAt = Date.now();
    if (pendingClose) { pendingClose = false; doClosePreview(); return; }
  }
  notify('lightbox');
}

/** Esc 键刚由浏览器退出全屏的瞬间不再关闭预览 */
export function justExitedFs(): boolean {
  if (Date.now() - fsExitAt < 400) { fsExitAt = 0; return true; }
  return false;
}

/* session 模块的防抖保存（注入以避免硬循环） */
let saveSessionDebouncedRef: () => void = () => {};
let saveUIRef: () => void = () => {};
export function bindSessionSavers(debounced: () => void, saveUI: () => void) {
  saveSessionDebouncedRef = debounced;
  saveUIRef = saveUI;
}

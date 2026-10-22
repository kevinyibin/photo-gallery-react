/**
 * 根组件 —— 页面骨架与原 index.html 的 DOM 结构一一对应，
 * 并集中挂载全局事件（键盘、拖放、历史、可见性、页面卸载）。
 *
 * 交互优化（本次重构）：
 * - 窗口尺寸变化改走 scheduleLayout（rAF 合帧），与侧栏 ResizeObserver
 *   的重排请求合并，避免一次窗口缩放触发两轮完整重排；
 * - 拖放扫描异常统一走 toast 错误提示（原来只写 console）。
 */
import { useEffect, useState } from 'react';
import { state, dom, notify } from './core/store';
import { initStatus, setDropActive, scheduleLayout } from './core/engine';
import { scanDataTransfer, onDirInputChange, onFileInputChange } from './core/scanner';
import { flushRatings } from './core/ratings';
import { flushMeta } from './core/meta';
import { saveSession } from './core/session';
import { toast } from './core/feedback';
import {
  goto, toggleSlide, toggleFullscreen, exitFullscreen, isFullscreen, justExitedFs,
  closePreview, doClosePreview, stopSlide, startSlide,
  currentItem, lbControls, onFsChange, setPreviewIndex
} from './core/preview';
import { toggleLike, deleteKeyAction } from './core/library';
import { closeModal } from './core/modal';
import { ContextMenuHost, isContextMenuOpen } from './ui/ContextMenu';
import Topbar from './components/Topbar';
import Sidebar from './components/Sidebar';
import Gallery from './components/Gallery';
import StatusBar from './components/StatusBar';
import Overlays from './components/Overlays';
import Lightbox from './components/Lightbox';
import BatchBar from './components/BatchBar';
import ModalHost from './components/ModalHost';

export default function App() {
  // 侧栏宽度：拖拽调整（原版本直接写 style.width；React 版用状态驱动，mouseup 后重排）
  // —— 典型的组件局部状态：只影响布局测量，不属于全局数据流。
  const [sideW, setSideW] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  /* ---- 启动：载入持久化状态并按需恢复上次浏览 ---- */
  useEffect(() => {
    initStatus();
  }, []);

  /* ---- 全局键盘 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      // 弹窗开启时 Esc 只关弹窗，不穿透到详情页
      if (state.modal) { if (e.key === 'Escape') closeModal(); return; }
      // 右键菜单开启时键盘由菜单接管（宿主已在 capture 阶段 stopPropagation，这里是二道防线）
      if (isContextMenuOpen()) return;
      if (!state.lbOpen) return;
      if (e.key === 'Escape') {
        // 全屏时优先退出全屏；刚由浏览器 ESC 退出全屏的瞬间不再关闭预览
        if (isFullscreen()) { exitFullscreen(); return; }
        if (justExitedFs()) return;
        stopSlide(); closePreview();
      }
      else if (e.key === 'ArrowLeft') goto(-1);
      else if (e.key === 'ArrowRight') goto(1);
      else if (e.key === '+' || e.key === '=') { if (state.lbLayout === 1) lbControls.current?.stepZoom(1.25); }
      else if (e.key === '-') { if (state.lbLayout === 1) lbControls.current?.stepZoom(0.8); }
      else if (e.key === '0') { if (state.lbLayout === 1) lbControls.current?.resetZoom(); }
      else if (e.key === ' ') { e.preventDefault(); toggleSlide(); }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'r' || e.key === 'R') lbControls.current?.rotatePreview();
      else if (e.key === 'l' || e.key === 'L') { toggleLike(currentItem()); }
      else if (e.key === 'i' || e.key === 'I') { lbControls.current?.toggleLbMeta(); }
      else if (e.key === 'd' || e.key === 'D' || e.key === 'Delete') { e.preventDefault(); deleteKeyAction(); }
      else if (e.key >= '1' && e.key <= '9') {
        // 数字键不再用于评分（评分仅支持鼠标点击星级）；
        // 多图对比模式下，1-9 标记当前布局中对应位置的图片为喜欢
        if (state.lbLayout > 1) {
          const pos = +e.key;
          if (pos <= state.lbLayout) {
            const it = state.view[state.previewIndex + pos - 1];
            if (it) toggleLike(it);
          }
        }
      }
      else if (e.key === 'Home') setPreviewIndex(0);
      else if (e.key === 'End') setPreviewIndex(state.view.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- 拖拽导入（全窗口） ---- */
  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDropActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (--dragDepth <= 0) { dragDepth = 0; setDropActive(false); }
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDropActive(false);
      state.scanning = true; state.scanCount = 0; notify('overlay');
      try { await scanDataTransfer(e.dataTransfer!); }
      catch (err) { console.error(err); toast.error('导入失败：文件读取异常，请重试'); }
      state.scanning = false; notify('overlay');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  /* ---- 全屏状态同步（含浏览器原生 ESC 退出） ---- */
  useEffect(() => {
    const onFs = () => onFsChange();
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs as any);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs as any);
    };
  }, []);

  /* ---- 浏览器返回键 / 手势：从详情页回到图库 ---- */
  useEffect(() => {
    const onPop = () => {
      if (location.hash.indexOf('#p=') !== 0 && state.lbOpen) doClosePreview();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* ---- 切到后台时暂停幻灯片，回来自动续播；卸载前落盘 ---- */
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (state.slideOn) { state.slidePaused = true; stopSlide(); }
        flushRatings();
        flushMeta();
        saveSession();
      } else if (state.slidePaused) {
        state.slidePaused = false;
        if (state.lbOpen) startSlide();
      }
    };
    const onHide = () => { flushRatings(); flushMeta(); saveSession(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, []);

  /* ---- 窗口尺寸变化：重排瀑布流（rAF 合帧，与 ResizeObserver 请求合并） ---- */
  useEffect(() => {
    const onResize = () => scheduleLayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---- 侧栏拖拽调宽 ---- */
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(150, Math.min(520, e.clientX));
      setSideW(w);
    };
    const onUp = () => {
      setResizing(false);
      scheduleLayout();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  return (
    <>
      <div className="flex flex-col h-screen">
        <Topbar />
        <div className="flex-1 flex min-h-0 relative">
          <Sidebar width={sideW} />
          <div
            className={'w-[5px] flex-none cursor-col-resize -ml-[3px] z-[5] max-[820px]:hidden transition-colors ' + (resizing ? 'bg-soft' : 'hover:bg-soft')}
            id="resizer"
            title="拖动调整宽度"
            onMouseDown={(e) => { setResizing(true); e.preventDefault(); }}
          />
          <Gallery />
        </div>
        <StatusBar />
      </div>

      <Overlays />
      <Lightbox />
      <ModalHost />
      <ContextMenuHost />
      <BatchBar />

      {/* 隐藏的文件选择器：目录 / 多文件（由原版本的隐藏 input 移植） */}
      <input
        type="file"
        id="dirInput"
        multiple
        hidden
        ref={el => { dom.dirInput = el; }}
        onChange={e => onDirInputChange(e.currentTarget)}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />
      <input
        type="file"
        id="fileInput"
        multiple
        hidden
        ref={el => { dom.fileInput = el; }}
        onChange={e => onFileInputChange(e.currentTarget)}
      />
    </>
  );
}

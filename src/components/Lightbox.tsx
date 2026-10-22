/**
 * 预览灯箱（详情页）—— 原 #lightbox 的 React 实现。
 * 引擎（core/preview）负责：打开/关闭、导航、幻灯片状态、hash 历史、全屏切换；
 * 本组件负责：媒体渲染（图片 / 视频 / 多图宫格）、缩放拖动旋转、
 * 邻近预加载后的展示、详情面板显隐。
 *
 * 状态边界：缩放 / 平移 / 旋转 / 拖拽 / 媒体加载态属于组件局部状态（useState）；
 * 全局状态只存 previewIndex / lbOpen / lbLayout / slide 等需要跨模块共享的字段。
 */
import { useEffect, useRef, useState } from 'react';
import { state, dom, useChannel, notify } from '../core/store';
import { ratingOf, setRating } from '../core/ratings';
import {
  currentItem, goto, closePreview, setLbLayout, setPreviewIndex, navStep,
  toggleSlide, startSlide, slideStep, setSlideLoop, setSlideInterval,
  toggleFullscreen, enterFullscreen, exitFullscreen, isFullscreen,
  toggleLbMeta, lbControls, preloadAround
} from '../core/preview';
import { toggleLike, likedOf } from '../core/library';
import { thumbCache } from '../core/thumbs';
import { menuForLightbox } from '../core/ctxMenus';
import { openContextMenu } from '../ui/ContextMenu';
import { cx, lbBtnCls } from '../ui/kit';
import Icon from '../ui/Icon';
import Stars from './Stars';
import MetaPanel from './MetaPanel';
import type { MediaItem } from '../core/types';

/**
 * 安全创建原图 ObjectURL —— file 不可用（文件夹权限失效 / 文件被移动删除 / 数据异常）时返回 null。
 * 大图是渲染期直接取 src 的，任何一次 createObjectURL 抛错都会被 React 当成渲染异常，
 * 没有错误边界的结果就是整棵树被卸载（用户看到「点一下就白屏 / 没反应」）。
 */
function safeUrl(it: MediaItem): string | null {
  if (it.url) return it.url;
  try {
    if (!(it.file instanceof Blob)) return null;
    it.url = URL.createObjectURL(it.file);
    return it.url;
  } catch (e) { return null; }
}

export default function Lightbox() {
  useChannel('lightbox');
  const stageRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const metaRef = useRef<HTMLElement | null>(null);

  /* 缩放 / 拖动 / 旋转（局部交互状态，与原版本的模块级变量对应） */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ sx: 0, sy: 0 });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [stageRect, setStageRect] = useState({ w: 0, h: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef({ x: 0, y: 0, t: 0, lastTap: 0, lastX: 0, lastY: 0 });

  const it = state.lbOpen ? currentItem() : null;

  /* 注册 DOM 引用（全屏 / 几何读取用） */
  useEffect(() => {
    dom.lightbox = rootRef.current;
    dom.lbStage = stageRef.current;
    dom.lbInner = innerRef.current;
    dom.lbMeta = metaRef.current;
    return () => { dom.lightbox = null; dom.lbStage = null; dom.lbInner = null; dom.lbMeta = null; };
  }, []);

  /* 切换作品 / 开关 / 布局变化：复位缩放拖动旋转与媒体状态（对应原 renderPreview 的初始化段） */
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRot(0);
    setDragging(false);
    setMediaReady(false);
    setMediaError(null);
  }, [state.previewIndex, state.lbOpen, state.lbLayout, retryKey]);

  /* 舞台几何：旋转后需要按舞台尺寸限制媒体最大宽高；尺寸变化时跟随更新 */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !state.lbOpen) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStageRect({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    // rot / lbLayout 变化后重新取一次真实几何，避免旋转时用到过期尺寸导致外接框被裁
  }, [state.lbOpen, state.fullscreen, rot, state.lbLayout]);

  /* 视频原地址：进入视频条目时创建，离开时释放（对应 releasePreviewVideo） */
  useEffect(() => {
    if (!state.lbOpen || !it || it.kind !== 'video' || state.lbLayout > 1) { setVideoUrl(null); return; }
    let url: string | null = null;
    try {
      if (it.file instanceof Blob) url = URL.createObjectURL(it.file);
    } catch (e) { url = null; }
    setVideoUrl(url);
    return () => {
      const v = videoRef.current;
      if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lbOpen, it && it.key, state.lbLayout, retryKey]);

  /* 滚轮缩放（需要非 passive 监听） */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !state.lbOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (state.lbLayout > 1) return;   // 多图对比模式不支持缩放拖动
      stepZoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lbOpen, zoom, pan]);

  /* 拖动（放大后平移） */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = e.clientX - dragStart.current.sx;
      const ny = e.clientY - dragStart.current.sy;
      setPan(clampPan(zoom, nx, ny));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, zoom]);

  /* 幻灯片计时：每次渲染完成后重新计时，保证间隔从“当前这张真正显示”起算，并自动适配视频时长 */
  useEffect(() => {
    if (slideTimer.current) { clearTimeout(slideTimer.current); slideTimer.current = null; }
    if (!state.slideOn || !state.lbOpen) return;
    let delay = state.slideInterval;
    if (state.lbLayout === 1 && it && it.kind === 'video') {   // 多图模式视频不自动播放，固定按间隔翻页
      const v = videoRef.current;
      const d = (v && isFinite(v.duration) && v.duration > 0) ? v.duration : (it.dur || 0);
      delay = Math.min(60000, Math.max(state.slideInterval, d * 1000 + 800));
      if (!mediaReady) return;   // 视频元数据就绪后再计时
    }
    slideTimer.current = setTimeout(() => { slideTimer.current = null; slideStep(1); }, delay);
    return () => { if (slideTimer.current) { clearTimeout(slideTimer.current); slideTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.slideOn, state.slideInterval, state.previewIndex, mediaReady, state.lbLayout, state.lbOpen]);

  /* 暴露给全局键盘的局部控制 */
  useEffect(() => {
    lbControls.current = {
      stepZoom: (f, cx2, cy) => stepZoom(f, cx2, cy),
      resetZoom: () => { setZoom(1); setPan({ x: 0, y: 0 }); },
      rotatePreview: () => rotatePreview(),
      toggleLbMeta: () => toggleLbMeta()
    };
    return () => { lbControls.current = null; };
  });

  /* ---- 缩放 / 拖动实现（与原版本 zoomAt / clampPan 一致） ---- */
  function clampPan(z: number, px: number, py: number) {
    const r = stageRect.w ? stageRect : { w: window.innerWidth, h: window.innerHeight };
    const mx = Math.max(0, (z - 1) * r.w / 2);
    const my = Math.max(0, (z - 1) * r.h / 2);
    return { x: Math.max(-mx, Math.min(mx, px)), y: Math.max(-my, Math.min(my, py)) };
  }

  /** 以指定屏幕坐标为锚点缩放（滚轮 / 双击），避免缩放时画面跳动 */
  function zoomAt(nz: number, cx2?: number, cy?: number) {
    nz = Math.min(8, Math.max(0.2, nz));
    const el = stageRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } as DOMRect;
    const px = (cx2 == null ? r.width / 2 : cx2 - r.left) - r.width / 2;
    const py = (cy == null ? r.height / 2 : cy - r.top) - r.height / 2;
    const k = nz / zoom;
    let nx = px - (px - pan.x) * k;
    let ny = py - (py - pan.y) * k;
    if (nz === 1) { nx = 0; ny = 0; }
    const c = clampPan(nz, nx, ny);
    setZoom(nz);
    setPan(c);
  }

  function stepZoom(f: number, cx2?: number, cy?: number) { zoomAt(zoom * f, cx2, cy); }

  /**
   * 旋转预览画面：顺时针 90°（与按钮图标 rotateCw 一致）。
   * 每次都在上一个角度基础上 +90 —— 使用状态更新函数保证连续点击方向恒定；
   * 旋转后的最大宽高由 mediaMaxStyle 按「旋转后的外接框」限制（宽高互换），
   * 因此 90° / 270° 时画面整体仍落在舞台内且居中（见下方 swap 计算）。
   */
  function rotatePreview() {
    if (state.lbLayout > 1) return;   // 多图对比模式不支持旋转
    if (!it || it.kind !== 'image') return;
    setRot(r => (r + 90) % 360);
  }

  if (!state.lbOpen) {
    return <div className="lightbox" id="lightbox" hidden ref={rootRef}></div>;
  }
  if (!it) {
    // 视图已空（例如废纸篓清空）：兜底关闭
    queueMicrotask(() => closePreview());
    return <div className="lightbox" id="lightbox" hidden ref={rootRef}></div>;
  }

  const len = state.view.length;
  const multi = state.lbLayout > 1;
  const end = Math.min(state.previewIndex + state.lbLayout, len);
  const countText = multi ? `${state.previewIndex + 1}–${end} / ${len}` : `${state.previewIndex + 1} / ${len}`;
  const liked = likedOf(it);
  /* 旋转 90° / 270° 时画面的「外接框」宽高互换：
     未旋转的渲染框宽 w ≤ 舞台高、高 h ≤ 舞台宽 ⇒ 旋转后的外接框 (h, w) 一定落在舞台 (W, H) 内，
     配合 lb-inner 的居中，画面既不会被 overflow-hidden 裁切，也始终居中。
     舞台几何未取到时回退到实时 clientWidth / 视口，避免首次渲染用空值导致画面溢出。 */
  const swap = rot % 180 !== 0;
  const stageEl = stageRef.current;
  const stageW = stageRect.w || (stageEl ? stageEl.clientWidth : 0) || window.innerWidth;
  const stageH = stageRect.h || (stageEl ? stageEl.clientHeight : 0) || window.innerHeight;
  const mediaMaxStyle: React.CSSProperties = {
    maxWidth: (swap ? stageH : stageW) + 'px',
    maxHeight: (swap ? stageW : stageH) + 'px'
  };

  /* 单图媒体：图片（低清铺底 + 原图淡入）/ 视频 */
  const low = it.kind === 'image' ? thumbCache.get(it.id) : null;
  /**
   * 原图 URL —— 必须安全创建。
   * 这里原先直接 `URL.createObjectURL(it.file)`：只要文件的 Blob 不可用
   * （句柄失权 / 文件被移动或删除 / 数据异常），就会在**渲染期抛异常**，
   * 而 React 没有错误边界 —— 整棵树被卸载，表现就是「点一张图，页面直接没了」。
   * 现在失败只降级为「这一张显示不可用」，不影响其它任何东西。
   */
  const imgSrc = it.kind === 'image' ? (it.url || safeUrl(it)) : null;

  const onStageMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (state.lbLayout > 1) return;
    if ((e.target as HTMLElement).tagName === 'VIDEO') return;
    if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('.lb-err')) return;
    if (zoom <= 1) return;              // 未放大时不做拖动，避免误触
    dragStart.current = { sx: e.clientX - pan.x, sy: e.clientY - pan.y };
    setDragging(true);
  };

  const onStageDoubleClick = (e: React.MouseEvent) => {
    if (state.lbLayout > 1) return;   // 多图模式双击 = 回到单图（由单元格自身处理）
    if ((e.target as HTMLElement).tagName === 'VIDEO') return;
    if (zoom === 1) zoomAt(2, e.clientX, e.clientY);
    else { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  /* 移动端：左右滑动切换作品，双击放大 / 还原 */
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { touch.current.t = 0; return; }
    touch.current.x = e.touches[0].clientX;
    touch.current.y = e.touches[0].clientY;
    touch.current.t = Date.now();
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const tc = touch.current;
    if (!tc.t) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tc.x, dy = t.clientY - tc.y, dt = Date.now() - tc.t;
    tc.t = 0;
    if ((e.target as HTMLElement).tagName === 'VIDEO') return;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 600) {
      goto(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 350) {
      if (state.lbLayout > 1) return;   // 多图模式不做双击缩放
      const tNow = Date.now();
      if (tNow - tc.lastTap < 320 && Math.abs(t.clientX - tc.lastX) < 60 && Math.abs(t.clientY - tc.lastY) < 60) {
        tc.lastTap = 0;
        zoomAt(zoom === 1 ? 2.5 : 1, t.clientX, t.clientY);
      } else {
        tc.lastTap = tNow; tc.lastX = t.clientX; tc.lastY = t.clientY;
      }
    }
  };

  return (
    <div
      className={cx(
        'lightbox fixed inset-0 z-[80] bg-[rgba(10,13,20,.93)] backdrop-blur-[10px] flex flex-col text-white',
        '[&:fullscreen]:w-screen [&:fullscreen]:h-screen [&:fullscreen]:flex [&:fullscreen]:flex-col [&:fullscreen]:bg-[rgba(10,13,20,.98)]',
        '[&:-webkit-full-screen]:w-screen [&:-webkit-full-screen]:h-screen [&:-webkit-full-screen]:flex [&:-webkit-full-screen]:flex-col',
        state.fullscreen && 'rounded-none'
      )}
      id="lightbox"
      ref={rootRef}
    >
      <div className="h-auto min-h-[52px] flex-none flex items-center gap-3 px-3.5 py-1.5 bg-white/[.05] border-b border-white/[.09]">
        <button className={cx(lbBtnCls(), 'mr-0.5')} id="lbBack" title="返回图库 (Esc)" onClick={closePreview}>‹ 返回</button>
        <div className="flex flex-col min-w-0 flex-[1_1_auto]">
          <span id="lbName" className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap" title={it.name}>{it.name}</span>
          <span className="text-[11px] text-white/55 overflow-hidden text-ellipsis whitespace-nowrap max-[1080px]:hidden" id="lbCount">{countText}</span>
        </div>
        <div className="ml-auto flex items-center gap-1 flex-none flex-wrap justify-end">
          <div className="flex p-[2px] rounded-lg bg-white/[.08] gap-0.5 h-8" id="lbLayoutSeg" title="多图对比布局：可同时查看 2 / 4 / 9 张，随时切回单图">
            {[1, 2, 4, 9].map(n => (
              <button
                key={n}
                className={cx(
                  'border-0 cursor-pointer px-2 h-[26px] rounded-md whitespace-nowrap',
                  state.lbLayout === n
                    ? 'bg-accent text-white font-semibold'
                    : 'bg-transparent text-white/[.65] hover:text-white'
                )}
                data-n={n}
                onClick={() => setLbLayout(n)}
              >{n === 1 ? '单图' : n + ' 图'}</button>
            ))}
          </div>
          <span className="w-px h-[18px] bg-white/[.18] mx-1"></span>
          {/* 缩放组：三个按钮统一使用 icon 变体（30×30、图标居中、内边距归零），
              百分比用固定宽度占位，缩放时按钮不会左右跳动 */}
          <span className="inline-flex items-center gap-1 max-[900px]:!hidden">
            <button
              className={lbBtnCls(false, { icon: true })}
              id="lbZoomOut"
              title="缩小 (-)"
              aria-label="缩小"
              onClick={() => stepZoom(0.8)}
            ><Icon name="zoomOut" size={16} /></button>
            <span className="min-w-[46px] px-1 text-center text-xs text-white/75 tabular-nums" id="lbZoom">{Math.round(zoom * 100) + '%'}</span>
            <button
              className={lbBtnCls(false, { icon: true })}
              id="lbZoomIn"
              title="放大 (+)"
              aria-label="放大"
              onClick={() => stepZoom(1.25)}
            ><Icon name="zoomIn" size={16} /></button>
            <button
              className={lbBtnCls(false, { icon: true })}
              id="lbReset"
              title="重置缩放与位置 (0)"
              aria-label="重置缩放与位置"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            ><Icon name="frame" size={16} /></button>
          </span>
          <span className="w-px h-[18px] bg-white/[.18] mx-1"></span>
          <Stars
            id="lbStars"
            className="lb-stars"
            title="评分（仅支持鼠标点击，再次点击同一星级取消）"
            value={ratingOf(it)}
            onRate={v => setRating(it, ratingOf(it) === v ? 0 : v)}
          />
          <button
            className={cx(lbBtnCls(liked), 'text-[15px]', liked && '!text-[#ff5b74] !bg-[rgba(255,91,116,.18)]')}
            id="lbLike"
            title="标记喜欢 (L)：喜欢的图片受保护，不可删除"
            onClick={() => toggleLike(it)}
          ><Icon name="heart" size={15} filled={liked} /></button>
          <span className="w-px h-[18px] bg-white/[.18] mx-1"></span>
          <button
            className={lbBtnCls(state.slideOn)}
            id="lbPlay"
            title={state.slideOn ? '暂停幻灯片 (空格)' : '播放幻灯片 (空格)'}
            onClick={toggleSlide}
          >
            <Icon name={state.slideOn ? 'pause' : 'play'} size={15} className="flex-none" />
            <span className="bt-txt max-[900px]:hidden">{state.slideOn ? '暂停' : '幻灯片'}</span>
          </button>
          <button
            className={lbBtnCls(state.slideLoop)}
            id="lbLoop"
            title={state.slideLoop ? '循环播放：开' : '循环播放：关（播完最后一张自动停止）'}
            onClick={() => setSlideLoop(!state.slideLoop)}
          >
            <Icon name={state.slideLoop ? 'repeat' : 'arrowRight'} size={15} className="flex-none" />
            <span className="bt-txt max-[900px]:hidden">{state.slideLoop ? '循环' : '不循环'}</span>
          </button>
          <select
            className="h-[30px] px-1.5 rounded-[7px] cursor-pointer bg-white/[.10] text-white border border-white/[.14] max-[900px]:!hidden"
            id="lbSlideInt"
            title="切换间隔"
            value={String(state.slideInterval)}
            onChange={e => setSlideInterval(+e.target.value)}
          >
            <option value="1500">1.5 秒</option>
            <option value="2500">2.5 秒</option>
            <option value="3500">3.5 秒</option>
            <option value="5000">5 秒</option>
            <option value="8000">8 秒</option>
            <option value="12000">12 秒</option>
          </select>
          <span className="w-px h-[18px] bg-white/[.18] mx-1"></span>
          <button className={cx(lbBtnCls(false, { icon: true }), 'max-[900px]:!hidden')} id="lbRot" title={`顺时针旋转 90° (R) · 当前 ${rot}°`} onClick={rotatePreview}>
            <Icon name="rotateCw" size={16} />
          </button>
          <button
            className={lbBtnCls(state.fullscreen)}
            id="lbFs"
            title={state.fullscreen ? '退出全屏 (F / Esc)' : '全屏 (F)'}
            onClick={toggleFullscreen}
          >
            <Icon name={state.fullscreen ? 'minimize' : 'maximize'} size={15} className="flex-none" />
            <span className="bt-txt max-[900px]:hidden">全屏</span>
          </button>
          <button
            className={lbBtnCls(state.lbMetaOn || state.lbMetaMobileOpen)}
            id="lbInfoBtn"
            title={state.lbMetaOn ? '隐藏详细信息 (I)' : '显示详细信息 (I)'}
            onClick={toggleLbMeta}
          >
            <Icon name="info" size={15} className="flex-none" />
            <span className="bt-txt max-[900px]:hidden">详情</span>
          </button>
          <button className={lbBtnCls()} id="lbClose" title="关闭 (Esc)" onClick={closePreview} aria-label="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex max-[900px]:relative">
        <div
          className="lb-stage group flex-[1_1_auto] min-h-0 relative overflow-hidden flex items-center justify-center"
          id="lbStage"
          ref={stageRef}
          style={{ cursor: dragging ? 'grabbing' : '' }}
          onMouseDown={onStageMouseDown}
          onDoubleClick={onStageDoubleClick}
          onContextMenu={e => {
            /* 右键 = 就地操作当前图：不必移到顶栏，也不打断沉浸浏览。
               面板内各控件（顶栏按钮 / 详情面板）不拦截，保持浏览器默认行为。 */
            e.preventDefault();
            if (!it) return;
            openContextMenu({
              x: e.clientX, y: e.clientY,
              title: it.name,
              ariaLabel: `大图「${it.name}」的操作菜单`,
              items: menuForLightbox(it)
            });
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div
            className={cx(
              'lb-inner w-full h-full transition-transform duration-[120ms] ease-out',
              multi
                ? cx(
                    'grid gap-2 p-2 box-border items-stretch justify-items-stretch content-stretch justify-stretch',
                    state.lbLayout === 2 ? 'grid-cols-2 grid-rows-1' : state.lbLayout === 4 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-3 grid-rows-3',
                    '[&>div]:min-w-0 [&>div]:min-h-0'
                  )
                : 'flex items-center justify-center',
              dragging && '!transition-none'
            )}
            id="lbInner"
            ref={innerRef}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {multi ? (
              <MultiCells cur={it} />
            ) : it.kind === 'image' ? (
              !imgSrc ? (
                <div className="lb-err flex flex-col items-center gap-2.5 text-white/80 text-sm text-center max-w-[520px] px-4">
                  <div className="py-1">这张图片的本地文件已不可用（可能文件夹权限失效、文件被移动或删除），无法读取原图。</div>
                  <button className={lbBtnCls()} onClick={closePreview}>返回图库</button>
                </div>
              ) : (
              <>
                {/* 低清铺底图：与高清图使用同一套「旋转 + 最大外接框」约束，居中叠放，旋转时两者完全重合 */}
                {low && low.url ? (
                  <img
                    className="lb-low absolute left-1/2 top-1/2 z-0 max-w-full max-h-full object-contain pointer-events-none select-none"
                    style={{ transform: `translate(-50%, -50%) rotate(${rot}deg)`, ...mediaMaxStyle }}
                    alt=""
                    draggable={false}
                    src={low.url}
                  />
                ) : null}
                <img
                  key={it.key + ':' + retryKey}
                  className={cx(
                    'lb-hi relative z-[1] max-w-full max-h-full object-contain select-none opacity-0 transition-opacity duration-[180ms] ease-out animate-lbfade',
                    mediaReady && 'opacity-100'
                  )}
                  alt={it.name}
                  draggable={false}
                  src={imgSrc}
                  style={{ transform: `rotate(${rot}deg)`, ...mediaMaxStyle }}
                  onLoad={e => {
                    setMediaReady(true);
                    // 记录真实分辨率（详情面板展示）
                    const nw = e.currentTarget.naturalWidth, nh = e.currentTarget.naturalHeight;
                    if (nw) {
                      it.w = nw; it.h = nh;
                      if (!it.aspect) it.aspect = nw / nh;
                      notify('lightbox');
                    }
                  }}
                  onError={() => { setMediaReady(true); setMediaError('图片加载失败或格式不支持'); }}
                />
              </>
              )
            ) : (
              <>
                {!mediaReady && !mediaError ? <div className="text-white/70 text-sm">加载视频…</div> : null}
                <video
                  key={it.key + ':' + retryKey}
                  ref={videoRef}
                  className={cx(
                    'lb-hi relative z-[1] max-w-[96%] max-h-[96%] object-contain outline-none bg-black opacity-0 transition-opacity duration-[180ms]',
                    mediaReady && 'opacity-100'
                  )}
                  src={videoUrl || ''}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  muted={!!state.slideOn}   // 幻灯片中静音自动播放，避免被浏览器的自动播放策略拦截
                  style={{ transform: `rotate(${rot}deg)`, ...mediaMaxStyle }}
                  onError={() => { setMediaError('视频加载失败或格式不支持'); }}
                  onLoadedMetadata={e => {
                    const v = e.currentTarget;
                    setMediaReady(true);
                    if (!it.dur) it.dur = v.duration;
                    if (!it.w) { it.w = v.videoWidth; it.h = v.videoHeight; }
                    notify('lightbox');
                  }}
                  onEnded={() => { if (state.slideOn) slideStep(1); }}
                />
              </>
            )}
            {mediaError ? (
              <div className="lb-err flex flex-col items-center gap-2.5 text-white/80 text-sm text-center">
                <div className="py-1">{mediaError}</div>
                <button className={lbBtnCls()} onClick={() => { setMediaError(null); setMediaReady(false); setRetryKey(k => k + 1); }}>重试</button>
              </div>
            ) : null}
          </div>
          <div className="lb-prev absolute left-[14px] top-1/2 -translate-y-1/2 w-[46px] h-[76px] flex items-center justify-center text-[30px] text-white/75 cursor-pointer bg-black/[.28] rounded-[10px] select-none opacity-0 group-hover:opacity-100 transition-[opacity,background-color] duration-[180ms] hover:bg-black/[.55] hover:text-white max-[900px]:w-10 max-[900px]:h-16" id="lbNavPrev" onClick={() => goto(-1)}>‹</div>
          <div className="lb-next absolute right-[14px] top-1/2 -translate-y-1/2 w-[46px] h-[76px] flex items-center justify-center text-[30px] text-white/75 cursor-pointer bg-black/[.28] rounded-[10px] select-none opacity-0 group-hover:opacity-100 transition-[opacity,background-color] duration-[180ms] hover:bg-black/[.55] hover:text-white max-[900px]:w-10 max-[900px]:h-16" id="lbNavNext" onClick={() => goto(1)}>›</div>
        </div>
        <aside
          className={cx(
            'lb-meta w-[336px] flex-none overflow-y-auto py-[18px] px-[18px] pb-[30px] bg-white/[.04] border-l border-white/[.09]',
            !state.lbMetaOn && 'hidden',
            'max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:top-auto max-[900px]:w-auto max-[900px]:max-h-[64vh]',
            'max-[900px]:overflow-y-auto max-[900px]:px-[18px] max-[900px]:py-3 max-[900px]:pb-[calc(20px+env(safe-area-inset-bottom))]',
            'max-[900px]:bg-[#15181e] max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:border-t-white/[.12] max-[900px]:rounded-t-2xl',
            'max-[900px]:transition-transform max-[900px]:duration-[250ms] max-[900px]:ease-out max-[900px]:shadow-metadrawer max-[900px]:z-[5]',
            state.lbMetaMobileOpen ? 'max-[900px]:translate-y-0' : 'max-[900px]:translate-y-[105%]'
          )}
          id="lbMeta"
          aria-label="拍摄信息"
          ref={metaRef as any}
        >
          {/* 移动端抽屉把手 */}
          <div className="hidden max-[900px]:block w-11 h-1 rounded-full bg-white/25 mx-auto mb-3"></div>
          <MetaPanel it={it} />
        </aside>
      </div>
    </div>
  );
}

/** 多图对比：渲染当前页（previewIndex 起，共 lbLayout 张）宫格 */
function MultiCells({ cur }: { cur: MediaItem }) {
  const n = state.lbLayout;
  const len = state.view.length;
  const end = Math.min(state.previewIndex + n, len);
  const cells = [];
  for (let i = state.previewIndex; i < end; i++) {
    const it = state.view[i];
    const liked = likedOf(it);
    let media: React.ReactNode;
    if (it.kind === 'image') {
      // 性能：多图优先复用已生成的缩略图（解码成本低），没有再回退原图
      const rec = thumbCache.get(it.id);
      const src = (rec && rec.url) ? rec.url : safeUrl(it);
      media = src
        ? <img alt={it.name} draggable={false} decoding="async" src={src} className="block flex-[0_1_auto] min-w-0 min-h-0 max-w-full max-h-full object-contain select-none" />
        : <div className="text-white/55 text-xs px-2 text-center">这一张无法读取</div>;
    } else {
      // 多图模式下视频只显示封面，不自动播放、不预载数据
      if (it.poster) {
        media = <img alt={it.name} draggable={false} decoding="async" src={it.poster} className="block flex-[0_1_auto] min-w-0 min-h-0 max-w-full max-h-full object-contain select-none" />;
      } else {
        safeUrl(it);
        media = <video src={it.url || undefined} muted preload="none" className="block flex-[0_1_auto] min-w-0 min-h-0 max-w-full max-h-full object-contain bg-black" />;
      }
    }
    cells.push(
      <div
        key={it.key}
        className={cx(
          'relative min-h-0 min-w-0 overflow-hidden flex justify-center bg-white/[.04] rounded-[10px] border-2 border-transparent cursor-pointer transition-[border-color,background-color] duration-150 hover:bg-white/[.08]',
          it === cur ? 'border-accent' : 'border-transparent'
        )}
        title={it.name + '（点击设为当前，数字键 ' + (i - state.previewIndex + 1) + ' 标记喜欢，双击进入单图）'}
        onClick={() => setPreviewIndex(i)}
        onDoubleClick={() => setLbLayout(1)}
      >
        {media}
        {it.kind === 'video' ? (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1] text-white/85 [filter:drop-shadow(0_2px_10px_rgba(0,0,0,.6))] pointer-events-none">
            <Icon name="play" size={30} filled />
          </span>
        ) : null}
        <span className="absolute left-2 top-2 z-[2] min-w-5 h-5 px-[5px] leading-5 text-center rounded-md bg-black/[.55] text-white/85 text-xs tabular-nums pointer-events-none">{String(i - state.previewIndex + 1)}</span>
        {liked ? (
          <span className="absolute right-2 top-2 z-[2] text-[#ff5b74] leading-none [filter:drop-shadow(0_1px_4px_rgba(0,0,0,.55))] pointer-events-none">
            <Icon name="heart" size={16} filled />
          </span>
        ) : null}
        <span className="absolute left-0 right-0 bottom-0 z-[2] py-[14px] px-2 pb-1.5 text-[11px] text-white/85 bg-[linear-gradient(transparent,rgba(0,0,0,.55))] overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">{it.name}</span>
      </div>
    );
  }
  return <>{cells}</>;
}

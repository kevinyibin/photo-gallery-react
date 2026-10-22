/**
 * 图库主区 —— 滚动容器 + 瀑布流虚拟化渲染 + 空状态。
 * 布局由 core/view 的 layout() 计算（state.pos / state.gridH）；
 * 本组件按滚动位置只渲染可视区（含缓冲）内的节点，与原版本的
 * renderVisible 双缓冲策略一致（近区立即渲染，远区随滚动提交）。
 *
 * 局部状态：scrollTop / viewportH（只影响本组件渲染窗口）；
 * 全局状态：items / nodes / pos / gridH / dropActive / restore（core 持有）。
 */
import { useEffect, useRef, useState } from 'react';
import { state, dom, useChannel, setLeft } from '../core/store';
import { relayout, setColWidth } from '../core/engine';
import { saveSessionDebounced } from '../core/session';
import { pruneQueues } from '../core/thumbs';
import { openTreePath } from '../core/tree';
import { setDirFilter, resetFilters } from '../core/engine';
import { pickFolder } from '../core/scanner';
import { doRestore } from '../core/session';
import { notify } from '../core/store';
import { cx } from '../ui/kit';
import Icon from '../ui/Icon';
import { openContextMenu } from '../ui/ContextMenu';
import { menuForCanvas, menuForGroupHeader } from '../core/ctxMenus';
import { useScrollReveal } from '../ui/useScrollReveal';
import Tile from './Tile';
import type { GridNode, LayoutPos } from '../core/types';

export default function Gallery() {
  useChannel('grid', 'empty');
  const scrollRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [, setViewportH] = useState(0);
  const scrollRaf = useRef(false);

  /* 注册 DOM 引用（布局引擎需要读取几何） */
  useEffect(() => {
    dom.scrollEl = scrollRef.current;
    dom.grid = gridRef.current;
    // 首次挂载后立即重排一次，保证 refresh() 能拿到正确的容器宽度
    relayout();
    setViewportH(scrollRef.current ? scrollRef.current.clientHeight : 0);
    return () => { dom.scrollEl = null; dom.grid = null; };
  }, []);

  /* 观察滚动视口尺寸变化（侧栏拖拽 / 窗口缩放都会触发重排） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight);
      relayout();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 滚动条：仅在滚动时显示（与侧栏共用 .scroller 样式） */
  useScrollReveal(scrollRef);

  /* 视图从空变为有内容时补一次重排。
     原因：refresh() 里的 layout() 在 notify 之前执行，此时 #grid 仍是 display:none
     （display 由 state.view.length 决定），量到宽度 0 会直接 return，pos 为空 ——
     而瓦片又必须先有 pos 才会挂载，于是首次导入会出现「有作品但一片空白」。
     等 React 提交完 DOM 再补齐这次重排，就形成闭环。 */
  useEffect(() => {
    if (state.nodes.length && state.pos.length !== state.nodes.length) relayout();
  }, [state.nodes.length, state.pos.length]);

  /* 滚动：rAF 合帧刷新可视集合 + 防抖保存会话 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!scrollRaf.current) {
        scrollRaf.current = true;
        requestAnimationFrame(() => {
          scrollRaf.current = false;
          setScrollTop(el.scrollTop);
        });
      }
      saveSessionDebounced();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // 用户主动滚动时放弃未完成的位置恢复，避免和自动恢复打架
    const cancelPending = () => { state.pendingScroll = null; };
    el.addEventListener('wheel', cancelPending, { passive: true });
    el.addEventListener('touchstart', cancelPending, { passive: true });
    el.addEventListener('keydown', cancelPending, { passive: true } as any);
    // Alt + 滚轮：调整缩略图尺寸（窄屏下尺寸滑杆会被收起，用这个方式补上）
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      setColWidth(state.colWidth + (e.deltaY < 0 ? 20 : -20));
      setLeft('缩略图宽度：' + state.colWidth + 'px');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', cancelPending);
      el.removeEventListener('touchstart', cancelPending);
      el.removeEventListener('keydown', cancelPending as any);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const st = scrollRef.current;
  const vh = (st && st.clientHeight) || 600;
  const top = scrollTop;
  const bottom = top + vh;
  const bufNear = Math.max(260, vh * 0.55);   // 立即渲染
  const bufFar = Math.max(700, vh * 1.4);     // 预挂载缓冲区（懒加载）

  const nodes = state.nodes;
  const pos = state.pos;
  const nearIdx: number[] = [];
  const farIdx: number[] = [];
  const visibleIds = new Set<number>();
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (!p) continue;
    if (p.y + p.h < top - bufFar || p.y > bottom + bufFar) continue;
    const n = nodes[i];
    if (n && n.type === 'item') visibleIds.add(n.item.id);
    if (p.y + p.h >= top - bufNear && p.y <= bottom + bufNear) nearIdx.push(i);
    else farIdx.push(i);
  }

  /* 精确清理生成队列：只丢弃已滚出视口的缩略图 / 封面请求 */
  useEffect(() => {
    pruneQueues(visibleIds);
  });

  const hasItems = state.items.length > 0;
  const noResult = hasItems && state.view.length === 0;
  const showEmpty = !hasItems || noResult;

  const renderNode = (i: number) => {
    const n = nodes[i];
    const p = pos[i];
    if (!n || !p) return null;
    if (n.type === 'group') return <GroupHeader key={n.key} node={n} p={p} />;
    return <Tile key={n.key} it={n.item} p={p} />;
  };

  return (
    <main
      className="main scroller flex-1 overflow-y-auto overflow-x-hidden relative min-w-0"
      id="scrollEl"
      ref={scrollRef as any}
      /* 右键空白区 = 库级 / 视图级操作。作品卡片与分组头各自的 onContextMenu 会先
         stopPropagation，所以这里收到的只有真正的「背景」右键 */
      onContextMenu={e => {
        e.preventDefault();
        openContextMenu({
          x: e.clientX, y: e.clientY, title: '图库', ariaLabel: '图库操作菜单',
          items: menuForCanvas()
        });
      }}
    >
      {/* 用 margin 而非 padding：绝对定位子元素的包含块是 padding box，
          padding 会让列宽计算多算一圈，导致瓦片溢出容器 */}
      <div
        className="grid relative m-[14px]"
        id="grid"
        ref={gridRef}
        style={{ height: state.gridH + 'px', display: state.view.length ? '' : 'none' }}
      >
        {nearIdx.map(renderNode)}
        {farIdx.map(renderNode)}
      </div>

      <div className={cx('px-5 py-10', showEmpty ? 'block' : 'hidden')} id="empty">
        <div className="max-w-[760px] mx-auto">
          <div
            className={cx(
              'border-2 border-dashed rounded-[18px] px-6 py-[54px] text-center bg-panel transition-[border-color,background-color] duration-[180ms]',
              state.dropActive ? 'border-accent bg-soft' : 'border-line'
            )}
            id="dropzone"
            style={{ display: noResult ? 'none' : '' }}
            onClick={e => { if (e.target === e.currentTarget) pickFolder(); }}
          >
            <svg viewBox="0 0 24 24" className="w-10 h-10 mx-auto fill-none stroke-current stroke-[1.5] text-accent stroke-linecap-round stroke-linejoin-round"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
            <h2 className="text-[19px] font-[650] mt-3.5 mb-1.5">把照片文件夹拖到这里</h2>
            <p className="m-0 mb-[18px] text-muted">自动在本地解析 EXIF 拍摄信息，按相机 · 镜头 · 焦距 · 年份整理作品</p>
            <button className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-accent bg-accent text-white cursor-pointer whitespace-nowrap text-[15px] hover:brightness-[1.07]" id="btnPick2" onClick={() => pickFolder()}>选择文件夹</button>
            <RestoreHint />
          </div>
          <div className="text-center py-[60px] px-5" id="noResult" hidden={!noResult}>
            <svg viewBox="0 0 24 24" className="w-9 h-9 text-muted fill-none stroke-current stroke-[1.5] stroke-linecap-round stroke-linejoin-round mx-auto"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <h3 className="text-[17px] font-[650] mt-3 mb-1.5">没有匹配的作品</h3>
            <p className="m-0 mb-4 text-muted">试着调整筛选条件、换个关键词，或取消文件夹筛选。</p>
            <button className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-accent bg-accent text-white cursor-pointer whitespace-nowrap text-[15px] hover:brightness-[1.07]" id="btnReset" onClick={resetFilters}>重置筛选条件</button>
          </div>
          <ul className="list-none p-0 mt-[22px] text-muted text-[13px]">
            <li className="relative pl-[18px] py-1.5 leading-[1.7]"><span className="absolute left-1 top-[14px] w-[5px] h-[5px] rounded-full bg-accent"></span>
              <b className="text-fg font-semibold">支持格式</b> —— 照片：JPG / PNG / WebP / AVIF / GIF / HEIC（HEIC 缩略图视浏览器支持而定）· 视频：MP4 / WebM / MOV</li>
            <li className="relative pl-[18px] py-1.5 leading-[1.7]"><span className="absolute left-1 top-[14px] w-[5px] h-[5px] rounded-full bg-accent"></span>
              <b className="text-fg font-semibold">拍摄信息</b> —— EXIF 全程在本地解析，用于相机机身、镜头、焦距区间、拍摄年份的组合筛选，不上传任何数据</li>
            <li className="relative pl-[18px] py-1.5 leading-[1.7]"><span className="absolute left-1 top-[14px] w-[5px] h-[5px] rounded-full bg-accent"></span>
              <b className="text-fg font-semibold">鼠标操作</b> —— <b className="text-fg">单击</b>任意作品直接进入大图（批量模式下单击为勾选，不会跳转）· <b className="text-fg">右键</b>作品 / 空白区 / 筛选条目 / 目录树 / 维度标题会打开对应的就地操作菜单，与左键的「进入」语义分工明确</li>
            <li className="relative pl-[18px] py-1.5 leading-[1.7]"><span className="absolute left-1 top-[14px] w-[5px] h-[5px] rounded-full bg-accent"></span>
              <b className="text-fg font-semibold">操作提示</b> —— 方向键左右切换 · 滚轮缩放 · L 标记喜欢（喜欢的图片不可删除，索尼照片会把同名 ARW 原件移入「精选RAW」）· D / Delete 移入废纸篓 · I 显隐详情面板 · 详情页可切换 2 / 4 / 9 多图对比，多图下按数字键 1-9 标记对应位置的图片为喜欢 · R 顺时针旋转 90° · F 全屏 · Esc 或浏览器返回键回到图库 · 评分仅支持鼠标点击星级 · 移动端支持左右滑动切换、双击放大</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

/** 空状态里的“恢复上次浏览”提示（结构与原版一致：子元素常驻，由父级 hidden 控制显隐） */
function RestoreHint() {
  const r = state.restore;
  const name = r ? (r.sess.rootName || (r.handle && r.handle.name) || '上次浏览的文件夹') : '';
  return (
    <div className="mt-[18px] flex items-center justify-center gap-2.5 flex-wrap pt-4 border-t border-dashed border-line" id="restoreHint" hidden={!r}>
      <span className="text-muted text-[13px]" id="restoreTxt">{r ? `上次浏览过「${name}」` + (r.sess.dir ? ' · ' + r.sess.dir : '') : ''}</span>
      <button className="inline-flex items-center gap-1.5 h-8 px-[9px] rounded-lg border border-line bg-panel cursor-pointer whitespace-nowrap hover:bg-hov" id="btnRestore2" onClick={doRestore}>
        <Icon name="rotateCcw" size={14} className="flex-none" />恢复上次浏览
      </button>
    </div>
  );
}

/** 分组头（按文件夹布局模式）：点击只查看该文件夹 */
function GroupHeader({ node, p }: { node: Extract<GridNode, { type: 'group' }>; p: LayoutPos }) {
  return (
    <div
      className="absolute top-0 left-0 flex items-center gap-2.5 h-10 px-1 cursor-pointer select-none"
      title="点击只查看该文件夹"
      style={{
        transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
        width: p.w + 'px',
        height: p.h + 'px'
      }}
      onClick={() => {
        openTreePath(node.dir);
        notify('tree');
        setDirFilter(node.dir);
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu({
          x: e.clientX, y: e.clientY,
          title: node.dir || '根目录',
          ariaLabel: `文件夹「${node.dir || '根目录'}」的操作菜单`,
          items: menuForGroupHeader(node.dir)
        });
      }}
    >
      <span className="text-[15px] font-[650] tracking-[.2px] overflow-hidden text-ellipsis whitespace-nowrap">{node.dir || '/'}</span>
      <span className="text-[11px] text-accent bg-soft px-2 py-0.5 rounded-full flex-none">{node.count}</span>
      <span className="flex-1 h-px bg-line min-w-[10px]"></span>
    </div>
  );
}

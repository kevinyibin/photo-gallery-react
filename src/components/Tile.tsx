/**
 * 瓦片 —— 单张作品卡片（缩略图 / 播放角标 / 时长 / 喜欢角标 / 悬停信息 / 选择框 / 名称与摘要）。
 * 与原 TILE_HTML 结构一致；缩略图加载走 thumbs 管线：
 * 缓存命中同步渲染，未命中排队异步回填；宽高比测得后触发整体重排。
 *
 * 局部状态：缩略图结果 / 加载完成 / 失败（每张卡片各自的加载态）；
 * 全局状态：selectMode / selected / currentSig / showName（core 持有）。
 * 原版用 CSS 伪元素实现的播放三角与勾选标记，改为真实 SVG 元素。
 */
import { useEffect, useRef, useState } from 'react';
import { state, setLeft } from '../core/store';
import { scheduleLayout } from '../core/view';
import { requestThumb, requestPoster, posterLRU, ThumbRec } from '../core/thumbs';
import { exifSummary, fmtDur, sigOf } from '../core/utils';
import { openPreview, warmPreview } from '../core/preview';
import { toggleSelect } from '../core/library';
import { menuForItem } from '../core/ctxMenus';
import { openContextMenu } from '../ui/ContextMenu';
import { cx } from '../ui/kit';
import Icon from '../ui/Icon';
import type { LayoutPos, MediaItem } from '../core/types';

export default function Tile({ it, p }: { it: MediaItem; p: LayoutPos }) {
  const [rec, setRec] = useState<ThumbRec | null>(null);
  const [failed, setFailed] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const alive = useRef(true);

  /* 挂载 / 换绑条目时：标记正在显示（LRU 淘汰跳过），并请求缩略图 */
  useEffect(() => {
    alive.current = true;
    it._shown = true;
    setRec(null);
    setFailed(false);
    setImgReady(false);

    if (it.kind === 'video') {
      // 视频封面：已有 / LRU 命中直接用，否则离屏抽帧；失败最多重试 2 次
      if ((it._ptried || 0) >= 2) { setFailed(true); return cleanup; }
      if (!it.poster) {
        const hit = posterLRU.get(it.id);
        if (hit && hit.url) it.poster = hit.url;
      }
      if (it.poster) {
        if (!it.aspect && it.w && it.h) { it.aspect = it.w / it.h; scheduleLayout(); }
        setRec({ url: it.poster, w: it.w, h: it.h, tw: 0, aspect: it.aspect || 0 });
      } else {
        requestPoster(it, (ok, dropped) => {
          if (!alive.current) return;
          if (ok && it.poster) {
            if (!it.aspect && it.w && it.h) { it.aspect = it.w / it.h; scheduleLayout(); }
            setRec({ url: it.poster, w: it.w, h: it.h, tw: 0, aspect: it.aspect || 0 });
            return;
          }
          if (dropped) return;             // 滚出视口被取消，不算失败
          setFailed(true);
        });
      }
    } else {
      // 照片缩略图：连续失败两次就不再重试（通常是浏览器无法解码的格式）
      if ((it._tries || 0) >= 2) { setFailed(true); return cleanup; }
      const cached = requestThumb(it, (r, dropped) => {
        if (!alive.current) return;
        if (r) {
          applyRec(r);
          return;
        }
        if (dropped) return;               // 滚出视口被取消，不算失败
        setFailed(true);
      });
      if (cached) applyRec(cached);
    }
    return cleanup;

    function applyRec(r: ThumbRec) {
      setRec(r);
      if (!it.aspect && r.aspect) { it.aspect = r.aspect; scheduleLayout(); }
    }
    function cleanup() {
      alive.current = false;
      it._shown = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it]);

  /* ---------- 单击 = 直接打开大图 ----------
   * 用「pointerup + click」双保险：
   * - pointerup 先到，正常单击大概率在这里就完成跳转（少等一次 click 合成）；
   * - click 仍是主路径（键盘 / 程序化触发 / 某些输入法只有 click）；
   * - 两者之间用 openGuard 去重，避免重复 pushState 多出一条历史记录。
   * 拖动超过 8px 或按住超过 700ms 都不算点击（用户可能在滚动时松手划过卡片）。
   */
  const downInfo = useRef<{ x: number; y: number; t: number } | null>(null);
  const openGuard = useRef(0);   // pointerup 已处理，抑制随后的 click
  const dragGuard = useRef(0);   // 本次手势是拖动 / 长按，不是点击

  /** 当前条目在视图里的序号：`_vi` 可能因刷新失效，逐级兜底，绝不猜错也不静默失败 */
  const viewIndex = (): number => {
    const v = state.view;
    if (it._vi != null && v[it._vi] === it) return it._vi;
    const i = v.indexOf(it);
    if (i >= 0) return i;
    return v.findIndex(x => x.key === it.key);
  };

  const openBig = () => {
    const idx = viewIndex();
    if (idx < 0) {
      // 不再「点了没反应」：明确告诉用户为什么没打开
      setLeft(`「${it.name}」已不在当前视图中，请调整筛选条件后再试`);
      return;
    }
    openPreview(idx);
  };

  const onClick = () => {
    if (Date.now() < openGuard.current) return;   // 已由 pointerup 处理
    // 拖动 / 长按松手后浏览器仍会补一个 click，这里把它拦掉，避免「划着划着就打开了」
    if (Date.now() < dragGuard.current) return;
    if (state.selectMode) { toggleSelect(it); return; }
    openBig();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    downInfo.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = downInfo.current;
    downInfo.current = null;
    if (!d || e.button !== 0) return;
    const moved = Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8;
    const held = Date.now() - d.t > 700;
    if (moved || held) { dragGuard.current = Date.now() + 400; return; }   // 不是点击
    if (state.selectMode) return;                                          // 交给 click 去切换勾选
    openGuard.current = Date.now() + 400;
    openBig();
  };

  /* 悬停预热：指针停留 120ms 才建 blob URL 并解码原图，
     既能让单击后的大图首帧即高清，又不会在快速划过的列表里白建几十个对象 URL */
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnter = () => {
    if (state.selectMode || it.kind !== 'image') return;
    if (warmTimer.current) clearTimeout(warmTimer.current);
    warmTimer.current = setTimeout(() => warmPreview(it), 120);
  };
  const onLeave = () => {
    if (warmTimer.current) { clearTimeout(warmTimer.current); warmTimer.current = null; }
  };
  useEffect(() => () => { if (warmTimer.current) clearTimeout(warmTimer.current); }, []);

  /* 右键：就地操作这张作品（不跳转）。stopPropagation 让图库空白区的菜单不重复弹出 */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: it.name,
      ariaLabel: `作品「${it.name}」的操作菜单`,
      items: menuForItem(it)
    });
  };

  const sum = exifSummary(it);
  const liked = !!it.liked;
  const sel = state.selected.has(it.id);
  const cur = !!(state.currentSig && sigOf(it) === state.currentSig);
  const loaded = imgReady || failed;

  return (
    <div
      className={cx(
        'group absolute top-0 left-0 rounded-app overflow-hidden bg-panel shadow-card cursor-pointer',
        'will-change-transform transition-shadow duration-[180ms] [contain:layout_paint_style] hover:shadow-tileh hover:z-[2]',
        sel && 'outline outline-2 outline-accent -outline-offset-2',
        cur && 'outline outline-2 outline-accent -outline-offset-2'
      )}
      style={{
        transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
        width: p.w + 'px',
        height: p.h + 'px'
      }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div
        className={cx('relative w-full overflow-hidden bg-tile', liked && 'outline outline-2 outline-[#ff5b74] -outline-offset-2 shadow-likeglow')}
        style={{ height: (p.imgH || p.h) + 'px' }}
      >
        {/* 占位骨架：加载中微光动画 / 失败时提示无法预览 */}
        {!loaded ? (
          failed ? (
            <div className="absolute inset-0 flex items-center justify-center bg-line text-muted text-xs">无法预览</div>
          ) : (
            <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,var(--tile)_30%,var(--border)_50%,var(--tile)_70%)] bg-[length:300%_100%]"></div>
          )
        ) : null}

        {rec && rec.url ? (
          <img
            className={cx('w-full h-full object-cover block opacity-0 transition-opacity duration-[250ms]', imgReady && 'opacity-100')}
            alt=""
            draggable={false}
            decoding="async"
            src={rec.url}
            onLoad={() => setImgReady(true)}
            onError={() => { setFailed(true); }}
          />
        ) : (
          <img className="w-full h-full object-cover block opacity-0 transition-opacity duration-[250ms]" alt="" draggable={false} decoding="async" />
        )}

        {/* 视频卡片底部渐变 */}
        {it.kind === 'video' ? <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,.28))]"></div> : null}

        {it.kind === 'video' ? (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42px] h-[42px] rounded-full bg-black/45 border-[1.5px] border-white/85 backdrop-blur-[4px] z-[2] pointer-events-none flex items-center justify-center group-hover:bg-accent">
            <svg viewBox="0 0 24 24" className="w-[13px] h-[13px] fill-white stroke-none"><path d="M6 4l14 8-14 8z"/></svg>
          </div>
        ) : null}

        {it.kind === 'video' && it.dur ? (
          <span className="absolute right-[7px] bottom-[7px] bg-black/[.62] text-white text-[11px] px-[7px] py-0.5 rounded-[5px] backdrop-blur-[6px] z-[2] pointer-events-none tabular-nums">{fmtDur(it.dur)}</span>
        ) : null}

        {liked ? (
          <span className="absolute left-[7px] top-1.5 z-[3] text-[#ff5b74] leading-none [filter:drop-shadow(0_1px_4px_rgba(0,0,0,.55))] pointer-events-none" title="已标记喜欢">
            <Icon name="heart" size={15} filled />
          </span>
        ) : null}

        <TileInfo it={it} />

        {/* 多选勾选圈 */}
        {state.selectMode ? (
          <div className={cx(
            'absolute right-2 top-2 z-[4] w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center',
            sel ? 'bg-accent border-white' : 'bg-black/35 border-white/90'
          )}>
            {sel ? (
              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-white stroke-[3] stroke-linecap-round stroke-linejoin-round"><path d="M5 12l4 4L19 6"/></svg>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.showName ? (
        <div className="px-2.5 py-0.5">
          <div className="text-xs font-[550] leading-[1.35] overflow-hidden text-ellipsis whitespace-nowrap" title={it.name}>{it.name}</div>
          <div className="text-[10px] text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap" title={sum ? (it.dirKey ? sum + ' · ' + it.dirKey : sum) : (it.dirKey || '根目录')}>
            {sum || (it.dirKey || '根目录')}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 卡片悬停信息：主色调色卡 + 标签（取代原来的评分星标） */
function TileInfo({ it }: { it: MediaItem }) {
  const pal = it.pal || [];
  const tags = it.tags || [];
  return (
    <div className="absolute left-1.5 right-1.5 bottom-1.5 z-[3] flex items-center gap-2 flex-wrap px-[7px] py-1 rounded-lg bg-black/[.42] backdrop-blur-[6px] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100">
      <div className="flex items-center gap-[3px] flex-none">
        {pal.length
          ? pal.slice(0, 4).map(c => <i key={c} className="w-3.5 h-3.5 rounded border border-white/55" style={{ background: c }} title={c}></i>)
          : <i className="w-3.5 h-3.5 rounded border border-white/55 bg-white/25 animate-shimmer bg-[linear-gradient(100deg,rgba(255,255,255,.18)_30%,rgba(255,255,255,.45)_50%,rgba(255,255,255,.18)_70%)] bg-[length:300%_100%]"></i>}
      </div>
      {tags.length ? (
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          {tags.slice(0, 3).map(t => <span key={t} className="text-[11px] leading-[1.5] text-white px-1.5 py-px rounded-full bg-white/[.18] whitespace-nowrap overflow-hidden text-ellipsis max-w-[92px]">{t}</span>)}
          {tags.length > 3 ? <span className="text-[11px] leading-[1.5] text-white/80 px-1.5 py-px rounded-full bg-white/10 flex-none">+{tags.length - 3}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

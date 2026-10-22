/**
 * 右键上下文菜单 —— 全站唯一实现（headless，不依赖组件库）。
 *
 * 为什么单独做一套而不是复用 ui/Menu 的 DropdownMenu：
 * - DropdownMenu 是「触发器 + 下拉」，位置由父级 relative 决定；
 *   右键菜单需要以鼠标坐标为锚点、向视口内翻转/夹取，生命周期也不由某个组件持有；
 * - 右键菜单是「就地操作」语义：不改变当前视图、不跳转，操作完即关闭（可选保留自绘行，
 *   例如星级评分行 —— 点击星星不关闭菜单，便于连续调整）。
 *
 * 对外只有一个函数式入口 `openContextMenu({x, y, items, title})`，
 * 宿主组件由 App 挂载一次（portal 到 body，避免被祖先的 transform / overflow 裁切）。
 *
 * 交互约定：
 * - 打开：surface 的 onContextMenu 里 preventDefault 后调用；
 * - 关闭：点菜单外、滚动、窗口尺寸变化、Esc、任一条目被选中；
 * - 键盘：↑ / ↓ / Home / End 移动，Enter / 空格 触发，Tab 关闭；打开时菜单接管键盘，
 *   避免「菜单开着但按 L 把当前图标记喜欢了」这类穿透；
 * - 打开时焦点落在首个可用项，关闭后焦点回到打开前的元素。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cx } from './kit';
import type { MenuItem } from './Menu';

export interface CtxMenuOptions {
  /** 视口坐标（clientX / clientY） */
  x: number;
  y: number;
  items: MenuItem[];
  /** 菜单头部说明（通常是被操作对象的名称 / 路径） */
  title?: string;
  /** 无障碍名称，默认取 title */
  ariaLabel?: string;
  /** 关闭回调（不区分是选中条目还是点外部关闭） */
  onClose?: () => void;
}

/* ---------------- 极简外部 store（不引入额外状态库） ---------------- */
let current: CtxMenuOptions | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function openContextMenu(opt: CtxMenuOptions) {
  current = opt;
  emit();
}

export function closeContextMenu() {
  if (!current) return;
  const cb = current.onClose;
  current = null;
  emit();
  cb?.();
}

/** 供全局键盘处理判断（菜单打开时不响应图库 / 灯箱快捷键） */
export function isContextMenuOpen(): boolean {
  return !!current;
}

const ITEM_SEL = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const EDGE = 8;   // 距离视口边缘的最小留白

export function ContextMenuHost() {
  const opt = useSyncExternalStore(subscribe, () => current, () => null);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const restoreFocus = useRef<Element | null>(null);

  /* 打开前记录焦点，关闭后归还（键盘用户的焦点不应丢失） */
  useEffect(() => {
    if (opt) { restoreFocus.current = document.activeElement; return; }
    const el = restoreFocus.current as HTMLElement | null;
    restoreFocus.current = null;
    if (el && el.isConnected && typeof el.focus === 'function') el.focus();
  }, [opt]);

  /* 先渲染再测量，然后向视口内夹取 / 向上翻转（鼠标靠近右下角时不至于被裁掉） */
  useLayoutEffect(() => {
    if (!opt) { setPos(null); return; }
    const el = ref.current;
    if (!el) { setPos({ left: opt.x, top: opt.y }); return; }
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = opt.x, top = opt.y;
    if (left + width + EDGE > vw) left = Math.max(EDGE, vw - width - EDGE);
    if (top + height + EDGE > vh) top = opt.y - height >= EDGE ? opt.y - height : Math.max(EDGE, vh - height - EDGE);
    setPos({ left, top });
  }, [opt]);

  const focusables = useCallback((): HTMLElement[] => {
    const el = ref.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(ITEM_SEL)).filter(n => !n.hasAttribute('data-disabled'));
  }, []);

  /* 打开后聚焦首个可用项（position 算完再聚焦，避免菜单跳动时焦点闪一下） */
  useEffect(() => {
    if (!opt || !pos) return;
    requestAnimationFrame(() => focusables()[0]?.focus());
  }, [opt, pos, focusables]);

  /* 全局副作用：外部点击 / 滚动 / 尺寸变化 / 其它右键 = 关闭；键盘完全由菜单接管 */
  useEffect(() => {
    if (!opt) return;

    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const onScroll = () => closeContextMenu();
    const onResize = () => closeContextMenu();
    const onCtx = (e: MouseEvent) => {
      // 菜单外再次右键：先关掉自己，交给目标 surface 的处理器重新打开
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      const list = focusables();
      const active = document.activeElement as HTMLElement | null;
      const i = active ? list.indexOf(active) : -1;
      if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (list.length) list[(i + 1 + list.length) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (list.length) list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === 'Tab') { closeContextMenu(); return; }
      else if (e.key === 'Enter' || e.key === ' ') {
        // 焦点在条目上时由条目自身的 click 处理，这里只兜「焦点不在条目上」的情况
        if (i < 0) { e.preventDefault(); list[0]?.click(); }
        return;
      } else {
        // 未识别的按键：吞掉，避免穿透到图库 / 灯箱快捷键
        e.stopPropagation();
        return;
      }
      // 已处理的按键：阻止继续传播（capture 阶段先于 window 上的全局监听）
      e.stopPropagation();
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [opt, focusables]);

  if (!opt) return null;

  /* 首个分组前不画分隔线；分隔线只为「有内容的分组」而生，连续分隔线一律折叠 */
  const rows: React.ReactNode[] = [];
  let lastWasSep = true;   // 起始视为已有分隔线，避免开头出现一条
  opt.items.forEach((it, idx) => {
    if (it.separator || it.separatorBefore) {
      if (!lastWasSep) { rows.push(<div key={'sep' + idx} role="separator" className="h-px my-1 bg-line2" />); lastWasSep = true; }
      if (it.separator) return;
    }
    if (it.groupLabel) {
      rows.push(
        <div key={it.key} role="presentation" className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted select-none">{it.label}</div>
      );
      lastWasSep = false;
      return;
    }
    if (it.custom) {
      rows.push(<div key={it.key} role="presentation" className="px-3 py-1.5">{it.custom}</div>);
      lastWasSep = false;
      return;
    }
    const role = it.checked === undefined ? 'menuitem' : (it.checkRole === 'radio' ? 'menuitemradio' : 'menuitemcheckbox');
    rows.push(
      <button
        key={it.key}
        type="button"
        role={role}
        aria-checked={it.checked}
        data-disabled={it.disabled ? '1' : undefined}
        aria-disabled={it.disabled || undefined}
        tabIndex={it.disabled ? -1 : 0}
        className={cx(
          'w-full flex items-center gap-2.5 px-3 h-8 border-0 bg-transparent cursor-pointer text-left text-[13px] outline-none',
          it.disabled
            ? 'text-muted opacity-45 cursor-not-allowed'
            : it.danger
              ? 'text-[#e5534b] hover:bg-[#e5534b]/10 focus-visible:bg-[#e5534b]/10'
              : 'text-fg hover:bg-hov focus-visible:bg-hov'
        )}
        onClick={() => {
          if (it.disabled) return;
          const fn = it.onSelect;
          closeContextMenu();
          fn?.();
        }}
      >
        {it.icon ? <Icon name={it.icon} size={15} className="flex-none" /> : <span className="w-[15px] flex-none" />}
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{it.label}</span>
        {it.checked ? <span className="flex-none w-4 flex items-center justify-center text-accent"><Icon name="check" size={14} /></span> : null}
        {it.hint ? <span className="flex-none text-[11px] text-muted tabular-nums">{it.hint}</span> : null}
      </button>
    );
    lastWasSep = false;
  });

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={opt.ariaLabel || opt.title || '上下文菜单'}
      className={cx(
        'fixed z-[90] min-w-[208px] max-w-[300px] py-1 rounded-xl',
        'bg-panel border border-line shadow-pop',
        'scroller max-h-[min(70vh,440px)] overflow-y-auto',
        // 打开时轻微缩放淡入，明确「从右键位置展开」
        'origin-top-left animate-[ctxin_.09s_ease-out]'
      )}
      style={{ left: (pos || { left: opt.x }).left, top: (pos || { top: opt.y }).top, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={e => e.preventDefault()}
    >
      {opt.title ? (
        <div className="px-3 pt-1 pb-1.5 text-[11px] leading-[1.5] text-muted select-none truncate" title={opt.title}>
          {opt.title}
        </div>
      ) : null}
      {rows}
    </div>,
    document.body
  );
}

/**
 * 下拉菜单 —— headless 实现（不依赖组件库），保证键盘与无障碍语义完整：
 *
 * - 触发器：`aria-haspopup="menu"` / `aria-expanded` / `aria-controls`；
 * - 弹出层：`role="menu"`，条目 `role="menuitem"` / `menuitemcheckbox`，分隔线 `role="separator"`；
 * - 键盘：↓/↑ 循环移动、Home/End 跳首尾、Esc 关闭并回焦触发器、Tab 关闭；
 *   触发器上按 ↓/Enter 打开并聚焦首个可用项；
 * - 指针：点击外部或滚动容器外关闭；鼠标移入即聚焦（与原生菜单一致）。
 *
 * 定位用 absolute + 左右对齐，由 `align` 决定，配合父级 `relative` 使用。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './kit';

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** 右侧提示（快捷键等） */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** 有值时渲染为可选中条目（默认 menuitemcheckbox，radio 时单选语义） */
  checked?: boolean;
  checkRole?: 'checkbox' | 'radio';
  onSelect?: () => void;
  /** 分隔线（在条目之前插入） */
  separatorBefore?: boolean;
  /** 纯分隔线条目（不渲染为可聚焦项） */
  separator?: boolean;
  /** 分组标题（渲染为不可聚焦的标题行，紧跟其后的条目属于该组） */
  groupLabel?: boolean;
  /** 自定义内容（滑块等，不可聚焦） */
  custom?: React.ReactNode;
  /** 只在窄屏（≤820px）出现：桌面已有独立控件，避免菜单项重复 */
  mobileOnly?: boolean;
  /** 只在 ≤980px 出现：该断点下「视图」下拉会被收起，内容改由「更多」承载 */
  narrowOnly?: boolean;
  /** 透传到按钮上的 id（保持既有 DOM id 的向后兼容） */
  id?: string;
}

export interface DropdownMenuProps {
  /** 触发器按钮的可见内容（图标 / 文字） */
  trigger: React.ReactNode;
  /** 触发器无障碍名称（图标按钮必填） */
  ariaLabel: string;
  items: MenuItem[];
  /** 触发器样式类（由调用方决定按钮外观） */
  triggerCls?: string;
  /** 菜单对齐方式，默认 right */
  align?: 'left' | 'right';
  /** 触发器右侧是否显示下拉箭头 */
  showChevron?: boolean;
  /** 触发器 id */
  id?: string;
  /** 菜单最小宽度 */
  menuWidth?: number;
  /** 窄屏下是否把标签文字隐藏（只留图标） */
  hideLabelBelow?: string;
  title?: string;
}

const ITEM_SEL = '[role="menuitem"],[role="menuitemcheckbox"]';

export default function DropdownMenu({
  trigger, ariaLabel, items, triggerCls, align = 'right', showChevron, id,
  menuWidth = 208, title
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const uid = useId();
  const menuId = (id || uid) + '-menu';
  const btnId = (id || uid) + '-btn';

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const focusables = useCallback((): HTMLElement[] => {
    const el = menuRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(ITEM_SEL))
      // 跳过禁用项与因断点隐藏的项（offsetParent 为 null 表示不可见，focus 无效）
      .filter(n => !n.hasAttribute('data-disabled') && n.offsetParent !== null);
  }, []);

  /* 打开 / 关闭的副作用：外部点击、Esc、聚焦首项 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onWinKey, true);
    // 打开后聚焦首个可用项
    requestAnimationFrame(() => focusables()[0]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onWinKey, true);
    };
  }, [open, close, focusables]);

  const openMenu = (focusFirst: boolean) => {
    setOpen(true);
    if (focusFirst) requestAnimationFrame(() => focusables()[0]?.focus());
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) openMenu(true);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1 + list.length) % list.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault(); list[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault(); list[list.length - 1].focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative inline-flex flex-none" ref={wrapRef}>
      <button
        type="button"
        id={btnId}
        ref={btnRef}
        className={triggerCls}
        title={title ?? ariaLabel}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu(true))}
        onKeyDown={onTriggerKey}
      >
        {trigger}
        {showChevron ? <Icon name="chevronDown" size={13} className={cx('flex-none transition-transform duration-150', open && 'rotate-180')} /> : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={btnId}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className={cx(
            'absolute top-[calc(100%+6px)] z-[70] min-w-[180px] py-1 rounded-xl',
            'bg-panel border border-line shadow-pop',
            // scroller：与主区共用滚动条样式（深色主题下不会再出现浅色原生滚动条）
            'scroller max-h-[min(70vh,420px)] overflow-y-auto',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          style={{ minWidth: menuWidth }}
        >
          {items.map(it => {
            const nodes: React.ReactNode[] = [];
            if (it.separatorBefore) {
              nodes.push(<div key={it.key + '-sep'} role="separator" className="h-px my-1 bg-line2" />);
            }
            if (it.separator) {
              nodes.push(
                <div
                  key={it.key}
                  role="separator"
                  className={cx(
            'h-px my-1 bg-line2',
            it.mobileOnly && 'hidden max-[820px]:!block',
            it.narrowOnly && 'hidden max-[980px]:!block'
          )}
                />
              );
              return nodes;
            }
            if (it.groupLabel) {
              nodes.push(
                <div
                  key={it.key}
                  role="presentation"
                  className={cx(
                    'px-3 pt-1.5 pb-1 text-[11px] font-semibold text-muted select-none',
                    it.mobileOnly && 'hidden max-[820px]:!block',
                    it.narrowOnly && 'hidden max-[980px]:!block'
                  )}
                >
                  {it.label}
                </div>
              );
              return nodes;
            }
            if (it.custom) {
              nodes.push(
                <div
                  key={it.key}
                  role="presentation"
                  aria-label={it.label}
                  className={cx(
                    'px-3 py-1.5',
                    it.mobileOnly && 'hidden max-[820px]:!block',
                    it.narrowOnly && 'hidden max-[980px]:!block'
                  )}
                >
                  {it.custom}
                </div>
              );
              return nodes;
            }
            const role = it.checked === undefined
              ? 'menuitem'
              : (it.checkRole === 'radio' ? 'menuitemradio' : 'menuitemcheckbox');
            nodes.push(
              <button
                key={it.key}
                id={it.id}
                type="button"
                role={role}
                aria-checked={it.checked}
                data-disabled={it.disabled ? '1' : undefined}
                tabIndex={it.disabled ? -1 : 0}
                className={cx(
                  'w-full flex items-center gap-2.5 px-3 h-8 border-0 bg-transparent cursor-pointer text-left text-[13px] outline-none',
                  'focus-visible:bg-soft',
                  it.mobileOnly && 'hidden max-[820px]:!flex',
                  it.narrowOnly && 'hidden max-[980px]:!flex',
                  it.disabled
                    ? 'text-muted opacity-45 cursor-not-allowed'
                    : it.danger
                      ? 'text-[#e5534b] hover:bg-[#e5534b]/10'
                      : 'text-fg hover:bg-hov'
                )}
                onClick={() => {
                  if (it.disabled) return;
                  it.onSelect?.();
                  close(true);
                }}
              >
                {it.icon ? <Icon name={it.icon} size={15} className="flex-none" /> : <span className="w-[15px] flex-none" />}
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{it.label}</span>
                {it.checked !== undefined ? (
                  <span className="flex-none w-4 flex items-center justify-center text-accent">
                    {it.checked ? <Icon name="check" size={14} /> : null}
                  </span>
                ) : null}
                {it.hint ? <span className="flex-none text-[11px] text-muted tabular-nums">{it.hint}</span> : null}
              </button>
            );
            return nodes;
          })}
        </div>
      ) : null}
    </div>
  );
}

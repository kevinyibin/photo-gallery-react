/**
 * UI 工具类组合 —— Tailwind 原子化样式的复用层。
 *
 * 重要约定（避免同类工具类互相覆盖）：
 * 同一 CSS 属性只能由「一个变体分支」决定，绝不在基础串里放 bg-* / text-* 再叠加
 * 另一个 bg-* / text-*，否则胜负取决于样式表中的类顺序（不可靠）。
 * 因此下列组合器把背景 / 边框 / 文字颜色整体交给变体分支选择。
 */
import type { CSSProperties } from 'react';

/** 拼接类名（过滤空值） */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 通用过渡（原 .btn / .lb-btn 的 transition 声明） */
const BTN_TRANS = 'transition-[background-color,border-color,opacity,color,filter] duration-150';

/** 通用按钮（原 .btn / .btn.primary / .btn.icon / .btn.lg / .btn.on / .btn.danger） */
export function btnCls(o?: {
  primary?: boolean;
  icon?: boolean;
  on?: boolean;
  danger?: boolean;
  lg?: boolean;
  /** 移动端专用按钮（原 .mobile-only）：桌面隐藏、≤820px 显示 */
  mobileOnly?: boolean;
  /** 桌面专用：≤820px 隐藏（窄屏时由「更多」菜单兜底） */
  desktopOnly?: boolean;
  /** 与主按钮拼接成分组按钮（split button）：去掉相邻侧的圆角与边框 */
  grouped?: 'left' | 'right';
}): string {
  // 变体：背景 / 边框 / 文字色整体二选一，互斥不叠加
  const variant = o?.primary
    ? 'bg-accent border-accent text-white hover:bg-accent hover:brightness-[1.07]'
    : o?.danger
      ? 'bg-panel border-[#e5534b] text-[#e5534b] hover:bg-[#e5534b] hover:text-white'
      : o?.on
        ? 'bg-soft border-accent text-accent hover:bg-soft hover:border-accent'
        : 'bg-panel border-line text-fg hover:bg-hov hover:border-line';
  return cx(
    'inline-flex items-center gap-1.5 h-8 px-[9px] rounded-lg border cursor-pointer whitespace-nowrap',
    BTN_TRANS,
    'disabled:opacity-45 disabled:cursor-not-allowed',
    variant,
    o?.icon && 'w-8 justify-center px-0',
    o?.lg && 'h-10 px-5 text-[15px]',
    o?.mobileOnly && 'hidden max-[820px]:!inline-flex',
    o?.desktopOnly && 'max-[820px]:!hidden',
    // 圆角由 grouped 分支独占，避免与 rounded-lg 叠加产生层叠歧义
    o?.grouped === 'left' && 'rounded-r-none border-r-0',
    o?.grouped === 'right' && 'rounded-l-none'
  );
}

/** 分组按钮容器（split button 外壳） */
export const btnGroupCls = 'inline-flex items-stretch flex-none overflow-hidden rounded-lg';

/** 下拉选择框（原 .sel） */
export const selCls = cx(
  'h-8 px-2 rounded-lg border border-line bg-panel cursor-pointer outline-none'
);

/** 分段控件容器（原 .seg） */
export const segCls = cx(
  'h-8 flex p-[2px] rounded-lg border border-line bg-panel'
);

/** 分段控件按钮（原 .seg-btn） */
export function segBtnCls(active?: boolean): string {
  const variant = active
    ? 'bg-soft text-accent font-semibold'
    : 'bg-transparent text-muted hover:text-fg';
  return cx(
    'border-0 cursor-pointer px-2 h-[26px] rounded-md whitespace-nowrap',
    variant
  );
}

/**
 * 详情页顶栏按钮（原 .lb-btn，深色语境）。
 *
 * 尺寸约定：高 30、圆角 7；
 * - icon 变体：固定 30×30 正方形、内边距归零、内容居中 —— 图标到四边的距离完全一致；
 * - 常规变体：左右内边距 9（窄屏 7），图标 / 文字之间由 gap 控制。
 * 同一按钮组（放大 / 百分比 / 缩小 / 重置）必须统一使用 icon 变体，
 * 才能保证「按钮尺寸、图标尺寸、图标与边框间距」三者对齐。
 */
export function lbBtnCls(on?: boolean, o?: { icon?: boolean }): string {
  const variant = on ? 'bg-accent text-white hover:bg-accent' : 'bg-white/10 text-white hover:bg-white/20';
  return cx(
    'h-[30px] min-w-[30px] border-0 rounded-[7px] cursor-pointer whitespace-nowrap inline-flex items-center',
    // 内边距由分支独占：icon 变体完全居中，常规变体才带左右内边距（避免同类工具类叠加）
    o?.icon ? 'w-[30px] px-0 justify-center' : 'px-[9px] max-[1240px]:px-[7px]',
    variant
  );
}

/** 浅色语境下的深色小按钮（批量条的「清除评分」） */
export function lbBtnLightCls(): string {
  return 'h-[30px] min-w-[30px] px-[9px] rounded-[7px] inline-flex items-center text-[13px] ' +
    'bg-line2 text-fg border border-line hover:bg-hov disabled:opacity-45 disabled:cursor-not-allowed';
}

/** 星级控件容器（原 .stars） */
export function starsCls(extra?: string): string {
  return cx('inline-flex items-center gap-px', extra);
}

/** 星级单星（原 .stars i）：dark = 详情页深色语境，light = 批量条浅色语境 */
export function starCls(on?: boolean, big?: boolean, variant: 'dark' | 'light' = 'dark'): string {
  const color = variant === 'dark'
    ? (on ? 'text-[#ffc23d]' : 'text-white/[.38]')
    : (on ? 'text-[#f5a623]' : 'text-line');
  return cx(
    'not-italic inline-flex items-center justify-center cursor-pointer select-none leading-none',
    'transition-[color,transform] duration-100 hover:scale-[1.18]',
    big ? 'text-[18px]' : 'text-[13px]',
    color
  );
}

/** 弹窗内提示段（原 .mo-hint） */
export const hintCls = 'm-0 mb-2.5 text-muted leading-[1.7]';

/** 内联样式小工具（供组件内联几何样式复用） */
export type Style = CSSProperties;

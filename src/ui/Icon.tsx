/**
 * 统一图标组件 —— 全项目图标的唯一来源。
 *
 * 设计约定：
 * - 24×24 viewBox，`stroke="currentColor"` + `fill="none"`，线宽 1.8，圆头圆角；
 *   因此图标颜色自动继承文字颜色，深浅主题无需额外适配。
 * - 尺寸由 `size` 控制（默认 16），也可用 className 覆盖（工具类优先）。
 * - `filled` 用于需要「实心态」的图标（喜欢的心形、星级）：实心时改填 currentColor。
 * - 装饰性图标默认 `aria-hidden`，语义由使用方通过 aria-label / title 提供。
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'camera' | 'folder' | 'folderOpen' | 'image' | 'images' | 'film' | 'layers'
  | 'plus' | 'trash' | 'checkSquare' | 'filter' | 'rotateCcw' | 'refreshCw'
  | 'settings' | 'search' | 'x' | 'sun' | 'moon' | 'more' | 'chevronDown'
  | 'chevronRight' | 'sliders' | 'waterfall' | 'sortAsc' | 'play' | 'download'
  | 'maximize' | 'minimize' | 'star' | 'heart' | 'palette' | 'aperture'
  | 'ruler' | 'calendar' | 'tag' | 'pencil' | 'eye' | 'eyeOff' | 'info'
  | 'keyboard' | 'check' | 'fileText' | 'type' | 'arrowRight' | 'repeat'
  | 'cornerDownLeft' | 'zoomIn' | 'zoomOut' | 'frame' | 'rotateCw' | 'grid' | 'panelLeft' | 'pause' | 'grip'
  | 'chevronLeft' | 'chevronUp';

const P: Record<IconName, JSX.Element> = {
  /* ---- 品牌 / 导入 ---- */
  camera: (<>
    <path d="M3 8a2 2 0 0 1 2-2h2.2l1.4-2h6.8l1.4 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="13" r="3.6" />
  </>),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  folderOpen: (<>
    <path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
    <path d="M3 9l1.2 8.2A2 2 0 0 0 6.2 19h11.6a2 2 0 0 0 2-1.8L21 9z" />
  </>),

  /* ---- 媒体类型 ---- */
  images: (<>
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="8.8" cy="9.2" r="1.6" />
    <path d="M21 15.5l-4.6-4.3L6.5 20" />
  </>),
  image: (<>
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="8.8" cy="9.2" r="1.6" />
    <path d="M21 15.5l-4.6-4.3L6.5 20" />
  </>),
  film: (<>
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M7.5 3v18M16.5 3v18M3 8.5h4.5M3 15.5h4.5M16.5 8.5H21M16.5 15.5H21" />
  </>),
  layers: (<>
    <path d="M12 3.5l8.5 4.6-8.5 4.6L3.5 8.1z" />
    <path d="M3.5 13.2l8.5 4.6 8.5-4.6" />
  </>),

  /* ---- 操作 ---- */
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (<>
    <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13" />
    <path d="M10.5 11v5M13.5 11v5" />
  </>),
  checkSquare: (<>
    <path d="M9 11.5l2.6 2.6L21 5.5" />
    <path d="M20.5 12.5V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </>),
  filter: <path d="M3.5 5h17l-6.6 7.6V18l-3.8 2v-7.4z" />,
  rotateCcw: (<>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8.5" />
    <path d="M3 3.5v5h5" />
  </>),
  refreshCw: (<>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
    <path d="M21 3.5v5h-5" />
  </>),
  settings: (<>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.1 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z" />
  </>),
  search: (<>
    <circle cx="11" cy="11" r="6.6" />
    <path d="M20 20l-4.3-4.3" />
  </>),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,

  /* ---- 主题 / 导航 ---- */
  sun: (<>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </>),
  moon: <path d="M20.8 13.2A8.6 8.6 0 1 1 10.8 3.2a6.7 6.7 0 0 0 10 10z" />,
  more: (<>
    <circle cx="12" cy="5.5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="18.5" r="1.5" />
  </>),
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  cornerDownLeft: (<>
    <path d="M19 5v8a3 3 0 0 1-3 3H5" />
    <path d="M9 12l-4 4 4 4" />
  </>),

  /* ---- 视图 / 排序 ---- */
  sliders: (<>
    <path d="M4 7h11M19 7h1M4 12h4M12 12h8M4 17h9M17 17h3" />
    <circle cx="17" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="15" cy="17" r="2" />
  </>),
  waterfall: (<>
    <path d="M4 4h6v11H4z" />
    <path d="M14 4h6v7h-6z" />
    <path d="M4 18h6v2H4z" />
    <path d="M14 14h6v6h-6z" />
  </>),
  grid: (<>
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </>),
  sortAsc: (<>
    <path d="M4 7h11M4 12h8M4 17h5" />
    <path d="M17 4.5v15M13.5 16l3.5 3.5L20.5 16" />
  </>),
  type: (<>
    <path d="M4 6.5V4.5h16v2" />
    <path d="M9 20h6M12 4.5V20" />
  </>),
  panelLeft: (<>
    <path d="M3.5 4.5h17v15h-17z" />
    <path d="M9.5 4.5v15" />
  </>),

  /* ---- 播放 / 导出 / 全屏 ---- */
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  pause: <path d="M9 5v14M15 5v14" />,
  download: (<>
    <path d="M12 3.5v11.5" />
    <path d="M7.5 10.5l4.5 4.5 4.5-4.5" />
    <path d="M4 20.5h16" />
  </>),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  fileText: (<>
    <path d="M6.5 3h7.5l4 4v14H6.5z" />
    <path d="M14 3v4h4" />
    <path d="M9.5 12.5h6M9.5 16h4" />
  </>),
  zoomIn: (<>
    <circle cx="11" cy="11" r="6.6" />
    <path d="M20 20l-4.3-4.3M11 8.5v5M8.5 11h5" />
  </>),
  zoomOut: (<>
    <circle cx="11" cy="11" r="6.6" />
    <path d="M20 20l-4.3-4.3M8.5 11h5" />
  </>),
  /* 「重置 / 适应窗口」：四角括弧 + 中心画面，与全屏图标区分 */
  frame: (<>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2" />
  </>),
  rotateCw: (<>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
    <path d="M21 3.5v5h-5" />
  </>),
  repeat: (<>
    <path d="M17 2.5l3.5 3.5L17 9.5" />
    <path d="M3.5 12.5v-2a3.5 3.5 0 0 1 3.5-3.5h13" />
    <path d="M7 21.5L3.5 18 7 14.5" />
    <path d="M20.5 11.5v2a3.5 3.5 0 0 1-3.5 3.5h-13" />
  </>),
  arrowRight: <path d="M5 12h13M12.5 6l6 6-6 6" />,

  /* ---- 评分 / 喜欢 / 筛选维度 ---- */
  star: <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1-5.4-3-5.4 3 1.1-6.1L3.2 9.6l6.1-.8z" />,
  heart: <path d="M12 20.2s-7.2-4.4-7.2-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.2 2.6c0 5-7.2 9.4-7.2 9.4z" />,
  palette: (<>
    <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.1 0 1.9-.8 1.9-1.8 0-1.1-.9-1.9-.9-2.9h1.9a3.9 3.9 0 0 0 3.9-3.9 8.8 8.8 0 0 0-6.8-9z" />
    <circle cx="8" cy="9.5" r="1" />
    <circle cx="12" cy="7.5" r="1" />
    <circle cx="16" cy="9.5" r="1" />
  </>),
  aperture: (<>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 3.4v5.2M12 15.4v5.2M3.4 12h5.2M15.4 12h5.2" />
  </>),
  ruler: (<>
    <path d="M3.5 9h17v6h-17z" />
    <path d="M7 9v3M10.5 9v3M14 9v3M17.5 9v3M7 15v-1.5M10.5 15v-1.5M14 15v-1.5M17.5 15v-1.5" />
  </>),
  calendar: (<>
    <path d="M4.5 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
    <path d="M4.5 10h15M9 3v3.5M15 3v3.5" />
  </>),
  tag: (<>
    <path d="M20.4 13.6l-7.2 7.2a2 2 0 0 1-2.8 0L3.2 13.6V4.4h9.2l8 8a1.4 1.4 0 0 1 0 1.2z" />
    <circle cx="7.8" cy="8.2" r="1.4" />
  </>),
  pencil: (<>
    <path d="M4 20h4L20.2 7.8l-4-4L4 16z" />
    <path d="M14.2 5.8l4 4" />
  </>),
  eye: (<>
    <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>),
  eyeOff: (<>
    <path d="M4 4l16 16" />
    <path d="M9.6 6.7A9.6 9.6 0 0 1 12 6.2c6 0 9.5 5.8 9.5 5.8a17 17 0 0 1-3.4 3.9" />
    <path d="M6.4 8.5A16.6 16.6 0 0 0 2.5 12S6 17.8 12 17.8a9.4 9.4 0 0 0 3.3-.6" />
  </>),
  info: (<>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.5M12 7.8h.01" />
  </>),
  keyboard: (<>
    <path d="M3.5 6.5h17v11h-17z" />
    <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </>),
  /** 拖拽手柄：两列三点（实心点，不受线宽影响） */
  grip: (<>
    <circle cx="9" cy="7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="17" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="17" r="1.15" fill="currentColor" stroke="none" />
  </>)
};

export interface IconProps {
  name: IconName;
  /** 像素尺寸（默认 16） */
  size?: number;
  /** 实心态（喜欢 / 星级等） */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** 线宽（默认 1.8） */
  strokeWidth?: number;
}

export function Icon({ name, size = 16, filled, className, style, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}

export default Icon;

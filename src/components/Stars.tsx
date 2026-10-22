/**
 * 星级控件 —— 详情页 / 批量条共用（局部展示型组件，无全局状态）。
 * 与原版本一致：始终渲染 5 个星位供点击打分；再次点击同一星级 = 取消评分（由调用方处理）。
 *
 * 星形改由统一 Icon 组件渲染（原先是 ★ 字符）：不同字体下的字形差异被消除，
 * 且颜色完全由 starCls 的 text-* 控制，深浅两套语境（variant）保持一致。
 *
 * variant：
 * - 'dark'（默认）：详情页深色语境，未选中 rgba(255,255,255,.38)、选中 #ffc23d；
 * - 'light'：批量条浅色语境，未选中边框色、选中 #f5a623（与原 CSS 一致）。
 */
import { starsCls, starCls, cx } from '../ui/kit';
import Icon from '../ui/Icon';

interface Props {
  value: number;
  onRate: (v: number) => void;
  className?: string;
  title?: string;
  id?: string;
  variant?: 'dark' | 'light';
}

export default function Stars({ value, onRate, className, title, id, variant = 'dark' }: Props) {
  const big = !!className && className.indexOf('big') >= 0;
  const dim = !!className && className.indexOf('dim') >= 0;
  const size = big ? 19 : 14;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <i key={i} data-v={i} className={starCls(i <= value, big, variant)} onClick={() => onRate(i)}>
        <Icon name="star" size={size} filled={i <= value} />
      </i>
    );
  }
  return (
    <div
      className={cx(starsCls(className), dim && 'opacity-45 pointer-events-none')}
      data-v={value || 0}
      title={title}
      id={id}
    >
      {stars}
    </div>
  );
}

/**
 * 作品筛选面板 —— 评分 / 标签 / 主色调 / 相机机身 / 镜头 / 焦距区间 / 拍摄年份。
 *
 * 结构：
 * - 每个维度是一个可折叠的 Section（折叠状态属组件局部状态，不进全局 store）；
 * - 维度标题**不带图标**，只有折叠指示箭头 —— 标题文字与条目文字统一对齐到
 *   同一条左侧基线（24px），去掉图标后视觉重心回到文字本身，也不再出现
 *   「图标宽度不一致导致各维度标题起点参差」的问题；
 * - 维度的排列顺序与显隐由用户配置（core/facetPrefs，随 UI 设置持久化），
 *   面板只按配置渲染，不再硬编码顺序；
 * - 每个维度标题带「已选 N」徽标，选中时行内可直接清除，顶部另有全局清除；
 * - 维度内条目超过 8 条时折叠为「展开全部」，避免长列表挤压其他维度；
 * - 评分是独立维度：快捷 chips（全部 / 已评分 / 未评分）+ 星级（N 星及以上），
 *   与 setRatingFilter 完全一致，只是交互更直接。
 *
 * 重渲染优化：只订阅 'facets' 频道（筛选聚合不依赖瀑布流布局，
 * 避免每次缩略图宽高回填触发的 notify('grid') 造成全量重算）。
 */
import { useRef, useState } from 'react';
import { state, useChannel } from '../core/store';
import { COLOR_FAMILIES, FOCAL_BINS, facetLabel, type FacetGroup } from '../core/constants';
import { facetOrder, hiddenFacets } from '../core/facetPrefs';
import { cmpName, focalBinLabel } from '../core/utils';
import { familyLabel, familyCss } from '../core/colors';
import {
  buildFacetData, toggleFacet, clearFacet, clearAllFacets, toggleTagMode,
  activeFacetCount, FacetKey
} from '../core/facets';
import { setRatingFilter } from '../core/engine';
import { askRenameTag, askDeleteTag } from '../core/modal';
import { menuForFacet, menuForRating, menuForSection } from '../core/ctxMenus';
import { openContextMenu } from '../ui/ContextMenu';
import { cx } from '../ui/kit';
import Icon from '../ui/Icon';
import { useScrollReveal } from '../ui/useScrollReveal';

/** 单个维度内默认展示的条目数，超出部分收进「展开全部」 */
const ROW_LIMIT = 8;

/**
 * 对齐基线：24px = 滚动容器 px-2(8) + 条目缩进 pl-4(16)。
 * 标题的折叠箭头 12px + gap 4px 同样是 16px，因此「标题文字 / 条目文字 /
 * chips 左边缘 / 空态文案 / 展开全部」全部落在同一条 24px 基线上。
 *
 * 缩进只加在「叶子元素」上（行 / chips 容器 / 空态 / 展开按钮），
 * 不用嵌套 padding 叠加 —— 否则 chips 与空态会比标题多缩进一档。
 * 行用 pl-4 而不是外层容器缩进，是为了让 hover 底色仍从容器左边缘铺满整行。
 */
const ROW_PAD = 'pl-4 pr-2';

export default function FacetPanel() {
  useChannel('facets');
  const d = buildFacetData();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useScrollReveal(scrollerRef);   // 滚动条仅在滚动时显示（与图库主区一致）
  const order = facetOrder();
  const hidden = hiddenFacets();
  /** 实际渲染的维度（顺序即用户配置的顺序，隐藏项直接不进 DOM） */
  const visible = order.filter(k => !hidden.has(k));
  const focalIndex: Record<string, number> = {};
  FOCAL_BINS.forEach((b, i) => { focalIndex[b.key] = i; });

  /** 维度 key → 元素。全部创建但不一定挂载：被隐藏的维度不进入 DOM，也不执行其内部逻辑 */
  const sections: Record<FacetGroup, React.ReactNode> = {
    rating: <RatingSection key="rating" />,
    tag: <TagSection key="tag" tagMap={d.tag} />,
    color: <ColorSection key="color" colMap={d.col} />,
    camera: (
      <FacetRows
        key="camera" fk="camera" title="相机机身" map={d.cam}
        sortFn={(a, b) => b[1] - a[1] || cmpName(a[0], b[0])}
      />
    ),
    lens: (
      <FacetRows
        key="lens" fk="lens" title="镜头" map={d.len}
        sortFn={(a, b) => b[1] - a[1] || cmpName(a[0], b[0])}
      />
    ),
    focal: (
      <FacetRows
        key="focal" fk="focal" title="焦距区间" map={d.foc} chips
        labelOf={focalBinLabel}
        sortFn={(a, b) => (focalIndex[a[0]] || 0) - (focalIndex[b[0]] || 0)}
      />
    ),
    year: (
      <FacetRows
        key="year" fk="year" title="拍摄年份" map={d.yr} chips
        sortFn={(a, b) => cmpName(b[0], a[0])}
      />
    )
  };

  return (
    <>
      <FacetStatus labels={visible.map(facetLabel)} />
      {/* scroller：与图库瀑布流共用同一套滚动条样式（宽度 / 圆角 / 轨道 / 滑块 / hover / 滚动时才显示） */}
      <div className="scroller flex-1 overflow-y-auto px-2 pb-4" id="facets" ref={scrollerRef}>
        {visible.map(k => sections[k])}
        {!visible.length ? (
          <div className="mt-4 pl-4 pr-2 text-xs text-muted leading-[1.8]">
            所有筛选维度都已隐藏 —— 可在顶栏「更多 · 设置」中重新开启。
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ============================ 维度外壳 ============================ */

interface SectionProps {
  title: string;
  /** 该维度在配置里的 key（右键标题可上移 / 下移 / 隐藏，与设置弹窗同一套数据） */
  group: FacetGroup;
  /** 该维度已选中的条目数（>0 时显示徽标与「清除」） */
  activeCount?: number;
  onClear?: () => void;
  /** 标题右侧的额外操作（如标签的组合方式切换） */
  extra?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 维度外壳：折叠箭头 + 标题（无图标）。
 * 标题按钮占满整行剩余宽度，hover 底色从容器左边缘开始；
 * 内容容器统一 pl-4，使条目文字与标题文字落在同一条基线上。
 */
function Section({ title, group, activeCount, onClear, extra, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-3" aria-label={title}>
      <div
        className="flex items-center gap-1"
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu({
            x: e.clientX, y: e.clientY, title: `${title} · 维度设置`,
            ariaLabel: `${title}维度的排序与显隐菜单`,
            items: menuForSection(group)
          });
        }}
      >
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 h-7 pl-0 pr-1 border-0 rounded-md bg-transparent cursor-pointer text-xs font-[650] text-fg hover:bg-hov"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {/* 折叠指示：12px 箭头 + 4px 间距 = 16px，与条目文字的 16px 缩进对齐 */}
          <Icon
            name="chevronDown"
            size={12}
            className={cx('flex-none text-muted transition-transform duration-150', !open && '-rotate-90')}
          />
          <span className="truncate">{title}</span>
          {activeCount ? (
            <span className="flex-none min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </button>
        {extra}
        {activeCount && onClear ? (
          <button
            type="button"
            className="flex-none border-0 bg-transparent text-accent cursor-pointer text-[11px] py-0.5 px-1 rounded hover:bg-soft"
            onClick={onClear}
          >清除</button>
        ) : null}
      </div>
      <div hidden={!open} className="mt-1">
        {children}
      </div>
    </section>
  );
}

/** 维度内的空态（与标题同基线） */
function EmptyRow({ text }: { text: string }) {
  return <div className="pl-4 pr-2 py-1 text-xs text-muted">{text}</div>;
}

/* ============================ 顶部状态 ============================ */

function FacetStatus({ labels }: { labels: string[] }) {
  const pend = state.exifTotal - state.exifDone;
  const cpend = state.colorEnabled ? (state.colorTotal - state.colorDone) : 0;
  const n = activeFacetCount();
  let body: React.ReactNode = null;
  if (state.exifTotal && pend > 0) {
    body = <span className="text-accent">正在读取拍摄信息 {state.exifDone}/{state.exifTotal}</span>;
  } else if (state.colorTotal && cpend > 0) {
    body = <span className="text-accent">正在分析主色调 {state.colorDone}/{state.colorTotal}</span>;
  }
  return (
    <div className="flex-none min-h-9 flex items-center gap-2 flex-wrap px-3 py-1.5 border-b border-line2 text-xs text-muted" id="facetStatus">
      {body}
      {n ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 border-0 bg-transparent text-accent cursor-pointer text-xs py-0.5 px-1 rounded hover:bg-soft"
          id="btnClearFacets"
          onClick={clearAllFacets}
        >
          <Icon name="x" size={11} />清除 {n} 项筛选
        </button>
      ) : null}
      {!body && !n ? <span>{labels.join(' · ')}，可多选组合</span> : null}
    </div>
  );
}

/* ============================ 评分 ============================ */

const RATE_CHIPS: [v: string, label: string][] = [
  ['all', '全部'],
  ['1', '已评分'],
  ['0', '未评分']
];

function RatingSection() {
  const rf = state.filter.rating;
  const cur = rf === 'all' ? 0 : +rf;
  return (
    <Section
      title="评分"
      group="rating"
      activeCount={rf !== 'all' ? 1 : 0}
      onClear={() => setRatingFilter('all')}
    >
      <div className="flex flex-wrap items-center gap-1.5 pl-4">
        {RATE_CHIPS.map(([v, label]) => {
          const on = rf === v;
          return (
            <button
              key={v}
              type="button"
              className={cx(
                'flex items-center h-7 px-[11px] flex-none border rounded-full cursor-pointer text-xs',
                on ? 'border-accent bg-soft text-accent font-semibold' : 'border-line bg-panel text-fg hover:bg-hov'
              )}
              data-rate={v}
              aria-pressed={on}
              onContextMenu={e => {
                e.preventDefault(); e.stopPropagation();
                openContextMenu({ x: e.clientX, y: e.clientY, title: '评分筛选', ariaLabel: '评分筛选菜单', items: menuForRating() });
              }}
              onClick={() => setRatingFilter(v)}
            >{label}</button>
          );
        })}
        <span className="flex items-center gap-px ml-auto pr-1" role="group" aria-label="按星级筛选">
          {[1, 2, 3, 4, 5].map(i => (
            <button
              key={i}
              type="button"
              className="w-[22px] h-7 flex items-center justify-center border-0 bg-transparent cursor-pointer"
              data-rate={String(i)}
              aria-label={`${i} 星及以上`}
              aria-pressed={cur === i}
              title={`${i} 星及以上`}
              onClick={() => setRatingFilter(cur === i ? 'all' : String(i))}
            >
              <Icon name="star" size={14} filled={i <= cur} className={i <= cur ? 'text-star2' : 'text-line'} />
            </button>
          ))}
        </span>
      </div>
    </Section>
  );
}

/* ============================ 通用维度 ============================ */

interface FacetRowsProps {
  fk: FacetKey;
  title: string;
  map: Map<string, number>;
  chips?: boolean;
  labelOf?: (k: string) => string;
  sortFn?: (a: [string, number], b: [string, number]) => number;
}

function FacetRows({ fk, title, map, chips, labelOf, sortFn }: FacetRowsProps) {
  const act = state.filter[fk] as Set<string> | null;
  const rows = sortFn ? Array.from(map.entries()).sort(sortFn) : Array.from(map.entries());
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, ROW_LIMIT);
  const pending = state.exifTotal && state.exifDone < state.exifTotal;

  return (
    <Section
      title={title}
      group={fk}
      activeCount={act ? act.size : 0}
      onClear={() => clearFacet(fk)}
    >
      {/* 空态放在 flex 容器之外：chips 容器自带 pl-4，EmptyRow 也自带 pl-4，
          若嵌套会双重缩进（比标题多出一档） */}
      {!rows.length ? <EmptyRow text={pending ? '正在解析拍摄信息…' : '暂无数据'} /> : null}
      {rows.length ? (
      <div className={cx('flex gap-px', chips ? 'flex-row flex-wrap gap-1.5 pl-4' : 'flex-col')}>
        {shown.map(([k, c]) => {
          const label = labelOf ? labelOf(k) : k;
          const on = !!(act && act.has(k));
          return (
            <button
              key={k}
              type="button"
              className={cx(
                'flex items-center gap-2 max-w-full border-0 rounded-md cursor-pointer text-left min-w-0 hover:bg-hov',
                chips
                  ? cx(
                      'h-7 px-[11px] flex-none border rounded-full text-xs',
                      on ? 'border-accent bg-soft text-accent font-semibold' : 'border-line bg-panel text-fg'
                    )
                  : cx(
                      'h-[30px] w-full text-[12.5px]',
                      ROW_PAD,
                      on ? 'bg-soft text-accent font-semibold' : 'bg-transparent text-fg'
                    )
              )}
              data-f={fk}
              data-k={k}
              aria-pressed={on}
              onContextMenu={e => {
                e.preventDefault(); e.stopPropagation();
                openContextMenu({ x: e.clientX, y: e.clientY, title: label, ariaLabel: `筛选值「${label}」的菜单`, items: menuForFacet(fk, k, label) });
              }}
              onClick={() => toggleFacet(fk, k)}
            >
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={label}>{label}</span>
              <span className={cx('text-[11px] flex-none tabular-nums', on ? 'text-accent' : 'text-muted')}>{c}</span>
            </button>
          );
        })}
        {rows.length > ROW_LIMIT ? (
          <button
            type="button"
            className={cx(
              'self-start mt-0.5 inline-flex items-center gap-1 h-6 px-1.5 border-0 rounded-md bg-transparent text-accent cursor-pointer text-[11px] hover:bg-soft',
              chips ? 'ml-0' : 'ml-4'
            )}
            data-expand={fk}
            onClick={() => setShowAll(!showAll)}
          >
            <Icon name={showAll ? 'chevronDown' : 'chevronRight'} size={11} />
            {showAll ? '收起' : `展开全部 ${rows.length} 项`}
          </button>
        ) : null}
      </div>
      ) : null}
    </Section>
  );
}

/* ============================ 标签 ============================ */

function TagSection({ tagMap }: { tagMap: Map<string, number> }) {
  const act = state.filter.tag;
  const rows = Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1] || cmpName(a[0], b[0]));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, ROW_LIMIT);

  const extra = rows.length ? (
    <button
      type="button"
      className="flex-none inline-flex items-center gap-1 border-0 bg-transparent text-accent cursor-pointer text-[11px] py-0.5 px-1 rounded hover:bg-soft"
      data-tagmode="1"
      title="切换多标签组合方式"
      onClick={toggleTagMode}
    >
      {state.tagMode === 'all' ? '同时含全部' : '含任一'}
    </button>
  ) : null;

  return (
    <Section
      title="标签"
      group="tag"
      activeCount={act ? act.size : 0}
      onClear={() => clearFacet('tag')}
      extra={extra}
    >
      {!rows.length ? (
        <EmptyRow text="还没有标签 —— 可在作品详情页或批量操作中添加" />
      ) : (
        <div className="flex flex-col gap-px">
          {shown.map(([k, c]) => {
            const on = !!(act && act.has(k));
            return (
              <div
                key={k}
                className={cx(
                  'group flex items-center gap-2 h-[30px] max-w-full border-0 rounded-md cursor-pointer text-left text-[12.5px] min-w-0 hover:bg-hov',
                  ROW_PAD,
                  on ? 'bg-soft text-accent font-semibold' : 'bg-transparent text-fg'
                )}
                data-f="tag"
                data-k={k}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation();
                  openContextMenu({ x: e.clientX, y: e.clientY, title: k, ariaLabel: `标签「${k}」的菜单`, items: menuForFacet('tag', k, k) });
                }}
                onClick={() => toggleFacet('tag', k)}
              >
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={k}>{k}</span>
                <span className={cx(
                  'flex items-center gap-0.5 transition-opacity duration-150 flex-none',
                  on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                )}>
                  <button
                    type="button"
                    className="not-italic w-[18px] h-[18px] rounded border-0 cursor-pointer inline-flex items-center justify-center text-muted bg-line2 hover:bg-soft hover:text-accent"
                    data-act="rename"
                    data-k={k}
                    title="重命名标签"
                    aria-label={`重命名标签 ${k}`}
                    onClick={e => { e.stopPropagation(); askRenameTag(k); }}
                  >
                    <Icon name="pencil" size={11} />
                  </button>
                  <button
                    type="button"
                    className="not-italic w-[18px] h-[18px] rounded border-0 cursor-pointer inline-flex items-center justify-center text-muted bg-line2 hover:bg-soft hover:text-accent"
                    data-act="del"
                    data-k={k}
                    title="删除标签（从所有图片移除）"
                    aria-label={`删除标签 ${k}`}
                    onClick={e => { e.stopPropagation(); askDeleteTag(k); }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
                <span className={cx('text-[11px] flex-none tabular-nums', on ? 'text-accent' : 'text-muted')}>{c}</span>
              </div>
            );
          })}
          {rows.length > ROW_LIMIT ? (
            <button
              type="button"
              className="self-start ml-4 mt-0.5 inline-flex items-center gap-1 h-6 px-1.5 border-0 rounded-md bg-transparent text-accent cursor-pointer text-[11px] hover:bg-soft"
              data-expand="tag"
              onClick={() => setShowAll(!showAll)}
            >
              <Icon name={showAll ? 'chevronDown' : 'chevronRight'} size={11} />
              {showAll ? '收起' : `展开全部 ${rows.length} 项`}
            </button>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/* ============================ 主色调 ============================ */

function ColorSection({ colMap }: { colMap: Map<string, number> }) {
  const act = state.filter.color;
  const rows = COLOR_FAMILIES.filter(x => colMap.get(x.key)).map(x => ({ fam: x, count: colMap.get(x.key)! }));
  return (
    <Section
      title="主色调"
      group="color"
      activeCount={act ? act.size : 0}
      onClear={() => clearFacet('color')}
    >
      {!state.colorEnabled && !rows.length ? (
        <EmptyRow text="色调分析默认关闭 —— 可在顶栏「更多 · 设置」中开启" />
      ) : !rows.length ? (
        <EmptyRow text={state.colorTotal && state.colorDone < state.colorTotal ? '正在分析色彩…' : '暂无数据'} />
      ) : (
        <div className="flex flex-wrap gap-1.5 pl-4">
          {rows.map(({ fam, count }) => {
            const on = !!(act && act.has(fam.key));
            return (
              <button
                key={fam.key}
                type="button"
                className={cx(
                  'flex items-center gap-[5px] h-[30px] pl-1.5 pr-[9px] border rounded-full cursor-pointer text-xs transition-[border-color,background-color] duration-150 hover:bg-hov',
                  on
                    ? 'border-accent bg-soft text-accent font-semibold [box-shadow:0_0_0_2px_var(--accent-soft)]'
                    : 'border-line bg-panel text-fg'
                )}
                data-f="color"
                data-k={fam.key}
                aria-pressed={on}
                title={`${fam.label} · ${count} 张`}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation();
                  openContextMenu({ x: e.clientX, y: e.clientY, title: familyLabel(fam.key), ariaLabel: `色系「${familyLabel(fam.key)}」的菜单`, items: menuForFacet('color', fam.key, familyLabel(fam.key)) });
                }}
                onClick={() => toggleFacet('color', fam.key)}
              >
                {/* 色系圆点不是装饰图标，而是「这个色系长什么样」的语义载体，保留 */}
                <i className="w-4 h-4 rounded-full flex-none border border-black/[.12] [box-shadow:inset_0_0_0_1px_rgba(255,255,255,.35)]" style={{ background: familyCss(fam.key) }}></i>
                <span>{familyLabel(fam.key)}</span>
                <em className={cx('not-italic text-[11px] tabular-nums', on ? 'text-accent' : 'text-muted')}>{count}</em>
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

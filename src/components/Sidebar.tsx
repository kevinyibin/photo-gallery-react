/**
 * 侧栏 —— 「作品筛选」/「文件夹」两个标签页 + 底部库统计。
 *
 * 结构（本次重设计）：
 * - 标签页头部带图标与激活下划线，窄屏额外提供「收起」按钮；
 * - 面板体只负责挂载（筛选面板 / 目录树），维度折叠等细节由各自组件内部维护；
 * - 窄屏（≤820px）整体变为可滑出的抽屉（原版媒体查询以内联断点表达）。
 */
import { state, useChannel } from '../core/store';
import { setSideTab, setDrawerOpen } from '../core/engine';
import { fmtSize } from '../core/utils';
import { ratingOf } from '../core/ratings';
import { cx } from '../ui/kit';
import Icon from '../ui/Icon';
import FacetPanel from './FacetPanel';
import TreePanel from './TreePanel';

const TABS: [key: 'facet' | 'tree', label: string, icon: 'filter' | 'folder'][] = [
  ['facet', '作品筛选', 'filter'],
  ['tree', '文件夹', 'folder']
];

export default function Sidebar({ width }: { width: number | null }) {
  useChannel('sidebar');
  const tab = state.sideTab;

  return (
    <aside
      className={cx(
        'flex-none bg-panel border-r border-line flex flex-col min-h-0 w-[250px] max-[1080px]:w-[200px]',
        'max-[820px]:fixed max-[820px]:left-0 max-[820px]:top-[var(--topbar-h)] max-[820px]:bottom-0 max-[820px]:z-[58]',
        'max-[820px]:w-[min(330px,88vw)]',
        'max-[820px]:transition-transform max-[820px]:duration-[220ms] max-[820px]:ease-out max-[820px]:shadow-sidedrawer',
        // 位移互斥：同一断点下两个 translate 变体只能出现一个，避免层叠顺序决定胜负
        state.drawerOpen ? 'max-[820px]:translate-x-0' : 'max-[820px]:-translate-x-[104%]'
      )}
      id="sidebar"
      style={width != null ? { width: width + 'px' } : undefined}
    >
      <div className="flex-none flex items-center gap-0.5 px-2.5 pt-1.5 border-b border-line2" role="tablist" aria-label="侧栏面板">
        {TABS.map(([k, label, icon]) => {
          const on = tab === k;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={on}
              data-tab={k}
              className={cx(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-[34px] border-0 bg-transparent cursor-pointer text-[13px] font-semibold rounded-t-lg transition-colors duration-150',
                on ? 'text-accent [box-shadow:inset_0_-2px_0_var(--accent)]' : 'text-muted hover:text-fg'
              )}
              onClick={() => setSideTab(k)}
            >
              <Icon name={icon} size={14} className="flex-none" />
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className="border-0 bg-transparent text-accent cursor-pointer text-xs py-0.5 px-1 rounded hover:bg-soft hidden max-[900px]:!inline-flex"
          id="btnCloseDrawer"
          title="收起筛选栏"
          aria-label="收起筛选栏"
          onClick={() => setDrawerOpen(false)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col" id="paneFacet" role="tabpanel" hidden={tab !== 'facet'}>
        <FacetPanel />
      </div>

      <div className="flex-1 min-h-0 flex flex-col" id="paneTree" role="tabpanel" hidden={tab !== 'tree'}>
        <TreePanel />
      </div>

      <SideFoot />
    </aside>
  );
}

/** 侧栏底部：库统计 + 当前视图的评分分布 */
function SideFoot() {
  useChannel('tree', 'grid');
  const n = state.tree;
  if (!n) return <div className="flex-none px-3 py-2 border-t border-line2 text-[11px] text-muted leading-[1.7]" id="sideFoot"></div>;
  const dist = [0, 0, 0, 0, 0];
  let rated = 0;
  for (const it of state.view) {
    const r = ratingOf(it);
    if (r) { dist[r - 1]++; rated++; }
  }
  return (
    <div className="flex-none px-3 py-2 border-t border-line2 text-[11px] text-muted leading-[1.7]" id="sideFoot">
      <div>共 {n.files} 个媒体文件 · {fmtSize(n.size)}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1"><Icon name="image" size={11} />{n.images}</span>
        <span className="inline-flex items-center gap-1"><Icon name="film" size={11} />{n.videos}</span>
        {rated ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <Icon name="star" size={11} filled />{rated}
            <span className="text-muted">
              {dist.map((c, i) => c ? `${i + 1} 星 ${c}` : null).filter(Boolean).reverse().join(' · ')}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 文件夹目录树 —— 按路径聚合统计，caret 展开/折叠，点击行筛选目录。
 * 顶部提供「全部折叠 / 展开」与「取消目录筛选」两个常用操作。
 */
import { useRef } from 'react';
import { state, notify, useChannel } from '../core/store';
import { cmpName } from '../core/utils';
import { setDirFilter } from '../core/engine';
import { hasOpenChild, setOpenAll } from '../core/tree';
import { menuForDir } from '../core/ctxMenus';
import { openContextMenu } from '../ui/ContextMenu';
import { cx } from '../ui/kit';
import Icon from '../ui/Icon';
import { useScrollReveal } from '../ui/useScrollReveal';
import type { TreeNode } from '../core/types';

interface Row { node: TreeNode; depth: number; }

export default function TreePanel() {
  useChannel('tree');
  const t = state.tree;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useScrollReveal(scrollerRef);   // 滚动条仅在滚动时显示（与图库主区一致）

  const rows: Row[] = [];
  if (t) {
    (function emit(node: TreeNode, depth: number) {
      rows.push({ node, depth });
      if (!node.open) return;
      const kids = Array.from(node.children.values()).sort((a, b) => cmpName(a.name, b.name));
      for (const k of kids) emit(k, depth + 1);
    })(t, 0);
  }

  const onRowClick = (r: Row, e: React.MouseEvent) => {
    const node = r.node;
    const hasKids = node.children.size > 0;
    if ((e.target as HTMLElement).closest('.caret') && hasKids) {
      node.open = !node.open;
      notify('tree');
    } else {
      setDirFilter(node.key);
      notify('tree');
    }
  };

  const toggleAll = () => {
    if (!state.tree) return;
    const expand = !(state.tree.open && hasOpenChild(state.tree));
    setOpenAll(state.tree, expand);
    notify('tree');
  };

  const dirFilterOn = !!state.filter.dir;

  return (
    <>
      <div className="h-9 flex-none flex items-center justify-between pl-3 pr-2 text-xs font-semibold text-muted border-b border-line2">
        <span>目录</span>
        <span className="flex items-center gap-0.5">
          {dirFilterOn ? (
            <button
              type="button"
              className="border-0 bg-transparent text-accent cursor-pointer text-xs py-0.5 px-1 rounded hover:bg-soft"
              id="btnClearDir"
              title="取消文件夹筛选"
              onClick={() => { setDirFilter(''); notify('tree'); }}
            >清除</button>
          ) : null}
          <button
            type="button"
            className="border-0 bg-transparent text-accent cursor-pointer text-xs py-0.5 px-1 rounded hover:bg-soft"
            id="btnCollapse"
            onClick={toggleAll}
          >全部折叠</button>
        </span>
      </div>
      {/* scroller：与图库瀑布流共用同一套滚动条样式（宽度 / 圆角 / 轨道 / 滑块 / hover / 滚动时才显示） */}
      <div className="tree scroller flex-1 overflow-auto py-1.5 px-1.5 pb-3" id="tree" ref={scrollerRef}>
        {rows.map((r, i) => {
          const node = r.node;
          const hasKids = node.children.size > 0;
          const active = state.filter.dir === node.key;
          return (
            <div
              key={node.key || '__root__' + i}
              className={cx(
                'flex items-center gap-1 h-7 rounded-md cursor-pointer text-[13px] select-none hover:bg-hov',
                active ? 'bg-soft text-accent font-semibold' : ''
              )}
              style={{ paddingLeft: (6 + r.depth * 13) + 'px' }}
              onClick={e => onRowClick(r, e)}
              onContextMenu={e => {
                /* 右键 = 文件夹级操作（展开 / 只看 / 复制路径），不动左键的「点行即筛选」 */
                e.preventDefault();
                e.stopPropagation();
                openContextMenu({
                  x: e.clientX, y: e.clientY,
                  title: node.key || '全部文件',
                  ariaLabel: `文件夹「${node.name}」的操作菜单`,
                  items: menuForDir(node)
                });
              }}
            >
              <span
                className={cx(
                  'caret w-3.5 h-3.5 flex-none flex items-center justify-center transition-transform duration-150',
                  hasKids ? (node.open ? 'rotate-90 text-muted' : 'text-muted') : 'invisible',
                  !hasKids && active && 'text-accent'
                )}
                role={hasKids ? 'button' : undefined}
                aria-label={hasKids ? (node.open ? '折叠' : '展开') : undefined}
                aria-expanded={hasKids ? node.open : undefined}
              >
                <Icon name="chevronRight" size={11} />
              </span>
              <span className={cx('flex-1 overflow-hidden text-ellipsis whitespace-nowrap', active && 'text-accent')} title={node.key || '全部文件'}>{node.name}</span>
              <span className={cx('text-[11px] flex-none tabular-nums', active ? 'text-accent' : 'text-muted')}>{node.files}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

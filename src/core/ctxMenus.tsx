/**
 * 右键菜单内容构造 —— 所有界面「右键能做什么」的唯一出处。
 *
 * 设计原则（与左键严格分工）：
 * - **左键 = 进入 / 切换**：点作品打开大图、点目录切换筛选、点条目切换选中；
 * - **右键 = 就地对当前对象做事**：不改变视图、不跳转（除非菜单里显式选择「打开大图」），
 *   因此批量模式下也能直接右键预览，不必先退出批量模式；
 * - 菜单首组永远是「针对这个对象最直接的动作」，与左键语义呼应而不是重复；
 * - 破坏性操作（移入废纸篓 / 彻底删除）统一带 danger 色、放到独立分组并保持在下方，
 *   避免误触；「喜欢」的作品受保护，相关项置灰并给出原因。
 *
 * 快捷键提示（hint）与全局键位保持一致：L 喜欢、Delete 废纸篓、←/→ 切换、R 旋转、F 全屏、I 详情。
 */
import { state, notify, setLeft } from './store';
import { ratingOf, setRating } from './ratings';
import {
  likedOf, toggleLike, moveToTrash, restoreFromTrash, purgeItems, afterViewShrunk,
  setSelectMode, toggleSelect, selectAllInView
} from './library';
import { toggleFacet, setFacetOnly, clearFacet, activeFacetCount } from './facets';
import type { FacetKey } from './facets';
import { setRatingFilter, setMode, setColWidth, setDirFilter, resetFilters } from './engine';
import { setOpenAll } from './tree';
import {
  openPreview, goto, toggleFullscreen, toggleLbMeta, closePreview, lbControls
} from './preview';
import { askAddTags, askRenameTag, askDeleteTag, openModal } from './modal';
import { moveFacet, toggleFacetHidden } from './facetPrefs';
import type { FacetGroup } from './constants';
import { pickFolder, pickFiles } from './scanner';
import { rescan } from './extra';
import { toast } from './feedback';
import { ConfirmText } from '../components/dialogs';
import Stars from '../components/Stars';
import type { MenuItem } from '../ui/Menu';
import type { MediaItem, TreeNode } from './types';

/* ============================ 小工具 ============================ */

/** 复制到剪贴板：优先异步 API，失败时回落到临时 textarea（http 环境下也能用） */
async function copyText(text: string, what: string) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (e2) { ok = false; }
  }
  if (ok) { toast.success(`已复制${what}`); setLeft(`已复制${what}：${text}`); }
  else toast.error('复制失败：浏览器未授权访问剪贴板');
}

/** 相对路径（库内路径 + 文件名；浏览器拿不到系统绝对路径） */
function relPath(it: MediaItem): string {
  return (it.dirKey ? it.dirKey + '/' : '') + it.name;
}

/** 评分行：与详情页一致 —— 点第 N 星 = N 星，再点同一星 = 清除 */
function ratingRow(it: MediaItem): MenuItem {
  const v = ratingOf(it);
  return {
    key: 'rate',
    label: '评分',
    custom: (
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-fg flex-none">评分</span>
        <Stars
          value={v}
          variant="light"
          title="1-5 星；再次点击同一星级清除评分（与详情页一致）"
          onRate={n => setRating(it, ratingOf(it) === n ? 0 : n)}
        />
        <span className="ml-auto text-[11px] text-muted tabular-nums">{v ? v + ' 星' : '未评分'}</span>
      </div>
    )
  };
}

/** 彻底删除：与 Delete 键在废纸篓中的行为一致，先确认再执行 */
function askPurge(it: MediaItem) {
  openModal({
    title: '彻底删除',
    content: <ConfirmText>确定彻底删除「{it.name}」？此操作不可恢复。</ConfirmText>,
    okText: '彻底删除',
    onOk: () => {
      if (purgeItems([it])) {
        setLeft(`已彻底删除：${it.name}`);
        afterViewShrunk();
      }
      return true;
    }
  });
}

/** 废纸篓相关的三项（按当前所处模式给出，避免同一菜单里出现互斥的重复项） */
function trashRows(it: MediaItem): MenuItem[] {
  const liked = likedOf(it);
  if (state.trashMode) {
    return [
      { key: 'restore', label: '从废纸篓恢复', icon: 'rotateCcw', separatorBefore: true, onSelect: () => { restoreFromTrash(it); notify('grid', 'lightbox'); setLeft(`已恢复：${it.name}`); } },
      { key: 'purge', label: '彻底删除…', icon: 'trash', danger: true, disabled: liked, hint: liked ? '已喜欢' : undefined, onSelect: () => askPurge(it) }
    ];
  }
  return [
    {
      key: 'trash', label: '移入废纸篓', icon: 'trash', danger: true, separatorBefore: true,
      disabled: liked, hint: liked ? '已喜欢·受保护' : 'Delete',
      onSelect: () => {
        if (moveToTrash(it)) { setLeft(`已移入废纸篓：${it.name}`); afterViewShrunk(); }
      }
    }
  ];
}

/* ============================ ① 图库 · 单张作品 ============================ */

export function menuForItem(it: MediaItem): MenuItem[] {
  const idx = state.view.indexOf(it);
  const liked = likedOf(it);
  const sel = state.selected.has(it.id);
  const sameDir = state.view.some(x => x !== it && x.dirKey === it.dirKey);

  return [
    /* 第一组：这个作品最直接的动作 —— 与左键「打开大图」同义，明确写出来便于批量模式下使用 */
    { key: 'open', label: '打开大图', icon: 'maximize', disabled: idx < 0, onSelect: () => openPreview(idx) },
    { key: 'like', label: liked ? '取消喜欢' : '标记喜欢', icon: 'heart', checked: liked, hint: 'L', onSelect: () => toggleLike(it) },
    ratingRow(it),
    { key: 'tag', label: '添加标签…', icon: 'tag', onSelect: () => askAddTags(it, () => notify('grid', 'lightbox')) },

    ...trashRows(it),

    /* 批量相关：右键即可把这一张纳入选择，或在批量模式里取消它 */
    {
      key: 'select', label: sel ? '取消勾选' : '勾选（批量操作）', icon: 'checkSquare', checked: sel, separatorBefore: true,
      onSelect: () => { if (!state.selectMode) setSelectMode(true); toggleSelect(it); }
    },
    {
      key: 'selectDir', label: '选中此文件夹的全部', icon: 'folder', disabled: !sameDir,
      onSelect: () => {
        setSelectMode(true);
        state.selected.clear();
        for (const x of state.view) if (x.dirKey === it.dirKey) state.selected.add(x.id);
        notify('batch', 'grid');
        setLeft(`已选中「${it.dirKey || '根目录'}」中的 ${state.selected.size} 项`);
      }
    },

    { key: 'copyName', label: '复制文件名', icon: 'fileText', separatorBefore: true, onSelect: () => copyText(it.name, '文件名') },
    { key: 'copyPath', label: '复制相对路径', icon: 'fileText', onSelect: () => copyText(relPath(it), '相对路径') }
  ];
}

/* ============================ ② 图库 · 空白区 ============================ */

export function menuForCanvas(): MenuItem[] {
  const hasView = state.view.length > 0;
  const hasFilter = !!(activeFacetCount() || state.filter.q || state.filter.dir ||
    state.filter.kind !== 'all' || state.filter.rating !== 'all');

  return [
    /* 库级：导入相关 */
    { key: 'pick', label: '选择文件夹…', icon: 'folderOpen', onSelect: () => pickFolder() },
    { key: 'add', label: '添加照片…', icon: 'image', onSelect: pickFiles },
    { key: 'rescan', label: '重新扫描文件夹', icon: 'refreshCw', hint: '增量', disabled: !state.root.name, onSelect: () => { void rescan(); } },

    /* 视图级 */
    { key: 'layout', label: '布局方式', groupLabel: true, separatorBefore: true },
    { key: 'flow', label: '瀑布流', icon: 'waterfall', checked: state.mode === 'flow', checkRole: 'radio', onSelect: () => setMode('flow') },
    { key: 'group', label: '按文件夹分组', icon: 'folder', checked: state.mode === 'group', checkRole: 'radio', onSelect: () => setMode('group') },
    { key: 'bigger', label: '缩略图放大一级', icon: 'zoomIn', separatorBefore: true, hint: 'Alt+滚轮', onSelect: () => setColWidth(state.colWidth + 20) },
    { key: 'smaller', label: '缩略图缩小一级', icon: 'zoomOut', onSelect: () => setColWidth(state.colWidth - 20) },

    /* 选择与筛选 */
    { key: 'selAll', label: '全选（批量操作）', icon: 'checkSquare', separatorBefore: true, disabled: !hasView, onSelect: () => { setSelectMode(true); selectAllInView(); } },
    { key: 'clear', label: '清除筛选条件', icon: 'x', disabled: !hasFilter, onSelect: resetFilters }
  ];
}

/* ============================ ③ 大图视图 ============================ */

export function menuForLightbox(it: MediaItem): MenuItem[] {
  const liked = likedOf(it);
  const isImage = it.kind === 'image';
  return [
    /* 浏览：与 ←/→ 等价，不必移开鼠标去找顶栏 */
    { key: 'prev', label: '上一张', icon: 'chevronLeft', hint: '←', onSelect: () => goto(-1) },
    { key: 'next', label: '下一张', icon: 'chevronRight', hint: '→', onSelect: () => goto(1) },

    { key: 'like', label: liked ? '取消喜欢' : '标记喜欢', icon: 'heart', checked: liked, hint: 'L', separatorBefore: true, onSelect: () => toggleLike(it) },
    ratingRow(it),
    { key: 'tag', label: '添加标签…', icon: 'tag', onSelect: () => askAddTags(it, () => notify('grid', 'lightbox')) },

    ...trashRows(it),

    /* 视图控制：只放「看的时候会临时用一下」的项，避免和图库菜单重叠 */
    { key: 'rotate', label: '旋转 90°', icon: 'rotateCw', separatorBefore: true, disabled: !isImage, hint: 'R', onSelect: () => lbControls.current?.rotatePreview() },
    { key: 'fit', label: '重置缩放与位置', icon: 'frame', disabled: !isImage, hint: '0', onSelect: () => lbControls.current?.resetZoom() },
    { key: 'fs', label: state.fullscreen ? '退出全屏' : '全屏', icon: state.fullscreen ? 'minimize' : 'maximize', hint: 'F', onSelect: toggleFullscreen },
    { key: 'meta', label: '详细信息面板', icon: 'info', checked: state.lbMetaOn, hint: 'I', onSelect: toggleLbMeta },

    { key: 'close', label: '关闭大图', icon: 'x', separatorBefore: true, hint: 'Esc', onSelect: closePreview }
  ];
}

/* ============================ ④ 左侧筛选维度 ============================ */

const FACET_TITLE: Record<FacetKey, string> = {
  camera: '相机机身', lens: '镜头', focal: '焦距区间', year: '拍摄年份', color: '主色调', tag: '标签'
};

export function menuForFacet(fk: FacetKey, value: string, label: string): MenuItem[] {
  const set = state.filter[fk] as Set<string> | null;
  const on = !!(set && set.has(value));
  const only = !!(set && set.size === 1 && set.has(value));
  const total = set ? set.size : 0;

  const items: MenuItem[] = [
    /* 与左键「切换」互补：右键提供「收敛到一项」和「显式移除」两个确定性动作 */
    { key: 'only', label: `只看「${label}」`, icon: 'filter', disabled: only, onSelect: () => setFacetOnly(fk, value) },
    { key: 'toggle', label: on ? '从筛选中移除' : '追加到当前筛选', icon: on ? 'x' : 'plus', checked: on, onSelect: () => toggleFacet(fk, value) },
    { key: 'clear', label: `清除「${FACET_TITLE[fk]}」筛选`, icon: 'x', separatorBefore: true, disabled: !total, onSelect: () => clearFacet(fk) }
  ];

  if (fk === 'tag') {
    items.push(
      { key: 'rename', label: '重命名标签…', icon: 'pencil', separatorBefore: true, onSelect: () => askRenameTag(value) },
      { key: 'del', label: '删除标签…', icon: 'trash', danger: true, onSelect: () => askDeleteTag(value) }
    );
  }
  return items;
}

/** 评分维度的右键菜单：把「已评分 / 未评分 / N 星及以上」做成单选，避免逐级点选 */
export function menuForRating(): MenuItem[] {
  const rf = state.filter.rating;
  const row = (key: string, label: string, v: string): MenuItem => ({
    key, label, checkRole: 'radio', checked: rf === v, onSelect: () => setRatingFilter(v)
  });
  return [
    row('all', '不限评分', 'all'),
    row('rated', '只看已评分', '1'),
    row('unrated', '只看未评分', '0'),
    ...[1, 2, 3, 4, 5].map(n => row('star' + n, `${n} 星及以上`, String(n)))
  ];
}

/** 维度标题的右键菜单：把「排序 / 显隐」这两个低频配置就近暴露出来（与设置弹窗同一套数据） */
export function menuForSection(group: FacetGroup): MenuItem[] {
  return [
    { key: 'up', label: '上移一位', icon: 'chevronUp', onSelect: () => moveFacet(group, -1) },
    { key: 'down', label: '下移一位', icon: 'chevronDown', onSelect: () => moveFacet(group, 1) },
    {
      key: 'hide', label: '在侧栏隐藏此维度', icon: 'eyeOff', separatorBefore: true, hint: '设置可恢复',
      onSelect: () => toggleFacetHidden(group, true)
    }
  ];
}

/* ============================ ⑤ 目录树 / 分组头 ============================ */

export function menuForDir(node: TreeNode): MenuItem[] {
  const hasKids = node.children.size > 0;
  const active = state.filter.dir === node.key;
  return [
    {
      key: 'view', label: node.key ? '只看此文件夹' : '回到全部文件', icon: 'folderOpen', checked: active,
      onSelect: () => { setDirFilter(node.key); notify('tree'); }
    },
    {
      key: 'toggle', label: node.open ? '折叠' : '展开', icon: node.open ? 'chevronUp' : 'chevronDown',
      disabled: !hasKids, separatorBefore: true,
      onSelect: () => { node.open = !node.open; notify('tree'); }
    },
    { key: 'expandAll', label: '展开全部子目录', icon: 'chevronDown', disabled: !hasKids, onSelect: () => { if (state.tree) setOpenAll(state.tree, true); notify('tree'); } },
    { key: 'collapseAll', label: '全部折叠', icon: 'chevronUp', onSelect: () => { if (state.tree) setOpenAll(state.tree, false); notify('tree'); } },
    { key: 'clear', label: '取消文件夹筛选', icon: 'x', separatorBefore: true, disabled: !state.filter.dir, onSelect: () => { setDirFilter(''); notify('tree'); } },
    { key: 'copy', label: '复制文件夹路径', icon: 'fileText', separatorBefore: true, onSelect: () => copyText(node.key || '（全部文件）', '文件夹路径') }
  ];
}

/** 分组视图里的文件夹标题（作品按文件夹分组时的组头） */
export function menuForGroupHeader(dir: string): MenuItem[] {
  return [
    { key: 'view', label: '只看此文件夹', icon: 'folderOpen', onSelect: () => { setDirFilter(dir); notify('tree'); } },
    { key: 'clear', label: '取消文件夹筛选', icon: 'x', disabled: !state.filter.dir, onSelect: () => { setDirFilter(''); notify('tree'); } },
    { key: 'copy', label: '复制文件夹路径', icon: 'fileText', separatorBefore: true, onSelect: () => copyText(dir || '（根目录）', '文件夹路径') },
    { key: 'flow', label: '切换为瀑布流', icon: 'waterfall', separatorBefore: true, onSelect: () => setMode('flow') }
  ];
}

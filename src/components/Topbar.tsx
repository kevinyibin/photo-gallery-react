/**
 * 顶栏 —— 按「使用频率 × 业务重要性」重排，控件从 16 个收敛为 6 个语义组：
 *
 *   ① 导入（核心高频）：「选择文件夹」主按钮 + 下拉（添加照片 / 重新扫描）
 *   ② 搜索（核心高频）：文件名 / 相机 / 镜头 / 标签
 *   ③ 类型（核心高频）：全部 · 照片 · 视频 · 喜欢
 *   ④ 视图（常用，收拢为下拉）：布局 · 排序 · 缩略图尺寸 · 文件名
 *   ⑤ 操作（常用）：批量选择 · 废纸篓
 *   ⑥ 更多（低频 + 新增）：幻灯片 · 导出清单 · 全屏 · 恢复上次浏览 · 清空 · 设置 · 主题
 *
 * 响应式：≤1400 收品牌文字 → ≤1180 类型只留图标 → ≤980 收「视图」下拉（内容并入更多）
 * → ≤820 收批量 / 废纸篓 / 主题（并入更多菜单），只留 筛选抽屉 · 导入 · 搜索 · 类型 · 更多。
 * 所有被折叠的功能在「更多」菜单中都有对应条目（窄屏项用 mobileOnly 只在窄屏出现，避免重复）。
 *
 * 无障碍：图标按钮均有 aria-label / title；分段与开关用 aria-pressed / aria-checked；
 * 下拉菜单具备完整 role=menu 与方向键导航（见 ui/Menu.tsx）。
 */
import { state, useChannel } from '../core/store';
import {
  onSearchInput, setKind, setSort, setMode, setColWidth, setShowName, toggleTheme, setDrawerOpen, setColorEnabled
} from '../core/engine';
import { pickFolder, pickFiles, clearAll } from '../core/scanner';
import { rescan, startSlideshow, exportViewCsv, toggleAppFullscreen } from '../core/extra';
import { setSelectMode, setTrashMode, trashCount } from '../core/library';
import { doRestore } from '../core/session';
import { openSettings } from '../core/modal';
import { activeFacetCount } from '../core/facets';
import { btnCls, btnGroupCls, cx } from '../ui/kit';
import Icon from '../ui/Icon';
import DropdownMenu, { type MenuItem } from '../ui/Menu';

/** 类型筛选：与 core 的 filter.kind 一一对应 */
const KINDS: [kind: 'all' | 'image' | 'video' | 'like', label: string, icon: 'layers' | 'images' | 'film' | 'heart'][] = [
  ['all', '全部', 'layers'],
  ['image', '照片', 'images'],
  ['video', '视频', 'film'],
  ['like', '喜欢', 'heart']
];

/** 排序方式：与 state.sort 一一对应 */
const SORTS: [value: string, label: string][] = [
  ['shot', '拍摄时间 新→旧'],
  ['shotAsc', '拍摄时间 旧→新'],
  ['name', '名称'],
  ['date', '修改时间'],
  ['path', '路径'],
  ['size', '文件大小'],
  ['rating', '评分']
];

export default function Topbar() {
  useChannel('topbar', 'grid', 'facets', 'batch');
  const hasItems = state.items.length > 0;
  const nTrash = trashCount();
  const f = state.filter;
  const nFacet = activeFacetCount();

  /* ---- 视图项：布局 / 排序 / 尺寸 / 文件名 ----
     narrow=true 时这些项只在 ≤980px 出现（该断点「视图」下拉被收起，由「更多」承载） */
  const buildViewItems = (narrow: boolean): MenuItem[] => [
    { key: 'gl-layout', label: '布局', groupLabel: true, narrowOnly: narrow },
    {
      key: 'flow', label: '瀑布流', icon: 'waterfall', checkRole: 'radio', narrowOnly: narrow,
      checked: state.mode === 'flow', onSelect: () => setMode('flow')
    },
    {
      key: 'group', label: '按文件夹', icon: 'folder', checkRole: 'radio', narrowOnly: narrow,
      checked: state.mode === 'group', onSelect: () => setMode('group')
    },
    { key: 'gl-sort', label: '排序', groupLabel: true, separatorBefore: true, narrowOnly: narrow },
    ...SORTS.map(([v, label]): MenuItem => ({
      key: 'sort-' + v, label, icon: 'sortAsc', checkRole: 'radio', narrowOnly: narrow,
      checked: state.sort === v, onSelect: () => setSort(v)
    })),
    {
      key: 'size', label: '缩略图尺寸', separatorBefore: true, narrowOnly: narrow,
      custom: (
        <label className="flex items-center gap-2">
          <Icon name="grid" size={14} className="flex-none text-muted" />
          <input
            type="range"
            id={narrow ? 'sizeRangeNarrow' : 'sizeRange'}
            className="flex-1 min-w-0 accent-accent"
            min={130}
            max={420}
            step={10}
            value={state.colWidth}
            aria-label="缩略图尺寸"
            onChange={e => setColWidth(+e.target.value)}
          />
          <span className="flex-none text-[11px] text-muted tabular-nums w-[26px] text-right">{state.colWidth}</span>
        </label>
      )
    },
    {
      key: 'name', label: '显示文件名', icon: 'type', narrowOnly: narrow,
      checked: state.showName, onSelect: () => setShowName(!state.showName)
    },
    { key: 'sep-view', label: '', separator: true, narrowOnly: narrow }
  ];

  /* ---- 更多菜单：低频动作 + 新增功能 + 被折叠控件的兜底项 ---- */
  const moreItems: MenuItem[] = [
    ...buildViewItems(true),
    {
      key: 'sel', label: '批量操作', icon: 'checkSquare', mobileOnly: true,
      checked: state.selectMode, disabled: !hasItems, onSelect: () => setSelectMode(!state.selectMode)
    },
    {
      key: 'trash', label: '废纸篓' + (nTrash ? ` (${nTrash})` : ''), icon: 'trash', mobileOnly: true,
      checked: state.trashMode, disabled: !nTrash && !state.trashMode, onSelect: () => setTrashMode(!state.trashMode)
    },
    {
      key: 'theme', label: state.theme === 'light' ? '深色主题' : '浅色主题', icon: state.theme === 'light' ? 'moon' : 'sun',
      mobileOnly: true, onSelect: toggleTheme
    },
    { key: 'sep-m', label: '', separator: true, mobileOnly: true },
    { key: 'slide', label: '幻灯片播放', icon: 'play', disabled: !state.view.length, onSelect: startSlideshow },
    { key: 'export', label: '导出当前清单', icon: 'download', hint: 'CSV', disabled: !state.view.length, onSelect: exportViewCsv },
    { key: 'fs', label: '整页全屏', icon: 'maximize', onSelect: toggleAppFullscreen },
    {
      key: 'restore', label: '恢复上次浏览', icon: 'rotateCcw', disabled: !state.restore,
      onSelect: () => doRestore()
    },
    { key: 'sep-1', label: '', separator: true },
    { key: 'clear', label: '清空图库', icon: 'trash', danger: true, disabled: !hasItems, onSelect: clearAll },
    { key: 'settings', label: '设置与快捷键', icon: 'settings', onSelect: () => openSettings(setColorEnabled) }
  ];

  return (
    /* 两端对齐：左 = 品牌 + 导入（flex-none），中 = 搜索（flex-1 自适应留白，居中），
       右 = 工具按钮组（flex-none，justify-end）；整行 items-center 保证垂直居中。 */
    <header className="min-h-[var(--topbar-h)] flex-none flex items-center justify-between flex-nowrap gap-2 px-3 bg-panel border-b border-line">
      {/* ===== 左：品牌 + 导入 ===== */}
      <div className="flex items-center gap-2 flex-none min-w-0">
        {/* 品牌 */}
        <div className="flex items-center gap-2 flex-none min-w-0">
          <Icon name="camera" size={20} className="text-accent flex-none" />
          <span className="font-[650] tracking-[.2px] whitespace-nowrap overflow-hidden text-ellipsis max-[1400px]:hidden">摄影作品集</span>
        </div>

        <div className="w-px h-[22px] bg-line flex-none max-[1400px]:!hidden"></div>

        {/* ① 导入：主按钮 + 下拉（添加照片 / 重新扫描） */}
        <div className={btnGroupCls} id="importGroup">
          <button
            className={btnCls({ primary: true, grouped: 'left' })}
            id="btnPick"
            title="选择文件夹导入作品"
            onClick={() => pickFolder()}
          >
            <Icon name="folderOpen" size={16} className="flex-none" />
            <span className="max-[820px]:hidden">选择文件夹</span>
          </button>
          <DropdownMenu
            id="btnImportMenu"
            ariaLabel="更多导入方式"
            title="更多导入方式"
            align="left"
            menuWidth={196}
            triggerCls={btnCls({ primary: true, icon: true, grouped: 'right' })}
            trigger={null}
            showChevron
            items={[
              { key: 'add', id: 'btnAdd', label: '添加照片', icon: 'image', onSelect: pickFiles },
              { key: 'rescan', id: 'btnRescan', label: '重新扫描文件夹', icon: 'refreshCw', hint: '增量', onSelect: () => { void rescan(); } }
            ]}
          />
        </div>
      </div>

      {/* ===== 中：搜索（自适应留白，居中；窄屏占满剩余空间） ===== */}
      <div className="flex items-center justify-center flex-1 min-w-0">
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-panel focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] flex-1 min-w-0 max-w-[440px] max-[820px]:max-w-none">
          <Icon name="search" size={16} className="flex-none text-muted" />
          <input
            type="search"
            id="search"
            className="min-w-0 flex-1 border-0 outline-none bg-transparent h-full [-webkit-search-cancel-button]:hidden"
            placeholder="搜索文件名、相机、镜头、标签…"
            aria-label="搜索作品"
            autoComplete="off"
            value={f.q}
            onChange={e => onSearchInput(e.target.value)}
          />
          {f.q ? (
            <button
              type="button"
              className="flex-none w-[18px] h-[18px] rounded-full border-0 bg-transparent text-muted cursor-pointer inline-flex items-center justify-center hover:bg-hov hover:text-fg"
              aria-label="清除搜索"
              onClick={() => { onSearchInput(''); document.getElementById('search')?.focus(); }}
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {/* ===== 右：工具按钮组（全部靠右，垂直居中） ===== */}
      <div className="flex items-center gap-2 flex-none justify-end">
        {/* ③ 类型筛选 */}
        <div className="flex border border-line rounded-lg overflow-hidden flex-none" id="kindChips" role="group" aria-label="作品类型">
          {KINDS.map(([k, label, icon]) => {
            const active = f.kind === k;
            return (
              <button
                key={k}
                type="button"
                className={cx(
                  'flex items-center justify-center gap-1.5 h-[30px] px-2.5 border-0 cursor-pointer border-r border-line last:border-r-0 max-[1180px]:px-[7px]',
                  active
                    ? (k === 'like'
                        ? 'bg-soft text-[#ff5b74] font-semibold'
                        : 'bg-soft text-accent font-semibold')
                    : 'bg-panel text-muted hover:bg-hov'
                )}
                data-kind={k}
                aria-pressed={active}
                title={k === 'like' ? '单独查看已标记喜欢的作品' : `只看${label}`}
                onClick={() => setKind(k)}
              >
                <Icon name={icon} size={14} filled={k === 'like' && active} className="flex-none" />
                <span className="text-[13px] max-[1180px]:hidden">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="w-px h-[22px] bg-line flex-none max-[980px]:!hidden"></div>

        {/* ④ 视图与排序（常用，收拢为下拉） */}
        <DropdownMenu
          id="btnViewMenu"
          ariaLabel="视图与排序"
          align="right"
          menuWidth={216}
          triggerCls={cx(btnCls(), 'max-[980px]:!hidden')}
          trigger={<><Icon name="sliders" size={16} className="flex-none" /><span>视图</span></>}
          showChevron
          items={buildViewItems(false)}
        />

        {/* ⑤ 常用操作 */}
        <button
          className={btnCls({ on: state.selectMode, desktopOnly: true })}
          id="btnSelect"
          disabled={!hasItems}
          title={state.selectMode ? '退出批量操作' : '批量操作：多选后统一添加 / 移除 / 替换标签'}
          aria-pressed={state.selectMode}
          onClick={() => setSelectMode(!state.selectMode)}
        >
          <Icon name="checkSquare" size={16} className="flex-none" />
          <span>批量</span>
        </button>
        <button
          className={btnCls({ on: state.trashMode, desktopOnly: true })}
          id="btnTrash"
          title={state.trashMode ? '返回图库' : '查看废纸篓：批量查看、恢复或彻底删除（喜欢的图片不可删除）'}
          aria-pressed={state.trashMode}
          disabled={!nTrash && !state.trashMode}
          onClick={() => setTrashMode(!state.trashMode)}
        >
          <Icon name="trash" size={16} className="flex-none" />
          <span>废纸篓</span>
          <span
            className="inline-block ml-0.5 px-1.5 min-w-[18px] h-[18px] leading-[18px] text-center rounded-full bg-accent text-white text-[11px] tabular-nums"
            id="trashCount"
            hidden={!nTrash}
          >{nTrash ? String(nTrash) : ''}</span>
        </button>

        {/* 窄屏：打开筛选抽屉（核心筛选能力在窄屏的唯一入口） */}
        <button
          className={btnCls({ icon: true, on: nFacet > 0, mobileOnly: true })}
          id="btnFilter"
          title="作品筛选"
          onClick={() => setDrawerOpen(true)}
        >
          <Icon name="filter" size={16} />
        </button>

        {/* 主题切换（高频） */}
        <button
          className={btnCls({ icon: true, desktopOnly: true })}
          id="btnTheme"
          title={state.theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          aria-label={state.theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          onClick={toggleTheme}
        >
          <Icon name={state.theme === 'light' ? 'moon' : 'sun'} size={16} />
        </button>

        {/* ⑥ 更多：低频动作 + 窄屏兜底 */}
        <DropdownMenu
          id="btnMore"
          ariaLabel="更多功能"
          title="更多功能"
          align="right"
          menuWidth={224}
          triggerCls={btnCls({ icon: true })}
          trigger={<Icon name="more" size={16} />}
          items={moreItems}
        />
      </div>
    </header>
  );
}

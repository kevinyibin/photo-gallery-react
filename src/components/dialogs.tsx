/**
 * 弹窗内容组件 —— 配合 antd Modal（ModalHost）使用。
 * 原版弹窗主体是 HTML 字符串模板（dangerouslySetInnerHTML），
 * 本次重构改为受控 React 组件：
 * - 输入读取不再 querySelector DOM，改用受控 state + api 引用对象；
 * - 校验失败在输入框内联展示错误（antd Input status + 红字提示），
 *   不再只是状态栏一闪而过的文案。
 *
 * api 约定：调用方（core/modal 流程）创建 { current: null } 引用对象传入，
 * 组件每次渲染把自己的读写接口写入 api.current，onOk 里即可读取 / 触发错误展示。
 */
import { useEffect, useState } from 'react';
import { Input, Checkbox } from 'antd';
import { cx, hintCls } from '../ui/kit';
import Icon from '../ui/Icon';
import {
  facetOrder, hiddenFacets, reorderFacet, moveFacet, toggleFacetHidden, resetFacetGroups,
  facetLabel, type FacetGroup
} from '../core/facetPrefs';

/* ============================ 文本输入（标签等） ============================ */

export interface TextInputAPI {
  /** 读取当前输入：手输文本 + 点选的建议项 */
  get: () => { text: string; chosen: string[] };
  /** 展示内联校验错误（输入框红框 + 提示文案） */
  setErr: (msg: string) => void;
  /** 清除校验错误 */
  clearErr: () => void;
}

export function TextInputDialog(props: {
  api: { current: TextInputAPI | null };
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  /** 可点选回填的已有标签建议 */
  suggestions?: string[];
  /** 在输入框内按回车 = 触发确定（由 core/modal 的 submitModal 接管） */
  onSubmit?: () => void;
}) {
  const [text, setText] = useState(props.initial || '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  props.api.current = {
    get: () => ({ text, chosen }),
    setErr: (m: string) => setErr(m),
    clearErr: () => setErr(null)
  };

  const toggleSug = (t: string) => {
    setChosen(prev => {
      const next = prev.indexOf(t) >= 0 ? prev.filter(x => x !== t) : prev.concat([t]);
      // 建议项与手输文本合并回填（解析时自动去重），避免原版「点建议覆盖手输内容」的丢失
      setText(cur => {
        const parts = cur.split(/[,，;；\s]+/).filter(Boolean).filter(x => x !== t);
        return (prev.indexOf(t) >= 0 ? parts : parts.concat([t])).join(' ');
      });
      return next;
    });
    setErr(null);
  };

  return (
    <>
      <Input
        status={err ? 'error' : undefined}
        placeholder={props.placeholder}
        maxLength={props.maxLength || 60}
        value={text}
        autoComplete="off"
        autoFocus
        onChange={e => { setText(e.target.value); setErr(null); }}
        onPressEnter={() => { if (!err) props.onSubmit?.(); }}
      />
      {err ? <div className="mt-1.5 text-xs text-[#e5534b]">{err}</div> : null}
      {props.suggestions && props.suggestions.length ? (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {props.suggestions.map(t => (
            <span
              key={t}
              className={cx(
                'px-[9px] py-[3px] rounded-full cursor-pointer border text-xs select-none transition-colors duration-150',
                chosen.indexOf(t) >= 0
                  ? 'bg-accent border-accent text-white'
                  : 'border-line bg-panel hover:border-accent hover:text-accent'
              )}
              onClick={() => toggleSug(t)}
            >{t}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ============================ 确认文案 ============================ */

export function ConfirmText({ children }: { children: React.ReactNode }) {
  return <p className={hintCls}>{children}</p>;
}

/* ============================ 失败清单 ============================ */

export function FailList({ list }: { list: { name: string; why?: string }[] }) {
  return (
    <>
      {/* scroller：与主区共用滚动条样式（深色主题下不会再出现浅色原生滚动条） */}
      <ul className="scroller list-none m-0 p-0 max-h-[46vh] overflow-auto">
        {list.slice(0, 40).map((f, i) => (
          <li key={i} className="flex gap-2.5 items-baseline py-1.5 border-b border-dashed border-line2 text-[12.5px]">
            <b className="font-semibold break-all">{f.name}</b>
            <span className="text-muted flex-none">{f.why || '未知原因'}</span>
          </li>
        ))}
      </ul>
      {list.length > 40 ? <p className={cx(hintCls, 'mt-2.5')}>仅显示前 40 项，共 {list.length} 项</p> : null}
    </>
  );
}

/* ============================ 设置 ============================ */

export interface SettingsAPI {
  get: () => { colorChecked: boolean };
}

export function SettingsDialog(props: {
  api: { current: SettingsAPI | null };
  colorEnabled: boolean;
}) {
  const [colorChecked, setColorChecked] = useState(props.colorEnabled);
  props.api.current = { get: () => ({ colorChecked }) };

  /* ---- 侧栏筛选维度：顺序 + 显隐 ----
     真源在全局 state（facetPrefs），这里的 order / hidden 只是镜像，
     用于让列表立即反映变更；每次操作都先写全局 + 落库，再用全局值回填本地，
     两边永不发散。弹窗关掉重开（destroyOnClose）即重新从持久化状态读取。 */
  const [order, setOrder] = useState<FacetGroup[]>(() => facetOrder());
  const [hidden, setHidden] = useState<Set<FacetGroup>>(() => hiddenFacets());
  const [dragKey, setDragKey] = useState<FacetGroup | null>(null);
  const [overKey, setOverKey] = useState<FacetGroup | null>(null);
  const syncFromStore = () => { setOrder(facetOrder()); setHidden(hiddenFacets()); };

  const onDrop = (target: FacetGroup) => {
    if (dragKey && dragKey !== target) { reorderFacet(dragKey, target); syncFromStore(); }
    setDragKey(null); setOverKey(null);
  };

  return (
    /* 弹窗主体统一一个滚动容器：维度列表 + 快捷键说明一起滚，
       避免「内层列表在滚、外层被裁掉」的双滚动条。 */
    <div className="scroller max-h-[62vh] overflow-y-auto pr-1 -mr-1">
      <label className="flex items-center gap-2 cursor-pointer text-sm mb-1.5">
        <Checkbox checked={colorChecked} onChange={e => setColorChecked(e.target.checked)} />
        <span>启用图片色调分析</span>
      </label>
      <p className={hintCls}>
        默认关闭。开启后将在后台提取照片主色调，用于侧栏「主色调」筛选与详情页色卡；结果会缓存，同一目录无需重算。
      </p>

      {/* ===== 侧栏筛选维度：排序 + 显隐（任何改动立即生效并落库） ===== */}
      <div className="mt-3">
        <div className="flex items-center gap-2 mb-1.5">
          <b className="text-[13px] font-[650]">侧栏筛选维度</b>
          <button
            type="button"
            className="ml-auto border-0 bg-transparent text-accent cursor-pointer text-[11px] py-0.5 px-1 rounded hover:bg-soft"
            onClick={() => { resetFacetGroups(); syncFromStore(); }}
          >恢复默认</button>
        </div>
        <ul
          className="scroller list-none m-0 p-0 rounded-lg border border-line overflow-hidden"
          aria-label="侧栏筛选维度的顺序与显隐"
        >
          {order.map(k => {
            const hid = hidden.has(k);
            const label = facetLabel(k);
            const dragging = dragKey === k;
            const over = overKey === k && dragKey !== k;
            return (
              <li
                key={k}
                draggable
                onDragStart={() => setDragKey(k)}
                onDragOver={e => { e.preventDefault(); setOverKey(k); }}
                onDragLeave={() => setOverKey(cur => (cur === k ? null : cur))}
                onDrop={e => { e.preventDefault(); onDrop(k); }}
                onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                className={cx(
                  'group flex items-center gap-1.5 h-9 pl-0.5 pr-1.5 border-b border-line2 last:border-b-0 select-none transition-colors duration-100',
                  dragging ? 'opacity-40 bg-soft' : hid ? 'bg-transparent' : 'bg-panel',
                  over ? 'bg-soft [box-shadow:inset_0_2px_0_var(--accent)]' : 'hover:bg-hov'
                )}
              >
                <button
                  type="button"
                  className="flex-none w-5 h-7 inline-flex items-center justify-center border-0 bg-transparent text-muted cursor-grab active:cursor-grabbing rounded focus-visible:outline-2 focus-visible:outline-accent"
                  title="拖动调整顺序，或聚焦后按 ↑ / ↓"
                  aria-label={`调整「${label}」的顺序：拖动，或用上下方向键`}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); moveFacet(k, -1); syncFromStore(); }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); moveFacet(k, 1); syncFromStore(); }
                  }}
                >
                  <Icon name="grip" size={13} />
                </button>
                <span className={cx('flex-1 min-w-0 truncate text-[13px]', hid ? 'text-muted line-through' : 'text-fg')}>
                  {label}
                </span>
                <button
                  type="button"
                  className="flex-none w-6 h-6 inline-flex items-center justify-center border-0 rounded cursor-pointer bg-transparent text-muted hover:bg-hov hover:text-fg"
                  aria-pressed={!hid}
                  title={hid ? '在侧栏显示该维度' : '在侧栏隐藏该维度'}
                  aria-label={`${hid ? '显示' : '隐藏'}「${label}」`}
                  onClick={() => { toggleFacetHidden(k); syncFromStore(); }}
                >
                  <Icon name={hid ? 'eyeOff' : 'eye'} size={13} />
                </button>
              </li>
            );
          })}
        </ul>
        <p className={cx(hintCls, 'mt-1.5 mb-0')}>
          拖动或用方向键调整顺序，眼睛图标控制显隐。改动立即生效并记住，刷新页面后保持不变。
          隐藏维度不会清除它在筛选里已选中的条件（仍可用顶部「清除筛选」一并清掉）。
        </p>
      </div>

      <div className="mt-3 px-3 py-2.5 rounded-lg bg-panel2 border border-line text-xs text-muted leading-[1.9]">
        <b className="text-fg">快捷键</b>
        <br />← → 切换 · 滚轮缩放 · 空格 幻灯片 · Esc 返回
        <br /><b className="text-fg">L</b> 标记喜欢（喜欢的图片受保护，不可删除；索尼照片会把同名 ARW 原件移入「精选RAW」文件夹）
        <br /><b className="text-fg">D / Delete</b> 移入废纸篓；废纸篓内为彻底删除（索尼照片会联动同名 ARW）
        <br /><b className="text-fg">I</b> 显示 / 隐藏右侧详细信息
        <br />多图对比（2 / 4 / 9 图）下按 <b className="text-fg">数字键 1-9</b> 标记对应位置的图片为喜欢
        <br />R 顺时针旋转 90° · F 全屏
        <br />评分仅支持鼠标点击星级控件，不再占用数字键
      </div>
    </div>
  );
}

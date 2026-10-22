/**
 * 通用弹窗 + 标签相关弹窗流程 + 设置弹窗。
 * 本次重构：
 * - 弹窗壳由自研组件换成 antd Modal（ModalHost 渲染），焦点管理 / ESC /
 *   滚动锁定 / 无障碍交给成熟组件库；
 * - 弹窗主体由 HTML 字符串模板（dangerouslySetInnerHTML + querySelector
 *   读输入）改为受控 React 组件（components/dialogs.tsx），onOk 返回
 *   false 可阻止关闭并展示内联校验错误；
 * - 校验失败 / 批量操作进度等关键反馈统一走 antd message（core/feedback）。
 */
import type { ReactNode } from 'react';
import { state, notify, setLeft } from './store';
import { toast } from './feedback';
import { sigOf } from './utils';
import {
  addTags, removeTags, replaceTags, parseTags, normalizeTag,
  allTagCounts, renameTagEverywhere, deleteTagEverywhere,
  setMetaBulk, flushMetaBulk
} from './meta';
import { ratingOf } from './ratings';
import { TextInputDialog, ConfirmText, FailList, SettingsDialog, TextInputAPI, SettingsAPI } from '../components/dialogs';
import type { MediaItem, ModalConfig } from './types';

/* refresh / 网格同步由 engine 注入 */
let refreshRef: () => void = () => {};
export function bindModalRefresh(fn: () => void) { refreshRef = fn; }

export function nextFrame(): Promise<void> { return new Promise(r => requestAnimationFrame(() => r())); }

export function openModal(opt: ModalConfig) {
  state.modal = opt;
  notify('modal');
}

export function closeModal() {
  state.modal = null;
  notify('modal');
}

/** 确定 / 回车提交：onOk 返回 false 表示校验未通过，弹窗保持打开 */
export function submitModal() {
  const cfg = state.modal;
  if (!cfg) return;
  const r = cfg.onOk ? cfg.onOk() : undefined;
  if (r !== false) closeModal();
}

export function showFailList(title: string, list: { name: string; why?: string }[]) {
  openModal({
    title,
    content: <FailList list={list} />,
    cancelText: '关闭',
    okText: null
  });
}

/* ============================ 标签：全局改名 / 删除 ============================ */
export function askRenameTag(t: string) {
  const api: { current: TextInputAPI | null } = { current: null };
  openModal({
    title: '重命名标签',
    content: (
      <>
        <ConfirmText>所有图片上的「{t}」都会改成新名称</ConfirmText>
        <TextInputDialog api={api} initial={t} maxLength={24} onSubmit={submitModal} />
      </>
    ),
    okText: '重命名',
    onOk: () => {
      const v = normalizeTag(api.current ? api.current.get().text : '');
      if (!v) {
        api.current?.setErr('标签名不能为空');
        toast.warning('标签名不能为空');
        return false;
      }
      if (v === t) return true;
      const r = renameTagEverywhere(t, v);
      refreshRef();
      setLeft(`已把 ${r.ok} 张图片上的「${t}」重命名为「${v}」`);
      return true;
    }
  });
}

export function askDeleteTag(t: string) {
  const n = allTagCounts().get(t) || 0;
  openModal({
    title: '删除标签',
    content: <ConfirmText>将从 {n} 张图片上移除标签「{t}」，此操作不可撤销。</ConfirmText>,
    okText: '删除标签',
    onOk: () => {
      const r = deleteTagEverywhere(t);
      refreshRef();
      setLeft(`已从 ${r.ok} 张图片上移除标签「${t}」`);
      return true;
    }
  });
}

/* ============================ 标签：单图添加（详情页） ============================ */
export function askAddTags(it: MediaItem, onDone: () => void) {
  const api: { current: TextInputAPI | null } = { current: null };
  openModal({
    title: '添加标签',
    content: (
      <>
        <ConfirmText>多个标签用空格或逗号分隔；点击已有标签可快速填入。</ConfirmText>
        <TextInputDialog
          api={api}
          placeholder="例如：人像 2024 旅行"
          suggestions={tagSuggestList(40)}
          onSubmit={submitModal}
        />
      </>
    ),
    okText: '添加',
    onOk: () => {
      const g = api.current ? api.current.get() : { text: '', chosen: [] };
      const tags = Array.from(new Set(g.chosen.concat(parseTags(g.text))));
      if (!tags.length) {
        api.current?.setErr('请输入或选择至少一个标签');
        toast.warning('请输入至少一个标签');
        return false;
      }
      const n = addTags(it, tags);
      onDone();
      setLeft(n ? `已添加标签「${tags.join('、')}」` : '这些标签已经存在');
      return true;
    }
  });
}

/* ============================ 批量标签：add / remove / replace ============================ */
export function askBatchTag(op: 'add' | 'remove' | 'replace', list: MediaItem[]) {
  if (!list.length) { setLeft('请先选择要操作的图片'); return; }
  if (state.busy) { toast.warning('正在处理上一批操作，请稍候'); return; }
  const api: { current: TextInputAPI | null } = { current: null };
  const title = (op === 'add' ? '添加标签' : op === 'remove' ? '移除标签' : '替换标签') + ` · ${list.length} 张`;
  const hint = op === 'add'
    ? '多个标签用空格或逗号分隔；也可直接点击下面的已有标签。'
    : op === 'remove'
      ? '选择或填写要移除的标签。'
      : '所选图片的现有标签会被这组标签覆盖。';
  openModal({
    title,
    content: (
      <>
        <ConfirmText>{hint}</ConfirmText>
        <TextInputDialog
          api={api}
          placeholder="标签名，空格分隔"
          suggestions={tagSuggestList(40)}
          onSubmit={submitModal}
        />
      </>
    ),
    okText: `应用到 ${list.length} 张`,
    onOk: () => {
      const g = api.current ? api.current.get() : { text: '', chosen: [] };
      const tags = Array.from(new Set(g.chosen.concat(parseTags(g.text))));
      if (!tags.length) {
        api.current?.setErr('请填写或选择至少一个标签');
        toast.warning('请填写或选择至少一个标签');
        return false;
      }
      runBatchTag(op, list, tags);
      return true;
    }
  });
}

async function runBatchTag(op: 'add' | 'remove' | 'replace', list: MediaItem[], tags: string[]) {
  const tKey = 'batch-tag';
  setMetaBulk(true);                // 暂停自动落库，改由分块统一提交
  state.busy = op;
  const verb = op === 'add' ? '添加' : op === 'remove' ? '移除' : '替换为';
  toast.loading(tKey, `正在${verb}标签「${tags.join('、')}」…`);
  const t0 = Date.now();
  const failed: { name: string; why: string }[] = [];
  let changed = 0, same = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    try {
      let n: number;
      if (op === 'add') n = addTags(it, tags);
      else if (op === 'remove') n = removeTags(it, tags);
      else { replaceTags(it, tags); n = 1; }
      if (n) changed++; else same++;
    } catch (e) {
      failed.push({ name: it.name, why: '处理异常' });
    }
    // 大批量时让出主线程，保持进度可读
    if (i % 400 === 399) { toast.updateLoading(tKey, `正在${verb} ${i + 1}/${list.length}…`); await nextFrame(); }
  }
  toast.updateLoading(tKey, `正在保存 ${list.length} 条标签记录…`);
  const res = await flushMetaBulk((done, total) => {
    if (done % 800 === 0 || done === total) toast.updateLoading(tKey, `正在保存 ${done}/${total}…`);
  });
  setMetaBulk(false);
  state.busy = null;
  if (res.failed && res.failed.size) {
    res.failed.forEach((why, sig) => {
      const hit = list.find(x => sigOf(x) === sig);
      failed.push({ name: hit ? hit.name : sig, why });
    });
  }
  refreshRef();
  const msg = `已${verb}标签「${tags.join('、')}」：更新 ${changed} 张` +
    (same ? `，${same} 张无变化` : '') +
    (failed.length ? `，${failed.length} 张失败` : '') +
    `（${((Date.now() - t0) / 1000).toFixed(1)}s）`;
  setLeft(msg);
  toast.finishLoading(tKey, failed.length ? 'warning' : 'success', failed.length ? `${msg}，详见弹窗清单` : msg);
  if (failed.length) showFailList(`${failed.length} 项未能保存`, failed);
}

/* ============================ 设置 ============================ */
/** 设置弹窗：色调分析开关（默认关闭）+ 快捷键说明 */
export function openSettings(setColorEnabled: (on: boolean) => void) {
  const api: { current: SettingsAPI | null } = { current: null };
  openModal({
    title: '设置',
    content: <SettingsDialog api={api} colorEnabled={state.colorEnabled} />,
    okText: '完成',
    onOk: () => {
      const on = !!(api.current && api.current.get().colorChecked);
      if (on !== state.colorEnabled) setColorEnabled(on);
      return true;
    }
  });
}

/** 标签建议列表（原 tagSuggestHtml 的数据源） */
function tagSuggestList(limit?: number): string[] {
  return Array.from(allTagCounts().keys())
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
    .slice(0, limit || 40);
}

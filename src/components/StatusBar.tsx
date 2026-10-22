/**
 * 底部状态栏 —— 左侧操作反馈，右侧当前视图统计（与原 updateStatus 一致）。
 */
import { state, useChannel } from '../core/store';
import { fmtSize } from '../core/utils';
import Icon from '../ui/Icon';

export default function StatusBar() {
  useChannel('status', 'grid');
  const n = state.view.length;
  let img = 0, vid = 0, size = 0;
  for (const it of state.view) {
    if (it.kind === 'image') img++; else vid++;
    size += it.size;
  }
  const parts: string[] = [];
  if (n) {
    parts.push(`当前 ${n} 项`);
    parts.push(`图片 ${img}`);
    parts.push(`视频 ${vid}`);
    parts.push(fmtSize(size));
  }
  if (state.filter.dir) parts.unshift('文件夹：' + (state.filter.dir || '/'));
  if (state.trashMode) parts.unshift('废纸篓');
  if (state.exifTotal && state.exifDone < state.exifTotal) parts.push(`EXIF 解析 ${state.exifDone}/${state.exifTotal}`);
  else if (state.colorEnabled && state.colorTotal && state.colorDone < state.colorTotal) parts.push(`色彩分析 ${state.colorDone}/${state.colorTotal}`);

  return (
    <footer className="h-[var(--status-h)] flex-none flex items-center gap-3.5 px-3.5 text-xs text-muted bg-panel border-t border-line tabular-nums overflow-hidden whitespace-nowrap">
      <span id="stLeft" className="min-w-0 overflow-hidden text-ellipsis flex-[0_1_auto]">{state.statusLeft}</span>
      <span className="flex-1"></span>
      <span id="stRight" className="min-w-0 overflow-hidden text-ellipsis flex-[0_1_auto] inline-flex items-center gap-1.5">
        {state.trashMode ? <Icon name="trash" size={12} className="flex-none" /> : null}
        {parts.join('  ·  ')}
      </span>
    </footer>
  );
}

/**
 * 批量操作条 —— 选择计数、标签批量增删替换、评分、废纸篓批量操作。
 * 废纸篓模式下用「恢复 / 彻底删除」替换标签与评分操作（与原版本一致）。
 */
import { state, useChannel } from '../core/store';
import { setRatingMany } from '../core/ratings';
import { askBatchTag } from '../core/modal';
import {
  selectedItems, setSelectMode, selectAllInView, clearSelection,
  applyBatchRating, batchTrash, batchRestore, batchPurge
} from '../core/library';
import { btnCls, lbBtnLightCls, cx } from '../ui/kit';
import Icon from '../ui/Icon';
import Stars from './Stars';

export default function BatchBar() {
  useChannel('batch', 'topbar');
  const n = state.selected.size;
  const tm = state.trashMode;
  const list = selectedItems();

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[70] flex items-center gap-2.5 px-3.5 py-2.5 bg-panel border-t border-line shadow-batch max-[900px]:flex-wrap max-[900px]:gap-1.5 max-[900px]:py-2 max-[900px]:px-2.5 max-[900px]:pb-[calc(8px+env(safe-area-inset-bottom))]"
      id="batchBar"
      hidden={!state.selectMode}
    >
      <span className="font-semibold tabular-nums" id="bbCount">已选 {n} 项</span>
      <span className="w-px h-5 bg-line mx-0.5 max-[900px]:hidden"></span>
      <span className="text-muted text-xs">标签</span>
      <button className={btnCls()} id="bbTagAdd" title="为选中的图片添加标签" hidden={tm} disabled={!n} onClick={() => askBatchTag('add', list)}>
        <Icon name="plus" size={15} className="flex-none" />添加
      </button>
      <button className={btnCls()} id="bbTagRemove" title="从选中的图片移除标签" hidden={tm} disabled={!n} onClick={() => askBatchTag('remove', list)}>
        <Icon name="x" size={15} className="flex-none" />移除
      </button>
      <button className={btnCls()} id="bbTagReplace" title="用指定标签替换选中图片的现有标签" hidden={tm} disabled={!n} onClick={() => askBatchTag('replace', list)}>
        <Icon name="repeat" size={15} className="flex-none" />替换
      </button>
      <span className="w-px h-5 bg-line mx-0.5 max-[900px]:hidden"></span>
      <button className={btnCls()} id="bbTrash" title="将选中图片移入废纸篓（喜欢的图片受保护，跳过）" hidden={tm} disabled={!n} onClick={batchTrash}>
        <Icon name="trash" size={15} className="flex-none" />移入废纸篓
      </button>
      <button className={btnCls()} id="bbRestore" title="将选中图片从废纸篓恢复" hidden={!tm} disabled={!n} onClick={batchRestore}>
        <Icon name="rotateCcw" size={15} className="flex-none" />恢复
      </button>
      <button className={btnCls({ danger: true })} id="bbPurge" title="彻底删除选中图片（喜欢的图片受保护，跳过）；此操作不可恢复" hidden={!tm} disabled={!n} onClick={batchPurge}>
        <Icon name="trash" size={15} className="flex-none" />彻底删除
      </button>
      <div className="flex items-center gap-2 opacity-[.72] hover:opacity-100 max-[900px]:w-full max-[900px]:order-3 max-[900px]:pt-0.5" id="bbMore" hidden={tm}>
        <span className="text-muted text-xs">评分</span>
        <BatchStars disabled={!n} />
        <button
          className={lbBtnLightCls()}
          id="bbUnset"
          disabled={!n}
          onClick={() => applyBatchRating(0)}
        >清除评分</button>
      </div>
      <span className="flex-1"></span>
      <button className={btnCls()} id="bbAll" onClick={selectAllInView}>全选当前筛选结果</button>
      <button className={btnCls()} id="bbNone" onClick={clearSelection}>清空选择</button>
      <button className={btnCls({ primary: true })} id="bbExit" onClick={() => setSelectMode(false)}>完成</button>
    </div>
  );
}

/** 批量评分星级：无选择时置灰 */
function BatchStars({ disabled }: { disabled: boolean }) {
  return (
    <Stars
      id="bbStars"
      className={cx('big', disabled && 'dim')}
      variant="light"
      value={0}
      onRate={v => { if (!disabled) applyBatchRating(v); }}
    />
  );
}

/**
 * 全局遮罩 —— 移动端抽屉遮罩、拖放导入遮罩、扫描进度遮罩。
 * 加载指示统一改用 antd Spin（组件库统一 loading 展示，令牌跟随主题主色）。
 */
import { Spin } from 'antd';
import { state, useChannel } from '../core/store';
import { setDrawerOpen } from '../core/engine';

export default function Overlays() {
  useChannel('overlay', 'sidebar');
  return (
    <>
      <div
        className="fixed inset-0 z-[57] bg-[rgba(10,14,20,.45)]"
        id="drawerMask"
        hidden={!state.drawerOpen}
        onClick={() => setDrawerOpen(false)}
      />

      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,15,25,.45)] backdrop-blur-[3px]" id="dropOverlay" hidden={!state.dropActive}>
        <div className="px-[60px] py-10 rounded-[20px] text-center bg-panel shadow-pop border-2 border-dashed border-accent">
          <svg viewBox="0 0 24 24" className="w-11 h-11 stroke-[1.5] text-accent fill-none stroke-current stroke-linecap-round stroke-linejoin-round mx-auto"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
          <div className="text-xl font-[650] mt-3">松手即开始扫描</div>
          <div className="text-muted mt-1.5 text-[13px]">支持一次拖入多个文件夹</div>
        </div>
      </div>

      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,15,25,.45)] backdrop-blur-[3px]" id="scan" hidden={!state.scanning}>
        <div className="px-11 py-[30px] rounded-2xl text-center bg-panel shadow-pop min-w-[280px]">
          <Spin size="large" />
          <div className="font-semibold mt-3.5">正在扫描本地目录…</div>
          <div className="text-muted text-[13px] mt-1.5 tabular-nums" id="scanSub">已发现 {state.scanCount} 个文件…</div>
        </div>
      </div>
    </>
  );
}

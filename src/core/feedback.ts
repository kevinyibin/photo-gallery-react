/**
 * 统一反馈层 —— 基于 antd message 的轻提示（成功 / 警告 / 错误 / 加载中）。
 *
 * 统一规则（本次重构约定）：
 * - 状态栏（setLeft）：承载常规操作结果与进度信息（原设计保留，不打扰）；
 * - toast：承载需要用户立刻注意的反馈 —— 校验错误、权限拒绝、存储失败、
 *   批量操作的进行中 / 完成提示等，替代原版「全部塞进状态栏」的做法；
 * - 所有 toast 由本模块统一出口，保证样式与位置一致（顶部居中，不遮挡底部批量条）。
 *
 * antd 的 message 实例经由 App.useApp() 注入（可感知 ConfigProvider 主题）；
 * 注入完成前回落到 antd 静态方法（仅发生在应用启动的极早期）。
 */
import { message } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

let api: MessageInstance | null = null;

/** 应用挂载时由 AntdProvider 注入主题感知的 message 实例 */
export function bindMessage(a: MessageInstance) { api = a; }

function inst(): MessageInstance { return api || message; }

export const toast = {
  success(content: string, duration = 2.5) { inst().success(content, duration); },
  error(content: string, duration = 3.5) { inst().error(content, duration); },
  warning(content: string, duration = 3) { inst().warning(content, duration); },
  info(content: string, duration = 2.5) { inst().info(content, duration); },

  /** 带 key 的持续型加载提示；用同一 key 更新内容或关闭 */
  loading(key: string, content: string) {
    inst().open({ key, type: 'loading', content, duration: 0 });
  },
  updateLoading(key: string, content: string) {
    inst().open({ key, type: 'loading', content, duration: 0 });
  },
  finishLoading(key: string, type: 'success' | 'error' | 'warning', content: string) {
    inst().open({ key, type, content, duration: 3 });
  },
  destroy(key?: string) {
    if (key) inst().destroy(key); else inst().destroy();
  }
};

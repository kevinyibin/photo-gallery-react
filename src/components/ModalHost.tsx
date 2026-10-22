/**
 * 弹窗宿主 —— 自研弹窗壳替换为 antd Modal。
 * 焦点管理、ESC 关闭、滚动锁定、动画与无障碍均由组件库负责；
 * 视觉上通过 ConfigProvider 令牌 + 样式覆盖对齐原版：
 * 卡片宽 420 / 圆角 14 / 面板底色 / 标题 15px 650 / 底部按钮右对齐。
 * 配置与流程仍由 core/modal 驱动（state.modal + 'modal' 频道）。
 */
import { Modal, Button } from 'antd';
import { state, useChannel } from '../core/store';
import { closeModal, submitModal } from '../core/modal';

export default function ModalHost() {
  useChannel('modal');
  const cfg = state.modal;

  if (!cfg) return null;

  return (
    <Modal
      open
      closable={false}
      title={cfg.title || ''}
      width={420}
      destroyOnClose
      maskClosable
      onCancel={closeModal}
      footer={
        <>
          <Button onClick={closeModal}>{cfg.cancelText || '取消'}</Button>
          {cfg.onOk ? (
            <Button type="primary" onClick={submitModal}>{cfg.okText || '确定'}</Button>
          ) : null}
        </>
      }
      styles={{ header: { marginBottom: 10, fontSize: 15, fontWeight: 650 } }}
    >
      <div className="text-[13px]">{cfg.content}</div>
    </Modal>
  );
}

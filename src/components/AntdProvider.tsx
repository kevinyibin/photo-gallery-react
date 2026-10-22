/**
 * antd 上下文容器 —— ConfigProvider（主题令牌，跟随应用明暗主题）+
 * App（为 message 提供主题感知的 React 上下文）。
 * 主题令牌按当前 state.theme 切换 light/dark 算法与主色，
 * 弹窗 / 输入框 / 按钮 / 提示的视觉与原版设计系统（圆角 8、主色 #3b6ef6）对齐。
 */
import { useEffect } from 'react';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { state, useChannel } from '../core/store';
import { bindMessage } from '../core/feedback';

/** 把上下文感知的 message 实例注入统一反馈层（core/feedback） */
function MessageBinder() {
  const { message } = AntdApp.useApp();
  useEffect(() => { bindMessage(message); }, [message]);
  return null;
}

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  useChannel('topbar');          // 主题切换后重渲染（toggleTheme 通知 topbar）
  const dark = state.theme === 'dark';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? '#5b8dff' : '#3b6ef6',
          borderRadius: 8,
          colorBgContainer: dark ? '#161a21' : '#ffffff',
          colorBgElevated: dark ? '#1b2028' : '#ffffff',
          colorText: dark ? '#e6e9ef' : '#171b21',
          colorBorder: dark ? '#262c36' : '#e3e7ec',
          colorBorderSecondary: dark ? '#1f2530' : '#eef1f5',
          boxShadowSecondary: '0 24px 70px rgba(10, 15, 30, .28)'
        },
        components: {
          Modal: {
            contentBg: dark ? '#161a21' : '#ffffff',
            headerBg: 'transparent',
            titleFontSize: 15,
            paddingContentHorizontal: 18,
            paddingContentVertical: 14
          },
          Button: { controlHeight: 32, fontWeight: 500 },
          Input: { controlHeight: 36 }
        }
      }}
    >
      <AntdApp>
        <MessageBinder />
        {children}
      </AntdApp>
    </ConfigProvider>
  );
}

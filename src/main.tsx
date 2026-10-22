/**
 * 应用入口 —— 挂载根组件并引入全局样式（Tailwind 基座 + 主题变量）。
 * antd 的 ConfigProvider / App 上下文由 AntdProvider 提供（主题跟随应用明暗切换）。
 * 不使用 React.StrictMode：其双重执行 effects 会触发两次扫描 / 入队，
 * 与原版本的单次初始化语义不符。
 */
import { createRoot } from 'react-dom/client';
import App from './App';
import AntdProvider from './components/AntdProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AntdProvider>
    <App />
  </AntdProvider>
);

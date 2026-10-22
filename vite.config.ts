import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 第三方框架与应用代码分包：组件库（antd）体积大且更新频率低，单独缓存。
        // 用函数形式而非对象形式：react / react-dom 是 CJS 包，对象形式的入口名匹配
        // 在 commonjs 转换后会失效（只会产出一个极小的 re-export 壳 chunk）。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(antd|@ant-design|rc-[^/]+)\//.test(id)) return 'antd';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
        }
      }
    }
  }
});

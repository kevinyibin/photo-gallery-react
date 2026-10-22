# 摄影作品集 · 本地照片浏览器（React 版）

由原生 JavaScript 版本完整迁移到 **React 18 + TypeScript + Vite** 技术栈，并在其基础上完成一轮**技术栈升级重构**：样式迁移到 **Tailwind CSS**（原子化）、通用组件替换为 **Ant Design 5**、数据流转重构到 **Zustand**。所有功能、页面 UI、交互行为和视觉效果与原版本保持一致。

纯前端应用：照片不离开本机，所有索引、评分、标签、EXIF 数据均存储在浏览器本地（IndexedDB + localStorage）。

---

## 一、环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 18（建议 20 LTS 及以上，开发实测 v24） |
| npm | ≥ 9（随 Node 自带即可） |
| 浏览器 | **Chromium 系**（Chrome / Edge / Arc 等最新版）。目录导入、文件句柄持久化依赖 File System Access API（`showDirectoryPicker` / `showOpenFilePicker`），Firefox / Safari 不支持该 API，只能用「选择文件」方式导入 |

无需任何后端服务与数据库。

## 二、安装与运行

```bash
# 1. 进入项目目录
cd photo-gallery-react

# 2. 安装依赖
npm install

# 3. 启动开发环境（默认 http://127.0.0.1:3000）
npm run dev

# 需要换端口时：
npm run dev -- --port 8080
```

## 三、构建与预览生产版本

```bash
# 构建生产版本（输出到 dist/，纯静态文件，可部署到任意静态服务器）
npm run build

# 本地预览构建产物（默认 http://127.0.0.1:4173）
npm run preview
```

其他命令：

```bash
# TypeScript 类型检查（不产出文件）
npm run typecheck
```

## 四、技术栈与依赖说明

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| react / react-dom | ^18.3 | 视图层 |
| vite + @vitejs/plugin-react | ^5.4 / ^4.3 | 构建与开发服务器 |
| typescript | ^5.6 | 类型系统 |
| **tailwindcss** (+ postcss / autoprefixer) | ^3.4 | **样式方案**：原子化工具类，主题令牌映射到 CSS 变量 |
| **antd** | ^5 | **组件库**：Modal / message / Spin / Button / Checkbox / Input |
| **zustand** | ^5 | **状态管理**：承载「可变 AppState + 频道版本号」的双域容器 |
| **exifr** | ^7.1 | EXIF / IPTC / XMP 元数据解析（社区成熟、维护活跃，替代原版手写的 PhoExif 最小解析器） |

原版的 `exif.js`（手写 JPEG/TIFF EXIF 解析器）以 `src/core/exifLite.ts` 保留，作为 exifr 的兜底：当 exifr 解析失败或文件为 WebP/PNG 等格式时自动回落，解析结果做与原版一致的取值范围校验。

> 三件替换的**具体方案与理由**见第九节。

## 五、目录结构

```
photo-gallery-react/
├── index.html              # 入口 HTML（DOM 骨架与原版一致）
├── vite.config.ts          # Vite 配置（dev 127.0.0.1:3000；react / antd 分包）
├── tailwind.config.js      # Tailwind 主题令牌（映射到 CSS 变量）、断点、阴影/动画
├── postcss.config.js       # tailwindcss + autoprefixer
├── src/
│   ├── main.tsx            # React 挂载入口（外层包裹 AntdProvider）
│   ├── index.css           # Tailwind 三层指令 + 主题变量 + 少量无法原子化的兜底样式
│   ├── App.tsx             # 根组件：组合所有面板，挂全局键盘/拖拽/Hash 监听
│   ├── ui/
│   │   ├── kit.ts          # ★ 原子化类名组合器（cx / btnCls / segCls / starCls …）
│   │   ├── Icon.tsx        # ★ 统一图标组件（全项目图标唯一来源，无表情符号）
│   │   └── Menu.tsx        # ★ headless 下拉菜单（完整 role=menu 与键盘导航）
│   │
│   ├── core/               # ★ 引擎层：零 React 依赖（feedback 例外，见下）
│   │   ├── types.ts        #   全部类型定义（Item / State / 节点 / 会话等）
│   │   ├── constants.ts    #   常量（DB 名、评分键、格式白名单、文案）
│   │   ├── store.ts        #   Zustand 容器：可变 state 域 + 频道版本号域
│   │   ├── feedback.ts     #   统一轻提示出口（toast），由 AntdProvider 注入实现
│   │   ├── utils.ts        #   格式化、防抖、路径处理等纯函数
│   │   ├── persist.ts      #   IndexedDB(lmb-media v2) / localStorage(lmb:*) 封装
│   │   ├── exif.ts         #   EXIF 编排：exifr 主解析 + 失败回落 + 缓存
│   │   ├── exifLite.ts     #   原版手写解析器移植（WebP/PNG/异常文件兜底）
│   │   ├── thumbs.ts       #   缩略图生成：createImageBitmap + LRU 缓存 + 并发队列
│   │   ├── library.tsx     #   入库/移除/废纸篓/清空/重扫描（弹窗体为 React 节点）
│   │   ├── scanner.ts      #   目录/文件扫描，格式识别，去重
│   │   ├── engine.ts       #   筛选引擎：搜索词、 faceted 过滤、排序
│   │   ├── view.ts         #   瀑布流布局计算（列数/坐标/分组头/滚动恢复）
│   │   ├── tree.ts         #   左侧目录树构建
│   │   ├── facets.ts       #   筛选面板（格式/日期/相机/镜头/标签…）聚合
│   │   ├── meta.ts         #   元信息面板数据组装
│   │   ├── colors.ts       #   色调分析（色相直方图 → 色卡筛选项）
│   │   ├── ratings.ts      #   星级评分 / 喜欢
│   │   ├── preview.ts      #   灯箱预览：缩放/平移/多图宫格/视频
│   │   ├── rawlink.ts      #   RAW+JPEG 关联配对
│   │   ├── session.ts      #   会话持久化：滚动位置、展开状态、当前项
│   │   ├── modal.tsx       #   弹窗状态机 + 表单弹窗（受控组件 + 内联校验）
│   │   └── extra.ts        #   新增动作：重新扫描 / 幻灯片 / 导出清单 / 整页全屏
│   │
│   └── components/         # ★ 视图层：只负责渲染与事件转发，不含业务逻辑
│       ├── AntdProvider.tsx  # ConfigProvider（主题跟随 state.theme）+ App.useApp()
│       ├── Topbar.tsx      #   顶栏：导入/搜索/排序/视图/主题/设置
│       ├── Sidebar.tsx     #   侧栏容器（目录树 + 筛选面板，窄屏为抽屉）
│       ├── TreePanel.tsx   #   目录树
│       ├── FacetPanel.tsx  #   筛选面板（含色卡）
│       ├── Gallery.tsx     #   瀑布流容器：虚拟化渲染、Alt+滚轮调尺寸
│       ├── Tile.tsx        #   单个瓦片（缩略图/角标/评分/选中态）
│       ├── Lightbox.tsx    #   灯箱：缩放平移、多图宫格、键盘导航
│       ├── MetaPanel.tsx   #   灯箱内 EXIF 元信息侧栏
│       ├── BatchBar.tsx    #   底部批量操作条
│       ├── ModalHost.tsx   #   弹窗宿主（antd Modal + 自定义 footer）
│       ├── dialogs.tsx     #   表单类弹窗内容：输入 / 确认 / 失败清单 / 设置
│       ├── Overlays.tsx    #   遮罩（扫描进度 Spin / 拖放提示 / 抽屉遮罩）
│       ├── Stars.tsx       #   星级小组件
│       └── StatusBar.tsx   #   状态栏
```

### 架构要点

- **单向数据流（Zustand 化）**：`core/store.ts` 用 Zustand 承载两个域——`state`（唯一可变 `AppState`，保留原版命令式写法）与 `ver`（各频道版本号）。模块修改 state 后调 `notify('频道名')`（只递增版本号），组件用 `useChannel('频道名')` 订阅。语义与重构前完全一致，但订阅走的是成熟的 `useSyncExternalStore` 实现，天然避免 tearing 与 Effect 时序问题。
- **引擎与视图解耦**：`core/` 不 import React（仅 `modal.tsx` / `library.tsx` 因弹窗内容为 React 节点而携带 JSX），算法层可独立测试；组件只读 state、调 core 函数。
- **模块间循环依赖**通过模块顶部的 `bindXxx()` 注入函数引用解决（如 `bindEngineActions`、`bindRefresh`），保持单向 import 图，无运行时循环。
- **样式原子化**：组件内直接写 Tailwind 类；重复出现的组合收敛到 `src/ui/kit.ts`。主题色一律走 `tailwind.config.js` 映射的 CSS 变量（`--bg` / `--panel` / `--fg` / `--accent` …），深色模式由 `[data-theme="dark"]` 选择器切换。
- **虚拟化渲染**：与原版一致的双缓冲策略——近区（视口 ±0.55 屏）立即渲染，远区（±1.4 屏）空闲预挂载，滚出缓冲区回收；滚动 8ms 分帧挂载，保证流畅。
- **注释**：各模块头部注明与原版 `app.js` 的对应段落，关键算法（瀑布流布局、LRU、色调分析）附实现说明，便于对照与后续迭代。

## 六、数据兼容性

与原版**完全共用同一份本地数据**，升级迁移无任何数据迁移成本：

- IndexedDB：库名 `lmb-media`，版本 2，表结构不变；
- localStorage：键前缀 `lmb:` 不变（评分、标签、会话、设置）；
- 若你之前用过原版，用 React 版打开同一浏览器配置，评分、标签、调色板、界面设置、上次会话全部原样恢复。

## 七、已知限制

- 目录导入与句柄持久化依赖 File System Access API，仅 Chromium 系浏览器可用；其他浏览器退化为「选择文件」导入（每次需重新选择）。
- 浏览器无法获取真实文件创建时间，「拍摄时间」优先取 EXIF，缺失时取文件修改时间（与原版行为一致）。

## 八、实测情况

**原生 → React 迁移**已实测通过：入库/状态栏统计/目录树、虚拟化渲染、缩略图解码与 LRU、灯箱（打开/hash 定位/元信息 13 行/导航/缩放/多图宫格/Esc 关闭）、星级评分、喜欢、批量全选与批量加标签、废纸篓（移入/计数/恢复/自动退出）、主题切换、设置弹窗、色调分析色卡、文件名显示开关、搜索过滤、刷新后会话与数据持久化恢复；DOM 结构指纹与原版逐项比对一致。

**技术栈升级重构**后的回归实测（`tsc --noEmit` 与 `vite build` 均通过，无头浏览器 DOM 断言）：

- 空状态与主按钮配色（曾出现 `bg-panel` 与 `bg-accent` 叠加导致的白底白字，已通过工具类互斥修复）；
- 入库 7 张测试图 → 瓦片渲染、状态栏统计、侧栏底部汇总；
- 筛选面板聚合：相机 / 镜头 / 焦距区间 / 拍摄年份；
- 灯箱：打开、计数、13 行 EXIF、4 星评分、喜欢标记（受保护提示）、2 图对比、Esc 关闭；
- 批量打标签弹窗：空提交校验（弹窗不关闭 + 内联红字 + `Input status="error"` + toast 同步）、正常提交后侧栏标签维度更新；
- 批量条：进入/退出、单选、全选、清空选择；批量移入废纸篓（含「已标记喜欢受保护跳过」提示）、废纸篓计数、批量恢复；
- 清空图库：计数归零、空状态出现、持久化记录清除；
- 主题切换与刷新后持久化恢复（主题 + 评分 KV 回填）；
- 移动端 390×844：侧栏变抽屉（关闭 x=-343 / 打开 x=0、点遮罩关闭）、resizer 隐藏、顶栏按钮按需收起、瓦片正常渲染；
- 搜索（"sony" → 2 项）。

因环境限制未逐项实测（代码路径与原版逐行对应，风险低）：目录选择器导入、拖拽导入、真实照片的 EXIF 解析、视频文件播放、幻灯片自动翻页、浏览器全屏。如发现问题请优先对照 `core/` 对应模块头部的原版段落定位。

## 九、技术栈升级：各部分替换的方案与理由

### 9.1 样式方案 → Tailwind CSS

**原状**：`src/styles.css` 是原版 967 行样式表的逐字节副本，`.tile` / `.f-row` / `.lb-btn` 等大量语义类名 + 全局层叠；改动一处样式需要在千行文件里定位，且无法看出组件真实依赖哪些属性。

**方案**：

1. `tailwind.config.js` 把原版设计令牌映射为 Tailwind 颜色（`bg` / `panel` / `panel2` / `fg` / `muted` / `line` / `accent` / `soft` / `tile` / `hov`，以及 `like` / `danger` / `star` 固定色），阴影（`card` / `pop` / `tileh` / `sidedrawer` / `metadrawer`）与动画（`shimmer` / `lbfade`）一并入库；
2. `darkMode: ['selector', '[data-theme="dark"]']` —— 与原版通过根元素属性切换主题的机制直接对齐，无需改动任何切主题的代码；
3. 组件内直接写原子类，重复出现的组合收敛为 `src/ui/kit.ts` 的组合器（`btnCls` / `segCls` / `selCls` / `lbBtnCls` / `starCls` / `hintCls`）；
4. `src/index.css` 只保留无法原子化的部分：Tailwind 三层指令、主题 CSS 变量、滚动条伪元素、`[hidden]` 兜底、窄屏用 `::before` 替换按钮文案的三条兼容 shim。

**理由**：

- 颜色/间距/圆角全部收敛到配置与组件本地，删掉一个组件不会再留下孤儿 CSS；
- 深色模式与断点（1320 / 1080 / 980 / 900 / 820px）由 Tailwind 的变体表达，原版散落在文件末尾的 `@media` 块变成组件内的 `max-[820px]:…`，读写都在一处；
- 产物 CSS 从 967 行手写表降到 33.5 kB（gzip 7.4 kB），且只含实际用到的类。

**踩过的坑（已修）**：同一元素上叠加**同类**工具类（如基础串 `bg-panel` + 变体 `bg-accent`）时，胜负由样式表顺序决定，曾导致主按钮白底白字。约定：**变体分支整体决定某一类属性，互不叠加**（见 `src/ui/kit.ts`），位移类（抽屉 `translate-x`）同理改为条件二选一。

### 9.2 通用组件 → Ant Design 5

**选择理由**：项目是 **React**，Element Plus / Ant Design Vue 是 Vue 生态，不适用；React 侧最成熟且主题可定制的是 Ant Design 5（CSS-in-JS、无全局样式表、与 Tailwind 不抢层叠），且其 `Modal` / `message` / `Spin` 正好覆盖本项目全部自研通用件。

| 自研件 | 替换为 | 说明 |
| --- | --- | --- |
| `components/Modal.tsx`（自研弹窗壳 + `innerHTML` 注入 body） | antd `Modal`（`components/ModalHost.tsx`） | 弹窗 body 改为 React 节点（`ModalConfig.body: string` → `content: ReactNode`），去掉字符串拼 HTML；`destroyOnClose` 保证每次打开都是干净状态 |
| 自研 `toast()`（手写 DOM 气泡） | antd `message`（`core/feedback.ts` + `AntdProvider` 注入 `App.useApp()`） | 提示跟随 antd 主题，深浅色自动适配；统一 `success/error/warning/info/loading/updateLoading/finishLoading/destroy` 出口 |
| `.spinner` 自绘旋转圈 | antd `Spin` | 扫描遮罩、批量处理进度 |
| 按钮 / 复选框 / 输入框 | antd `Button` / `Checkbox` / `Input` | 表单校验用 `Input status="error"` 内联呈现 |

**保持视觉不变的做法**：`ConfigProvider` 只喂 token（`colorPrimary` / `colorBgContainer` / `borderRadius` …）并跟随 `state.theme` 切 `darkAlgorithm` / `defaultAlgorithm`；弹窗宽度、圆角、按钮高度都与原版测量值对齐；`.ant-message { top: 66px }` 避免轻提示压住顶栏。

### 9.3 数据流转 → Zustand

**原状**：约 60 行自研「单一可变 state + 频道订阅」，用模块级 `Set<() => void>` 手写订阅、`useState + useEffect` 触发重渲染。

**方案**：`core/store.ts` 改为 Zustand `create` 出的**双域容器**：

```ts
export const useGalleryStore = create<{ state: AppState; ver: Record<Channel, number> }>()(() => ({ state, ver: { ...zeroVer } }));
export function notify(...channels: Channel[]) {           // 只递增版本号，不产生新 state 引用
  useGalleryStore.setState(prev => { const ver = { ...prev.ver }; for (const ch of channels) ver[ch]++; return { ver }; });
}
export function useChannel(...channels: Channel[]): number { // 组件侧订阅版本号之和
  return useGalleryStore(s => channels.reduce((a, c) => a + s.ver[c], 0));
}
```

`state` 域仍是可变对象（保留原版命令式写法，`core/` 全部业务代码零改动），`ver` 域只承载「哪些频道脏了」。

**理由**：

- 订阅机制交给 Zustand（内部 `useSyncExternalStore`），天然规避 tearing、订阅泄漏与 Effect 时序问题；
- 保留「可变 state + 频道广播」的原语义，因此**引擎层一行业务逻辑都不用改**，向后兼容性成本最低；
- `notify` 只更新 `ver`，不复制 `state`（上万张图的数组不会被浅拷贝），性能优于「不可变全量替换」的 Redux 范式。

### 9.4 全局状态与组件局部状态的边界

| 域 | 内容 | 存放位置 |
| --- | --- | --- |
| **全局**（Zustand `state`） | 图库数据 `items` / 视图 `view` / 节点与布局 `nodes`+`pos` / 筛选条件 / 排序 / 布局模式 / 灯箱状态 / 会话与持久化 / 遮罩与弹窗 | `core/store.ts` |
| **组件局部**（`useState` / `useRef`） | 灯箱缩放与拖动偏移、侧栏拖拽宽度、瓦片缩略图加载态、滚动位置与视口高度、弹窗输入与校验错误、元信息抽屉开合 | 各组件内部 |

判定标准：**是否需要跨组件共享、是否需要持久化**。只影响本组件测量与渲染窗口的一律留局部（例如 `Gallery` 的 `scrollTop`，若放进全局会让每次滚动都触发全局广播）。

### 9.5 交互与请求优化

- **统一轻提示**：所有成功 / 失败 / 受保护 / 校验提示走 `core/feedback.ts` 的 `toast`（含批量处理的 `loading → updateLoading → finishLoading` 进度），状态栏只保留常驻摘要（`setLeft`）；
- **表单校验反馈**：弹窗改为受控 React 组件，校验失败时**弹窗不关闭** + 输入框内联红字（`Input status="error"`）+ 错误文案就地展示 + toast 同步，取代原来「关掉弹窗再提示」的断裂感；`submitModal()` 的 `onOk` 返回 `false` 即阻止关闭；
- **减少重复请求**：① 窗口 resize 改走 `scheduleLayout()`（rAF 合帧），与侧栏 `ResizeObserver` 的重排请求合并，一次缩放只触发一轮重排；② `FacetPanel` 订阅从 `useChannel('facets','grid')` 收窄为 `useChannel('facets')`——筛选聚合不依赖布局，避免每次缩略图宽高回填都全量重算；③ 缩略图队列保留原有的 LRU + 并发 + 请求去重，并在滚动时用可见集合精确清理已滚出视口的请求（`pruneQueues`）；
- **构建分包**：`vite.config.ts` 用函数式 `manualChunks` 拆出 `react`（142 kB）与 `antd`（345 kB），业务代码 194 kB；用函数形式是因为 `react` / `react-dom` 是 CJS 包，对象形式的入口名匹配在 commonjs 转换后只产出一个极小的 re-export 壳 chunk。

### 9.6 向后兼容

- 频道名、频道粒度、`notify` / `useChannel` 签名完全不变，`core/` 业务模块**零改动**（仅 `modal.ts → .tsx`、`library.ts → .tsx` 因弹窗内容为 React 节点而换扩展名）；
- `ModalConfig` 的 `body: string` → `content: ReactNode`、`onOk` 返回值放宽为 `boolean | void`，是本次唯一的接口变更，调用点已全部同步；
- IndexedDB（`lmb-media` v2）与 localStorage（`lmb:*`）结构、键名完全不变，旧版本数据可直接恢复；
- 构建命令（`dev` / `build` / `preview` / `typecheck`）与产物形态不变。

## 十、顶栏与侧栏的信息架构

### 10.1 功能项归类

原顶栏有 16 个平级控件，按「使用频率 × 业务重要性」重新分层。**判定依据**：① 是否为完成主任务（导入 → 找图 → 查看）的必经步骤；② 单次会话内的操作频次；③ 误触代价（破坏性操作一律下沉）。

| 层级 | 功能项 | 位置 | 依据 |
| --- | --- | --- | --- |
| **核心高频** | 选择文件夹（导入主按钮） | 顶栏主区，primary | 应用入口，无图库则一切功能不可用 |
| | 搜索（文件名 / 相机 / 镜头 / 标签） | 顶栏主区，弹性宽度 | 找图的主要手段，几乎每次会话都会用 |
| | 类型（全部 / 照片 / 视频 / 喜欢） | 顶栏主区，分段 | 一键切换视图范围，高频且状态需要常驻可见 |
| | 批量选择、废纸篓 | 顶栏主区 | 整理类操作的入口，废纸篓还需常驻显示计数 |
| | 主题切换 | 顶栏主区 | 高频、零代价，且状态需要可见 |
| **常用** | 添加照片、重新扫描 | 「导入 ▾」下拉 | 与导入同族，但频次低于首次导入 |
| | 布局模式、排序、缩略图尺寸、显示文件名 | 「视图 ▾」下拉 | 都是「展示方式」，需要时可改、不常改；统一收进一个下拉后主区只留一个入口 |
| **低频** | 幻灯片播放、导出清单、整页全屏 | 「更多 ⋮」 | 场景性功能，非日常必需 |
| | 恢复上次浏览 | 「更多 ⋮」 | 仅在存在历史会话时有意义 |
| | 清空图库 | 「更多 ⋮」，danger 样式 | 破坏性操作，必须下沉并加视觉警示 |
| | 设置与快捷键 | 「更多 ⋮」 | 一次性配置 |

**新增的实用功能**（均落在「更多 ⋮」/「导入 ▾」中，不占主区）：

| 功能 | 实现 | 说明 |
| --- | --- | --- |
| 重新扫描文件夹 | `core/extra.ts → rescan()` | 复用已授权的目录句柄增量重扫，重复文件按签名去重；无句柄时引导改用「选择文件夹」 |
| 幻灯片播放 | `startSlideshow()` | 从当前视图首张开始自动播放，空格暂停 / Esc 退出 |
| 导出当前清单 | `exportViewCsv()` | 导出**当前筛选结果**为 CSV（含 EXIF、评分、标签、主色调），带 BOM 兼容 Excel |
| 整页全屏 | `toggleAppFullscreen()` | 与灯箱内 F 全屏互不干扰 |

### 10.2 最终布局

顶栏是三段式两端对齐（`justify-between`，整行 `items-center` 垂直居中）：
左端品牌 + 导入，中间搜索框自适应并居中（`max-w-440`，窄屏占满），右端工具按钮组整体靠右。

```
桌面（≥1181px）
┌─ 左（flex-none）─────────┬─ 中（flex-1，居中）─────────┬─ 右（flex-none，靠右）──────────────┐
│ [品牌] │ [选择文件夹 ▾]   │      [搜索 ………………]        │ [全部|照片|视频|喜欢] │ [视图 ▾] [批量] [废纸篓 n] [主题] [⋮] │
└──────────────────────────┴─────────────────────────────┴──────────────────────────────────────┘

≤1400  收起品牌文字（留 logo）
≤1180  类型分段只留图标
≤980   收起「视图 ▾」，其内容并入「更多 ⋮」
≤820   收起 批量 / 废纸篓 / 主题，改为「更多 ⋮」中的开关项；
        露出「筛选」抽屉按钮（≤820 侧栏变抽屉）
```

窄屏主区只剩 4 个控件：**筛选 · 导入 · 搜索 · 类型 · 更多**，实测顶栏单行 56px、`scrollWidth == clientWidth`（无溢出）。

**不丢功能的关键**：被折叠的控件在「更多」菜单里都有对应条目，且用两种断点标记避免桌面重复——`mobileOnly`（≤820px 出现）用于批量 / 废纸篓 / 主题，`narrowOnly`（≤980px 出现）用于视图项。因此 900px 这个「视图下拉已收起、桌面按钮还在」的区间也不会出现功能真空。

### 10.3 左侧筛选栏

| 维度 | 形态 | 说明 |
| --- | --- | --- |
| 评分 | 快捷 chips（全部 / 已评分 / 未评分）+ 星级 | 原为「更多筛选 > 下拉」，前置为独立维度；复用 `setRatingFilter`，语义完全一致 |
| 标签 | 可折叠列表 + 组合方式切换（含任一 / 同时含全部）+ 行内改名 / 删除 | 行内操作在 hover / focus 时显现 |
| 主色调 | 色卡 chips | 与色调分析结果联动 |
| 相机机身 / 镜头 / 焦距区间 / 拍摄年份 | 可折叠列表（焦距、年份为 chips） | 每个维度标题带「已选 N」徽标，标题栏可折叠、可在行内清除 |
| 目录树 | 独立标签页 | 顶部提供「全部折叠 / 展开」与「取消文件夹筛选」 |

- 每个维度的折叠状态是**组件局部 state**（不需要跨组件共享、不需要持久化）；
- **维度标题不带图标**，只保留折叠箭头。对齐基线统一为 24px：容器 `px-2`(8) + 条目缩进 `pl-4`(16) = 24；标题的箭头 12px + `gap-1`(4) 同样落在 24，因此「标题文字 / 列表条目文字 / chips 左边缘 / 空态文案」共用同一条左侧基线；
- 维度的**排列顺序与显隐由用户配置**（见 10.5），面板按配置渲染；
- 单维度超过 8 条时折叠为「展开全部 N 项」，避免长列表挤压其他维度；
- 顶部状态条显示 EXIF / 色调解析进度与已激活筛选数，可一键清除，并列出当前可见维度；底部保留库统计与评分分布。

### 10.4 图标与无障碍

- **`src/ui/Icon.tsx`**：全项目图标的唯一来源。24×24 viewBox、`stroke="currentColor"`、线宽 1.8、圆头圆角，因此颜色自动继承文字色，深浅主题无需额外适配；`filled` 用于实心态（喜欢、星级）。**全项目已无表情符号 / 符号字符**（原先的 🗑 ⚙ 🌙 ☀ ❤ ★ ✕ ▶ ⛶ 🔁 等全部替换），`index.css` 里那三条用 `::before` 注入 ▶/⛶/ℹ 字符的兼容 shim 也一并删除。
- **`src/ui/Menu.tsx`**：headless 下拉菜单，触发器带 `aria-haspopup="menu"` / `aria-expanded` / `aria-controls`，弹出层 `role="menu"`，条目为 `menuitem` / `menuitemradio` / `menuitemcheckbox`，分组标题 `role="presentation"`，分隔线 `role="separator"`。
- **键盘**：触发器上 ↓ 打开并聚焦首项；菜单内 ↓/↑ 循环、Home/End 跳首尾、Esc 关闭并回焦触发器、Tab 关闭；点击外部关闭。因断点隐藏的条目会被排除在可聚焦序列外（`offsetParent` 判断），键盘不会「走到看不见的项」。
- 分段控件用 `role="group"` + `aria-pressed`，筛选行同样带 `aria-pressed`，所有图标按钮都有 `aria-label` / `title`。

### 10.5 筛选维度的排序与显隐（可持久化）

七类维度（评分 / 标签 / 主色调 / 相机机身 / 镜头 / 焦距区间 / 拍摄年份）的**顺序与显隐**都可以在「顶栏 · 更多 · 设置与快捷键」里调整：

| 能力 | 交互 | 说明 |
| --- | --- | --- |
| 排序 | 拖动行首手柄，或聚焦手柄后按 ↑ / ↓ | 两种方式都会立即写回配置；`draggable` 落在整行 `<li>` 上（按钮自身拖动在部分浏览器里不触发） |
| 显隐 | 行尾眼睛按钮（`aria-pressed` 表示当前可见） | 隐藏项在列表中显示为灰色删除线，侧栏对应 Section 直接不挂载 |
| 恢复默认 | 区块右上角「恢复默认」 | 顺序回到出厂值、显隐全部放开 |

**数据流**（三层，单向）：

```
设置弹窗交互
   └─ core/facetPrefs（唯一写入口：改 state → notify('facets') → saveUI）
        ├─ state.facetOrder: FacetGroup[]   内存真源
        ├─ state.facetHidden: Set<FacetGroup>
        └─ persist.set(ST_KV, K_UI, {...})  落库
                ↓ 刷新 / 重开
        engine.boot() → persist.get → applyUI() → state 还原 → refresh() → notifyAll()
                ↓
        FacetPanel 按 facetOrder 渲染、跳过 facetHidden 中的项
```

**存储位置**：与其它 UI 偏好（主题、缩略图尺寸、布局…）共用同一条记录 —— 数据库 `lmb-media`(v2) 的 `kv` 存储、键 `ui`；IndexedDB 不可用时由 `persist` 自动降级到 `localStorage` 的 `lmb:kv`。写入的是 `facetOrder`（保序字符串数组）与 `facetHidden`（字符串数组，读回时还原成 `Set`）。

**读取容错**（`constants.ts` 的 `normalizeFacetOrder` / `normalizeFacetHidden`）：丢弃未知 key → 去重 → 把缺失的维度按出厂顺序补到末尾。因此老用户的旧配置（没有这两个字段）会直接得到出厂顺序；将来增删维度也不会渲染出空壳或丢项。

**一个刻意的取舍**：隐藏维度只影响渲染，**不会清除该维度已选中的筛选条件**（避免「隐藏一下顺序结果筛选被悄悄重置」）。残留条件仍可通过顶部「清除 N 项筛选」一并清掉，设置弹窗里也有对应提示。

---

## 十一、浏览界面 UI 修复与调整

保持既有功能与视觉风格不变的前提下，完成 5 项修复。

### 11.1 顶栏两端对齐

`Topbar.tsx` 的 `<header>` 改为 `flex items-center justify-between`，内部拆成三个区域：

| 区域 | 内容 | 布局 |
| --- | --- | --- |
| 左 | 品牌（logo + 文字）· 分隔线 · 导入组 | `flex-none min-w-0` |
| 中 | 搜索框 | `flex-1 min-w-0`，`justify-center`；搜索框 `flex-1 max-w-[440px]`（≤820 取消上限占满） |
| 右 | 类型分段 · 视图 · 批量 · 废纸篓 · 筛选 · 主题 · 更多 | `flex-none justify-end` |

实测（1440×900）：左区起点 = 12px、右区终点 = 1428px（正好是 `px-3` 的内缩），三个区中心线都与顶栏中心线重合；搜索框在中间区域内左右各留 38px（真正居中）。1440 / 1024 / 900 / 390 四档 `scrollWidth == clientWidth`，「更多」按钮右边缘恒为 `innerWidth - 12`。

### 11.2 滚动条样式统一

新增共用类 `.scroller`（`src/index.css`），瀑布流主区 `#scrollEl`、筛选面板 `#facets`、目录树 `#tree` 三处同时挂上：

- 宽度 / 高度 10px，圆角 6px，`border: 3px solid transparent` + `background-clip: content-box`（视觉宽度 4px，隐藏时只改背景色，**不引起内容回流**）；
- 轨道统一 `transparent`，滑块默认 `transparent`、滚动或悬停时 `--sb-thumb`、滑块自身 hover 时 `--sb-thumb-hover`；
- **深色主题单独配色**：不能沿用 `--border`（`#262c36` 叠在 `--bg #0e1116` 上对比度仅 ~1.35，几乎不可见）。深浅各定义一组令牌——浅色沿用原 `--border` / `--muted` 取值（观感完全不变），深色改用半透明白 `rgba(255,255,255,.24)` / `.42`，无论背景是 `--bg`、`--panel` 还是弹出层 `#1b2028` 都保持可见；
- `color-scheme` 跟随主题（`light` / `dark`），未被 `.scroller` 覆盖的滚动区（antd 弹窗内部、原生 `select` 等）不会再出现浅色原生滚动条；
- Firefox 用 `scrollbar-width: thin` + `scrollbar-color` 同步令牌；灯箱信息面板 `.lb-meta` 是恒定深色语境，单独一套不随主题切换。
- **仅在滚动时显示**：`src/ui/useScrollReveal.ts` 在滚动开始时给容器加 `is-scrolling`、停止 800ms 后移除（直接操作 classList，不走 React state，避免滚动时重渲染；这些容器的 className 是常量，不会被 React 覆盖）。指针悬停在区域内时也显示滑块，保证可抓取。

实测：`#scrollEl` 与 `#facets` 均满足「静止 false → 滚动中 true → 停手后 false」。

深色主题实测（1100×600 视口，滑块强制常显后取像素）：滑块区域 `rgb(52,54,57)`–`rgb(71,73,77)`，背景 `rgb(10,12,16)`，对比度约 **2.10**（修复前 `--border` 方案约 **1.35**）；浅色主题滑块仍为 `rgb(227,231,236)`，与原设计一致。

### 11.3 灯箱移除「下载 / 复制」

按需求删除两个功能入口，且不残留任何空占位与引用：

- `Lightbox.tsx`：删除 `lbDown` / `lbCopy` 两个按钮及对应 import；
- `core/preview.ts`：删除 `downloadCurrent()` / `copyCurrentPath()` 实现；
- `App.tsx`：删除 `s` / `c` 两个全局键盘绑定；
- 文案同步：`dialogs.tsx` 快捷键由「R 旋转 · S 保存 · C 复制路径 · F 全屏」改为「R 顺时针旋转 90° · F 全屏」；`Gallery.tsx` 空状态操作提示同步去掉「S 保存」。
- 相邻分隔线仍由「旋转」与「全屏」两侧使用，未出现空白占位。

实测：灯箱打开后 `#lbDown` / `#lbCopy` 均为 `null`，控制台无报错。

### 11.4 旋转修复

- **方向一致**：改用 `rotateCw` 图标 + `setRot(r => (r + 90) % 360)`，图标语义与实际旋转方向（顺时针）一致；用状态更新函数而非闭包值，连续点击角度严格为 90 → 180 → 270 → 0。
- **外接框不裁切**：旋转 90°/270° 时按「外接框宽高互换」限制渲染尺寸——未旋转框宽 ≤ 舞台高、高 ≤ 舞台宽 ⇒ 旋转后的外接框必落在舞台内；舞台几何取不到时回退实时 `clientWidth` / 视口，避免首帧用空值导致溢出。
- **居中**：舞台与内容都是 flex 居中 + `transform-origin: center`，旋转不改变中心点；低清铺底图使用同一套约束与旋转角，与高清图完全重合。
- 舞台几何在 `rot` / `lbLayout` 变化后重新测量，避免用到过期尺寸。

实测（舞台 1104×848，1600×1000 横图）：四次旋转外接框依次 1104×690 → 530×848 → 1104×690 → 530×848，全部 `inside = true`，中心偏移 0px。

### 11.5 缩放三按钮统一

`lbBtnCls()` 新增 `icon` 变体：`w-[30px] px-0 justify-center`（内边距由分支独占，不与基础串的 `px-[9px]` 叠加）。放大 / 缩小 / 重置三个按钮统一使用该变体，图标全部换成 `Icon` 组件（原先是 `−` / `+` / `⤢` 三个字形，视觉大小与基线各不相同），尺寸统一 16px；「重置」新增 `frame` 图标（四角括弧 + 中心画面，与全屏图标区分）。中间的百分比标签用 `min-w-[46px]` 固定占位，缩放时按钮不左右跳动。

实测：四个图标按钮（含旁边的旋转）全部为 30×30、圆角 7px、`padding 0`、图标 16×16、图标到四边距离均为 7px，按钮之间间距恒为 4px；缩放功能 100% → 125% → 156% → 125% → 100% 正常。

### 11.6 验证结论

`tsc --noEmit` 与 `vite build` 均通过（react 142kB / antd 345kB / app 213kB）；`src/` 内已无 `downloadCurrent` / `copyCurrentPath` / `lbDown` / `lbCopy` / 「S 保存」等残留引用；浏览器实测全程 `console` 无 error / warn、无未捕获异常与 Promise 拒绝。

---

## 十二、鼠标交互：单击直达大图 + 右键就地操作

### 12.1 左键：单击一张作品 = 直接进入大图

单击走 `Tile.onClick → openPreview(state.view.indexOf(it))`，只有一条路径，没有「先选中再打开」的中间态；批量模式下单击改为勾选（避免误跳转，这是唯一例外，右键菜单里的「打开大图」可绕过）。

为了让它**看起来**也是零等待，补了两处：

| 优化 | 位置 | 说明 |
| --- | --- | --- |
| 悬停预热原图 | `core/preview.warmPreview`，由 `Tile` 的 `pointerenter` 触发（延迟 120ms） | 建 ObjectURL + `new Image()` + `decode()`。指针停留才预热，快速划过不会白建几十个 URL；预热队列只保留最近 12 张，超出丢弃 `_pre` 引用控内存 |
| 打开前先备好 src | `openPreview` 内先 `warmPreview(it)` 再 `notify` | 大图首帧就有 `src`，不再出现「先空白 → 180ms 淡入」；`preloadAround` 复用同一标记，不会重复解码 |

实测：指针悬停后 `{hasUrl:true, hasPre:true, decoded:true}`；单击到 `lbOpen=true, imgLoaded=true` 约 370ms（含 350ms 的脚本等待，实际由事件驱动）。

#### 12.1.1 「点了没反应」的三条真实成因（已修）

反馈「单击不开大图」后按真实文件复测，定位到三个都能让点击**静默失效**的问题：

| # | 成因 | 表现 | 修法 |
| --- | --- | --- | --- |
| 1 | `openPreview` 里把 `warmPreview` / `preloadAround` 放在 `notify` **之前** | 只要目标或邻近某张图的 `file` 不可用（文件夹权限失效、文件被移动删除、数据异常），`URL.createObjectURL` 一抛异常就打断整个函数 → 状态已改但**从未通知渲染**，看起来就是「点了没反应」 | 先 `markCurrent` + `notify` 让大图出来，再做预热/预加载；两者内部逐项 `try/catch`，且预热前判 `file instanceof Blob` |
| 2 | 大图组件在**渲染期**直接 `URL.createObjectURL`（单图 / 多图宫格 / 视频三处） | 没有错误边界，一次抛错 React 会卸载整棵树 → 白屏 | 抽出 `safeUrl()`：失败返回 `null`，单图降级为「本地文件已不可用 + 返回图库」，宫格降级为「这一张无法读取」 |
| 3 | 打开大图同时 pushState 两次（pointerup 与 click 都会触发），或拖动经过卡片松手 | 前者要多按一次返回才退出，后者「划着划着就被打开」 | `openPreview` 幂等（同序号不重复 pushState）；卡片用 `pointerup + click` 双保险并以 8px / 700ms 阈值区分点击与拖动 |

现在的判定：单击 = 立即打开；双击 = 打开且只写一条历史；按住拖动超过 8px 或超过 700ms = 不打开；目标图损坏 = 打开并给出可读的降级提示（不再白屏）。四条均有脚本实测覆盖（真实 900×600 JPEG 走 `#fileInput` 入库 → 点击 → 校验 `lbOpen / previewIndex / history.length / console 异常`）。

顺带修掉一个先决问题：`refresh()` 里的 `layout()` 在 `notify` 之前执行，此时 `#grid` 还是 `display:none`，量到宽度 0 直接 return，`pos` 为空而瓦片又必须先有 `pos` 才挂载 → **首次导入到空库会出现「有作品但一片空白」**。`Gallery` 增加一条「提交后校验」的 effect：`nodes.length && pos.length !== nodes.length` 时补一次 `relayout()`，形成闭环。

### 12.2 右键：各界面矩阵

统一实现 `ui/ContextMenu.tsx`（headless、portal 到 body、按鼠标坐标定位并向视口内夹取/翻转），内容由 `core/ctxMenus.tsx` 集中构造 —— 「哪个界面能做什么」只有一处出处。

| 界面 | 触发 | 菜单内容 | 适用场景 |
| --- | --- | --- | --- |
| 作品卡片 | 右键卡片任意位置 | 打开大图 · 喜欢（勾选态）· 评分（内嵌星级，点星不关菜单）· 添加标签… · 移入废纸篓 / 恢复 / 彻底删除 · 勾选（批量）· 选中此文件夹的全部 · 复制文件名 / 相对路径 | 针对**某一个文件**做事，不打断浏览；批量模式下也能直接预览 |
| 大图舞台 | 右键图片区域 | 上一张 / 下一张 · 喜欢 · 评分 · 添加标签… · 废纸篓相关 · 旋转 90° / 重置缩放 / 全屏 / 详情面板 · 关闭大图 | 沉浸浏览时免于把鼠标移回顶栏；每项都标注了对应快捷键 |
| 图库空白区 | 右键网格背景 | 选择文件夹… / 添加照片… / 重新扫描 · 布局方式（瀑布流 / 按文件夹）· 缩略图放大 / 缩小一级 · 全选（批量）· 清除筛选条件 | **库级 / 视图级**操作 |
| 分组头（按文件夹布局） | 右键组标题 | 只看此文件夹 · 取消文件夹筛选 · 复制文件夹路径 · 切换为瀑布流 | 文件夹粒度的快速收敛 |
| 目录树行 | 右键行 | 只看此文件夹（勾选态）/ 回到全部文件 · 折叠 / 展开 · 展开全部子目录 · 全部折叠 · 取消文件夹筛选 · 复制文件夹路径 | 左键「点行即筛选」不变，右键补上树形操作 |
| 筛选条目（相机 / 镜头 / 焦距 / 年份 / 主色调 / 标签） | 右键行或 chips | 只看「xx」（替换该维度）· 追加到当前筛选 / 从筛选中移除 · 清除该维度筛选；标签额外给重命名 / 删除标签… | 从多选快速收敛到一项，或精确移除某一项 |
| 评分 chips | 右键 | 不限 / 只看已评分 / 只看未评分 / 1–5 星及以上（单选） | 把逐级点选变成一次选择 |
| 维度标题 | 右键 | 上移一位 / 下移一位 / 在侧栏隐藏此维度 | 复用「设置 · 侧栏筛选维度」那套配置，不必进设置 |

### 12.3 左右键的分工与一致性问题

- **左键 = 进入 / 切换**：卡片进大图、目录行切换筛选、筛选条目切换选中；
- **右键 = 就地对当前对象做事**：不改变视图、不跳转（除菜单里显式选择「打开大图」），因此「批量模式下想看一眼原图」这类冲突被直接消解；
- 破坏性操作（废纸篓 / 彻底删除）永远单独成组、danger 色、置于菜单下方；「已喜欢」受保护时置灰并写明原因（`已喜欢·受保护`）；
- 快捷键提示（`L` / `Delete` / `←` `→` / `R` / `F` / `I` / `Esc`）与全局键位表一致，不做第二套约定；
- 菜单打开时键盘由菜单接管（capture 阶段 `stopPropagation`），不会出现「菜单还开着，按 L 把当前图标记喜欢了」的穿透；Esc 只关菜单、再按一次才关大图；关闭后焦点归还打开前的元素；
- 无障碍：`role="menu"`，条目 `menuitem` / `menuitemcheckbox` / `menuitemradio`，↑↓/Home/End/Enter/Tab 全部可用，自绘的星级行标记为 `presentation` 不可聚焦。

---

## 十三、日常开发：两个脚本

仓库根目录有两个可双击的快捷脚本，也可以用终端调用。

### 13.1 `启动.command` —— 起开发服务器

```bash
./启动.command          # 默认 http://127.0.0.1:3000/
./启动.command 8080     # 指定端口
```

自动定位 Node（PATH → nvm → fnm → Homebrew → /usr/local → Volta → asdf → pnpm → WorkBuddy 内置运行时），缺依赖时自动 `npm ci`，端口被别的程序占用会自动顺延，已经在跑则直接打开浏览器。

### 13.2 `Git.command` —— 日常 Git 操作面板

**双击**（不带参数）会先读一遍仓库状态，只列出「此刻能做的事」，选号执行；操作完回到菜单，不用重开窗口：

```
  Git 操作面板  photo-gallery-react
  分支 main → origin/main · 领先 2 · 落后 0 · 改动 3 处
────────────────────────────────────────
   1  提交并推送（最常用）
   2  只提交，不推送
   3  取消暂存（保留改动）
   4  丢弃所有未提交改动（危险）
   5  只推送（2 个提交待推）
   6  查看状态与差异
   7  查看提交历史
   8  撤销上一次提交（保留改动）
   9  回滚某次已推送的提交
  10  分支：查看 / 新建 / 切换 / 合并
  11  打版本标签并推送
  12  暂存工作区 / 恢复暂存
  q   退出
```

菜单会随状态变化：工作区干净时不出现「提交」；没有待推提交时不出现「推送」；落后远端才出现「拉取」；有 rebase/merge 没做完才出现「中止」。

也可以直接下命令（脚本化、或者习惯了快）：

| 命令 | 作用 |
| --- | --- |
| `./Git.command push "fix: xxx"` | 提交并推送（给说明；不给则自动生成） |
| `./Git.command commit` | 只提交 |
| `./Git.command pushonly` | 只推送已有提交 |
| `./Git.command pull` / `sync` | 拉取（rebase） / 先拉后推 |
| `./Git.command status` / `log` | 看状态与差异 / 看历史 |
| `./Git.command undo` | 丢弃未提交改动（不可恢复，需确认） |
| `./Git.command unstage` / `uncommit` | 取消暂存 / 撤销上次提交（保留改动） |
| `./Git.command revert [hash]` | 回滚某次已推送提交（生成反向提交，不重写历史） |
| `./Git.command branch [list\|new\|switch\|merge]` | 分支操作 |
| `./Git.command tag v1.1.0` | 打标签并推送 |
| `./Git.command abort` | 中止进行中的 rebase / merge / cherry-pick |
| `./Git.command stash [save\|pop\|list]` | 暂存 / 恢复工作区 |

通用开关：`-y` 不确认 · `-n` 只提交不推送 · `--no-check` 跳过类型检查 · `-m "说明"` · `-i` 强制进菜单 · `-h` 帮助。

**安全约定**：破坏性操作（丢弃改动、撤销提交、回滚、合并）都要显式确认；**非交互环境（脚本、管道、CI）里没给 `-y` 就一律不执行**，绝不把「无人应答」当成「默认同意」。

#### 提交与推送做了什么

- 仓库体检：是否 git 仓库、有无远端、是否卡在 merge/rebase 中途
- 列出改动与 diff 统计；单文件 > 5MB 会拦下确认
- `tsc --noEmit` 类型检查（`--no-check` 可跳过），不通过时询问
- 提交说明留空时自动生成，如 `chore: 更新 3 个文件（src/components, README.md）`
- 推送失败按原因处理：网络类错误且 shell 里有 `HTTPS_PROXY` 则带代理重试；远端有新提交则 `pull --rebase --autostash` 后重推；冲突时中止并给出下一步命令

> 兼容说明：`上传代码.command` 现在只是一个转发别名，指向同一个 `Git.command`，老习惯不用改。

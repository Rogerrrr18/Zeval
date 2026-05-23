## Visual Theme

Zeval Eval Console 采用开发工具风格的暗色工作台视觉：

- 背景是深海军蓝到近黑的渐变基底，带轻微网格与霓虹冷光。
- 模块是半透明分析面板，不做厚重卡片堆叠。
- 重点信息用青蓝色和电光蓝强调，避免大面积高饱和。
- 页面应该看起来像“分析控制台”，不是营销页，也不是表单后台。

## Color Palette

- `bg/base`: `#030712`
- `bg/panel`: `#080d1b`
- `bg/panel-strong`: `#0f172a`
- `text/primary`: `#f8fbff`
- `text/secondary`: `#8ea0ba`
- `text/muted`: `#67798f`
- `accent/cyan`: `#67e8f9`
- `accent/blue`: `#2563eb`
- `accent/teal`: `#2dd4bf`
- `success`: `#22c55e`
- `warning`: `#fbbf24`
- `danger`: `#fb7185`

## Typography

- 主字体使用 `Geist Sans`，强调现代、紧凑、开发工具感。
- 数值和运行标识可适度使用 `Geist Mono`。
- 大标题字距略收紧，数值卡片允许更大字号。
- 所有正文优先可读性，不追求花哨展示字体。

## Layout Principles

- 优先使用响应式 grid，而不是固定左右栏。
- 采用 `12-column dashboard grid` 思路，宽屏多栏，窄屏自动堆叠。
- 核心操作区、摘要区、状态区、图表区要有清晰层级，不要平均分配视觉权重。
- 允许留白，避免每块内容都塞满。

## Component Guidance

- 上传区应该像 dropzone，不像普通按钮。
- 摘要卡片需要突出数值，并保留一句解释。
- 状态区使用步骤时间线表达，不用纯文本堆叠。
- 图表容器要统一边框、内边距和高度。
- 建议区应区分优先级，例如 `P0/P1/P2`。
- 导出区像 artifact 面板，强调 run id 与产物下载。

## Do

- 保持克制、专业、偏工程化。
- 让窗口缩放时布局自然重排。
- 用少量高亮颜色引导视线。
- 让 UI 能服务“评估工作流”这个主题。

## Do Not

- 不要使用花哨的大面积彩虹渐变。
- 不要堆太多描边和阴影。
- 不要做成消费级社交产品风格。
- 不要让移动端只是简单缩小桌面布局。

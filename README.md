# Zeval 2.0 项目结构说明

本仓库用于整理 Zeval 动态评测方向的原始实现、重构方案与实验验证项目。当前最重要的可运行项目是 `eval-test-v1`。

## 主要目录

| 路径 | 说明 |
| --- | --- |
| `eval-test-v1/` | 当前实现真人动态评测的融合方案，重要。使用本项目时需要先进入该目录，再执行 `npm run dev` 启动。 |
| `experiment--main/` | Roger 之前整理的动态评测实验方案与 Python pilot。 |
| `zerore-eval-system-main/` | Zeval 项目第一版实现。 |
| `Zeval 重构方案/` | 基于第一版 Zeval 实现整理出的重构方案；后续需要结合 `eval-test-v1` 与 `experiment--main` 两个实验方案继续调整。 |

## 启动当前实验项目

```bash
cd eval-test-v1
npm run dev
```

默认打开地址见 `eval-test-v1/README.md`。如果首次运行缺少依赖，请先在 `eval-test-v1/` 下执行 `npm install`。

## 根目录方案文档

以下 HTML 文件按产出时间排序：

| 文件 | 说明 |
| --- | --- |
| `1-动态评测融合方案-方案对比与架构.html` | 动态评测融合方案初稿，用于对比 `eval-test-v1` 与 `experiment--main`，并说明融合后的流程与架构。 |
| `2-realUser动态评测方案.html` | 引入真人用户参与动态评测的方案计划。 |
| `3-zeval-pipeline-map.html` | Zeval 系统整体链路与黑白盒边界梳理，用于理解评测、Benchmark、人工审核等环节的关系。 |
| `4-真人用户动态评测方案.html` | 运行 `eval-test-v1` 过程中遇到的问题、修复方案与 RealUser 动态评测维护记录。后续发现新问题也应继续更新到该文件。 |

## 当前工作重点

当前优先围绕 `eval-test-v1` 推进：

- 以 session 为基础评测单元。
- 抽取并绑定意图指针与可回填项。
- 支持全自动动态评测与真人用户动态评测两种模式。
- 将实验中发现的问题持续沉淀到 `4-真人用户动态评测方案.html`。

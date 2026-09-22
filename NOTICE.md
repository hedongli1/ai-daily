# 署名与许可义务

本站（ai-daily）代码与文档以 MIT 许可发布。但站点展示的**数据**来自多个上游，
各自遵循不同许可。本文件逐项列出适用范围与义务。

## models.dev

- 用途：模型元数据（模型名、厂商、发布时间、上下文长度、价格、开源标记）
- 许可：**MIT**
- 上游：https://models.dev
- 本站做法：每日抓取全量快照存入 `docs/data/raw/`，经归一化后产出
  `docs/data/snapshot/`。保留原始数据不改写字段含义。

## Epoch AI

- 用途：第三方评测明细（运行次数、评测域、域内均分与最佳分）
- 许可：**CC-BY 4.0**
- 上游：https://epoch.ai/data/benchmarks.csv
- **署名要求（许可硬性条件）**：

  > Benchmark data from **Epoch AI** (https://epoch.ai), licensed **CC-BY 4.0**.

- 本站做法：以原样转述方式展示其评测运行次数与域内均分。
  **未做跨赛制合分，未改变数据含义。**
- 本站**不提供**「综合智力排名」。原因：Epoch 原始数据的 `Task` 列对同一模型为常量，
  结构上不足以支撑跨赛制综合评分。站内 `/about` 页对此有完整说明。

## 各厂商官方公告

- 用途：事实事件的溯源证据链接
- 许可：各自所有
- 本站做法：**只取标题、链接与时间，不抓取、不转存正文内容。**
  站内展示的是标题原文与指向来源的外链。

## 明确排除的来源

| 来源 | 排除原因 |
|---|---|
| **Artificial Analysis** | 其条款禁止再分发数据，本站不使用其任何数据 |
| **LMArena** | 其条款禁止自动化抓取，本站不抓取 |

## 像素字体

| 字体 | 用途 | 许可 | 来源 |
|---|---|---|---|
| **Press Start 2P** | 英文像素字体 | OFL 1.1 | https://fonts.google.com/specimen/Press+Start+2P （Google Fonts 官方分发） |
| **缝合像素字体 Fusion Pixel（12px 等宽 zh_hans）** | 中文像素字体，`docs/fonts/fusion-pixel.woff2` 随仓库分发 | OFL-1.1 | https://github.com/TakWolf/fusion-pixel-font （作者官方 Releases） |

## 本站自身

- 站点实现（HTML / CSS / JS）、数据管线、信息架构、视觉设计均为独立编写。
- 界面为《我的世界》风格像素方块主题，全部由 CSS 原创绘制，**未使用 Mojang《Minecraft》任何官方贴图或素材**。
- 设计思路上参考了 [liyupi/ai-model-world](https://github.com/liyupi/ai-model-world)
  （MIT）公开的「零维护数据管线」思路 —— 特别是其「系统里唯一依赖人类常识的地方是一张
  查表」的结论，本站的厂商注册表出于同一考虑。
- **未复用其任何代码、像素素材、字体或文案。**
- 代码许可：MIT，见 [LICENSE](LICENSE)。

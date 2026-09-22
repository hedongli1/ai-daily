# AI 矿务日报 · ai-daily

**用模型数据库的每日差分，回答「今天 AI 圈发生了什么」。**

不是新闻聚合，是事实差分。每个工作日两次自动抓取、比对、发报，全程不经过任何大模型。

🔗 https://hedongli1.github.io/ai-daily/

界面为《我的世界》风格像素方块主题（CSS 原创绘制，不含 Mojang 官方素材）。
像素字体：Press Start 2P（OFL，Google Fonts）+ 缝合像素 Fusion Pixel（OFL-1.1，TakWolf 官方 Releases）。

---

## 它怎么工作

```
models.dev 全量快照  ──┐
                       ├──► 与昨日快照相减 ──► 五类事件 ──► 站点
厂商官方公告（标题）  ──┤         │
Epoch AI 评测明细    ──┘         └──► 证据链接挂到事件上
```

### 五类事件

| 事件 | 怎么算出来的 |
|---|---|
| **新模型** | 今日快照有、昨日快照无 |
| **调价** | `cost.*` 任一字段变化 |
| **上下文变更** | `limit.context` 变化 |
| **下架** | 昨日快照有、今日快照无 |
| **官方公告** | RSS 新增条目（只取标题与链接，不抓正文） |

新增/下架用**快照差分**而不是模型自带的 `release_date` —— 后者是模型自己的发布日期，
不是「我们今天才知道」的日期，用它会导致同一个模型天天重复上报。

---

## 🚨 这个项目最大的一个坑

`models.dev` 收录了 **7868 条**模型条目，但其中 **92%** 来自 **181 家渠道**——
API 网关（OpenRouter / NanoGPT）、云平台（Amazon Bedrock）、托管服务（Hugging Face）、
订阅套餐（`*-coding-plan`）。

同一个模型会被 N 个渠道重复收录。实测 2026-09-18 的 `GLM 5.3 FlashX` 一天之内出现在
**5 个不同厂商**的条目下。不处理的话，「今日新模型」会被渠道的收录动作刷屏。

**我们试过三个统计信号来区分原厂与渠道，每一个都有反例：**

| 信号 | 反例 |
|---|---|
| 聚合率（我的模型被别家收录的比例） | **方向是反的** —— 网关收录 OpenAI 的模型，结果把 OpenAI 判成了网关 |
| 派生率（名字里包含别家模型名的比例） | **同族命名误伤** —— 谷歌的 `gemini-2-5-flash-lite` 包含 `gemini-2-5-flash`，被判成蹭名 |
| 目录体量 | 抓得住 576 条的 NanoGPT，抓不住 165 条的 Amazon Bedrock |

每修一次就冒出新反例。结论：**这类判断本质上依赖人类常识，不是统计能解的。**

最终方案是一份**人工登记的厂商注册表**（[`scripts/vendor-registry.js`](scripts/vendor-registry.js)），
只收真正训练并发布模型的原厂 —— 当前 **33 家**。为了让维护不需要你盯着，
管线每次运行都会打印「未登记但有新模型的厂商」，把缺口变成可见清单。

> 结果是：610 条原厂模型条目，而不是 7868 条渠道噪声。

---

## 数据来源与许可

| 来源 | 用途 | 许可 |
|---|---|---|
| [models.dev](https://models.dev) | 模型元数据（价格 / 上下文 / 开源 / 发布日期） | MIT |
| [Epoch AI](https://epoch.ai) | 第三方评测明细 | **CC-BY 4.0** |
| 各厂商官方博客 / GitHub | 公告标题与链接（不抓正文） | 各自所有，仅作引用 |

**明确排除**：Artificial Analysis（条款禁止再分发）、LMArena（条款禁止自动化抓取）。

署名义务见 [`NOTICE.md`](NOTICE.md) 与站内 `/credits` 页。

### 本站不提供「综合智力排名」

Epoch AI 原始数据的 `Task` 列对同一个模型是常量，**结构上不足以算出跨赛制综合排名**。
本站只如实展示「该模型被评测过多少次、在哪个域、均分多少」。想看排名请去
[Epoch 原始看板](https://epoch.ai/data/ai-benchmarking-dashboard)。

---

## 本地运行

零依赖，只需要 Node.js ≥ 18（用到内置 `fetch`）。

```bash
node scripts/selftest.js        # 纯函数自检，78 项，不联网
node scripts/fetch.js           # 抓取 + 差分 + 落盘
node scripts/fetch.js --offline # 用本地已有原始快照复算，不联网、确定性
node scripts/fetch-bench.js     # 抓 Epoch AI 评测
node scripts/build-site.js      # 编译站点数据到 docs/data/site/

# 本地预览站点
cd docs && python3 -m http.server 8899
```

### 目录

```
.github/workflows/
  daily.yml     晨报 08:30 / 晚报 22:14（北京时间，与 trending-radar 同频错峰）
  deploy.yml    push 到 main 后发布 GitHub Pages
scripts/
  lib.js               零依赖工具（抓取 / 归一化 / 日期 / 格式化）
  sources.json         数据源清单
  vendor-registry.js   ⭐ 原厂注册表（唯一需要人工维护的文件）
  normalize.js         展平 + 原厂/渠道判定 + 原厂优选
  diff.js              快照相减 → 五类事件
  feeds.js             RSS 解析 + 证据挂载
  fetch.js             管线入口
  fetch-bench.js       Epoch AI 评测
  build-site.js        编译站点数据
  selftest.js          纯函数自检
docs/
  index.html / style.css / app.js   零依赖静态站（含 hash 路由）
  data/snapshot/       每日全量快照（历史累积，差分的依据）
  data/events/         每日事件
  data/site/           站点消费的 JSON
```

---

## 已知缺口

- **国产厂商缺官方源**：DeepSeek、智谱、月之暗面等均无官方 RSS，目前用其 GitHub 组织动态兜底，覆盖不完整。
- **注册表靠人工**：出现新原厂时需要补一行，否则它的模型不进事件流。管线会打印缺口提醒。
- **每天只拍两次快照**：北京时间 08:30 / 22:14，更晚发生的变化要等下一个班次。
- **Anthropic RSS 不稳定**：本机探测超时，Actions 上需持续观察。

---

## 与本站设计的关系

信息架构上参考了 [liyupi/ai-model-world](https://github.com/liyupi/ai-model-world)（MIT）公开的
「零维护数据管线」思路 —— 尤其是它「系统里唯一依赖人类常识的地方是一张查表」这个结论，
本站的厂商注册表正是同一思路。但**未复用其任何代码、像素素材、字体或文案**。

两者的分工不同：ai-model-world 呈现大模型的**当前格局**，ai-daily 记录格局**每天怎么变**。

---

## 许可

代码与文档 [MIT](LICENSE)。数据快照各自遵循上游许可，详见 [NOTICE.md](NOTICE.md)。

# 记忆插件 · 实现（core 内核 + plugin 架子层）

酒馆助手加载地址：

```js
import 'https://cdn.jsdelivr.net/gh/Lyra-Ta/memory-design@main/dist/index.js';
```

> 此间小镇 HereBetween · 长程记忆《世界档案》归档插件。
> 2026-07-11 起。分两层：`src/core/` 纯逻辑内核（零酒馆依赖）＋ `src/plugin/` 架子层（靠 TavernDeps 依赖缝接酒馆，仍可脱离酒馆单测）；原生 Shadow DOM UI 已接入。

## 这是什么

按《记忆插件_设计定稿》落地：

- **`src/core/`**：数据/存储内核。纯函数、零副作用、不依赖酒馆全局，能独立单测、也能原样打包。
- **`src/plugin/`**：架子层。归档会话引擎（主循环 + 单例锁）、配置持久化、§4 编排表——通过 `TavernDeps` **依赖缝**调酒馆（`getChatMessages/generateRaw/…`），测试里用 mock 注入，脱离酒馆也能跑通全流程。

真实酒馆全局绑定、Connection Profiles、UI 与单文件打包均已接入；当前仍保留原生会话类而未引入 Pinia。

## 模块地图

| 文件 | 职责 | 对应设计文档 |
|---|---|---|
| `src/core/types.ts` | 域模型：档案结构 / 世代 / 覆盖标记 / 定位表条目 / 校验问题 | 全局词汇 |
| `src/core/archive-format.ts` | canonical token 一套三家共用：抽取（标签天然隔离）/ 格式自适应解析（时间轴《》 与 旧扁平 []）/ 序列化 / 换代 / 结构校验（硬错·软疑） | 《档案格式契约与生成校验》 |
| `src/core/summary-format.ts` | 完整 `Flux` / `Causal_Flux` 抽取、x 后范围收集，以及普通扁平 Archive 校验 | 《摘要转总结_触发与占位》 |
| `src/core/locator.ts` | 定位表：遍历楼层→档案条目（世代 / 覆盖端点 / 体量）+ 选择器 + `deriveBoundary` | 功能规格 §A、§3 |
| `src/core/trigger.ts` | 2N 触发数学：`当前层−boundary≥2N` 提醒、范围 `boundary→当前层−N`、+50 静默 | 《大总结时间轴化_触发与流程》 |
| `src/core/summary-trigger.ts` | 普通总结轻提醒：默认 50、最小 20，只提醒不拦手动 | 《摘要转总结_触发与占位》§8 |
| `src/core/commit.ts` | 两段提交引擎：planner（写 pending→退旧→转正，支持同层退旧＋追加）+ 顺序执行器（落盘校验）+ 崩溃断点检测 | 功能规格 §F |
| `src/plugin/commit-log.ts` | pending 薄日志：只记计划/已成功 old 楼层、pending/promote 目标与接管阶段，不存正文 | 功能规格 §F |
| `src/plugin/deps.ts` | `TavernDeps` 依赖缝：本插件消费的酒馆接口集合（收窄类型） | 功能规格 §2.1 |
| `src/plugin/chat-state.ts` | 统一聊天读取层：唯一 q 入口；热快照携带缓存 x / 正则窗口；同快照 `0-q` 扫描校正 x / boundary | 《摘要转总结_触发与占位》§3 |
| `src/plugin/chat-events.ts` | 聊天事件观察器：sent/received 合并读 q，delete/update/swipe 合并扫描，切聊天同步失效旧状态及统一解绑 | 两套总结共用基础层 |
| `src/plugin/regex-window.ts` | 只由同一快照的 q / x 计算正则深度分区；十层分桶且保证不裁掉未总结 Flux | 《摘要转总结_触发与占位》§8.1 |
| `src/plugin/regex-controller.ts` | 把 W 串行同步到此间小镇当前预设的两条固定 UUID 正则；同桶不重复写，只改 depth、不改 enabled | 《摘要转总结_触发与占位》§8.1 |
| `src/plugin/config.ts` | 配置模型 + chat 作用域持久化 + 全局默认种子；提示词只存用户 override，不复制内置全文 | 功能规格 §6 配置种子 |
| `src/plugin/orchestration.ts` | §4 编排表模型 + 内置/override 解析 + `assemblePrompt`→ordered_prompts | 功能规格 §4 |
| `src/plugin/summary-orchestration.ts` | 摘要→总结的固定 system/user/system 三段式提示词、override 与运行时填槽 | 《摘要转总结_触发与占位》§4.2 |
| `src/plugin/session.ts` | 两套总结共用的单例引擎：时间轴化两段提交＋摘要→总结的全部完整 `<World_Archive>`/x 后 Flux 冻结、空白 y、同批重试与安全写回；共用取消/5 分钟超时 | 功能规格 §1；摘要转总结文档 |
| `src/plugin/tavern.ts` + `tavern-globals.d.ts` | `createTavernDeps`：把酒馆助手运行时全局包成 `TavernDeps`（唯一碰全局处） | — |
| `src/plugin/ui.ts` | 原生 Shadow DOM 面板：hub、时间轴、两套总结的设置/生成/重试/结果页、结构化编辑、API、完整性回退与提交事务日志 | 视觉稿 + 摘要转总结文档 |
| `src/plugin/index.ts` + `reminder.ts` | 脚本入口：注册按钮、共享 q/x 聊天事件、时间轴 2N/+50 与普通总结 S 轻提醒、切聊天重载、`pagehide` 清理 | 两套总结共用入口 |

## 承重支点（落地时别改坏）

- **标签天然隔离**：`<World_Archive>` 的正则天生抓不到 `<old_World_Archive>` / `<World_Archive_pending>`（字面不同串）。`extractArchiveBlocks` 靠这个把三世代干净分开——这是整套设计的支点，别动。
- **校验只查结构不查语义**：`validateArchive` 只认 token 在不在 / 闭没闭合 / 空没空。时间粒度、总结质量一律不碰。
- **假阳性守卫**：中文书名号《…》出现在正文/摘录里**不会**被误判成半个容器 token（只认行首起且不闭合的）。有单测钉死。
- **两段提交顺序化 + 可续跑**：每步写入前先核对楼层快照，落盘后再读回校验；任何一步没过就停在 pending 断点并封锁新事务。每个校验成功的步骤同步写入 chat 薄日志（`commit-log.ts`）；「提交事务日志」页据此显示 pending 已写 / 哪些层已 old / 既存末容器是否已接管 / 哪一层已转正，并可**一键继续未完成提交**（`session.resumeCommit` 依现场幂等补完剩余退旧·覆写·转正）。旧版无日志 pending 不猜。
- **提示词默认与覆盖分离**：内置提示词只来自当前脚本；chat/global 变量仅保存真正改过的模块及其基线指纹。远程更新后，未自定义用户自动跟随最新版，自定义用户可见“内置有新版”并一键恢复。
- **q 与表必须同快照**：全插件只由 `ChatStateReader.syncHead` 读 q；热快照同时携带缓存 x 与由 q/x 算出的正则窗口；`collect` 只消费已传入的 `{table,currentFloor}`，不能把 A 时刻的表与 B 时刻的 q 混用。完整表不按 q 缓存，因为 q 不变时正文仍可编辑；正文一旦 dirty，扫描完成前先把 x 当未知并保守扩窗，绝不用可能失效的旧 x 裁 Flux。
- **真切聊天立即作废旧操作**：共享读取层另维护只在真正切聊天时递增的 `chatEpoch`。两套候选、普通总结轮次与两段提交冻结该世代；每次异步写入及提交步骤前后复核，切换发生后立即停下，绝不把旧候选继续写进新聊天。
- **普通总结的来源与写位分离**：生成前直接扫描存储原文，运行时给模型「所有完整 `<World_Archive>` ＋ x 后截至 sourceThrough 的完整 Flux」；两者都是只读输入，角色卡、世界书和日常聊天不作事实源。候选只在 y 仍是空白 assistant 时写入，失败/取消/超时/重 roll 保持同一批来源、y、连接与提示词版本，只允许更改 Guidance。

## 发放（dispatch）模型 — 2026-07-11 已澄清

大总结时间轴化 = 把累积的**待整理 world archive**（此间小镇现有「正文→flux→archive」的产物，扁平 `[标题|关键词|时间]` 段、**无 marker**）合并成一份**时间轴档案**。引擎照此实现：

- **覆盖标记打在档案内部末尾、绑定该档**：`<!-- archived: N -->`（只记"总结到哪层"= boundary）由插件在写新档时套进 `<World_Archive>` **内部末尾**。档案在标记就在；楼层被删、标记读不到 → 触发"复原上一标记至今的 old_ 档"（完整性回退）。`extractCoverageMarkers` 仍容错旧 `a-b`（取尾号）。
- **既存/原始靠 marker 分，不靠位置**：`session.collect` 里 **带 marker 的在场档 = 既存**，发给 AI 的续写上下文取**最新一份既存档的全部可见容器**（完整续写背景；例：200/400 各时间轴化过，只发最新的 400、不发 200）；增量覆写仍只针对其末尾容器——提交时按「候选首容器与既存末容器同名」判定，二者不冲突。**不带 marker 的 = 原始**（flux 扁平待整理、整批消化）。
- **新档写原始的最高楼层、原始整批退役**：`buildCommitDecision` 目标层 = 原始最高楼层，退役 = 全部原始源档（含尾层自己 → 同层退旧＋追加）。信息并入新档、`marker 丢失可复原`，故**不丢记忆**。
- **增量覆写末尾容器**（已接）：仅当新候选首容器与既存末容器**标题完全一致**时，`supersedeLastContainer` 才就地 **HTML 注释包裹**冷存旧容器；不同名就两者都保留。
- **注释一律不显示**：`parseArchiveBody` 显示前 `stripComments`（marker + 被包裹旧容器）。插件的时间轴/预览/编辑绝不暴露这些标签；预设本就有"清除所有 HTML 注释"的正则，调下先后顺序即不被注入。
- **原始只消化到 当前层−N，保最近 N 层新鲜**：`collect` 里原始 = 无 marker ＆ 楼层 ≤ 当前层−N；最近 N 层新冒的原始档这轮不碰（= 触发上界，两者各管一头：既存/原始靠 marker 分，上界靠楼层）。
- **完整性回退**（已接）：`session.integrityCheck` 读最近存活的 marker 层 X，把 **X 之后的 `old_` 全部标为可复原**；`integrityRestore` 顺序改回 live。`refresh` 顺带报 `floorsDecreased`（q<p，删过楼层 → 该弹回退窗、先修再刷）。
- **两种档案格式并存（按 token 结构判定）**：`《标题|时间》`= 容器；`[标题|关键词|时间]`（三段·两处隔断）= 旧式顶层段（segment）；`[标题|时间]`（两段）且有开着的容器 = 片段。绝不把容器内片段误抓成顶层，旧档也绝不丢。旧段时间轴里作顶层节点显示、**不显示**中段关键词；编辑走**自由改**，时间轴节点走**保护性结构化编辑**（`kind` 就是 UI 选编辑器的开关）。

## 仍待细化

- **触发口径**：已按更晚定稿的 2N 实现（触发只管"何时提醒"；范围上界 当前层−N 在 `collect` 里生效）。
- **压缩 2（摘要 / Flux→普通 Archive）**：核心、提示词、占位写回、结果界面、轻提醒与固定 UUID 正则深度控制已实现，见 [`摘要转总结_触发与占位`](../设计文档/摘要转总结_触发与占位.md)。仍待真实长聊天调优；正文→摘要继续由预设负责。

## 跑测试

```bash
npm install        # devDeps：typescript / tsx / @types/node / esbuild
npm test           # node:test，全部 core / session / adapter 回归
npm run typecheck  # tsc --noEmit
```

## 打包 / 加载进酒馆

```bash
npm run build:plugin   # esbuild 打成单文件 dist/index.js（IIFE）
```

`dist/index.js` 是一个**自包含的酒馆助手脚本**：core+plugin 全打进去，`getChatMessages/generateRaw/eventOn/…` 等运行时函数留作**全局引用**（酒馆助手在脚本作用域注入）。加载 = 在酒馆助手里新建一个「脚本」，把 `dist/index.js` 内容贴进去、启用；聊天框附近会出现「记忆归档」按钮，点开即用。

测试是这两层的**验收证据**：解析往返无损、标签隔离、校验硬错/软疑分野、两套提醒、生成取消/超时竞态、普通总结的来源冻结/y 安全写回/同批重试、pending 薄日志与中断续跑，以及时间轴化 **generate→commit 全流程**（mock 酒馆）均有覆盖。

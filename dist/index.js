"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/core/trigger.ts
  var DEFAULT_N = 200;
  var MIN_N = 100;
  var SNOOZE_STEP = 50;
  function normalizeN(n) {
    if (!Number.isFinite(n)) return DEFAULT_N;
    return Math.max(MIN_N, Math.floor(n));
  }
  function computeTriggerState(params) {
    const n = normalizeN(params.n);
    const gap = params.currentFloor - params.boundary;
    const eligible = gap >= 2 * n;
    const range = eligible ? { from: params.boundary, to: params.currentFloor - n } : null;
    const rangeSize = range ? range.to - range.from : 0;
    const dismissed = params.lastDismissedFloor;
    const inSnoozeWindow = dismissed !== null && dismissed !== void 0 && params.currentFloor - dismissed < SNOOZE_STEP;
    return {
      n,
      gap,
      eligible,
      shouldRemind: eligible && !inSnoozeWindow,
      range,
      rangeSize
    };
  }

  // src/core/summary-trigger.ts
  var DEFAULT_SUMMARY_INTERVAL = 50;
  var MIN_SUMMARY_INTERVAL = 20;
  function normalizeSummaryInterval(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SUMMARY_INTERVAL;
    return Math.max(MIN_SUMMARY_INTERVAL, Math.floor(value));
  }
  function computeSummaryTriggerState(params) {
    const interval = normalizeSummaryInterval(params.interval);
    const anchor = params.latestArchiveFloor;
    const distance = anchor === null ? Math.max(0, params.currentFloor + 1) : Math.max(0, params.currentFloor - anchor);
    const eligible = distance >= interval;
    const reminded = params.lastRemindedFloor;
    const reminderWindowPassed = reminded === null || params.currentFloor - reminded >= interval;
    return {
      interval,
      distance,
      eligible,
      shouldRemind: eligible && reminderWindowPassed,
      nextFloor: anchor === null ? interval - 1 : anchor + interval
    };
  }

  // src/plugin/orchestration.ts
  var HISTORICAL_PLACEHOLDER = "{{HISTORICAL_CONTEXT}}";
  var GUIDANCE_PLACEHOLDER = "{{GUIDANCE}}";
  var SKELETON = `你是一个「记忆归档器」。把给定的角色扮演原始记录，进一步压缩篇幅，成为一份结构化《世界档案》。以因果为时间轴，仅值得保留的细节以摘录方式存在。
最终目标：把这份档案当作角色记忆来源。只把真正抓人的瞬间原样留住（留为摘录）；把记忆中大致经历了什么留住（留为片段总结）。绝对禁止任何形式增添细节。

<Basic_Rules>
用 <World_Archive> … </World_Archive> 包裹整份档案。
档案按时间顺序排列若干「时间容器」。每个时间容器＝一段时间（比如一整年、一场持续几天的副本、某几天）。
Legend：《…》为容器标题，[…]为片段标题。// 后内容为生成引导，不是生成格式。
具体结构如下：
<World_Archive>
《容器标题 | 时间段》
…… // 容器总结：总领本容器内所有片段的概览——这段时间整体上发生了什么

  [片段标题 | 时间范围]
  …… // 片段总结：按逻辑顺序说明发生了什么，保持因果不断连，前后可推导，人物在场
  · …… // 摘录：保留原动作/原对话/原意象等
  [片段标题 | 时间范围]
  ……
  · ……
  · ……
  // 下一个潜在的片段
// 下一个潜在的容器
</World_Archive>

【容器】
· 容器（大段时间）的断点＝跨年/跨月、进出一个大场景或副本、剧情大阶段切换。容器允许尽可能宏观。
· 按“故事的自然断点”切，而不是机械按段数/字数切。
· 无法被归入任何片段的零散时间段，单独成为一个容器，内部不挂载片段。

【片段】
· 片段覆盖一个「时间范围」（不是时间点）；范围之间可以重叠、可以并列——容器内的片段不必排成一条严格的时间线。
· 片段只带一个标题和它的时间范围，不打标签、不标注线索。
· 合法片段类型：
    · 时间切片：一段连续的场景，占一个不重叠的时段。
    · 贯穿线：一条零散出现、合起来才成整体的暗线，聚成一个跨度片段，与切片并列。举例，一个 [年度] 容器里可以同时并列：[收集情报 | 全年]、[日常事件1 | 上半年]、[日常事件2 | 下半年]、[复仇| 下半年]，贯穿线（此处的收集情报与复仇）与两段日常在时间上可以重叠或交错。
    · 共性切片：同一容器中复数次出现的相同场景/相同在场角色/相似互动模式（如 [刷牙洗脸| 时间A-B & C-D]为共性切片、[中午外出| 时间 B-C]为日常切片），可以合并为同一片段。具体差异可下放摘录。
 · 判别贯穿线：某条线每次只零星一两笔，连起来才是完整贯穿线进展 → 聚成一段；每次都自成一场完整的戏 → 各自切片。（举例：暗线、个人发展线、整体局势变化...）
· 一个具体瞬间的细节只归属一个片段：若某个贯穿线A发生在片段B里，判断它主要发生在哪个场景（片段B中贯穿线A的闪回影响了角色行动），就只具体写进那一片段（此处为B片段），另一侧一笔带过。
· 片段大致按起始时间排；并列/重叠的用各自时间范围区分，跨度大的贯穿线放前放后都行。
</Basic_Rules>

<Writing_Guidelines>
【容器·总结怎么写】
· 站在整个容器的高度，尽可能按照时间顺序，一段话讲清这段时间「整体上发生了什么」，尤其是三要素：时间、地点、在场人物（只要是出现的人名，配角也不要遗漏，这关系到哪些角色在场知道某些事）。
· 它是这个容器最顶上的概览：只读它，就能知道这段时间的大致状态与走向，不必逐个看片段。
· 粗，但不是概括性空话，只讲发生的事实——要能让人跳过下面的片段也不至于断片。
示例：
· 这个夏天很热，A（调查员）与B（私家侦探）在城市中展开了一系列关于都市传说的调查行动。两人先调查了废弃大楼，期间B就A的流程正直提出不满，A坚持原流程，B无言但也没有离开。两人最终发现了希腊太阳与鸟状的浮雕，随后前往图书馆查阅相关资料。在图书馆查阅过程中，他们遇到了神秘人物C。B以高温犯困为借口先行离开，在市中心的地下室一对一接触C，并给出了一个未来可被兑现的任意承诺作为筹码，C提供了关于神秘符号与都市传说可能的关系。但A跟踪C到这里且发现了B，两人激烈争吵，C趁乱离开。
-> 可以发现示例中并不需要说B如何表达不满、B离开时A的反应、B和C碰面具体说了什么等，但因果与进展已经全盘记录在案（如 背景环境为什么影响行动、浮雕是什么样子的、去哪里查资料、在哪里遇到C、筹码是什么、C提供了什么）

【片段·总结怎么写】
· 写清这一片段「发生了什么」，即 在场有谁、谁对谁做了什么、来龙去脉与归属…
· 省去所有「逐帧编排」——那种一举一动的纯装饰性连续动作（擦纸巾、发抖、后退之类）；它们的质感若值得留，交给「摘录」。
· 高分辨率的细节（如愣住、大笑、之类）不进入总结，同样仅在值得保留时交给摘录。
· 只记发生过的事实。不要写「当前状态」「还没了结」「这是伏笔」这类推断或预测。
示例：
· A与B一同进入了废弃大楼3楼左侧的空房间。两人在房间里发现了一个奇怪的装置，A尝试操作它，但装置毫无反应。B观察后基于之前图书馆查到的信息提出了一个新的按键顺序。按照此方法和A对嫌疑人的侧写直觉作为修正，两人成功启动了装置，房间内的灯光亮起，显示出一幅地图。
-> 可以发现此示例展示了详细的细节如空房间位置、两人的解密思路等。但A的侧写直觉具体是什么、成功启动后除了地图显现还有什么细节并不需要在这里展示

【片段·摘录怎么挑】
· 唯一判据：「总结说完之后，还有哪些瞬间与闪回在未来会被角色回忆起？」总结已经带到的，不收；总结捞不回、在未来可能会被记起的具体瞬间（无论是感知记忆还是具体的语言记忆），才收。
  · 表面的情绪不是判据：一次沉默可以收，一串俏皮话也可以收——只要是总结无法言明的有趣的/互动的/有张力的/值得被记住的/特殊的。
  · 举例：收到礼物时的反应；某个下意识做了又撤回的；某个无意识的；因为某些原因突然愣神；…
· 留原话、原动作、原意象，别改写成第三人称转述。条目本身是完整句子，是事件存在的意义所在。
· 条数完全弹性：高浓度的名场面可以很多条，装饰/过渡/日常常态 也可以一条都没有，保持克制。
· 条目内容应按时间顺序排列，与小总结对齐。即看到此动作可以在小总结的因果事实中找到此条目发生在哪个位置。
示例：
  · A说“...”。B反击后，沉默许久。
  · B别开视线把耳环放在桌上，称“只是随便买的”。A眼睛一亮，抓了起来把玩了一会儿后调侃“口是心非”。
-> 可以发现此示例自带情绪和气氛，但又不带过多无关细节。保留原文和在场角色的伴随反应，B或者A回忆起时都能感受到潜藏的亲密感，而不是“随便买的”这句话本身的疏离。

【红线】
· 不预测未来、不标伏笔/待解。
· 不编造原文没有的细节，一切细节都来源于文本本身。
· 不抽象化、不泛化、不升华：尊重原文的具体性，不要替角色命名情绪或情感关系等。
· 除非是直接可见的动作或语言 或 是直接来源于文本，否则不要写「情绪/心理」的主观感受。即允许文本明示的动机与因果，但禁止推断性心理。
</Writing_Guidelines>`;
  var HISTORICAL = `<Historical_Context>
${HISTORICAL_PLACEHOLDER}
</Historical_Context>
原始记录读取完毕。`;
  var NOTE = `注意：对于【既存信息】中最后一个容器（仅取其一），其时间范围与【原始记录】中某段有明显重叠且判断合并为一个容器时更有助于保持连续性。请在即将生成的世界存档中增量覆写此容器（即完整保留原本信息基础上新增本次记录，将其作为本次生成的第一个容器；既存末尾容器中的旧事实不得降精度），确保此容器：“容器标题” 保持一致。`;
  var GUIDANCE_BLOCK = `对【原始记录】的补充信息（用于校正理解与调整取舍，但不得覆盖红线、事实保真及输出格式要求）：
${GUIDANCE_PLACEHOLDER}`;
  var COT = `<Output_Requirements>
在开始输出前，请先按如下格式进行思考，并使用<thinking>…</thinking>包裹，不得跳步不得省略。
<thinking>
## 读取【既存信息】和【原始记录】：
1. 分析【既存信息】中最近一个容器的时间范围、在场人物、事件发生的逻辑顺序。
2. 分析【原始记录】中各段的时间线索、在场人物、事件发生的逻辑顺序，理清明线和暗线。

## 判断容器边界：
1. 判断【原始记录】首段是否落在既存末尾容器的时间范围内 → 若是，本次输出必须以该容器标题重新输出整个容器，含既存的旧片段。其余内容成为新容器。
2. 以【原始记录】的段落为单位，分离各段落中线索，至少判定每一段落中是否存在多线并行，对其内容进行提取（如主线可为日常常态中的事件，暗线/贯穿线可为某人单独的成长线 或 复仇线等，发生在日常的间隙，并不局限于题材）。
3. 贯穿线注明各笔发生在哪些段落内，将散落各处的贯穿线推进串成脉络

## 基于<Basic_Rules>切分容器：
1. 优先寻找贯穿线。如果没找到，请给出理由。
2. 余下片段继续分类。
-> 本身并不一定需要按照时间线进行切分，更多的是按主题和相关性。理由应与<Basic_Rules: 【片段】>对齐。
3. 列举切分完毕的片段标题。按照信息相近度将相近时间区间内对片段加入同一容器。

## 基于<Writing_Guidelines>萃取摘录：
对每个切分完毕的片段，基于其内部逻辑筛选潜在可摘录信息。
高置信值得被保留的示例：理由？
应被丢弃的示例：理由？
-> 理由应与<Writing_Guidelines: 【片段·摘录怎么挑】>对齐。

## 正式输出前，再回忆一遍<Writing_Guidelines: 【红线】>与其他重要规则和信息。
</thinking>

思考完毕后，输出 <World_Archive>…</World_Archive>，不要额外解释。
</Output_Requirements>

现在从思考<thinking>开始：`;
  var POST = COT;
  function defaultOrchestration() {
    return [
      { id: "skeleton", label: "骨架规则（身份 + 结构 + 红线）", role: "system", kind: "static", content: SKELETON, enabled: true },
      { id: "historical_context", label: "Historical Context（既存 + 原始）", role: "user", kind: "historical_context", content: HISTORICAL, enabled: true },
      { id: "note", label: "注意（增量覆写等说明）", role: "system", kind: "static", content: NOTE, enabled: true },
      { id: "guidance", label: "重roll 引导槽（本段个性化需求）", role: "user", kind: "guidance", content: GUIDANCE_BLOCK, enabled: true },
      { id: "post", label: "后置提示词", role: "system", kind: "static", content: POST, enabled: true }
    ];
  }
  function promptFingerprint(content) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${content.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  function resolveOrchestration(overrides) {
    return defaultOrchestration().map((entry) => {
      const override = overrides[entry.id];
      return override ? { ...entry, content: override.content } : entry;
    });
  }
  function fill(template, placeholder, value) {
    return template.includes(placeholder) ? template.split(placeholder).join(value) : `${template}
${value}`;
  }
  function assemblePrompt(entries, input) {
    const prompts = [];
    for (const e of entries) {
      if (!e.enabled) continue;
      let content;
      if (e.kind === "historical_context") {
        content = fill(e.content, HISTORICAL_PLACEHOLDER, input.historicalContext);
      } else if (e.kind === "guidance") {
        if (!input.guidance.trim()) continue;
        content = fill(e.content, GUIDANCE_PLACEHOLDER, input.guidance);
      } else {
        content = e.content;
      }
      prompts.push({ role: e.role, content });
    }
    return prompts;
  }

  // src/plugin/summary-orchestration.ts
  var SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER = "{{所有符合条件的信息，也就是所有<World_Archive>以及被抓到的<Flux>}}";
  var SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER = "{{ARCHIVE_CONTEXT}}";
  var SUMMARY_TARGET_FLUX_PLACEHOLDER = "{{TARGET_FLUX}}";
  var SUMMARY_GUIDANCE_PLACEHOLDER = "{{GUIDANCE}}";
  var PRE = `你是一个「记忆审计归档系统」。
该审计不参与叙事生成，不负责创作与风格选择。仅对已生成的显现内容（<Flux>）进行可逆压缩与正确性校验。其输出的 Archive 将作为后续一切系统推演的唯一历史输入。`;
  var RUNTIME = `<Historical_Context>
${SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER}
</Historical_Context>

${SUMMARY_GUIDANCE_PLACEHOLDER}`;
  var POST2 = `<Output_Requirements>
在开始输出前，请先按如下格式进行思考，并使用<thinking>…</thinking>包裹，不得跳步不得省略。
<thinking>

[阶段1: 游标校准]
- **存档查询**：扫描全部<World_Archive>, 梳理归属于Archive的所有因果结。
- **锚定基准**: 反向扫描最近的 \`</World_Archive>\`，记录其 [事件标题| 锚点 | 起止时间]。
- **捕获域**: 锁定自基准线起的所有 \`<Flux>\` 条目。
  - 按顺序罗列捕获域中所有flux信息的[起始点]、[结束点]及[核心事件逻辑]。

[阶段2: 容器分段]
- **指令**: 将捕获的 Flux 条目分配至不同的[事件容器]中。
- **强制切分**:
  1. 单个事件容器最多包含 **3个** \`<Flux>\` 标签组。若超过，必须**强制截断**，将余下内容放入[下一事件容器]。
  2. 无论数量是否达标，一旦检测到**物理空间转移**或**时间显著跨度**或**高张力高密度互动**，必须**立即截断**，建立新容器。
- *Output Preview*: [Event_1 (Flux 1-3)] -> [Event_2 (Flux 4-6)]...
- 整理每个容器内部的细节走向（如：每个动作/对话与哪个动作有逻辑关联）

[阶段3: 质感萃取]
以bullet point列举每个事件容器需要保留的P0；从P1中补全信息使逻辑连贯因果明确：
P0（必须保留）
- 涉及人物关系、情感或行动方向的叙述（e.g. 因为什么而说某句话、做某件事）
- 关键对白原句
- 明确的物理行为（进入 / 离开 / 触碰 / 拿起 / ...）
- 事实的变化（局势变化/人物常驻位置转移/新增人物/人物退场/…）
P1（可选保留）
- 触发情绪变化的感官锚点（温度 / 气味 / 声音）与对应的情绪本身
- 少量微动作（停顿、视线移动）
P2（默认删除）
- 连续的环境描写
- 重复或弱相关的五感
- 类似修辞或文学风格句

原词锁定:
- 严禁将“具体的动作/物体”转化为“抽象的状态/评价”。
- 避免总结性心理判断（如：他意识到 / 她终于明白）。

- 特例：**性行为描写**抽象为发生了什么，不需要性行为的具体细节。但更注重保留其中的信息、情感、对白、约定等。允许多容器合并（即优先级高于阶段2容器分段）

[阶段4: 蒙太奇编织]
- **可逆性自检**: 假设丢失所有 Flux，仅读取压缩后的 Archive，能否推导出那个瞬间行动的因果关系、还原当下的人物状态？若不能，说明压缩过度，需回滚并在锚定层增加细节。
</thinking>

思考完毕后，输出 <World_Archive>…</World_Archive>，不要额外解释。

- **Format (多事件循环输出)**：
<World_Archive>
// Loop for each Event Container
[事件标题|情绪/感知坐标（约3个关键词）|起止时间]
[不进行评价、推论、补全。蒙太奇式按客观顺序原影流畅显现所有情节、感官锚点、对白、心理转折、情绪流动 等，这些元素都将化作叙事的温度与感知记忆。]

// If Next Event exists, insert line break
[事件标题|情绪/感知坐标|起止时间]
[...]

// End Loop
</World_Archive>

</Output_Requirements>

现在从思考<thinking>开始：

<thinking>`;
  function defaultSummaryOrchestration() {
    return [
      { id: "pre", label: "前置定义", role: "system", kind: "static", content: PRE, enabled: true },
      { id: "runtime", label: "运行时填入", role: "user", kind: "runtime", content: RUNTIME, enabled: true },
      { id: "post", label: "后置思考与输出", role: "system", kind: "static", content: POST2, enabled: true }
    ];
  }
  function summaryPromptFingerprint(content) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${content.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  function makeSummaryOrchestrationOverride(content, baseContent) {
    return { content, baseHash: summaryPromptFingerprint(baseContent) };
  }
  function resolveSummaryOrchestration(overrides) {
    return defaultSummaryOrchestration().map((entry) => {
      const override = overrides[entry.id];
      return override ? { ...entry, content: override.content } : entry;
    });
  }
  function fillOrAppend(template, placeholder, value, fallback) {
    if (template.includes(placeholder)) return template.split(placeholder).join(value);
    return `${template.trimEnd()}

${fallback}`;
  }
  function fillRuntime(template, input) {
    const historicalContext = [input.archiveContext.trim(), input.targetFlux.trim()].filter(Boolean).join("\n\n");
    const hasUnifiedPlaceholder = template.includes(SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER);
    const hasLegacyArchivePlaceholder = template.includes(SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER);
    const hasLegacyFluxPlaceholder = template.includes(SUMMARY_TARGET_FLUX_PLACEHOLDER);
    let content = template;
    if (hasUnifiedPlaceholder) {
      content = content.split(SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER).join(historicalContext);
    }
    if (hasLegacyArchivePlaceholder || hasLegacyFluxPlaceholder) {
      content = fillOrAppend(
        content,
        SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER,
        input.archiveContext,
        `<Archive_Context>
${input.archiveContext}
</Archive_Context>`
      );
      content = fillOrAppend(
        content,
        SUMMARY_TARGET_FLUX_PLACEHOLDER,
        input.targetFlux,
        `<Target_Flux>
${input.targetFlux}
</Target_Flux>`
      );
    } else if (!hasUnifiedPlaceholder) {
      content = `${content.trimEnd()}

<Historical_Context>
${historicalContext}
</Historical_Context>`;
    }
    const guidance = input.guidance?.trim() ?? "";
    const guidanceBlock = guidance ? `<Guidance>
${guidance}
</Guidance>` : "";
    if (content.includes(SUMMARY_GUIDANCE_PLACEHOLDER)) {
      content = content.split(SUMMARY_GUIDANCE_PLACEHOLDER).join(guidanceBlock);
    } else if (guidanceBlock) {
      content = `${content.trimEnd()}

${guidanceBlock}`;
    }
    return content.trim();
  }
  function assembleSummaryPrompt(entries, input) {
    return entries.flatMap((entry) => {
      if (!entry.enabled) return [];
      const content = entry.kind === "runtime" ? fillRuntime(entry.content, input) : entry.content;
      return [{ role: entry.role, content }];
    });
  }

  // src/plugin/config.ts
  var CONFIG_KEY = "memoryArchiver";
  var CONFIG_VERSION = 7;
  var LEGACY_DEFAULT_PROMPT_HASHES = {
    skeleton: ["fnv1a:2088:eeafee11"],
    historical_context: ["fnv1a:75:492c7d5d"],
    note: ["fnv1a:156:e4051a79"],
    guidance: ["fnv1a:59:32dae3b4"],
    post: ["fnv1a:674:80798d0e"]
  };
  function defaultConfig() {
    return {
      version: CONFIG_VERSION,
      n: DEFAULT_N,
      boundary: 0,
      lastKnownFloor: null,
      lastDismissedFloor: null,
      connectionProfileId: null,
      modelHint: "任务较复杂，推荐 Gemini 等智商尚可的模型就够。",
      orchestrationOverrides: {},
      summaryInterval: DEFAULT_SUMMARY_INTERVAL,
      summaryPlaceholderFloor: null,
      summaryLastRemindedFloor: null,
      summaryOrchestrationOverrides: {},
      timelineEnabled: true,
      summaryEnabled: true
    };
  }
  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function coerceOverrides(raw) {
    if (!isRecord(raw)) return {};
    const overrides = {};
    const knownIds = new Set(defaultOrchestration().map((entry) => entry.id));
    for (const [id, value] of Object.entries(raw)) {
      if (!knownIds.has(id)) continue;
      if (!isRecord(value) || typeof value.content !== "string" || typeof value.baseHash !== "string") continue;
      overrides[id] = { content: value.content, baseHash: value.baseHash };
    }
    return overrides;
  }
  function coerceSummaryOverrides(raw) {
    if (!isRecord(raw)) return {};
    const overrides = {};
    const knownIds = new Set(defaultSummaryOrchestration().map((entry) => entry.id));
    for (const [id, value] of Object.entries(raw)) {
      if (!knownIds.has(id)) continue;
      if (!isRecord(value) || typeof value.content !== "string" || typeof value.baseHash !== "string") continue;
      overrides[id] = { content: value.content, baseHash: value.baseHash };
    }
    return overrides;
  }
  function legacyEntries(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || typeof value.content !== "string") return [];
      return [value];
    });
  }
  function legacyContentFor(id, byId) {
    const direct = byId.get(id);
    if (direct) return direct.content;
    if (id !== "post") return void 0;
    const oldParts = ["cot", "output_format"].map((oldId) => byId.get(oldId)?.content?.trim()).filter((content) => !!content);
    return oldParts.length ? oldParts.join("\n\n") : void 0;
  }
  function migrateLegacyOrchestration(raw) {
    const entries = legacyEntries(raw);
    if (!entries.length) return {};
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const overrides = {};
    for (const builtin of defaultOrchestration()) {
      const content = legacyContentFor(builtin.id, byId);
      if (content === void 0) continue;
      const contentHash = promptFingerprint(content);
      const legacyHashes = LEGACY_DEFAULT_PROMPT_HASHES[builtin.id] ?? [];
      const knownBuiltinHashes = /* @__PURE__ */ new Set([...legacyHashes, promptFingerprint(builtin.content)]);
      if (knownBuiltinHashes.has(contentHash)) continue;
      overrides[builtin.id] = {
        content,
        baseHash: legacyHashes[0] ?? promptFingerprint(builtin.content)
      };
    }
    return overrides;
  }
  function coerce(raw) {
    const d = defaultConfig();
    if (!isRecord(raw)) return d;
    const oldVersion = typeof raw.version === "number" ? raw.version : 0;
    const migrated = oldVersion < CONFIG_VERSION ? migrateLegacyOrchestration(raw.orchestration) : {};
    const explicit = coerceOverrides(raw.orchestrationOverrides);
    return {
      version: CONFIG_VERSION,
      n: normalizeN(typeof raw.n === "number" ? raw.n : void 0),
      boundary: typeof raw.boundary === "number" ? raw.boundary : d.boundary,
      lastKnownFloor: typeof raw.lastKnownFloor === "number" ? raw.lastKnownFloor : null,
      lastDismissedFloor: typeof raw.lastDismissedFloor === "number" ? raw.lastDismissedFloor : null,
      connectionProfileId: typeof raw.connectionProfileId === "string" ? raw.connectionProfileId : null,
      modelHint: typeof raw.modelHint === "string" ? raw.modelHint : d.modelHint,
      orchestrationOverrides: { ...migrated, ...explicit },
      summaryInterval: normalizeSummaryInterval(raw.summaryInterval),
      summaryPlaceholderFloor: typeof raw.summaryPlaceholderFloor === "number" && Number.isInteger(raw.summaryPlaceholderFloor) ? raw.summaryPlaceholderFloor : null,
      summaryLastRemindedFloor: typeof raw.summaryLastRemindedFloor === "number" && Number.isInteger(raw.summaryLastRemindedFloor) ? raw.summaryLastRemindedFloor : null,
      summaryOrchestrationOverrides: coerceSummaryOverrides(raw.summaryOrchestrationOverrides),
      timelineEnabled: typeof raw.timelineEnabled === "boolean" ? raw.timelineEnabled : d.timelineEnabled,
      summaryEnabled: typeof raw.summaryEnabled === "boolean" ? raw.summaryEnabled : d.summaryEnabled
    };
  }
  function asGlobalSeed(cfg) {
    return {
      ...cfg,
      boundary: 0,
      lastKnownFloor: null,
      lastDismissedFloor: null,
      orchestrationOverrides: { ...cfg.orchestrationOverrides },
      summaryPlaceholderFloor: null,
      summaryLastRemindedFloor: null,
      summaryOrchestrationOverrides: { ...cfg.summaryOrchestrationOverrides }
    };
  }
  function loadConfig(deps) {
    const chat = deps.getVariables({ type: "chat" })[CONFIG_KEY];
    if (chat !== void 0) {
      const cfg = coerce(chat);
      saveConfig(deps, cfg);
      return cfg;
    }
    const globalSeed = deps.getVariables({ type: "global" })[CONFIG_KEY];
    const seeded = asGlobalSeed(coerce(globalSeed));
    if (globalSeed !== void 0) saveGlobalDefault(deps, seeded);
    saveConfig(deps, seeded);
    return seeded;
  }
  function saveConfig(deps, cfg) {
    deps.insertOrAssignVariables(
      {
        [CONFIG_KEY]: {
          ...cfg,
          orchestrationOverrides: { ...cfg.orchestrationOverrides },
          summaryOrchestrationOverrides: { ...cfg.summaryOrchestrationOverrides }
        }
      },
      { type: "chat" }
    );
  }
  function saveGlobalDefault(deps, cfg) {
    const seed = asGlobalSeed(cfg);
    deps.insertOrAssignVariables({ [CONFIG_KEY]: seed }, { type: "global" });
  }

  // src/plugin/chat-events.ts
  function bindChatActivityMonitor(options) {
    const debounceMs = options.debounceMs ?? 200;
    let activeChatIdentity = options.initialChatIdentity;
    let headTimer = null;
    let scanTimer = null;
    let destroyed = false;
    const clearHeadTimer = () => {
      if (headTimer === null) return;
      clearTimeout(headTimer);
      headTimer = null;
    };
    const clearScanTimer = () => {
      if (scanTimer === null) return;
      clearTimeout(scanTimer);
      scanTimer = null;
    };
    const scheduleHead = () => {
      if (destroyed || scanTimer !== null) return;
      clearHeadTimer();
      headTimer = setTimeout(() => {
        headTimer = null;
        if (destroyed) return;
        options.onHeadActivity(options.state.syncHead());
      }, debounceMs);
    };
    const scheduleScan = () => {
      if (destroyed) return;
      clearHeadTimer();
      clearScanTimer();
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (destroyed) return;
        const head = options.state.syncHead();
        options.onArchiveInvalidated(options.state.scan(head));
      }, debounceMs);
    };
    const subscriptions = [
      options.eventOn(options.events.MESSAGE_SENT, scheduleHead),
      options.eventOn(options.events.MESSAGE_RECEIVED, scheduleHead),
      options.eventOn(options.events.MESSAGE_DELETED, scheduleScan),
      options.eventOn(options.events.MESSAGE_UPDATED, scheduleScan),
      options.eventOn(options.events.MESSAGE_SWIPED, scheduleScan),
      options.eventOn(options.events.CHAT_CHANGED, (chatFileName) => {
        const eventIdentity = typeof chatFileName === "string" && chatFileName ? chatFileName : options.getCurrentChatIdentity();
        if (eventIdentity && eventIdentity === activeChatIdentity) {
          options.state.markDirty();
          scheduleScan();
          return;
        }
        activeChatIdentity = eventIdentity;
        clearHeadTimer();
        clearScanTimer();
        options.state.reset(eventIdentity);
        options.onChatChanged(eventIdentity);
      })
    ];
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearHeadTimer();
        clearScanTimer();
        for (const subscription of subscriptions) subscription.stop();
      }
    };
  }

  // src/plugin/reminder.ts
  var REMINDER_EVENT_FALLBACKS = {
    MESSAGE_SENT: "message_sent",
    MESSAGE_RECEIVED: "message_received",
    MESSAGE_UPDATED: "message_updated",
    MESSAGE_SWIPED: "message_swiped",
    CHAT_CHANGED: "chat_id_changed",
    MESSAGE_DELETED: "message_deleted"
  };
  function resolveReminderEventNames(eventTypes) {
    const value = (key) => {
      const candidate = eventTypes?.[key];
      return typeof candidate === "string" && candidate ? candidate : REMINDER_EVENT_FALLBACKS[key];
    };
    return {
      MESSAGE_SENT: value("MESSAGE_SENT"),
      MESSAGE_RECEIVED: value("MESSAGE_RECEIVED"),
      MESSAGE_UPDATED: value("MESSAGE_UPDATED"),
      MESSAGE_SWIPED: value("MESSAGE_SWIPED"),
      CHAT_CHANGED: value("CHAT_CHANGED"),
      MESSAGE_DELETED: value("MESSAGE_DELETED")
    };
  }
  function buildReminderNotice(params) {
    const trigger = computeTriggerState(params);
    if (!trigger.shouldRemind || !trigger.range) return null;
    return {
      currentFloor: params.currentFloor,
      from: trigger.range.from,
      through: trigger.range.to
    };
  }
  function buildSummaryReminderNotice(params, trigger = computeSummaryTriggerState(params)) {
    if (!trigger.shouldRemind) return null;
    return {
      currentFloor: params.currentFloor,
      distance: trigger.distance
    };
  }
  function buildReminderDecision(params) {
    const timeline = params.timelineEnabled === false ? null : buildReminderNotice(params.timeline);
    if (timeline) return { kind: "timeline", notice: timeline };
    const summary = params.summaryEnabled === false ? null : buildSummaryReminderNotice(params.summary, params.summaryTrigger);
    return summary ? { kind: "summary", notice: summary } : null;
  }

  // src/plugin/regex-controller.ts
  var FLUX_WINDOW_REGEX_ID = "1a7548c3-d1c5-4fc2-8955-1933510e164c";
  var ARCHIVE_ONLY_REGEX_ID = "dd0c4c41-36dd-4c99-87bc-6e77eec4252e";
  var PRESET_TARGET = { type: "preset", name: "in_use" };
  var FLUX_MIN_DEPTH = 11;
  var FLUX_DEFAULT_MAX_DEPTH = 50;
  function createRegexDepthController(options) {
    const updateRegexes = options.updateTavernRegexesWith;
    const warn = options.warn ?? ((message, error) => {
      if (error === void 0) console.warn(message);
      else console.warn(message, error);
    });
    let appliedW = null;
    let activeW = null;
    let pendingW = null;
    let running = null;
    let destroyed = false;
    let warnedMissingApi = false;
    let lastMissingIds = "";
    const report = (message, error) => {
      try {
        warn(message, error);
      } catch {
      }
    };
    const applyWindow = async (w) => {
      if (!updateRegexes) {
        if (!warnedMissingApi) {
          warnedMissingApi = true;
          report("缺少运行时 API updateTavernRegexesWith，已跳过 preset/in_use 正则深度同步");
        }
        return false;
      }
      let foundFlux = false;
      let foundArchiveOnly = false;
      try {
        await updateRegexes(
          (regexes) => {
            for (const regex of regexes) {
              if (regex.id === FLUX_WINDOW_REGEX_ID) {
                foundFlux = true;
                regex.min_depth = FLUX_MIN_DEPTH;
                regex.max_depth = w;
              } else if (regex.id === ARCHIVE_ONLY_REGEX_ID) {
                foundArchiveOnly = true;
                regex.min_depth = w + 1;
                regex.max_depth = null;
              }
            }
            return regexes;
          },
          PRESET_TARGET
        );
      } catch (error) {
        report(`更新 preset/in_use 正则深度失败（W=${w}）`, error);
        return false;
      }
      const missingIds = [
        ...!foundFlux ? [FLUX_WINDOW_REGEX_ID] : [],
        ...!foundArchiveOnly ? [ARCHIVE_ONLY_REGEX_ID] : []
      ];
      const missingKey = missingIds.join(",");
      if (missingKey && missingKey !== lastMissingIds) {
        report(`preset/in_use 缺少固定正则 UUID：${missingIds.join("、")}`);
      }
      lastMissingIds = missingKey;
      return true;
    };
    const drain = async () => {
      while (!destroyed && pendingW !== null) {
        const w = pendingW;
        pendingW = null;
        if (w === appliedW) continue;
        activeW = w;
        const applied = await applyWindow(w);
        activeW = null;
        appliedW = applied ? w : null;
      }
    };
    const startDrain = () => {
      if (destroyed || running !== null || pendingW === null) return;
      const task = drain().catch((error) => {
        activeW = null;
        report("正则深度同步控制器发生未预期错误", error);
      });
      running = task;
      void task.then(() => {
        if (running !== task) return;
        running = null;
        if (!destroyed && pendingW !== null) startDrain();
      });
    };
    return {
      request(window2) {
        if (destroyed) return;
        const w = window2.fluxMaxDepth;
        if (!Number.isSafeInteger(w) || w < 0) {
          report(`收到无效的正则深度桶 W=${String(w)}，已跳过`);
          return;
        }
        if (activeW === null && pendingW === null && w === appliedW) return;
        if (w === pendingW) return;
        pendingW = w;
        startDrain();
      },
      restoreDefault() {
        if (destroyed) return;
        pendingW = FLUX_DEFAULT_MAX_DEPTH;
        startDrain();
      },
      async flush() {
        while (true) {
          startDrain();
          const task = running;
          if (!task) return;
          await task;
          await Promise.resolve();
        }
      },
      destroy() {
        destroyed = true;
        pendingW = null;
      }
    };
  }

  // src/core/archive-format.ts
  var TAG = "World_Archive";
  var OPEN = {
    live: `<${TAG}>`,
    old: `<old_${TAG}>`,
    pending: `<${TAG}_pending>`
  };
  var CLOSE = {
    live: `</${TAG}>`,
    old: `</old_${TAG}>`,
    pending: `</${TAG}_pending>`
  };
  var EXCERPT_MARKERS = ["·", "•", "・"];
  var EXCERPT_MARK = "·";
  var CONTAINER_LINE = /^《\s*([^《》]*?)\s*》$/;
  var FRAGMENT_LINE = /^\[\s*([^[\]]*?)\s*\]$/;
  var STRAY_TAG_LINE = /^<\/?[A-Za-z_][\w:.-]*(\s[^<>]*)?\/?>$/;
  function tagIndices(text, tag) {
    const out = [];
    for (let i = text.indexOf(tag); i !== -1; i = text.indexOf(tag, i + tag.length)) out.push(i);
    return out;
  }
  function blocksForGen(text, gen) {
    const open = OPEN[gen];
    const close = CLOSE[gen];
    const opens = tagIndices(text, open);
    const closes = tagIndices(text, close);
    const blocks = [];
    let consumed = -1;
    for (const c of closes) {
      let best = -1;
      for (const o of opens) {
        if (o >= c) break;
        if (o > consumed) best = o;
      }
      if (best === -1) continue;
      const end = c + close.length;
      blocks.push({ generation: gen, raw: text.slice(best, end), inner: text.slice(best + open.length, c).trim(), span: [best, end] });
      consumed = c;
    }
    return blocks;
  }
  function extractArchiveBlocks(text) {
    const blocks = [];
    for (const gen of ["live", "old", "pending"]) blocks.push(...blocksForGen(text, gen));
    return blocks.sort((a, b) => a.span[0] - b.span[0]);
  }
  function extractLastArchiveBlock(text, generation = "live") {
    const close = CLOSE[generation];
    const closeAt = text.lastIndexOf(close);
    if (closeAt < 0) return null;
    const end = closeAt + close.length;
    return blocksForGen(text, generation).find((b) => b.span[1] === end) ?? null;
  }
  function repairStructureLines(inner, fixes) {
    return inner.split("\n").map((raw) => {
      const line = raw.trim();
      if (line.startsWith("《") && !line.includes("》")) {
        fixes.push("补上容器标题闭合符 》");
        return `${raw}》`;
      }
      if (line.startsWith("[") && !line.includes("]")) {
        fixes.push("补上片段标题闭合符 ]");
        return `${raw}]`;
      }
      return raw;
    }).join("\n");
  }
  function repairArchiveOutput(text) {
    let repaired = text;
    const fixes = [];
    const lastOpen = repaired.lastIndexOf(OPEN.live);
    const lastClose = repaired.lastIndexOf(CLOSE.live);
    if (lastOpen >= 0 && lastOpen > lastClose) {
      repaired = `${repaired.trimEnd()}
${CLOSE.live}`;
      fixes.push(`补上 ${CLOSE.live}`);
    } else if (lastOpen < 0 && lastClose < 0) {
      const thinkingEnd = repaired.lastIndexOf("</thinking>");
      const searchFrom = thinkingEnd >= 0 ? thinkingEnd + "</thinking>".length : 0;
      const tail = repaired.slice(searchFrom);
      const container = tail.match(/^\s*《[^\n]*$/m);
      if (container && container.index !== void 0) {
        const body = tail.slice(container.index).trim();
        repaired = `${repaired.slice(0, searchFrom).trimEnd()}${searchFrom > 0 ? "\n" : ""}${OPEN.live}
${body}
${CLOSE.live}`;
        fixes.push(`补上 ${OPEN.live}…${CLOSE.live} 外壳`);
      }
    }
    const block = extractLastArchiveBlock(repaired, "live");
    if (block) {
      const inner = repairStructureLines(block.inner, fixes);
      if (inner !== block.inner) {
        const rebuilt = `${OPEN.live}
${inner}
${CLOSE.live}`;
        repaired = repaired.slice(0, block.span[0]) + rebuilt + repaired.slice(block.span[1]);
      }
    }
    return { text: repaired, changed: fixes.length > 0, fixes: [...new Set(fixes)] };
  }
  function extractCoverageMarkers(text) {
    const re = /<!--\s*archived:\s*(?:\d+\s*-\s*)?(\d+)\s*-->/g;
    const markers = [];
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      markers.push({ through: Number(m[1]), span: [m.index, m.index + m[0].length] });
    }
    return markers;
  }
  function makeCoverageMarker(through) {
    return `<!-- archived: ${through} -->`;
  }
  function withMarkerInside(body, through) {
    return `${body}
${makeCoverageMarker(through)}`;
  }
  function hasCoverageMarker(text) {
    return /<!--\s*archived:\s*\d+\s*-->/.test(text);
  }
  function stripComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  function commentWrap(text) {
    return `<!-- ${text} -->`;
  }
  function commentWrapLastContainer(inner) {
    const lines = inner.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) if (CONTAINER_LINE.test(lines[i].trim())) start = i;
    if (start === -1) return inner;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (CONTAINER_LINE.test(lines[i].trim()) || /<!--\s*archived:/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const head = lines.slice(0, start).join("\n").replace(/\n+$/, "");
    const wrapped = commentWrap(lines.slice(start, end).join("\n").trim());
    const tail = lines.slice(end).join("\n").replace(/^\n+/, "");
    return [head, wrapped, tail].filter((s) => s.length > 0).join("\n");
  }
  function splitLabel(raw) {
    const parts = raw.split("|").map((s) => s.trim());
    if (parts.length <= 1) return { title: raw.trim(), keywords: null, time: null };
    const title = parts[0];
    const time = parts[parts.length - 1] || null;
    const keywords = parts.length >= 3 ? parts.slice(1, -1).join(" | ") || null : null;
    return { title, keywords, time };
  }
  function excerptMark(line) {
    for (const mark of EXCERPT_MARKERS) if (line.startsWith(mark)) return mark;
    return null;
  }
  function newContainer(kind, label2) {
    const { title, keywords, time } = splitLabel(label2);
    return { kind, title, time, keywords, summary: "", fragments: [] };
  }
  function parseArchiveBody(rawInner) {
    const inner = stripComments(rawInner);
    const nodes = [];
    let node = null;
    let container = null;
    let fragment = null;
    const appendSummary = (line) => {
      if (fragment) fragment.summary = fragment.summary ? `${fragment.summary}
${line}` : line;
      else if (node) node.summary = node.summary ? `${node.summary}
${line}` : line;
    };
    for (const rawLine of inner.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (STRAY_TAG_LINE.test(line)) continue;
      const cm = line.match(CONTAINER_LINE);
      if (cm) {
        node = container = newContainer("container", cm[1]);
        fragment = null;
        nodes.push(node);
        continue;
      }
      const fm = line.match(FRAGMENT_LINE);
      if (fm) {
        const fieldCount = fm[1].split("|").length;
        if (fieldCount >= 3 || !container) {
          node = newContainer("segment", fm[1]);
          container = null;
          fragment = null;
          nodes.push(node);
        } else {
          const { title, time } = splitLabel(fm[1]);
          fragment = { title, time, summary: "", excerpts: [] };
          container.fragments.push(fragment);
        }
        continue;
      }
      const mark = excerptMark(line);
      if (mark) {
        const ex = { text: line.slice(mark.length).trim() };
        if (fragment) fragment.excerpts.push(ex);
        else if (node) (node.looseExcerpts ?? (node.looseExcerpts = [])).push(ex);
        continue;
      }
      appendSummary(line);
    }
    return nodes;
  }
  function labelToken(open, close, title, keywords, time) {
    const parts = [title];
    if (keywords) parts.push(keywords);
    if (time) parts.push(time);
    return `${open}${parts.join(" | ")}${close}`;
  }
  function serializeContainers(nodes) {
    const blocks = [];
    for (const c of nodes) {
      const [open, close] = c.kind === "segment" ? ["[", "]"] : ["《", "》"];
      const lines = [labelToken(open, close, c.title, c.keywords, c.time)];
      if (c.summary) lines.push(c.summary);
      for (const ex of c.looseExcerpts ?? []) lines.push(`${EXCERPT_MARK} ${ex.text}`);
      for (const f of c.fragments) {
        lines.push("");
        lines.push(labelToken("[", "]", f.title, null, f.time));
        if (f.summary) lines.push(f.summary);
        for (const ex of f.excerpts) lines.push(`${EXCERPT_MARK} ${ex.text}`);
      }
      blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n").trim();
  }
  function wrapArchive(body, generation = "live") {
    return `${OPEN[generation]}
${body}
${CLOSE[generation]}`;
  }
  function parseArchiveNodes(inner) {
    const nodes = [];
    for (const part of inner.split(/(<!--[\s\S]*?-->)/g)) {
      if (!part.trim()) continue;
      if (/^<!--[\s\S]*-->$/.test(part.trim())) {
        nodes.push({ type: "comment", raw: part.trim() });
      } else {
        for (const container of parseArchiveBody(part)) nodes.push({ type: "container", container });
      }
    }
    return nodes;
  }
  function serializeArchiveNodes(nodes) {
    const pieces = [];
    let buf = [];
    const flush = () => {
      if (buf.length) {
        pieces.push(serializeContainers(buf));
        buf = [];
      }
    };
    for (const n of nodes) {
      if (n.type === "container") buf.push(n.container);
      else {
        flush();
        pieces.push(n.raw);
      }
    }
    flush();
    return pieces.join("\n\n").trim();
  }
  function setGeneration(raw, to) {
    const trimmed = raw.trim();
    for (const from of ["live", "old", "pending"]) {
      if (trimmed.startsWith(OPEN[from]) && trimmed.endsWith(CLOSE[from])) {
        const inner = trimmed.slice(OPEN[from].length, trimmed.length - CLOSE[from].length);
        return `${OPEN[to]}${inner}${CLOSE[to]}`;
      }
    }
    return raw;
  }
  function supersedeLastContainer(archiveRaw) {
    const trimmed = archiveRaw.trim();
    for (const gen of ["live", "old", "pending"]) {
      if (trimmed.startsWith(OPEN[gen]) && trimmed.endsWith(CLOSE[gen])) {
        const inner = trimmed.slice(OPEN[gen].length, trimmed.length - CLOSE[gen].length).trim();
        return `${OPEN[gen]}
${commentWrapLastContainer(inner)}
${CLOSE[gen]}`;
      }
    }
    return archiveRaw;
  }
  function hard(code, message, extra) {
    return { severity: "hard", code, message, ...extra };
  }
  function soft(code, message, extra) {
    return { severity: "soft", code, message, ...extra };
  }
  function brokenTokenIssue(line) {
    if (line.startsWith("《") && !CONTAINER_LINE.test(line)) {
      return hard("CONTAINER_TOKEN_BROKEN", `容器标题 token 不完整或未独立成行：「${line}」`);
    }
    if (line.startsWith("》")) {
      return hard("CONTAINER_TOKEN_BROKEN", `落单的容器闭合符 》：「${line}」`);
    }
    if (line.startsWith("[") && !FRAGMENT_LINE.test(line)) {
      return hard("FRAGMENT_TOKEN_BROKEN", `片段标题 token 不完整或未独立成行：「${line}」`);
    }
    return null;
  }
  function validateArchive(text) {
    const issues = [];
    const lastOpen = text.lastIndexOf(OPEN.live);
    const lastClose = text.lastIndexOf(CLOSE.live);
    const hasOpen = lastOpen >= 0;
    const block = lastOpen > lastClose ? null : extractLastArchiveBlock(text, "live");
    if (!block) {
      issues.push(
        hasOpen ? hard("SHELL_UNCLOSED", `<${TAG}> 外壳未闭合（缺 </${TAG}>）`) : hard("SHELL_MISSING", `缺少 <${TAG}>…</${TAG}> 外壳`)
      );
      return { ok: false, issues, block: null, containers: [] };
    }
    for (const rawLine of block.inner.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const broken = brokenTokenIssue(line);
      if (broken) issues.push(broken);
    }
    const containers = parseArchiveBody(block.inner);
    const realContainers = containers.filter((c) => c.kind === "container");
    if (realContainers.length === 0) {
      issues.push(hard("NO_CONTAINER", "外壳内无任何时间轴容器《》"));
    }
    containers.forEach((c, ci) => {
      if (c.kind !== "container") return;
      if (!c.summary.trim()) {
        issues.push(hard("CONTAINER_SUMMARY_EMPTY", `容器《${c.title || "?"}》缺大总结`, { containerIndex: ci }));
      }
      if (c.time === null) {
        issues.push(soft("CONTAINER_TIME_MISSING", `容器《${c.title || "?"}》标题缺「| 时间」字段`, { containerIndex: ci }));
      }
      const hasLoose = (c.looseExcerpts?.length ?? 0) > 0;
      if (c.fragments.length === 0 && !hasLoose) {
        issues.push(soft("CONTAINER_NO_FRAGMENT", `容器《${c.title || "?"}》只有大总结、无任何片段/摘录`, { containerIndex: ci }));
      }
      c.fragments.forEach((f, fi) => {
        if (f.time === null) {
          issues.push(soft("FRAGMENT_TIME_MISSING", `片段[${f.title || "?"}]标题缺「| 时间」字段`, { containerIndex: ci, fragmentIndex: fi }));
        }
        if (f.summary.trim() && f.excerpts.length === 0) {
          issues.push(soft("FRAGMENT_NO_EXCERPT", `片段[${f.title || "?"}]有小总结但无摘录`, { containerIndex: ci, fragmentIndex: fi }));
        }
        for (const ex of f.excerpts) {
          const open = (ex.text.match(/「/g) ?? []).length;
          const close = (ex.text.match(/」/g) ?? []).length;
          if (open !== close) {
            issues.push(soft("BRACKET_UNBALANCED", `摘录里「」疑似不闭合：「${ex.text}」`, { containerIndex: ci, fragmentIndex: fi }));
            break;
          }
        }
      });
    });
    return { ok: !issues.some((i) => i.severity === "hard"), issues, block, containers };
  }

  // src/core/summary-format.ts
  function tokenIndices(text, token) {
    const indices = [];
    for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) {
      indices.push(i);
    }
    return indices;
  }
  function htmlCommentSpans(text) {
    const spans = [];
    const re = /<!--[\s\S]*?-->/g;
    for (let match = re.exec(text); match !== null; match = re.exec(text)) {
      spans.push([match.index, match.index + match[0].length]);
    }
    return spans;
  }
  function blocksForTag(text, tag) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const opens = tokenIndices(text, open);
    const closes = tokenIndices(text, close);
    const blocks = [];
    let consumedThrough = -1;
    for (const closeAt of closes) {
      let openAt = -1;
      for (const candidate of opens) {
        if (candidate >= closeAt) break;
        if (candidate > consumedThrough) openAt = candidate;
      }
      if (openAt < 0) continue;
      const end = closeAt + close.length;
      blocks.push({
        tag,
        raw: text.slice(openAt, end),
        inner: text.slice(openAt + open.length, closeAt).trim(),
        span: [openAt, end]
      });
      consumedThrough = closeAt;
    }
    return blocks;
  }
  function extractFluxBlocks(text) {
    const comments = htmlCommentSpans(text);
    return [...blocksForTag(text, "Flux"), ...blocksForTag(text, "Causal_Flux")].filter((block) => !comments.some(([start, end]) => block.span[0] >= start && block.span[1] <= end)).sort((a, b) => a.span[0] - b.span[0]);
  }
  function collectTargetFlux(messages, x, sourceThrough) {
    const lowerExclusive = x ?? Number.NEGATIVE_INFINITY;
    const blocks = [];
    for (const message of messages) {
      if (message.message_id <= lowerExclusive || message.message_id > sourceThrough) continue;
      for (const block of extractFluxBlocks(message.message)) {
        blocks.push({ ...block, floor: message.message_id });
      }
    }
    return blocks.sort((a, b) => a.floor - b.floor || a.span[0] - b.span[0]);
  }
  function hard2(code, message, extra) {
    return { severity: "hard", code, message, ...extra };
  }
  function soft2(code, message, extra) {
    return { severity: "soft", code, message, ...extra };
  }
  var FLAT_SEGMENT_LINE = /^\[\s*([^\[\]]*?)\s*\]$/;
  function hasMeaningfulSummary(segment) {
    return segment.summary.split("\n").some((rawLine) => {
      const line = rawLine.trim();
      if (!line) return false;
      return !(line.startsWith("[") && !FLAT_SEGMENT_LINE.test(line));
    });
  }
  function validateSummaryArchive(text) {
    const issues = [];
    const open = `<${TAG}>`;
    const close = `</${TAG}>`;
    const lastOpen = text.lastIndexOf(open);
    const lastClose = text.lastIndexOf(close);
    const hasOpen = lastOpen >= 0;
    const block = lastOpen > lastClose ? null : extractLastArchiveBlock(text, "live");
    if (!block) {
      issues.push(
        hasOpen ? hard2("SHELL_UNCLOSED", `${open} 外壳未闭合（缺 ${close}）`) : hard2("SHELL_MISSING", `缺少 ${open}…${close} 外壳`)
      );
      return { ok: false, issues, block: null, nodes: [], segments: [] };
    }
    if (extractCoverageMarkers(block.raw).length > 0) {
      issues.push(hard2("ARCHIVED_MARKER_FORBIDDEN", "普通 Archive 不得包含 archived 覆盖标记"));
    }
    for (const rawLine of stripComments(block.inner).split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("[") && !FLAT_SEGMENT_LINE.test(line)) {
        issues.push(soft2("SEGMENT_TOKEN_BROKEN", `事件段标题 token 疑似不完整：「${line}」`));
      }
    }
    const nodes = parseArchiveBody(block.inner);
    const segments = nodes.filter((node) => node.kind === "segment");
    const containers = nodes.filter((node) => node.kind === "container");
    if (segments.length === 0) {
      issues.push(hard2("NO_SEGMENT", "外壳内无任何普通扁平事件段 []"));
    }
    if (containers.length > 0) {
      issues.push(soft2("CONTAINER_UNEXPECTED", "普通 Archive 应使用扁平事件段 []，不需要《容器》"));
    }
    segments.forEach((segment) => {
      const index = nodes.indexOf(segment);
      if (!hasMeaningfulSummary(segment)) {
        issues.push(
          hard2("SEGMENT_SUMMARY_EMPTY", `事件段[${segment.title || "?"}]缺总结正文`, {
            containerIndex: index
          })
        );
      }
      if (!segment.title.trim()) {
        issues.push(soft2("SEGMENT_TITLE_MISSING", "事件段标题为空", { containerIndex: index }));
      }
      if (segment.keywords === null) {
        issues.push(
          soft2("SEGMENT_KEYWORDS_MISSING", `事件段[${segment.title || "?"}]缺情绪/感知关键词字段`, {
            containerIndex: index
          })
        );
      }
      if (segment.time === null) {
        issues.push(
          soft2("SEGMENT_TIME_MISSING", `事件段[${segment.title || "?"}]缺起止时间字段`, {
            containerIndex: index
          })
        );
      }
    });
    return {
      ok: !issues.some((issue) => issue.severity === "hard"),
      issues,
      block,
      nodes,
      segments
    };
  }

  // src/core/locator.ts
  function pairMarkers(text, blocks, markers) {
    const remaining = markers.slice();
    const result = blocks.map(() => null);
    blocks.forEach((b, i) => {
      const idx = remaining.findIndex((m) => m.span[0] >= b.span[0] && m.span[1] <= b.span[1]);
      if (idx !== -1) result[i] = remaining.splice(idx, 1)[0];
    });
    blocks.forEach((b, i) => {
      if (result[i]) return;
      const idx = remaining.findIndex((m) => {
        const insideSomeBlock = blocks.some((other) => m.span[0] >= other.span[0] && m.span[1] <= other.span[1]);
        if (insideSomeBlock || m.span[1] > b.span[0]) return false;
        return text.slice(m.span[1], b.span[0]).trim() === "";
      });
      if (idx !== -1) result[i] = remaining.splice(idx, 1)[0];
    });
    return result;
  }
  function buildLocatorTable(messages) {
    const table = [];
    for (const msg of messages) {
      const blocks = extractArchiveBlocks(msg.message);
      if (blocks.length === 0) continue;
      const markers = extractCoverageMarkers(msg.message);
      const paired = pairMarkers(msg.message, blocks, markers);
      const lastBlock = blocks[blocks.length - 1];
      blocks.forEach((b, i) => {
        if (b.generation === "live" && b !== lastBlock) return;
        const m = paired[i];
        table.push({
          messageId: msg.message_id,
          generation: b.generation,
          through: m ? m.through : null,
          content: b.inner,
          size: b.inner.length,
          raw: b.raw,
          span: b.span
        });
      });
    }
    return table.sort((a, b) => a.messageId - b.messageId || a.span[0] - b.span[0]);
  }
  function liveEntries(table) {
    return table.filter((e) => e.generation === "live");
  }
  function latestLiveArchiveFloor(table) {
    let latest = null;
    for (const entry of table) {
      if (entry.generation !== "live") continue;
      if (latest === null || entry.messageId > latest) latest = entry.messageId;
    }
    return latest;
  }
  function totalLiveSize(table) {
    return liveEntries(table).reduce((sum, e) => sum + e.size, 0);
  }
  function deriveBoundary(table) {
    let end = null;
    for (const e of table) {
      if (e.generation === "old") continue;
      if (e.through !== null && (end === null || e.through > end)) end = e.through;
    }
    return end;
  }
  function hasOrphanPending(table) {
    return table.some((e) => e.generation === "pending");
  }

  // src/core/commit.ts
  function replaceSpanExact(text, span, expected, replacement) {
    const [start, end] = span;
    if (start < 0 || end < start || text.slice(start, end) !== expected) {
      throw new Error("提交前档案位置或内容已变化，请刷新并重新生成");
    }
    return text.slice(0, start) + replacement + text.slice(end);
  }
  function replaceLastExact(text, expected, replacement) {
    const start = text.lastIndexOf(expected);
    if (start < 0) throw new Error("提交现场缺少本次 pending，已停止转正");
    return text.slice(0, start) + replacement + text.slice(start + expected.length);
  }
  function planCommit(d) {
    for (const r of d.retire) {
      if (r.blockRaw.includes("<World_Archive_pending>")) {
        throw new Error("planCommit: 退役目标不应是 pending 块（pending 走转正、不走退役）");
      }
    }
    if (d.supersede && d.retire.some((r) => r.message_id === d.supersede.message_id)) {
      throw new Error("planCommit: 同一楼层不能同时作为原始档退役与既存档覆写目标");
    }
    const steps = [];
    const marker = makeCoverageMarker(d.through);
    const pendingBlock = wrapArchive(withMarkerInside(d.pendingBody, d.through), "pending");
    const liveBlock = setGeneration(pendingBlock, "live");
    const work = /* @__PURE__ */ new Map([[d.targetMessageId, d.targetMessageText]]);
    for (const r of d.retire) {
      if (!work.has(r.message_id)) work.set(r.message_id, r.message);
    }
    if (d.supersede && !work.has(d.supersede.message_id)) work.set(d.supersede.message_id, d.supersede.message);
    const beforeWrite = work.get(d.targetMessageId);
    const afterWrite = `${beforeWrite}

${pendingBlock}`;
    work.set(d.targetMessageId, afterWrite);
    steps.push({
      phase: "write-pending",
      message_id: d.targetMessageId,
      message: afterWrite,
      expectedBefore: beforeWrite,
      note: `写 pending + 内嵌覆盖标记 →${d.through}`,
      verify: { includes: [marker, "<World_Archive_pending>"], excludes: [] }
    });
    const retireInSafeOrder = [...d.retire].sort(
      (a, b) => a.message_id - b.message_id || b.blockSpan[0] - a.blockSpan[0]
    );
    for (const r of retireInSafeOrder) {
      const retiredBlock = setGeneration(r.blockRaw, "old");
      const before = work.get(r.message_id);
      const next = replaceSpanExact(before, r.blockSpan, r.blockRaw, retiredBlock);
      work.set(r.message_id, next);
      steps.push({
        phase: "retire-old",
        message_id: r.message_id,
        message: next,
        expectedBefore: before,
        note: `退役楼层 ${r.message_id} 上的旧档`,
        verify: { includes: [retiredBlock], excludes: [] }
      });
    }
    if (d.supersede) {
      const superseded = supersedeLastContainer(d.supersede.blockRaw);
      if (superseded === d.supersede.blockRaw) {
        throw new Error(`planCommit: 层 ${d.supersede.message_id} 的既存档没有可覆写的末尾容器`);
      }
      const before = work.get(d.supersede.message_id);
      const next = replaceSpanExact(before, d.supersede.blockSpan, d.supersede.blockRaw, superseded);
      work.set(d.supersede.message_id, next);
      steps.push({
        phase: "supersede",
        message_id: d.supersede.message_id,
        message: next,
        expectedBefore: before,
        note: `增量覆写：注释包裹既存档末尾容器（层 ${d.supersede.message_id}）`,
        verify: { includes: ["<!-- 《"], excludes: [] }
      });
    }
    const beforePromote = work.get(d.targetMessageId);
    const afterPromote = replaceLastExact(beforePromote, pendingBlock, liveBlock);
    work.set(d.targetMessageId, afterPromote);
    steps.push({
      phase: "promote-live",
      message_id: d.targetMessageId,
      message: afterPromote,
      expectedBefore: beforePromote,
      note: "pending → live 转正",
      verify: { includes: [liveBlock], excludes: ["<World_Archive_pending>"] }
    });
    return steps;
  }
  async function executeCommit(plan, deps, hooks = {}) {
    for (const [stepIndex, step] of plan.entries()) {
      const before = deps.getChatMessages(step.message_id).find((m) => m.message_id === step.message_id)?.message ?? "";
      if (before !== step.expectedBefore) {
        throw new Error(`提交前楼层 ${step.message_id} 已被改动（@${step.phase}），已停止以免覆盖新内容`);
      }
      await deps.setChatMessages([{ message_id: step.message_id, message: step.message }], { refresh: "none" });
      const back = deps.getChatMessages(step.message_id).find((m) => m.message_id === step.message_id)?.message ?? "";
      for (const inc of step.verify.includes) {
        if (!back.includes(inc)) throw new Error(`两段提交落盘校验失败 @${step.phase} 楼层 ${step.message_id}：缺「${inc.slice(0, 24)}…」`);
      }
      for (const exc of step.verify.excludes) {
        if (back.includes(exc)) throw new Error(`两段提交落盘校验失败 @${step.phase} 楼层 ${step.message_id}：残留「${exc}」`);
      }
      if (back !== step.message) {
        throw new Error(`两段提交落盘校验失败 @${step.phase} 楼层 ${step.message_id}：完整正文与计划不一致`);
      }
      await hooks.afterStepVerified?.(step, stepIndex);
    }
  }
  function detectInterruptedCommit(table) {
    if (!hasOrphanPending(table)) return [];
    return table.filter((e) => e.generation === "pending");
  }
  function planRollbackPending(messageText, pendingRaw, pendingSpan) {
    if (pendingSpan) {
      const [rawStart, end] = pendingSpan;
      if (messageText.slice(rawStart, end) !== pendingRaw) {
        throw new Error("pending 已变化，拒绝按旧位置删除");
      }
      let start = rawStart;
      while (start > 0 && messageText[start - 1] === "\n") start -= 1;
      return (messageText.slice(0, start) + messageText.slice(end)).trimEnd();
    }
    const escaped = pendingRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return messageText.replace(new RegExp(`\\n*${escaped}`), "").trimEnd();
  }

  // src/plugin/commit-log.ts
  var COMMIT_LOG_KEY = "memoryArchiverCommitTx";
  var COMMIT_LOG_VERSION = 1;
  function isRecord2(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function isFloor(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  function isTimestamp(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
  function normalizeFloors(floors) {
    return [...new Set(floors)].sort((a, b) => a - b);
  }
  function cloneLog(log) {
    return {
      ...log,
      plannedOldFloors: [...log.plannedOldFloors],
      oldSucceededFloors: [...log.oldSucceededFloors],
      supersede: log.supersede ? { ...log.supersede } : null
    };
  }
  function parseFloorArray(value) {
    if (!Array.isArray(value) || !value.every(isFloor)) return null;
    return normalizeFloors(value);
  }
  function parseCommitLog(raw) {
    if (!isRecord2(raw) || raw.version !== COMMIT_LOG_VERSION) return null;
    if (typeof raw.txId !== "string" || !raw.txId) return null;
    if (!isFloor(raw.targetFloor) || !isFloor(raw.through)) return null;
    const plannedOldFloors = parseFloorArray(raw.plannedOldFloors);
    const oldSucceededFloors = parseFloorArray(raw.oldSucceededFloors);
    if (!plannedOldFloors || !oldSucceededFloors) return null;
    if (!oldSucceededFloors.every((floor) => plannedOldFloors.includes(floor))) return null;
    if (typeof raw.pendingWritten !== "boolean") return null;
    if (raw.promotedFloor !== null && !isFloor(raw.promotedFloor)) return null;
    const statuses = ["prepared", "committing", "failed", "completed"];
    if (!statuses.includes(raw.status)) return null;
    if (!isTimestamp(raw.startedAt) || !isTimestamp(raw.updatedAt)) return null;
    if (raw.completedAt !== null && !isTimestamp(raw.completedAt)) return null;
    if (raw.error !== null && typeof raw.error !== "string") return null;
    let supersede = null;
    if (raw.supersede !== null) {
      if (!isRecord2(raw.supersede)) return null;
      if (!isFloor(raw.supersede.plannedFloor) || typeof raw.supersede.done !== "boolean") return null;
      supersede = { plannedFloor: raw.supersede.plannedFloor, done: raw.supersede.done };
    }
    return {
      version: COMMIT_LOG_VERSION,
      txId: raw.txId,
      targetFloor: raw.targetFloor,
      through: raw.through,
      plannedOldFloors,
      oldSucceededFloors,
      pendingWritten: raw.pendingWritten,
      promotedFloor: raw.promotedFloor,
      supersede,
      status: raw.status,
      startedAt: raw.startedAt,
      updatedAt: raw.updatedAt,
      completedAt: raw.completedAt,
      error: raw.error
    };
  }
  function createCommitLog(input, now = Date.now()) {
    if (!isFloor(input.targetFloor) || !isFloor(input.through)) {
      throw new Error("提交日志的目标楼层或覆盖端点无效");
    }
    if (!input.plannedOldFloors.every(isFloor)) throw new Error("提交日志包含无效的退役楼层");
    if (input.supersedeFloor != null && !isFloor(input.supersedeFloor)) {
      throw new Error("提交日志包含无效的增量覆写楼层");
    }
    if (!isTimestamp(now)) throw new Error("提交日志时间戳无效");
    const txId = input.txId?.trim() || `mem-${input.targetFloor}-${input.through}-${now.toString(36)}`;
    return {
      version: COMMIT_LOG_VERSION,
      txId,
      targetFloor: input.targetFloor,
      through: input.through,
      plannedOldFloors: normalizeFloors(input.plannedOldFloors),
      oldSucceededFloors: [],
      pendingWritten: false,
      promotedFloor: null,
      supersede: input.supersedeFloor == null ? null : { plannedFloor: input.supersedeFloor, done: false },
      status: "prepared",
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      error: null
    };
  }
  function loadCommitLog(deps) {
    return parseCommitLog(deps.getVariables({ type: "chat" })[COMMIT_LOG_KEY]);
  }
  function saveCommitLog(deps, log) {
    deps.insertOrAssignVariables({ [COMMIT_LOG_KEY]: cloneLog(log) }, { type: "chat" });
  }
  function clearCommitLog(deps) {
    deps.insertOrAssignVariables({ [COMMIT_LOG_KEY]: null }, { type: "chat" });
  }
  function markCommitStepSucceeded(log, step, now = Date.now()) {
    if (!isTimestamp(now)) throw new Error("提交日志时间戳无效");
    const next = cloneLog(log);
    next.status = "committing";
    next.updatedAt = now;
    next.completedAt = null;
    next.error = null;
    switch (step.phase) {
      case "write-pending":
        if (step.message_id !== next.targetFloor) throw new Error("pending 落盘楼层与日志目标不一致");
        next.pendingWritten = true;
        break;
      case "retire-old":
        if (!next.plannedOldFloors.includes(step.message_id)) {
          throw new Error(`楼层 ${step.message_id} 不在本次计划退役列表中`);
        }
        next.oldSucceededFloors = normalizeFloors([...next.oldSucceededFloors, step.message_id]);
        break;
      case "supersede":
        if (!next.supersede || next.supersede.plannedFloor !== step.message_id) {
          throw new Error(`楼层 ${step.message_id} 不是本次计划的增量覆写目标`);
        }
        next.supersede.done = true;
        break;
      case "promote-live":
        if (step.message_id !== next.targetFloor) throw new Error("pending 转正楼层与日志目标不一致");
        if (!next.pendingWritten) throw new Error("pending 尚未记录落盘，不能记录转正");
        next.promotedFloor = step.message_id;
        break;
    }
    return next;
  }
  function markCommitLogFailed(log, error, now = Date.now()) {
    if (!isTimestamp(now)) throw new Error("提交日志时间戳无效");
    const next = cloneLog(log);
    next.status = "failed";
    next.updatedAt = now;
    next.completedAt = null;
    next.error = error instanceof Error ? error.message : String(error);
    return next;
  }
  function completeCommitLog(log, now = Date.now()) {
    if (!isTimestamp(now)) throw new Error("提交日志时间戳无效");
    const missingOld = log.plannedOldFloors.filter((floor) => !log.oldSucceededFloors.includes(floor));
    if (!log.pendingWritten) throw new Error("pending 尚未成功落盘");
    if (missingOld.length) throw new Error(`仍有退役楼层未成功：${missingOld.join("、")}`);
    if (log.supersede && !log.supersede.done) throw new Error("增量覆写尚未成功");
    if (log.promotedFloor !== log.targetFloor) throw new Error("pending 尚未在目标楼层转正");
    const next = cloneLog(log);
    next.status = "completed";
    next.updatedAt = now;
    next.completedAt = now;
    next.error = null;
    return next;
  }

  // src/plugin/regex-window.ts
  var RAW_CONTEXT_DEPTH = 10;
  var REGEX_DEPTH_STEP = 10;
  var INITIAL_FLUX_DEPTH = 50;
  function roundDepthUp(depth) {
    return Math.ceil(depth / REGEX_DEPTH_STEP) * REGEX_DEPTH_STEP;
  }
  function computeRegexDepthWindow(params) {
    const { currentFloor: q, latestArchiveFloor: x } = params;
    const unarchivedDepth = x === null ? q + 1 : Math.max(0, q - x);
    const minimumFluxDepth = x === null ? INITIAL_FLUX_DEPTH : RAW_CONTEXT_DEPTH;
    const fluxMaxDepth = Math.max(minimumFluxDepth, roundDepthUp(unarchivedDepth));
    return {
      unarchivedDepth,
      rawMaxDepth: RAW_CONTEXT_DEPTH,
      fluxMinDepth: RAW_CONTEXT_DEPTH + 1,
      fluxMaxDepth,
      archiveOnlyMinDepth: fluxMaxDepth + 1
    };
  }

  // src/plugin/chat-state.ts
  var ChatStateReader = class {
    constructor(deps) {
      __publicField(this, "deps", deps);
      __publicField(this, "chatIdentity", null);
      __publicField(this, "head", null);
      __publicField(this, "latestArchiveFloor", null);
      __publicField(this, "revision", 0);
      __publicField(this, "chatEpoch", 0);
    }
    peekHead() {
      return this.head;
    }
    currentChatEpoch() {
      return this.chatEpoch;
    }
    isCurrentChatEpoch(expected) {
      return expected === this.chatEpoch;
    }
    /** 真正切换聊天时忘掉旧 head；下次读取属于新聊天。 */
    reset(chatIdentity) {
      this.chatIdentity = chatIdentity;
      this.head = null;
      this.latestArchiveFloor = null;
      this.chatEpoch += 1;
      this.revision += 1;
    }
    /**
     * 标记“q 未必变，但聊天正文/档案索引已可能变化”。
     * 在权威扫描完成前保守忘掉 x：正则窗口会扩大为“尚无 x”，宁可多留上下文也不误裁 Flux。
     */
    markDirty() {
      this.latestArchiveFloor = null;
      this.revision += 1;
      if (this.head) {
        this.head = {
          ...this.head,
          latestLiveArchiveFloor: null,
          regexWindow: computeRegexDepthWindow({
            currentFloor: this.head.currentFloor,
            latestArchiveFloor: null
          }),
          revision: this.revision
        };
      }
    }
    /** 全插件读取 q 的唯一入口。 */
    syncHead() {
      const currentFloor = this.deps.getLastMessageId();
      if (this.head && this.head.chatIdentity === this.chatIdentity && this.head.currentFloor === currentFloor) {
        return this.head;
      }
      this.revision += 1;
      this.head = {
        chatIdentity: this.chatIdentity,
        chatEpoch: this.chatEpoch,
        currentFloor,
        latestLiveArchiveFloor: this.latestArchiveFloor,
        regexWindow: computeRegexDepthWindow({
          currentFloor,
          latestArchiveFloor: this.latestArchiveFloor
        }),
        revision: this.revision
      };
      return this.head;
    }
    /**
     * 按已经取得的 head 建一张权威表，不再读 q。
     * 消息删除/同聊天正文变更的事件点可用此保证“一个事件批次一次 q”。
     */
    scan(head = this.syncHead()) {
      if (head.chatIdentity !== this.chatIdentity || head.chatEpoch !== this.chatEpoch) {
        throw new Error("聊天已切换，拒绝使用旧的楼层快照");
      }
      const messages = this.deps.getChatMessages(`0-${head.currentFloor}`);
      const table = buildLocatorTable(messages);
      const latestArchiveFloor = latestLiveArchiveFloor(table);
      if (latestArchiveFloor !== this.latestArchiveFloor) {
        this.latestArchiveFloor = latestArchiveFloor;
        this.revision += 1;
      }
      const resolvedHead = {
        chatIdentity: head.chatIdentity,
        chatEpoch: head.chatEpoch,
        currentFloor: head.currentFloor,
        latestLiveArchiveFloor: latestArchiveFloor,
        regexWindow: computeRegexDepthWindow({
          currentFloor: head.currentFloor,
          latestArchiveFloor
        }),
        revision: this.revision
      };
      this.head = resolvedHead;
      return {
        ...resolvedHead,
        messages,
        table,
        derivedBoundary: deriveBoundary(table)
      };
    }
    /** 操作边界的新鲜快照：一次 q + 一次 0-q 扫描。 */
    scanFresh() {
      return this.scan(this.syncHead());
    }
  };

  // src/plugin/session.ts
  var GENERATION_TIMEOUT_MS = 5 * 60 * 1e3;
  var GenerationCancelledError = class extends Error {
    constructor() {
      super("已取消生成");
      this.name = "GenerationCancelledError";
    }
  };
  var GenerationTimeoutError = class extends Error {
    constructor(timeoutMs = GENERATION_TIMEOUT_MS) {
      const duration = timeoutMs === GENERATION_TIMEOUT_MS ? "5 分钟" : `${Math.ceil(timeoutMs / 1e3)} 秒`;
      super(`生成超过 ${duration}，已自动取消`);
      this.name = "GenerationTimeoutError";
    }
  };
  var ChatChangedDuringOperationError = class extends Error {
    constructor() {
      super("聊天已切换，已停止旧聊天的操作，未继续写入当前聊天");
      this.name = "ChatChangedDuringOperationError";
    }
  };
  var ArchiverSession = class {
    constructor(deps, config, generationTimeoutMs = GENERATION_TIMEOUT_MS, chatState) {
      __publicField(this, "deps", deps);
      __publicField(this, "config", config);
      __publicField(this, "generationTimeoutMs", generationTimeoutMs);
      __publicField(this, "phase", "idle");
      __publicField(this, "activeGeneration", null);
      __publicField(this, "generationSequence", 0);
      __publicField(this, "featureEnablementListeners", /* @__PURE__ */ new Set());
      /** 当前普通总结的冻结来源；首次失败后仍保留，供同一批来源重试。 */
      __publicField(this, "summaryRound", null);
      /** 提醒、UI、生成和提交共用的唯一聊天读取层。 */
      __publicField(this, "chatState");
      this.chatState = chatState ?? new ChatStateReader(deps);
    }
    assertCurrentChat(expectedEpoch) {
      if (!this.chatState.isCurrentChatEpoch(expectedEpoch)) {
        throw new ChatChangedDuringOperationError();
      }
    }
    /** 两段提交的每次读写都在同步调用点复核聊天世代；写 await 返回后再复核一次。 */
    guardedCommitDeps(expectedEpoch) {
      return {
        getChatMessages: (range) => {
          this.assertCurrentChat(expectedEpoch);
          return this.deps.getChatMessages(range);
        },
        setChatMessages: async (messages, option) => {
          this.assertCurrentChat(expectedEpoch);
          await this.deps.setChatMessages(messages, option);
          this.assertCurrentChat(expectedEpoch);
        }
      };
    }
    // ---- 刷新（只读，任何时候可调） -------------------------------------------
    refresh(read = this.chatState.scanFresh()) {
      const q = read.currentFloor;
      const previousFloor = this.config.lastKnownFloor;
      const p = previousFloor ?? q;
      const floorsDecreased = q < p;
      const table = read.table;
      const boundary = read.derivedBoundary ?? this.config.boundary ?? 0;
      const interrupted = detectInterruptedCommit(table);
      const commitLog = loadCommitLog(this.deps);
      const integrity = this.integrityCheck(table);
      const trigger = computeTriggerState({
        currentFloor: q,
        boundary,
        n: this.config.n,
        lastDismissedFloor: this.config.lastDismissedFloor
      });
      const summaryTrigger = computeSummaryTriggerState({
        currentFloor: q,
        latestArchiveFloor: read.latestLiveArchiveFloor,
        interval: this.config.summaryInterval,
        lastRemindedFloor: this.config.summaryLastRemindedFloor
      });
      if (!floorsDecreased && !interrupted.length && !integrity.needed && previousFloor !== q) {
        this.config.lastKnownFloor = q;
        this.persist();
      }
      return {
        table,
        previousFloor,
        currentFloor: q,
        latestLiveArchiveFloor: read.latestLiveArchiveFloor,
        regexWindow: read.regexWindow,
        summaryTrigger,
        boundary,
        trigger,
        interrupted,
        commitLog,
        totalLiveSize: totalLiveSize(table),
        floorsDecreased,
        integrity
      };
    }
    // ---- 完整性回退（marker 丢 → 复原其后的 old_） ---------------------------
    /** 读最近存活的覆盖标记层 X；X 之后的退役 old_ 即失去新档、建议全部复原。 */
    integrityCheck(table) {
      const markerFloors = liveEntries(table).filter((e) => e.through !== null).map((e) => e.messageId);
      const lastMarkerFloor = markerFloors.length > 0 ? Math.max(...markerFloors) : -1;
      const toRestore = table.filter((e) => e.generation === "old" && e.messageId > lastMarkerFloor);
      return { needed: toRestore.length > 0, lastMarkerFloor, toRestore };
    }
    /** 执行复原：把这些退役 old_ 块改回 live（顺序落盘）。 */
    async integrityRestore(toRestore) {
      const read = this.chatState.scanFresh();
      const chatEpoch = read.chatEpoch;
      if (detectInterruptedCommit(read.table).length > 0) {
        throw new Error("检测到未完成的归档提交；必须先恢复 pending，不能同时复原退役档");
      }
      const grouped = /* @__PURE__ */ new Map();
      for (const e of toRestore) {
        const list = grouped.get(e.messageId) ?? [];
        list.push(e);
        grouped.set(e.messageId, list);
      }
      const byFloor = /* @__PURE__ */ new Map();
      for (const [messageId, entries] of grouped) {
        this.assertCurrentChat(chatEpoch);
        let text = this.readFloorText(messageId);
        for (const e of entries.sort((a, b) => b.span[0] - a.span[0])) {
          text = replaceSpanExact(text, e.span, e.raw, setGeneration(e.raw, "live"));
        }
        byFloor.set(messageId, text);
      }
      for (const [message_id, message] of byFloor) {
        this.assertCurrentChat(chatEpoch);
        await this.deps.setChatMessages([{ message_id, message }], { refresh: "none" });
        this.assertCurrentChat(chatEpoch);
        this.chatState.markDirty();
      }
      this.assertCurrentChat(chatEpoch);
      this.config.lastKnownFloor = this.chatState.syncHead().currentFloor;
      this.persist();
    }
    // ---- 收集（纯逻辑，按 marker 分既存/原始） --------------------------------
    //
    // 带覆盖标记的在场档案 = 既存（取最新一份的末尾可见容器作续写上下文）。
    // 不带的 = 原始（flux 扁平待整理），但**只消化楼层 ≤ 当前层−N 的**——最近 N 层留新鲜（= 触发上界）。
    // 显示/喂给模型前统一滤掉注释。
    collect(snapshot, selection) {
      const threshold = snapshot.currentFloor - this.config.n;
      const live = liveEntries(snapshot.table);
      let sources = live.filter((e) => e.through === null && e.messageId <= threshold);
      if (selection) {
        const endpoint = selection.length > 0 ? Math.max(...selection) : null;
        sources = endpoint === null ? [] : sources.filter((e) => e.messageId <= endpoint);
      }
      const continuity = live.filter((e) => e.through !== null).sort((a, b) => (b.through ?? b.messageId) - (a.through ?? a.messageId))[0] ?? null;
      const parts = [];
      if (continuity) {
        parts.push(
          "【既存信息：参考以下信息，确保新的世界存档与此保持连续。】",
          stripComments(continuity.content),
          "既存信息（已归档）读取完毕。继续载入原始记录（待归档）"
        );
      }
      parts.push("【原始记录:对下面的原始记录做归档。】", ...sources.map((s) => stripComments(s.content)));
      return { historicalContext: parts.join("\n\n"), sources, continuity };
    }
    /** 最新时间轴档案中最后一个可见《容器》。 */
    lastVisibleContinuityContainer(entry) {
      const nodes = parseArchiveBody(entry.content);
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (nodes[i].kind === "container") return nodes[i];
      }
      return null;
    }
    /**
     * 事务/来源校验的单层实时读取。只封装重复 I/O 形状，绝不缓存；
     * 这些 exact read 与 q 快照分属两种安全语义。
     */
    readFloorText(messageId) {
      return this.deps.getChatMessages(messageId)[0]?.message ?? "";
    }
    readFloor(messageId) {
      return this.deps.getChatMessages(messageId).find((message) => message.message_id === messageId) ?? null;
    }
    isBlankAssistant(message) {
      return !!message && message.role === "assistant" && message.message.trim() === "";
    }
    clearSummaryPointer() {
      this.config.summaryPlaceholderFloor = null;
      this.persist();
    }
    /**
     * 新一轮开始前只处理本插件记住的 y：仍是空白 assistant 才删除；
     * 缺失或已被正文占用时一律不碰，只忘掉旧指针。随后总是在聊天末尾新建 y。
     */
    async cleanRecordedSummaryPlaceholder(chatEpoch) {
      this.assertCurrentChat(chatEpoch);
      const y = this.config.summaryPlaceholderFloor;
      if (y === null) return;
      const message = this.readFloor(y);
      if (this.isBlankAssistant(message)) {
        this.assertCurrentChat(chatEpoch);
        await this.deps.deleteChatMessages([y], { refresh: "affected" });
        this.assertCurrentChat(chatEpoch);
        this.chatState.markDirty();
      }
      this.assertCurrentChat(chatEpoch);
      this.summaryRound = null;
      this.clearSummaryPointer();
    }
    /**
     * 摘要 → 总结的纯收集：Historical Context 的前半取全部完整在场
     * <World_Archive>，后半只取最近 Archive 层 x 之后、sourceThrough=q
     * 以内的完整 Flux 标签块。两类来源在此保持分离以供溯源，发起生成时
     * 才按顺序合并进同一个 <Historical_Context>，且均不改写来源楼层。
     */
    collectSummary(read) {
      const archives = liveEntries(read.table).sort(
        (a, b) => a.messageId - b.messageId || a.span[0] - b.span[0]
      );
      const archiveContext = archives.length ? archives.map((entry) => `【在场档案 · 层 ${entry.messageId}】
${wrapArchive(stripComments(entry.content), "live")}`).join("\n\n") : "（无既存 World Archive）";
      const fluxes = collectTargetFlux(
        read.messages,
        read.latestLiveArchiveFloor,
        read.currentFloor
      ).filter((flux) => flux.inner.trim().length > 0);
      const targetFlux = fluxes.map((flux) => `【原始摘要 · 层 ${flux.floor}】
${flux.raw}`).join("\n\n");
      return {
        archiveContext,
        targetFlux,
        archiveFloors: [...new Set(archives.map((entry) => entry.messageId))],
        fluxes,
        latestArchiveFloor: read.latestLiveArchiveFloor,
        sourceThrough: read.currentFloor,
        sourceChars: fluxes.reduce((sum, flux) => sum + flux.raw.length, 0)
      };
    }
    ensureSummaryPlaceholder(round) {
      this.assertCurrentChat(round.chatEpoch);
      const current = this.readFloor(round.placeholderFloor);
      if (this.isBlankAssistant(current)) return;
      if (this.config.summaryPlaceholderFloor === round.placeholderFloor) this.clearSummaryPointer();
      if (this.summaryRound?.id === round.id) this.summaryRound = null;
      if (this.phase === "preview") this.phase = "idle";
      throw new Error(`总结写入位层 ${round.placeholderFloor} 已不是空白 assistant，已停止以免覆盖正文`);
    }
    /**
     * 手动开始永远不受间隔阈值拦截。先清理仍空白的旧 y，再以 fresh q 冻结来源、
     * 在末尾创建一个新的空白 assistant，最后才发起独立生成。
     */
    async generateSummary(guidance = "") {
      if (this.phase !== "idle") throw new Error("单例锁：已有归档在进行，请先结束或退出");
      const chatEpoch = this.chatState.currentChatEpoch();
      await this.cleanRecordedSummaryPlaceholder(chatEpoch);
      this.assertCurrentChat(chatEpoch);
      const read = this.chatState.scanFresh();
      if (read.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
      if (detectInterruptedCommit(read.table).length > 0) {
        throw new Error("检测到未完成的归档提交；请先继续提交，再生成普通总结");
      }
      if (this.integrityCheck(read.table).needed) {
        throw new Error("检测到档案完整性缺口；请先复原退役档");
      }
      const collected = this.collectSummary(read);
      if (collected.fluxes.length === 0) throw new Error("最近一份 World Archive 之后没有可总结的 Flux");
      const roundId = `mem-summary-${collected.sourceThrough}-${++this.generationSequence}`;
      this.assertCurrentChat(chatEpoch);
      await this.deps.createChatMessages(
        [{ role: "assistant", message: "" }],
        { insert_before: "end", refresh: "affected" }
      );
      this.assertCurrentChat(chatEpoch);
      this.chatState.markDirty();
      const placeholderFloor = this.chatState.syncHead().currentFloor;
      const placeholder = this.readFloor(placeholderFloor);
      if (!this.isBlankAssistant(placeholder) || placeholderFloor <= collected.sourceThrough) {
        throw new Error("末尾空白写入位创建失败，已停止生成");
      }
      const round = {
        id: roundId,
        chatEpoch,
        archiveContext: collected.archiveContext,
        targetFlux: collected.targetFlux,
        archiveFloors: collected.archiveFloors,
        fluxFloors: [...new Set(collected.fluxes.map((flux) => flux.floor))],
        latestArchiveFloor: collected.latestArchiveFloor,
        sourceThrough: collected.sourceThrough,
        placeholderFloor,
        sourceChars: collected.sourceChars,
        connectionProfileId: this.config.connectionProfileId,
        orchestration: this.summaryOrchestrationEntries().map((entry) => ({ ...entry }))
      };
      this.assertCurrentChat(chatEpoch);
      this.summaryRound = round;
      this.config.summaryPlaceholderFloor = placeholderFloor;
      this.persist();
      return this.runSummaryGenerate(round, guidance, "idle");
    }
    /** 首次失败/取消/超时后，用同一批冻结来源与同一个 y 重试。 */
    async retrySummary(guidance = "") {
      if (this.phase !== "idle") throw new Error("只能在空闲状态重试普通总结");
      const round = this.summaryRound;
      if (!round) throw new Error("没有可重试的冻结总结来源，请新建一轮");
      this.ensureSummaryPlaceholder(round);
      return this.runSummaryGenerate(round, guidance, "idle");
    }
    /** 结果页重 roll：来源/y/连接不变，只替换可空 guidance 并重跑整段。 */
    async regenerateSummary(cand, guidance) {
      if (this.phase !== "preview") throw new Error("重 roll 需在预览态");
      const round = this.summaryRound;
      if (!round || round.id !== cand.round.id) throw new Error("普通总结来源已失效，请新建一轮");
      this.ensureSummaryPlaceholder(round);
      return this.runSummaryGenerate(round, guidance, "preview");
    }
    async runSummaryGenerate(round, guidance, fallbackPhase) {
      this.assertCurrentChat(round.chatEpoch);
      this.ensureSummaryPlaceholder(round);
      const generationId = `${round.id}-${++this.generationSequence}`;
      const op = this.beginGeneration(generationId, fallbackPhase);
      try {
        const raw = await Promise.race([
          this.deps.generateRaw({
            ordered_prompts: assembleSummaryPrompt(round.orchestration, {
              archiveContext: round.archiveContext,
              targetFlux: round.targetFlux,
              guidance
            }),
            generation_id: generationId,
            connection_profile_id: round.connectionProfileId ?? void 0
          }),
          op.abortPromise
        ]);
        if (this.activeGeneration !== op) throw new GenerationCancelledError();
        this.assertCurrentChat(round.chatEpoch);
        const candidate = this.toSummaryCandidate(raw, round, guidance);
        this.releaseGeneration(op, "preview");
        return candidate;
      } catch (error) {
        this.releaseGeneration(op, fallbackPhase);
        throw error;
      }
    }
    toSummaryCandidate(raw, round, guidance) {
      const validation = validateSummaryArchive(raw);
      return {
        raw,
        body: validation.block?.inner ?? "",
        validation,
        containers: validation.nodes,
        sourceThrough: round.sourceThrough,
        placeholderFloor: round.placeholderFloor,
        guidance,
        sourceChars: round.sourceChars,
        round
      };
    }
    editSummaryCandidate(cand, body) {
      const wrapped = wrapArchive(body, "live");
      const oldBlock = cand.validation.block;
      const raw = oldBlock ? cand.raw.slice(0, oldBlock.span[0]) + wrapped + cand.raw.slice(oldBlock.span[1]) : wrapped;
      return this.toSummaryCandidate(raw, cand.round, cand.guidance);
    }
    /** 只有 y 仍是空白 assistant 才写入；正文变化时宁可失败也绝不覆盖。 */
    async applySummary(cand) {
      if (this.phase !== "preview") throw new Error("应用总结需在预览态");
      if (!cand.validation.ok) throw new Error("硬错未清，拦应用");
      const round = this.summaryRound;
      if (!round || round.id !== cand.round.id) throw new Error("普通总结来源已失效，请新建一轮");
      this.assertCurrentChat(round.chatEpoch);
      this.ensureSummaryPlaceholder(round);
      this.phase = "committing";
      try {
        this.assertCurrentChat(round.chatEpoch);
        await this.deps.setChatMessages(
          [{ message_id: round.placeholderFloor, message: wrapArchive(cand.body, "live") }],
          { refresh: "affected" }
        );
        this.assertCurrentChat(round.chatEpoch);
        this.chatState.markDirty();
        this.summaryRound = null;
        this.config.summaryPlaceholderFloor = null;
        this.config.summaryLastRemindedFloor = null;
        this.assertCurrentChat(round.chatEpoch);
        this.persist();
        this.phase = "idle";
        return round.placeholderFloor;
      } catch (error) {
        this.phase = "preview";
        throw error;
      }
    }
    /** 放弃候选不写 y；空白 y 由下次新建总结时安全清理。 */
    discardSummary() {
      this.phase = "idle";
      this.summaryRound = null;
    }
    summaryRetryAvailable() {
      return this.phase === "idle" && this.summaryRound !== null;
    }
    // ---- 生成（单次独立调用，单例锁） ---------------------------------------
    /** 起一次归档生成（要求 idle）。selection 的最大楼层是连续范围端点；省略则走 N 外全部。 */
    async generate(table, guidance = "", selection) {
      if (this.phase !== "idle") throw new Error("单例锁：已有归档在进行，请先结束或退出");
      void table;
      return this.runGenerate(guidance, selection, "idle");
    }
    /** 重roll：从头整段重跑（要求 preview）。 */
    async regenerate(table, guidance, selection) {
      if (this.phase !== "preview") throw new Error("重roll 需在预览态");
      void table;
      return this.runGenerate(guidance, selection, "preview");
    }
    beginGeneration(id, fallbackPhase) {
      let rejectAbort;
      const abortPromise = new Promise((_resolve, reject) => {
        rejectAbort = reject;
      });
      const op = {
        id,
        token: Symbol(id),
        fallbackPhase,
        abortPromise,
        rejectAbort,
        timer: null
      };
      this.activeGeneration = op;
      this.phase = "generating";
      op.timer = setTimeout(() => {
        this.abortGeneration(op, new GenerationTimeoutError(this.generationTimeoutMs));
      }, this.generationTimeoutMs);
      return op;
    }
    /**
     * 只中止仍是当前的那次生成。先从 active 摘掉，让旧 Promise 的 catch/finally
     * 无权碰后来发起的新请求；abortPromise 保证即使底层 stop 不 settle，上层也会立即结束。
     */
    abortGeneration(op, error) {
      if (this.activeGeneration !== op) return;
      this.activeGeneration = null;
      if (op.timer !== null) clearTimeout(op.timer);
      op.timer = null;
      this.phase = op.fallbackPhase;
      op.rejectAbort(error);
      try {
        this.deps.stopGenerationById(op.id);
      } catch {
      }
    }
    releaseGeneration(op, nextPhase) {
      if (this.activeGeneration !== op) return;
      this.activeGeneration = null;
      if (op.timer !== null) clearTimeout(op.timer);
      op.timer = null;
      this.phase = nextPhase;
    }
    async runGenerate(guidance, selection, fallbackPhase) {
      const read = this.chatState.scanFresh();
      const chatEpoch = read.chatEpoch;
      if (detectInterruptedCommit(read.table).length > 0) {
        throw new Error("检测到未完成的归档提交；为避免叠加写入，已禁止开始新归档");
      }
      if (this.integrityCheck(read.table).needed) {
        throw new Error("检测到档案完整性缺口；请先复原退役档，再开始新归档");
      }
      const { historicalContext, sources, continuity } = this.collect(read, selection);
      if (sources.length === 0) throw new Error("没有可归档的原始档案");
      const provenance = this.captureProvenance(sources, continuity, chatEpoch);
      const through = sources.reduce((m, s) => Math.max(m, s.messageId), 0);
      const sourceChars = sources.reduce((s, e) => s + e.content.length, 0);
      const generationId = `mem-${through}-${++this.generationSequence}`;
      const op = this.beginGeneration(generationId, fallbackPhase);
      try {
        const prompts = assemblePrompt(this.orchestrationEntries(), { historicalContext, guidance });
        const raw = await Promise.race([
          this.deps.generateRaw({
            ordered_prompts: prompts,
            generation_id: generationId,
            connection_profile_id: this.config.connectionProfileId ?? void 0
          }),
          op.abortPromise
        ]);
        if (this.activeGeneration !== op) throw new GenerationCancelledError();
        this.assertCurrentChat(chatEpoch);
        const cand = this.toCandidate(raw, through, guidance, selection, sourceChars, provenance);
        this.releaseGeneration(op, "preview");
        return cand;
      } catch (err) {
        this.releaseGeneration(op, fallbackPhase);
        throw err;
      }
    }
    toCandidate(raw, through, guidance, selection, sourceChars, provenance) {
      const validation = validateArchive(raw);
      const body = validation.block?.inner ?? "";
      return {
        raw,
        body,
        validation,
        containers: validation.containers,
        through,
        guidance,
        selection,
        sourceChars,
        provenance
      };
    }
    archiveRef(entry) {
      return { messageId: entry.messageId, raw: entry.raw, span: [entry.span[0], entry.span[1]] };
    }
    captureProvenance(sources, continuity, chatEpoch) {
      this.assertCurrentChat(chatEpoch);
      const entries = continuity ? [...sources, continuity] : sources;
      const floors = /* @__PURE__ */ new Map();
      for (const entry of entries) {
        this.assertCurrentChat(chatEpoch);
        const message = this.readFloorText(entry.messageId);
        if (message.slice(entry.span[0], entry.span[1]) !== entry.raw) {
          throw new Error(`层 ${entry.messageId} 的归档在生成前已变化，请刷新后重试`);
        }
        floors.set(entry.messageId, message);
      }
      return {
        chatEpoch,
        sources: sources.map((e) => this.archiveRef(e)),
        continuity: continuity ? this.archiveRef(continuity) : null,
        floors: [...floors].map(([messageId, message]) => ({ messageId, message }))
      };
    }
    sameRefs(entries, refs) {
      if (entries.length !== refs.length) return false;
      return entries.every((entry, i) => {
        const ref = refs[i];
        return entry.messageId === ref.messageId && entry.raw === ref.raw && entry.span[0] === ref.span[0] && entry.span[1] === ref.span[1];
      });
    }
    assertCandidateProvenance(cand, snapshot) {
      this.assertCurrentChat(cand.provenance.chatEpoch);
      for (const floor of cand.provenance.floors) {
        const current = this.readFloorText(floor.messageId);
        if (current !== floor.message) {
          throw new Error(`层 ${floor.messageId} 的归档在预览期间发生变化，请重新生成`);
        }
      }
      const collected = this.collect(snapshot, cand.selection);
      if (!this.sameRefs(collected.sources, cand.provenance.sources)) {
        throw new Error("归档来源集合在预览期间发生变化，请重新生成");
      }
      const expectedContinuity = cand.provenance.continuity;
      const currentContinuity = collected.continuity;
      if (!!expectedContinuity !== !!currentContinuity || expectedContinuity !== null && currentContinuity !== null && !this.sameRefs([currentContinuity], [expectedContinuity])) {
        throw new Error("既存归档在预览期间发生变化，请重新生成");
      }
      return collected;
    }
    /** 取消生成（防卡壳）。 */
    cancel() {
      const op = this.activeGeneration;
      if (op) this.abortGeneration(op, new GenerationCancelledError());
    }
    /** 手改：就地改档案内容（tag-free），重新校验；标签不露、结构不坏。 */
    editCandidate(cand, newBody) {
      const wrapped = wrapArchive(newBody, "live");
      const oldBlock = cand.validation.block;
      const raw = oldBlock ? cand.raw.slice(0, oldBlock.span[0]) + wrapped + cand.raw.slice(oldBlock.span[1]) : wrapped;
      const validation = validateArchive(raw);
      return {
        ...cand,
        raw,
        body: newBody,
        validation,
        containers: validation.containers
      };
    }
    /** 对模型候选只做机械、无歧义的结构补正；补不了的硬错仍由校验继续拦截。 */
    repairCandidate(cand) {
      const repaired = repairArchiveOutput(cand.raw);
      if (!repaired.changed) return { candidate: cand, fixes: [] };
      const next = this.toCandidate(
        repaired.text,
        cand.through,
        cand.guidance,
        cand.selection,
        cand.sourceChars,
        cand.provenance
      );
      return { candidate: next, fixes: repaired.fixes };
    }
    /** 退出：弃候选、回 idle，聊天不动。 */
    discard() {
      this.phase = "idle";
    }
    // ---- 就地编辑写回（改已提交的在场档案，无损保住 marker/注释/其余容器） -----
    /**
     * 就地编辑一份在场（live）档案里的某个**可见容器**（按可见顺序 index，从 0 起）。
     * 无损写回：覆盖标记、被增量覆写接管的旧容器、其余容器一律保住；世代仍是 live。
     * newText = 用户改后的**单个容器** canonical 文本（`《…》…` 或旧段 `[…]…`）。
     * 楼层里 <World_Archive> 之外的内容（若有）原样保留。
     */
    async editLiveContainer(messageId, expectedRaw, index, newText) {
      const chatEpoch = this.chatState.currentChatEpoch();
      this.assertCurrentChat(chatEpoch);
      const floorText = this.readFloorText(messageId);
      const block = buildLocatorTable([{ message_id: messageId, message: floorText }]).find((e) => e.generation === "live");
      if (!block) throw new Error("该楼层没有在场档案");
      if (block.raw !== expectedRaw) throw new Error("档案在编辑期间已变化，请刷新后重试");
      const nodes = parseArchiveNodes(block.content);
      const containers = nodes.filter((n) => n.type === "container");
      if (index < 0 || index >= containers.length) throw new Error("容器序号越界");
      const parsed = parseArchiveBody(newText);
      if (parsed.length === 0) throw new Error("编辑内容为空或无法识别为容器");
      if (parsed.length > 1) throw new Error("编辑内容必须恰好是一个容器（检测到多个《》/[]）");
      containers[index].container = parsed[0];
      const newInner = serializeArchiveNodes(nodes);
      const rebuilt = replaceSpanExact(floorText, block.span, block.raw, wrapArchive(newInner, "live"));
      this.assertCurrentChat(chatEpoch);
      await this.deps.setChatMessages([{ message_id: messageId, message: rebuilt }], { refresh: "none" });
      this.assertCurrentChat(chatEpoch);
      this.chatState.markDirty();
    }
    // ---- 配置持久化（对话进度写 chat；用户设置另同步 global 种子） --------
    /** 把当前 config 落盘到 chat 作用域。 */
    persist() {
      saveConfig(this.deps, this.config);
    }
    /** 把当前 config 存为全局默认模板（供之后新对话 seed）。 */
    saveAsGlobalDefault() {
      saveGlobalDefault(this.deps, this.config);
    }
    /** 用户明确保存的设置，同时成为今后新对话的全局默认。 */
    persistUserSetting() {
      this.persist();
      this.saveAsGlobalDefault();
    }
    /** 设「保留最近 N 层不总结」（规范化后持久化）。 */
    setN(n) {
      this.config.n = normalizeN(n);
      this.persistUserSetting();
    }
    /** 普通总结的提醒间隔；最小 20，只影响提醒。 */
    setSummaryInterval(value) {
      this.config.summaryInterval = normalizeSummaryInterval(value);
      this.persistUserSetting();
    }
    /** 启停「摘要 → 大总结」后台功能；关闭不影响手动进入与生成。 */
    setSummaryEnabled(enabled) {
      if (this.config.summaryEnabled === enabled) return;
      this.config.summaryEnabled = enabled;
      this.persistUserSetting();
      this.notifyFeatureEnablementChanged();
    }
    /** 启停「大总结时间轴化」后台功能；关闭不影响手动进入与生成。 */
    setTimelineEnabled(enabled) {
      if (this.config.timelineEnabled === enabled) return;
      this.config.timelineEnabled = enabled;
      this.persistUserSetting();
      this.notifyFeatureEnablementChanged();
    }
    /** 订阅两个启用开关的变化；用于运行时即时启停共享监听与动态正则。 */
    onFeatureEnablementChanged(listener) {
      this.featureEnablementListeners.add(listener);
      return () => {
        this.featureEnablementListeners.delete(listener);
      };
    }
    notifyFeatureEnablementChanged() {
      for (const listener of this.featureEnablementListeners) {
        try {
          listener();
        } catch (error) {
          console.warn("[记忆归档] 功能启用状态回调失败：", error);
        }
      }
    }
    /** 指派酒馆 Connection Profile（只记 ID，不碰 URL/key）；空 → null（跟随当前连接）。 */
    setConnectionProfile(id) {
      this.config.connectionProfileId = id && id.trim() ? id : null;
      this.persistUserSetting();
    }
    /** 酒馆 Connection Manager 中可独立请求的连接配置。 */
    connectionProfiles() {
      return this.deps.getConnectionProfiles();
    }
    /** 当前脚本内置提示词叠加 chat override 后的有效编排。 */
    orchestrationEntries() {
      return resolveOrchestration(this.config.orchestrationOverrides);
    }
    /** 单模块是否自定义，以及它所基于的内置版之后是否已变化。 */
    orchestrationState(id) {
      const override = this.config.orchestrationOverrides[id];
      if (!override) return { customized: false, builtinUpdateAvailable: false };
      const builtin = defaultOrchestration().find((entry) => entry.id === id);
      return {
        customized: true,
        builtinUpdateAvailable: !!builtin && override.baseHash !== promptFingerprint(builtin.content)
      };
    }
    promptOverrideSummary() {
      const ids = Object.keys(this.config.orchestrationOverrides);
      return {
        customized: ids.length,
        updates: ids.filter((id) => this.orchestrationState(id).builtinUpdateAvailable).length
      };
    }
    /** 保存一条用户覆盖；内容等于当前内置版时自动删除覆盖。 */
    setOrchestrationOverride(id, content) {
      const builtin = defaultOrchestration().find((entry) => entry.id === id);
      if (!builtin) return;
      if (content === builtin.content) {
        delete this.config.orchestrationOverrides[id];
        this.persistUserSetting();
        return;
      }
      const existing = this.config.orchestrationOverrides[id];
      this.config.orchestrationOverrides[id] = {
        content,
        // 只要仍在编辑同一覆盖项，就不能假装用户已经吸收了后来出现的内置新版。
        baseHash: existing?.baseHash ?? promptFingerprint(builtin.content)
      };
      this.persistUserSetting();
    }
    resetOrchestrationOverride(id) {
      if (!(id in this.config.orchestrationOverrides)) return;
      delete this.config.orchestrationOverrides[id];
      this.persistUserSetting();
    }
    resetAllOrchestrationOverrides() {
      if (Object.keys(this.config.orchestrationOverrides).length === 0) return;
      this.config.orchestrationOverrides = {};
      this.persistUserSetting();
    }
    /** 兼容旧调用名；实际只写 override，不再改/存整份内置编排。 */
    updateOrchestration(id, content) {
      this.setOrchestrationOverride(id, content);
    }
    /** 普通总结的固定三段式编排，叠加少量 chat override。 */
    summaryOrchestrationEntries() {
      return resolveSummaryOrchestration(this.config.summaryOrchestrationOverrides);
    }
    summaryOrchestrationState(id) {
      const override = this.config.summaryOrchestrationOverrides[id];
      if (!override) return { customized: false, builtinUpdateAvailable: false };
      const builtin = defaultSummaryOrchestration().find((entry) => entry.id === id);
      return {
        customized: true,
        builtinUpdateAvailable: !!builtin && override.baseHash !== summaryPromptFingerprint(builtin.content)
      };
    }
    summaryPromptOverrideSummary() {
      const ids = Object.keys(this.config.summaryOrchestrationOverrides);
      return {
        customized: ids.length,
        updates: ids.filter((id) => this.summaryOrchestrationState(id).builtinUpdateAvailable).length
      };
    }
    setSummaryOrchestrationOverride(id, content) {
      const builtin = defaultSummaryOrchestration().find((entry) => entry.id === id);
      if (!builtin) return;
      if (content === builtin.content) {
        delete this.config.summaryOrchestrationOverrides[id];
        this.persistUserSetting();
        return;
      }
      const existing = this.config.summaryOrchestrationOverrides[id];
      this.config.summaryOrchestrationOverrides[id] = existing ? { content, baseHash: existing.baseHash } : makeSummaryOrchestrationOverride(content, builtin.content);
      this.persistUserSetting();
    }
    resetSummaryOrchestrationOverride(id) {
      if (!(id in this.config.summaryOrchestrationOverrides)) return;
      delete this.config.summaryOrchestrationOverrides[id];
      this.persistUserSetting();
    }
    resetAllSummaryOrchestrationOverrides() {
      if (Object.keys(this.config.summaryOrchestrationOverrides).length === 0) return;
      this.config.summaryOrchestrationOverrides = {};
      this.persistUserSetting();
    }
    // ---- 提交决策 + 两段提交 -------------------------------------------------
    /**
     * 由候选 + 定位表构建提交决策（按 marker 分既存/原始）：
     *   - 原始（无 marker 源档）整批退役、消化进新档；
     *   - 目标层 = 原始的最高楼层（新档追加其后、同层退旧＋追加）；
     *   - 覆盖标记端点 = 该层（总结到这层），打在新档内部；
     *   - 仅当候选首容器与既存末尾容器标题完全一致时，增量覆写该末尾容器。
     */
    buildCommitDecision(cand, snapshot) {
      if (detectInterruptedCommit(snapshot.table).length > 0) {
        throw new Error("检测到未完成的归档提交；请先恢复现场，不能继续保存");
      }
      if (this.integrityCheck(snapshot.table).needed) {
        throw new Error("检测到档案完整性缺口；请先复原退役档，不能继续保存");
      }
      const { sources, continuity } = this.assertCandidateProvenance(cand, snapshot);
      if (sources.length === 0) throw new Error("提交失败：归档来源为空");
      const target = sources.reduce((m, s) => Math.max(m, s.messageId), 0);
      if (target !== cand.through) throw new Error("提交边界与生成时来源不一致，请重新生成");
      const retire = sources.map((s) => ({
        message_id: s.messageId,
        message: this.readFloorText(s.messageId),
        blockRaw: s.raw,
        blockSpan: s.span
      }));
      const candidateFirst = cand.containers[0];
      const continuityLast = continuity ? this.lastVisibleContinuityContainer(continuity) : null;
      const continuesLastContainer = candidateFirst?.kind === "container" && continuityLast?.kind === "container" && candidateFirst.title.length > 0 && continuityLast.title.length > 0 && candidateFirst.title === continuityLast.title;
      const supersede = continuity && continuesLastContainer ? {
        message_id: continuity.messageId,
        message: this.readFloorText(continuity.messageId),
        blockRaw: continuity.raw,
        blockSpan: continuity.span
      } : void 0;
      return {
        targetMessageId: target,
        targetMessageText: this.readFloorText(target),
        pendingBody: cand.body,
        through: cand.through,
        retire,
        supersede
      };
    }
    /** 两段提交（要求 preview）。跑完 boundary 推进、回 idle。 */
    async commit(cand, table) {
      if (this.phase !== "preview") throw new Error("提交需在预览态");
      if (!cand.validation.ok) throw new Error("硬错未清，拦保存");
      void table;
      const chatEpoch = cand.provenance.chatEpoch;
      this.assertCurrentChat(chatEpoch);
      const fresh = this.chatState.scanFresh();
      if (fresh.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
      const decision = this.buildCommitDecision(cand, fresh);
      const plan = planCommit(decision);
      let commitLog = createCommitLog({
        targetFloor: decision.targetMessageId,
        through: decision.through,
        plannedOldFloors: decision.retire.map((item) => item.message_id),
        supersedeFloor: decision.supersede?.message_id
      });
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, commitLog);
      this.phase = "committing";
      try {
        await executeCommit(plan, this.guardedCommitDeps(chatEpoch), {
          afterStepVerified: (step) => {
            this.assertCurrentChat(chatEpoch);
            this.chatState.markDirty();
            commitLog = markCommitStepSucceeded(commitLog, step);
            saveCommitLog(this.deps, commitLog);
          }
        });
        this.finalizeAfterCommit(decision.through, chatEpoch);
        commitLog = completeCommitLog(commitLog);
        this.assertCurrentChat(chatEpoch);
        saveCommitLog(this.deps, commitLog);
        this.phase = "idle";
      } catch (err) {
        if (this.chatState.isCurrentChatEpoch(chatEpoch)) {
          this.chatState.markDirty();
          try {
            commitLog = markCommitLogFailed(commitLog, err);
            saveCommitLog(this.deps, commitLog);
          } catch {
          }
        }
        this.phase = "idle";
        throw err;
      }
    }
    /** 提交成功收尾：推进 boundary、重置基线与提醒。commit 与 resumeCommit 共用。 */
    finalizeAfterCommit(through, chatEpoch) {
      this.assertCurrentChat(chatEpoch);
      this.config.boundary = through;
      this.config.lastKnownFloor = this.chatState.syncHead().currentFloor;
      this.config.lastDismissedFloor = null;
      this.assertCurrentChat(chatEpoch);
      this.persist();
    }
    // ---- 崩溃恢复 -------------------------------------------------------------
    /**
     * 一键继续未完成提交：依据薄事务日志 + 当前现场，把中断的两段提交补完。
     *
     * 现场即真相、且**幂等**：只补真正还缺的步骤——
     *   - 计划退役但仍是 live 的源档 → 退役；已 old 的自动跳过。
     *   - 计划增量覆写但末尾容器仍等待接管 → 覆写；已包裹的自动跳过。
     *   - 现存 pending → 转正（现场有 pending 必未转正）。
     * 现场若已无 pending：尚未起步就清日志；已转正就据现场安全收尾。
     * 完成后照常推进 boundary 并把薄日志记为 completed。
     */
    async resumeCommit() {
      if (this.phase !== "idle") throw new Error("单例锁：请先结束当前归档，再继续未完成的提交");
      const chatEpoch = this.chatState.currentChatEpoch();
      this.assertCurrentChat(chatEpoch);
      const loaded = loadCommitLog(this.deps);
      if (!loaded) throw new Error("没有找到未完成的提交记录");
      if (loaded.status === "completed") throw new Error("该提交已完成，无需继续");
      let log = loaded;
      const target = log.targetFloor;
      const read = this.chatState.scanFresh();
      if (read.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
      const table = read.table;
      const pending = table.find((e) => e.messageId === target && e.generation === "pending") ?? null;
      if (!pending) {
        if (!log.pendingWritten) {
          this.assertCurrentChat(chatEpoch);
          clearCommitLog(this.deps);
          return { resumed: false, steps: 0 };
        }
        const promoted = table.some(
          (e) => e.messageId === target && e.generation === "live" && e.through === log.through
        );
        if (!promoted) {
          throw new Error("现场既无 pending 也无对应在场新档，无法自动继续，请人工核对档案");
        }
        log = this.reconcileCompleted(log, table, null, chatEpoch);
        this.finalizeAfterCommit(log.through, chatEpoch);
        log = completeCommitLog(log);
        this.assertCurrentChat(chatEpoch);
        saveCommitLog(this.deps, log);
        return { resumed: true, steps: 0 };
      }
      if (!log.pendingWritten) {
        log = this.markStep(log, "write-pending", target);
        this.assertCurrentChat(chatEpoch);
        saveCommitLog(this.deps, log);
      }
      const pendingFirst = parseArchiveBody(pending.content).find((c) => c.kind === "container") ?? null;
      const plan = this.planResumeSteps(log, table, pending);
      this.phase = "committing";
      try {
        await executeCommit(plan, this.guardedCommitDeps(chatEpoch), {
          afterStepVerified: (step) => {
            this.assertCurrentChat(chatEpoch);
            this.chatState.markDirty();
            log = markCommitStepSucceeded(log, step);
            saveCommitLog(this.deps, log);
          }
        });
        const doneRead = this.chatState.scanFresh();
        if (doneRead.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
        log = this.reconcileCompleted(log, doneRead.table, pendingFirst, chatEpoch);
        this.finalizeAfterCommit(log.through, chatEpoch);
        log = completeCommitLog(log);
        this.assertCurrentChat(chatEpoch);
        saveCommitLog(this.deps, log);
        this.phase = "idle";
        return { resumed: true, steps: plan.length };
      } catch (err) {
        if (this.chatState.isCurrentChatEpoch(chatEpoch)) {
          this.chatState.markDirty();
          try {
            log = markCommitLogFailed(log, err);
            saveCommitLog(this.deps, log);
          } catch {
          }
        }
        this.phase = "idle";
        throw err;
      }
    }
    /** 据薄日志与现场，重建「尚未完成」的提交步骤（幂等：已应用的步骤不会重复）。 */
    planResumeSteps(log, table, pending) {
      const target = log.targetFloor;
      const steps = [];
      const work = /* @__PURE__ */ new Map();
      const floorText = (id) => {
        if (!work.has(id)) work.set(id, this.readFloorText(id));
        return work.get(id);
      };
      const remaining = log.plannedOldFloors.filter((f) => !log.oldSucceededFloors.includes(f));
      for (const floor of [...remaining].sort((a, b) => a - b)) {
        const before = floorText(floor);
        const liveSources = extractArchiveBlocks(before).filter((b) => b.generation === "live" && !hasCoverageMarker(b.inner));
        const src = liveSources[liveSources.length - 1];
        if (!src) continue;
        const retired = setGeneration(src.raw, "old");
        const next = replaceSpanExact(before, src.span, src.raw, retired);
        work.set(floor, next);
        steps.push({
          phase: "retire-old",
          message_id: floor,
          message: next,
          expectedBefore: before,
          note: `继续退役楼层 ${floor} 上的旧档`,
          verify: { includes: [retired], excludes: [] }
        });
      }
      if (log.supersede && !log.supersede.done) {
        const superFloor = log.supersede.plannedFloor;
        const cont = table.find((e) => e.messageId === superFloor && e.generation === "live" && e.through !== null);
        const pendingFirst = parseArchiveBody(pending.content).find((c) => c.kind === "container") ?? null;
        const contLast = cont ? this.lastVisibleContinuityContainer(cont) : null;
        const stillPending = !!cont && pendingFirst?.kind === "container" && contLast?.kind === "container" && pendingFirst.title.length > 0 && contLast.title.length > 0 && pendingFirst.title === contLast.title;
        if (stillPending && cont) {
          const before = floorText(superFloor);
          const superseded = supersedeLastContainer(cont.raw);
          if (superseded === cont.raw) throw new Error(`层 ${superFloor} 的既存档没有可覆写的末尾容器`);
          const next = replaceSpanExact(before, cont.span, cont.raw, superseded);
          work.set(superFloor, next);
          steps.push({
            phase: "supersede",
            message_id: superFloor,
            message: next,
            expectedBefore: before,
            note: `继续增量覆写既存档末尾容器（层 ${superFloor}）`,
            verify: { includes: ["<!-- 《"], excludes: [] }
          });
        }
      }
      const beforePromote = floorText(target);
      const liveBlock = setGeneration(pending.raw, "live");
      const at = beforePromote.lastIndexOf(pending.raw);
      if (at < 0) throw new Error("现场缺少本次 pending，无法转正");
      const afterPromote = beforePromote.slice(0, at) + liveBlock + beforePromote.slice(at + pending.raw.length);
      steps.push({
        phase: "promote-live",
        message_id: target,
        message: afterPromote,
        expectedBefore: beforePromote,
        note: "继续 pending → live 转正",
        verify: { includes: [liveBlock], excludes: ["<World_Archive_pending>"] }
      });
      return steps;
    }
    /**
     * 续跑后据现场把「因幂等而跳过的步骤」补记进日志，并校验整笔确实完成。
     * 任一计划变更在现场仍未落地即抛错——绝不把半截态记成 completed。
     */
    reconcileCompleted(log, table, pendingFirst, chatEpoch) {
      this.assertCurrentChat(chatEpoch);
      let next = log;
      if (!next.pendingWritten) next = this.markStep(next, "write-pending", next.targetFloor);
      for (const floor of next.plannedOldFloors) {
        if (next.oldSucceededFloors.includes(floor)) continue;
        const stillLive = table.some((e) => e.messageId === floor && e.generation === "live" && e.through === null);
        if (stillLive) throw new Error(`楼层 ${floor} 的源档仍未退役，继续提交未完成`);
        next = this.markStep(next, "retire-old", floor);
      }
      if (next.supersede && !next.supersede.done) {
        const superFloor = next.supersede.plannedFloor;
        const cont = table.find((e) => e.messageId === superFloor && e.generation === "live" && e.through !== null);
        const contLast = cont ? this.lastVisibleContinuityContainer(cont) : null;
        const stillPending = !!cont && pendingFirst?.kind === "container" && contLast?.kind === "container" && pendingFirst.title.length > 0 && contLast.title.length > 0 && pendingFirst.title === contLast.title;
        if (stillPending) throw new Error("既存档末尾容器仍未接管，继续提交未完成");
        next = this.markStep(next, "supersede", superFloor);
      }
      if (next.promotedFloor !== next.targetFloor) {
        const hasPending = table.some((e) => e.messageId === next.targetFloor && e.generation === "pending");
        if (hasPending) throw new Error("pending 仍未转正，继续提交未完成");
        next = this.markStep(next, "promote-live", next.targetFloor);
      }
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, next);
      return next;
    }
    /** 把一个「现场已确认应用」的阶段折算进日志（正文无关，只记楼层与阶段）。 */
    markStep(log, phase, message_id) {
      return markCommitStepSucceeded(log, {
        phase,
        message_id,
        message: "",
        expectedBefore: "",
        note: "",
        verify: { includes: [], excludes: [] }
      });
    }
    /** 仅移除 pending；只有确认事务尚未退役/覆写任何旧档时才可把它当完整回滚。 */
    async rollbackPending(entry) {
      const chatEpoch = this.chatState.currentChatEpoch();
      this.assertCurrentChat(chatEpoch);
      const text = this.readFloorText(entry.messageId);
      const restored = planRollbackPending(text, entry.raw, entry.span);
      this.assertCurrentChat(chatEpoch);
      await this.deps.setChatMessages([{ message_id: entry.messageId, message: restored }], { refresh: "none" });
      this.assertCurrentChat(chatEpoch);
      this.chatState.markDirty();
    }
  };

  // src/plugin/tavern.ts
  function connectionManagerService() {
    const injected = globalThis.SillyTavern;
    const context = typeof injected?.getContext === "function" ? injected.getContext() : injected;
    return context?.ConnectionManagerRequestService ?? null;
  }
  function getConnectionProfiles() {
    try {
      const profiles = connectionManagerService()?.getSupportedProfiles?.() ?? [];
      return profiles.flatMap((profile) => {
        if (typeof profile.id !== "string" || typeof profile.name !== "string") return [];
        return [
          {
            id: profile.id,
            name: profile.name,
            api: typeof profile.api === "string" ? profile.api : void 0,
            model: typeof profile.model === "string" ? profile.model : void 0
          }
        ];
      });
    } catch {
      return [];
    }
  }
  function profileMaxTokens(profile) {
    const getPresetSafe = globalThis.getPreset;
    if (typeof getPresetSafe === "function") {
      for (const name of [profile?.preset, "in_use"]) {
        if (typeof name !== "string" || !name) continue;
        try {
          const n = Number(getPresetSafe(name)?.settings?.max_completion_tokens);
          if (Number.isFinite(n) && n > 0) return Math.floor(n);
        } catch {
        }
      }
    }
    return 8192;
  }
  function mapChatMessage(message) {
    return {
      message_id: message.message_id,
      message: message.message,
      name: message.name,
      role: message.role,
      is_hidden: message.is_hidden,
      data: message.data,
      extra: message.extra,
      swipe_id: message.swipe_id,
      swipes: message.swipes,
      swipes_data: message.swipes_data,
      swipes_info: message.swipes_info
    };
  }
  function createTavernDeps() {
    const profileControllers = /* @__PURE__ */ new Map();
    async function generateWithConnectionProfile(config, profileId) {
      const service = connectionManagerService();
      if (!service?.sendRequest) {
        throw new Error("当前酒馆不支持按连接配置独立生成；请升级酒馆或改为使用当前连接");
      }
      const controller = new AbortController();
      const generationId = config.generation_id ?? `memory-profile-${Date.now()}`;
      profileControllers.get(generationId)?.abort();
      profileControllers.set(generationId, controller);
      try {
        const profile = service.getProfile?.(profileId);
        const result = await service.sendRequest(
          profileId,
          config.ordered_prompts,
          profileMaxTokens(profile),
          {
            stream: false,
            signal: controller.signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true
          }
        );
        if (typeof result === "string") return result;
        return String(result?.content ?? "");
      } finally {
        if (profileControllers.get(generationId) === controller) {
          profileControllers.delete(generationId);
        }
      }
    }
    return {
      getChatMessages: (range) => getChatMessages(range).map(mapChatMessage),
      setChatMessages: (messages, option) => setChatMessages(messages, option),
      createChatMessages: (messages, option) => createChatMessages(messages, option),
      deleteChatMessages: (messageIds, option) => deleteChatMessages(messageIds, option),
      getLastMessageId: () => getLastMessageId(),
      generateRaw: async (config) => {
        if (config.connection_profile_id) {
          return generateWithConnectionProfile(config, config.connection_profile_id);
        }
        const nativeConfig = { ...config };
        delete nativeConfig.connection_profile_id;
        const out = await generateRaw(nativeConfig);
        return typeof out === "string" ? out : String(out?.content ?? "");
      },
      stopGenerationById: (id) => {
        const controller = profileControllers.get(id);
        controller?.abort();
        profileControllers.delete(id);
        return stopGenerationById(id) || !!controller;
      },
      stopAllGeneration: () => {
        const hadProfiles = profileControllers.size > 0;
        for (const controller of profileControllers.values()) controller.abort();
        profileControllers.clear();
        return stopAllGeneration() || hadProfiles;
      },
      getVariables: (option) => getVariables(option),
      insertOrAssignVariables: (variables, option) => {
        insertOrAssignVariables(variables, option);
      },
      getConnectionProfiles
    };
  }

  // src/plugin/ui.ts
  var CSS = `
:host{all:initial;position:fixed !important;inset:0 !important;z-index:2147483600 !important;display:block;}
.wrap{position:absolute;inset:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;
  --bg:#f6f2e9;--card:#fbf8f1;--ink:#2a251f;--read:#4a4238;--ink2:#564c40;--mut:#a5947c;--faint:#c1b299;
  --acc:#b0774f;--acc-soft:rgba(176,119,79,.10);--line:#e7dcc9;--line2:#efe7d8;--field:#fffdf9;--lock:#c4b7a2;--hollow:#cdbda2;
  --ok:#7c8b5e;--ok-soft:rgba(124,139,94,.12);--warn:#a8904e;--warn-soft:rgba(168,144,78,.13);--err:#a4553f;--err-soft:rgba(164,85,63,.10);}
.wrap.night{--bg:#26221e;--card:#34302a;--ink:#ece5db;--read:#cec4b6;--ink2:#c3b9ab;--mut:#9c9082;--faint:#867a6c;
  --acc:#bda28d;--acc-soft:rgba(189,162,141,.15);--line:#484038;--line2:#3a352e;--field:#2f2b26;--lock:#6f6558;--hollow:#5a5147;
  --ok:#8f9d6d;--ok-soft:rgba(143,157,109,.14);--warn:#a8904e;--warn-soft:rgba(184,154,82,.13);--err:#b06b52;--err-soft:rgba(187,125,100,.13);}
.wrap *{box-sizing:border-box;margin:0;padding:0;}
.wrap .backdrop{position:fixed;inset:0;background:rgba(20,16,12,.46);}
.wrap .daynight{display:inline-flex;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:var(--field);flex:0 0 auto;}
.wrap .dn{font-size:11.5px;color:var(--mut);padding:4px 12px;cursor:pointer;user-select:none;transition:.2s;}
.wrap .dn.on{background:var(--acc);color:#fff;}
.wrap.night .dn.on{color:#26221e;}
.wrap .panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;height:620px;max-width:94vw;max-height:94vh;max-height:94dvh;overflow-y:auto;overflow-x:hidden;
  background:var(--bg);color:var(--ink);border-radius:16px;box-shadow:0 24px 60px -22px rgba(0,0,0,.6);}
.wrap .panel.dragging{user-select:none;-webkit-user-select:none;}
.wrap .panel::-webkit-scrollbar{width:8px;}.wrap .panel::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .grow{flex:1;}
.wrap .panel-chrome{position:sticky;top:0;height:0;z-index:30;pointer-events:none;}
.wrap .panel-close{appearance:none;-webkit-appearance:none;position:absolute;top:10px;left:12px;width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:var(--mut);font:300 24px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;pointer-events:auto;touch-action:manipulation;transition:.14s;}
.wrap .panel-close:hover{color:var(--err);background:var(--err-soft);}

/* hub header（sticky：滚动时抬头常驻） */
.wrap .head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px 58px;position:sticky;top:0;z-index:6;background:var(--bg);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.wrap .title{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:20px;font-weight:600;letter-spacing:1.5px;}
.wrap .body{padding:12px 20px 22px;}

/* sub-page header（sticky：滚动时抬头常驻，随内容联动标题） */
.wrap .top{display:flex;align-items:center;gap:10px;padding:14px 18px 12px 58px;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:6;background:var(--bg);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.wrap .panel.dragging .head,.wrap .panel.dragging .top{cursor:grabbing;}
.wrap .back{font-size:17px;color:var(--mut);cursor:pointer;line-height:1;padding:5px 9px 5px 4px;margin:-3px 0;border-radius:8px;user-select:none;flex:0 0 auto;transition:.14s;}
.wrap .back:hover{color:var(--acc);background:var(--acc-soft);}
.wrap .now,.wrap .htitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wrap .htitle{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:16px;font-weight:600;letter-spacing:.8px;}
.wrap .hmeta{font-size:11px;color:var(--faint);margin-top:5px;}
.wrap .hmeta .ar{color:var(--mut);}

/* hub rects & squares */
.wrap .rect{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:15px 16px;margin-bottom:12px;cursor:pointer;transition:.16s;}
.wrap .rect:hover{border-color:var(--acc);transform:translateY(-1px);box-shadow:0 8px 22px -14px rgba(120,92,60,.5);}
.wrap .rect .mark{width:3px;align-self:stretch;border-radius:3px;background:var(--acc);opacity:.8;flex:0 0 auto;}
.wrap .rect .tx{flex:1;min-width:0;}
.wrap .rect .t{font-size:15px;font-weight:600;letter-spacing:.3px;}
.wrap .rect .d{font-size:11.5px;color:var(--mut);margin-top:3px;}
.wrap .rect .st{font-size:11px;color:var(--ink2);margin-top:7px;}
.wrap .rect .st b{color:var(--acc);font-weight:600;}
.wrap .rect .go{font-size:19px;color:var(--faint);flex:0 0 auto;transition:.16s;}
.wrap .rect:hover .go{color:var(--acc);transform:translateX(2px);}
.wrap .grouplab{font-size:10px;color:var(--faint);letter-spacing:.18em;margin:14px 4px 10px;}
.wrap .squares{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.wrap .sq{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px 15px 15px;min-height:120px;display:flex;flex-direction:column;cursor:pointer;transition:.16s;}
.wrap .sq:hover{border-color:var(--acc);transform:translateY(-1px);box-shadow:0 8px 22px -14px rgba(120,92,60,.5);}
.wrap .sqtop{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px;min-height:18px;}
.wrap .sq .dot{width:8px;height:8px;border-radius:50%;background:var(--acc);margin-bottom:11px;}
.wrap .sqtop .dot{margin-bottom:0;}
.wrap .feature-switch{appearance:none;-webkit-appearance:none;position:relative;width:31px;height:18px;flex:0 0 auto;border:1px solid var(--line);border-radius:999px;background:var(--field);cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s;padding:0;}
.wrap .feature-switch::after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;background:var(--mut);box-shadow:0 1px 3px rgba(0,0,0,.18);transition:transform .16s,background .16s;}
.wrap .feature-switch[aria-checked="true"]{background:var(--acc);border-color:var(--acc);}
.wrap .feature-switch[aria-checked="true"]::after{background:#fff;transform:translateX(13px);}
.wrap.night .feature-switch[aria-checked="true"]::after{background:#26221e;}
.wrap .feature-switch:hover{box-shadow:0 0 0 3px var(--acc-soft);}
.wrap .feature-switch:focus-visible{outline:2px solid var(--acc);outline-offset:2px;}
.wrap .sq .t{font-size:14px;font-weight:600;letter-spacing:.3px;}
.wrap .updot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft);margin-left:7px;vertical-align:1px;}
.wrap .sq .d{font-size:11px;color:var(--mut);margin-top:5px;line-height:1.6;}
.wrap .sq .sp{flex:1;}
.wrap .sq .stat{font-size:11px;color:var(--ink2);}
.wrap .sq .stat b{color:var(--acc);font-weight:600;}
.wrap .sq .stat.disabled{color:var(--mut);}
.wrap .sq .stat.due{display:flex;align-items:center;gap:6px;color:var(--acc);font-weight:500;}
.wrap .sq .stat.due .pin{width:6px;height:6px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 3px var(--acc-soft);flex:0 0 auto;}
.wrap .sq.tbd{background:transparent;border-style:dashed;cursor:default;}
.wrap .sq.tbd:hover{transform:none;box-shadow:none;border-color:var(--line);}
.wrap .sq.tbd .dot{background:transparent;border:2px solid var(--faint);}
.wrap .sq.tbd .t,.wrap .sq.tbd .d,.wrap .sq.tbd .foot{color:var(--mut);}
.wrap .foot{font-size:10.5px;color:var(--faint);}
.wrap .warnbar{display:flex;align-items:center;gap:8px;background:var(--warn-soft);border:1px solid var(--warn);color:var(--warn);border-radius:11px;padding:11px 13px;margin-bottom:12px;font-size:12px;cursor:pointer;}
.wrap .okbar{background:var(--ok-soft);border-color:var(--ok);color:var(--ok);cursor:default;}
.wrap .empty{color:var(--faint);font-size:12px;text-align:center;padding:26px 0;}

/* 05 archive setup */
.wrap .runbtn{width:100%;border:0;border-radius:12px;background:var(--acc);color:#fff;font:inherit;font-size:14.5px;font-weight:600;padding:14px;cursor:pointer;letter-spacing:1px;transition:.14s;}
.wrap.night .runbtn{color:#26221e;}
.wrap .runbtn:hover{filter:brightness(1.05);}
.wrap .runbtn.off{opacity:.5;cursor:not-allowed;}
.wrap .setwrap{margin:20px 0 8px;}
.wrap .setrow{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink);}
.wrap .num{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--field);overflow:hidden;}
.wrap .num button{border:0;background:transparent;color:var(--mut);font:inherit;font-size:15px;width:28px;height:30px;cursor:pointer;}
.wrap .num button:hover{color:var(--acc);}
.wrap .num input{width:48px;border:0;outline:0;background:transparent;text-align:center;font:inherit;font-size:13px;color:var(--ink);}
.wrap .subhint{font-size:10.5px;color:var(--faint);margin:8px 2px 0;}
.wrap .seclab{font-size:10px;color:var(--faint);letter-spacing:.14em;text-transform:uppercase;margin:22px 2px 11px;}
.wrap .promptsec{display:flex;align-items:center;gap:8px;margin:22px 2px 11px;min-height:22px;flex-wrap:wrap;}
.wrap .promptsec .seclab{margin:0;flex:0 0 auto;}
.wrap .promptcontrols{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}
.wrap .promptfollow{font-size:10.5px;color:var(--faint);white-space:nowrap;flex:0 0 auto;}
.wrap .promptnotice{font-size:10.5px;color:var(--warn);white-space:nowrap;flex:0 0 auto;}
.wrap .promptreset{font-size:10.5px;color:var(--acc);border:1px solid var(--acc);border-radius:7px;padding:3px 8px;cursor:pointer;white-space:nowrap;transition:.14s;flex:0 0 auto;}
.wrap .promptreset:hover{background:var(--acc-soft);}
.wrap .mods{display:flex;flex-direction:column;gap:7px;}
.wrap .mod{border:1px solid var(--line);border-radius:8px;background:var(--card);overflow:hidden;}
.wrap .mod.ro{border-style:dashed;}
.wrap .modhead{display:flex;align-items:center;gap:8px;padding:6px 10px;min-height:34px;cursor:pointer;flex-wrap:wrap;}
.wrap .mt{font-size:13px;font-weight:500;}
.wrap .prompttag{font-size:9.5px;color:var(--faint);border:1px solid var(--line);border-radius:5px;padding:1px 6px;white-space:nowrap;}
.wrap .prompttag.custom{color:var(--acc);border-color:var(--acc);}
.wrap .prompttag.update{color:var(--warn);border-color:var(--warn);background:var(--warn-soft);}
.wrap .rotag{font-size:10px;color:var(--faint);border:1px solid var(--line);border-radius:5px;padding:1px 6px;}
.wrap .pen{font-size:13px;color:var(--mut);padding:2px 5px;border-radius:6px;transition:.14s;}
.wrap .pen:hover{color:var(--acc);background:var(--acc-soft);}
.wrap .pen.active{color:var(--acc);background:var(--acc-soft);}
.wrap .modedit{padding:0 9px 8px;}
.wrap .msub{font-size:10px;color:var(--faint);margin:9px 0 4px;display:flex;align-items:center;gap:8px;}
.wrap .msub .fullbtn{margin-left:auto;}
.wrap .fullbtn{color:var(--mut);cursor:pointer;font-size:11px;padding:1px 6px;border:1px solid var(--line);border-radius:5px;transition:.14s;flex:0 0 auto;user-select:none;}
.wrap .fullbtn:hover{color:var(--acc);border-color:var(--acc);}
.wrap .ebar .fullbtn{margin-right:auto;}
.wrap .modedit textarea{width:100%;height:62px;min-height:46px;resize:vertical;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--read);font:inherit;font-size:12px;line-height:1.6;padding:7px 9px;outline:0;}
.wrap .modedit textarea:focus{border-color:var(--acc);}
.wrap .runtime-summary{font-size:11px;line-height:1.65;color:var(--mut);background:var(--field);border:1px dashed var(--line);border-radius:7px;padding:7px 9px;}
.wrap .runtime-summary b{color:var(--read);font-weight:500;}
.wrap .headact{font-size:10.5px;color:var(--mut);cursor:pointer;padding:1px 3px;white-space:nowrap;}
.wrap .headact.saveact{color:var(--acc);font-weight:600;}
/* 提示词全屏编辑：面板放大、大文本框铺满（用 vh 定高，避开百分比高度链断裂） */
.wrap .panel.full{width:min(900px,calc(100vw - 32px));height:calc(100vh - 40px);height:calc(100dvh - 40px);max-width:none;max-height:900px;overflow:hidden;}
.wrap .panel.full [data-el=view]{height:100%;min-height:0;display:flex;flex-direction:column;}
.wrap .panel.full .top{flex:0 0 auto;}
.wrap .fullwrap{padding:14px 18px 18px;flex:1 1 auto;min-height:0;}
.wrap .fulltext{width:100%;height:100%;resize:none;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--read);font:13px/1.85 -apple-system,"PingFang SC",sans-serif;padding:14px 16px;outline:0;}
.wrap .fulltext:focus{border-color:var(--acc);}
.wrap .top .savem{cursor:pointer;color:var(--acc);font-weight:600;font-size:13px;flex:0 0 auto;}
.wrap .modedit textarea[readonly]{color:var(--mut);cursor:default;}
.wrap .ebar{display:flex;gap:16px;justify-content:flex-end;align-items:center;margin-top:10px;}
.wrap .ebar .cancel{font-size:12px;color:var(--mut);cursor:pointer;}
.wrap .ebar .savem{font-size:12px;color:var(--acc);font-weight:600;cursor:pointer;}
.wrap .robox{font-size:11px;color:var(--mut);line-height:1.7;padding:10px 12px;border:1px dashed var(--line);border-radius:9px;background:var(--field);margin-top:8px;}
.wrap .rangebox{margin:13px 0 2px;border:1px solid var(--line);border-radius:9px;background:var(--card);overflow:hidden;}
.wrap .rangehead{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line);font-size:11px;color:var(--mut);}
.wrap .rangehead b{color:var(--ink);font-size:11.5px;}
.wrap .rangectl{color:var(--acc);cursor:pointer;font-size:10.5px;}
.wrap .rangeitems{max-height:112px;overflow:auto;padding:3px 7px;}
.wrap .rangeitem{display:flex;align-items:center;gap:8px;padding:4px 3px;font-size:11px;color:var(--read);cursor:pointer;}
.wrap .rangeitem input{accent-color:var(--acc);width:13px;height:13px;flex:0 0 auto;}
.wrap .rangeitem .rfloor{font-family:"SF Mono",Menlo,monospace;color:var(--acc);min-width:42px;}
.wrap .rangeitem .rtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* 02 timeline spine */
.wrap .metarow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;}
.wrap .meta{font-size:11px;color:var(--mut);}
.wrap .rettoggle{font-size:10.5px;color:var(--faint);cursor:pointer;border:1px solid var(--line);border-radius:20px;padding:3px 11px;transition:.14s;flex:0 0 auto;user-select:none;}
.wrap .rettoggle:hover{color:var(--acc);border-color:var(--acc);}
.wrap .spine{position:relative;border-left:2px solid var(--line);margin-left:6px;padding-left:20px;}
.wrap .ev{position:relative;}
.wrap .ev .card{scroll-margin-top:58px;}
.wrap .read [data-cidx]{scroll-margin-top:58px;}
/* 底部留白：让靠近末尾的容器也能滚到抬头正下方（返回定位/落点定位用） */
.wrap .scrollpad{height:500px;flex:0 0 auto;pointer-events:none;}
.wrap .ev .edot{position:absolute;left:-21px;top:15px;width:10px;height:10px;border-radius:50%;background:var(--acc);transform:translateX(-50%);z-index:2;}
.wrap .ev .edot.hollow{background:var(--bg);border:2px solid var(--hollow);}
.wrap .ev .card{padding:11px 13px;border-radius:11px;cursor:pointer;background:transparent;box-shadow:0 0 0 rgba(0,0,0,0);transform:translateY(0);transition:background .16s ease,box-shadow .18s ease,transform .18s ease;margin-bottom:9px;}
/* 同色浮起：悬停不改背景色（与面板同 --bg），只靠阴影+轻微上浮显层次 */
.wrap .ev:hover .card{background:var(--bg);box-shadow:0 5px 16px -9px rgba(120,92,60,.3);transform:translateY(-1px);}
.wrap.night .ev:hover .card{box-shadow:0 7px 20px -10px rgba(0,0,0,.62);}
.wrap .ev.retired .yr,.wrap .ev.retired .nm{opacity:.5;}
.wrap .ev .yr{font-size:10.5px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;}
.wrap .ev .nm{font-size:14px;color:var(--ink);}
.wrap .refresh{font-size:11px;color:var(--faint);}

/* 03 archive reading */
.wrap .now{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:14.5px;font-weight:600;letter-spacing:.6px;}
.wrap .now small{font-family:-apple-system,sans-serif;font-weight:400;font-size:10.5px;color:var(--mut);margin-left:7px;}
.wrap .read{padding:16px 18px 20px;}
.wrap .chead .cline{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
.wrap .cyr{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:13px;color:var(--acc);}
.wrap .cname{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:16px;font-weight:600;letter-spacing:.5px;}
.wrap .crange{font-size:10.5px;color:var(--faint);margin:5px 0 10px;}
.wrap .prose{font-size:13px;line-height:1.95;color:var(--read);text-align:justify;}
.wrap .prose p{margin-bottom:10px;}.wrap .prose p:last-child{margin-bottom:0;}
.wrap .dftitle{font-size:12.5px;color:var(--acc);font-weight:600;margin:13px 0 4px;}
.wrap .dsmall{font-size:12.5px;color:var(--read);line-height:1.85;margin-bottom:6px;}
.wrap .dexc{font-size:12px;color:var(--mut);line-height:1.8;padding-left:14px;text-indent:-11px;}
.wrap .dexc .d{color:var(--acc);}
.wrap .readnote{margin:16px 0 0;font-size:10.5px;color:var(--faint);text-align:center;}
.wrap .badge{margin-left:8px;font-size:10px;color:var(--acc);border:1px solid var(--acc);border-radius:20px;padding:2px 8px;flex:0 0 auto;}
.wrap .rcont{border-radius:12px;}
.wrap .rcont.editable{cursor:pointer;padding:12px;margin:-4px;transition:background .16s,box-shadow .18s,transform .18s;}
.wrap .rcont.editable:hover{background:var(--card);box-shadow:0 6px 18px -10px rgba(0,0,0,.35);transform:translateY(-1px);}
.wrap .ebar .tip{margin-right:auto;font-size:10.5px;color:var(--faint);}
/* 容器间分隔 ◇（往下滑到下一个） */
.wrap .sep{display:flex;align-items:center;justify-content:center;margin:16px 0;color:var(--faint);}
.wrap .sep::before,.wrap .sep::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--line),transparent);}
.wrap .sep .d{font-size:9px;letter-spacing:4px;padding:0 8px;}
/* 04 结构化编辑：灰色=锁定结构，有底框才可改 */
.wrap .selegend{font-size:10.5px;color:var(--faint);line-height:1.7;margin-bottom:12px;padding:9px 11px;background:var(--acc-soft);border-radius:8px;}
.wrap .selegend .lk{color:var(--lock);}
.wrap .selegend .ed{color:var(--acc);border-bottom:1px solid var(--acc);}
.wrap .se-root{padding:2px;}
.wrap .tok{color:var(--lock);user-select:none;}
.wrap .f{background:var(--field);border:1px solid var(--line);border-radius:6px;padding:2px 8px;outline:0;color:var(--ink);display:inline-block;min-width:40px;transition:.14s;white-space:pre-wrap;}
.wrap .f:focus{border-color:var(--acc);}
.wrap .fblock{display:block;background:var(--field);border:1px solid var(--line);border-radius:8px;padding:10px 11px;outline:0;color:var(--read);font-size:12.5px;line-height:1.85;margin:8px 0 4px;text-align:justify;white-space:pre-wrap;}
.wrap .fblock:focus{border-color:var(--acc);}
.wrap .se-ctitle{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:15px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.wrap .se-ctitle .f{font-family:"Songti SC","Noto Serif CJK SC",serif;font-weight:600;}
.wrap .se-ctitle .f.time,.wrap .se-ftitle .f.time{font-family:-apple-system,sans-serif;font-weight:400;font-size:11px;color:var(--mut);}
.wrap .se-ftitle{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:16px 0 2px;font-size:13px;}
.wrap .se-exc{display:flex;align-items:flex-start;gap:7px;margin:7px 0;}
.wrap .se-exc .star{color:var(--lock);padding-top:3px;user-select:none;font-size:14px;}
.wrap .se-exc .f.line{flex:1;font-size:12px;line-height:1.7;padding:5px 9px;}
.wrap .se-exc .del{color:var(--faint);cursor:pointer;font-size:13px;padding:3px 6px;border-radius:5px;}
.wrap .se-exc .del:hover{color:var(--err);background:var(--err-soft);}
.wrap .excadd{font-size:11px;color:var(--faint);margin-left:22px;cursor:pointer;display:inline-block;margin-top:2px;}
.wrap .excadd:hover{color:var(--acc);}
.wrap .editbar2{display:flex;align-items:center;gap:18px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--line);}
.wrap .editbar2 .cancel{font-size:12px;color:var(--mut);cursor:pointer;}
.wrap .editbar2 .savem{font-size:12px;color:var(--acc);font-weight:600;cursor:pointer;}
.wrap .editing-card{background:var(--field);border:1px solid var(--line);border-radius:12px;padding:14px 15px;}

/* result window (06/07/08/09) */
.wrap .panel.result{overflow:hidden;}
.wrap .panel.result [data-el=view]{height:100%;min-height:0;}
.wrap .result-page{height:100%;min-height:0;display:flex;flex-direction:column;}
.wrap .result-fixed{flex:0 0 auto;background:var(--bg);z-index:2;}
.wrap .result-title{min-width:0;}
.wrap .result-status{padding:10px 20px 0;}
.wrap .result-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 20px 16px;}
.wrap .result-scroll::-webkit-scrollbar{width:8px;}.wrap .result-scroll::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .result-footer{flex:0 0 auto;padding:10px 20px 14px;border-top:1px solid var(--line);background:var(--bg);}
.wrap .result-footer .acts{margin-top:0;}
.wrap .repairrow{display:flex;justify-content:flex-end;margin:-4px 0 10px;}
.wrap .repairbtn{border:1px solid var(--err);background:var(--err-soft);color:var(--err);font:inherit;font-size:11.5px;padding:6px 10px;border-radius:8px;cursor:pointer;}
.wrap .discard{font-size:12px;color:var(--mut);cursor:pointer;padding:5px 8px;border-radius:7px;transition:.14s;}
.wrap .discard:hover{color:var(--err);background:var(--err-soft);}
.wrap .verify{display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:10px;margin-bottom:13px;font-size:12.5px;}
.wrap .verify .mk{width:19px;height:19px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto;}
.wrap .verify.ok{background:var(--ok-soft);border:1px solid var(--ok);}.wrap .verify.ok .mk{background:var(--ok);}.wrap .verify.ok .vt{color:var(--ok);}
.wrap .verify.soft{background:var(--warn-soft);border:1px solid var(--warn);}.wrap .verify.soft .mk{background:var(--warn);}.wrap .verify.soft .vt{color:var(--warn);}
.wrap .verify.hard{background:var(--err-soft);border:1px solid var(--err);}.wrap .verify.hard .mk{background:var(--err);}.wrap .verify.hard .vt{color:var(--err);}
.wrap .verify .vt{font-weight:500;flex:1;}
.wrap .verify .vs{font-size:11px;color:var(--mut);}
.wrap .issues{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}
.wrap .iss{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:10px;}
.wrap .iss.soft{background:var(--warn-soft);border:1px solid var(--warn);}
.wrap .iss.hard{background:var(--err-soft);border:1px solid var(--err);}
.wrap .iss .ic{width:17px;height:17px;border-radius:50%;color:#fff;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px;}
.wrap .iss.soft .ic{background:var(--warn);}.wrap .iss.hard .ic{background:var(--err);}
.wrap .iss .itxt{flex:1;min-width:0;}
.wrap .iss .loc{font-size:12px;font-weight:600;margin-bottom:3px;}
.wrap .iss.soft .loc{color:var(--warn);}.wrap .iss.hard .loc{color:var(--err);}
.wrap .iss .desc{font-size:11.5px;color:var(--read);line-height:1.6;}
.wrap .iss .sug{font-size:11px;margin-top:4px;}
.wrap .iss.soft .sug{color:var(--warn);}.wrap .iss.hard .sug{color:var(--err);}
.wrap .cand-head{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
.wrap .seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;background:var(--field);padding:2px;gap:2px;}
.wrap .seg button{border:0;background:transparent;font:inherit;font-size:11.5px;color:var(--mut);padding:5px 12px;border-radius:7px;cursor:pointer;transition:.14s;}
.wrap .seg button.on{background:var(--acc);color:#fff;}
.wrap.night .seg button.on{color:#26221e;}
.wrap .edit-cue{font-size:10.5px;color:var(--faint);margin-left:auto;}
.wrap .doc{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:15px 16px;max-height:290px;overflow:auto;cursor:text;transition:.14s;}
.wrap .result-scroll .doc{max-height:none;overflow:visible;}
.wrap .doc:hover{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft);}
.wrap .doc::-webkit-scrollbar{width:8px;}.wrap .doc::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .shell{font-size:10.5px;color:var(--faint);font-family:"SF Mono",Menlo,monospace;}
.wrap .ctitle{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:14.5px;font-weight:600;margin:12px 0 6px;letter-spacing:.3px;}
.wrap .ctitle:first-of-type{margin-top:7px;}
.wrap .big{font-size:12.5px;color:var(--read);line-height:1.9;margin-bottom:9px;}
.wrap .ftitle{font-size:12px;color:var(--acc);font-weight:600;margin:9px 0 4px;}
.wrap .small{font-size:12px;color:var(--read);line-height:1.85;margin-bottom:6px;}
.wrap .exc{font-size:11.5px;color:var(--mut);line-height:1.8;padding-left:13px;text-indent:-11px;}
.wrap .exc .d{color:var(--acc);}
.wrap .raw{white-space:pre-wrap;word-break:break-word;font:12px/1.7 "SF Mono",Menlo,monospace;color:var(--read);}
.wrap .editdoc{width:100%;min-height:220px;resize:vertical;border:1px solid var(--acc);border-radius:11px;background:var(--field);color:var(--read);font:12.5px/1.85 -apple-system,"PingFang SC",sans-serif;padding:14px 15px;outline:0;}
.wrap .guide{margin:15px 0 4px;}
.wrap .glab{font-size:10.5px;color:var(--faint);margin:0 2px 6px;}
.wrap .glab b{color:var(--mut);}
.wrap .guide input{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--field);color:var(--read);font:inherit;font-size:12px;padding:10px 12px;outline:0;}
.wrap .guide input:focus{border-color:var(--acc);}
.wrap .acts{display:flex;align-items:center;gap:9px;margin-top:16px;}
.wrap .ghost{border:1px solid var(--line);background:var(--card);color:var(--read);font:inherit;font-size:12.5px;padding:11px 16px;border-radius:10px;cursor:pointer;transition:.14s;}
.wrap .ghost:hover{border-color:var(--acc);color:var(--acc);}
.wrap .savenote{margin-left:auto;font-size:10.5px;margin-right:2px;}
.wrap .savenote.soft{color:var(--warn);}.wrap .savenote.hard{color:var(--err);}
.wrap .save{border:0;background:var(--acc);color:#fff;font:inherit;font-size:13px;font-weight:600;padding:12px 26px;border-radius:10px;cursor:pointer;letter-spacing:1px;transition:.14s;}
.wrap.night .save{color:#26221e;}
.wrap .save.off{background:var(--line);color:var(--faint);cursor:not-allowed;}
.wrap .acts .save:first-child{margin-left:auto;}

/* 10 API config */
.wrap .fnname{font-size:14.5px;font-weight:600;letter-spacing:.3px;margin-bottom:18px;}
.wrap .flabel{font-size:12px;color:var(--read);margin-bottom:8px;}
.wrap .sel{position:relative;}
.wrap .sel select{width:100%;appearance:none;-webkit-appearance:none;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--ink);font:inherit;font-size:13px;padding:12px 38px 12px 14px;cursor:pointer;outline:0;}
.wrap .sel select:focus{border-color:var(--acc);}
.wrap .sel .chev{position:absolute;right:15px;top:50%;transform:translateY(-50%);color:var(--mut);pointer-events:none;font-size:11px;}
.wrap .modelhint{font-size:11.5px;color:var(--mut);margin:11px 2px 0;line-height:1.6;}
.wrap .saverow{margin-top:22px;display:flex;justify-content:flex-end;align-items:center;gap:14px;}

/* 11 integrity */
.wrap .imk{width:26px;height:26px;border-radius:50%;background:var(--err-soft);border:1px solid var(--err);color:var(--err);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto;margin-top:1px;}
.wrap .hsub{font-size:11px;color:var(--err);margin-top:4px;line-height:1.5;}
.wrap .list{display:flex;flex-direction:column;gap:7px;}
.wrap .item{display:flex;align-items:center;gap:11px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);}
.wrap .item .itx{flex:1;min-width:0;}
.wrap .item .nm{font-size:13.5px;color:var(--ink);}
.wrap .item .src{font-size:10.5px;color:var(--mut);margin-top:2px;font-family:"SF Mono",Menlo,monospace;}
.wrap .item .old{font-size:9.5px;color:var(--err);border:1px solid var(--err);border-radius:5px;padding:1px 6px;white-space:nowrap;}
.wrap .okmk{font-size:9.5px;color:var(--ok);border:1px solid var(--ok);border-radius:5px;padding:1px 6px;white-space:nowrap;flex:0 0 auto;}
.wrap .womk{font-size:9.5px;color:var(--mut);border:1px solid var(--line);border-radius:5px;padding:1px 6px;white-space:nowrap;flex:0 0 auto;}
.wrap .txlink{margin-top:16px;font-size:11.5px;color:var(--mut);cursor:pointer;text-align:center;padding:9px;border-radius:9px;border:1px dashed var(--line);transition:.14s;}
.wrap .txlink:hover{color:var(--ink);border-color:var(--mut);}
.wrap .gobtn{width:100%;border:0;background:var(--acc);color:#fff;font:inherit;font-size:13.5px;font-weight:600;padding:13px;border-radius:11px;cursor:pointer;letter-spacing:1px;margin-top:16px;transition:.14s;}
.wrap.night .gobtn{color:#26221e;}
.wrap .gobtn:hover{filter:brightness(1.05);}
.wrap .loading{padding:44px 20px;text-align:center;color:var(--mut);font-size:13px;}
.wrap .loading .ghost{display:block;margin:18px auto 0;padding:9px 18px;}
.wrap .genfail{cursor:default;justify-content:space-between;align-items:center;}
.wrap .genfail .gtxt{min-width:0;line-height:1.55;}
.wrap .retrybtn{flex:0 0 auto;border:1px solid var(--warn);background:transparent;color:var(--warn);font:inherit;font-size:10.5px;padding:5px 9px;border-radius:7px;cursor:pointer;}
.wrap .retrybtn:hover{background:var(--warn-soft);}
.wrap .summary-fail{display:block;cursor:default;}
.wrap .summary-fail .guide{margin:10px 0 0;}
.wrap .summary-fail .retryrow{display:flex;align-items:center;gap:10px;margin-top:9px;}
.wrap .summary-fail .retryrow .subhint{margin:0;flex:1;}
.wrap .summary-fail .retrybtn[disabled]{opacity:.45;cursor:not-allowed;}

/* mobile fallback：脚本会再按 visualViewport 精确定位；这里保证脚本尚未运行时也不重排内部 UI。 */
@media (max-width:640px), (pointer:coarse) and (max-height:600px){
  .wrap .panel,.wrap .panel.full{top:50%;right:auto;bottom:auto;left:50%;transform:translate(-50%,-50%);width:calc(100vw - 24px);height:calc(100vh - 88px);height:calc(100dvh - 88px);max-width:480px;max-height:none;border-radius:16px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
  .wrap .panel-close{width:36px;height:36px;font-size:25px;}
  .wrap .panel.full .top .prompttag{display:none;}
}
`;
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function label(title, time) {
    return esc([title, time].filter(Boolean).join(" | "));
  }
  function paras(text) {
    return text.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
  }
  function renderDoc(containers) {
    const p = ['<div class="shell">&lt;World_Archive&gt;</div>'];
    for (const c of containers) {
      const [o, cl] = c.kind === "segment" ? ["[", "]"] : ["《", "》"];
      const head = c.kind === "segment" ? [c.title, c.keywords, c.time].filter(Boolean).map((x) => esc(x)).join(" | ") : label(c.title, c.time);
      p.push(`<div class="ctitle">${o}${head}${cl}</div>`);
      if (c.summary) p.push(`<div class="big">${esc(c.summary)}</div>`);
      for (const ex of c.looseExcerpts ?? []) p.push(`<div class="exc"><span class="d">·</span> ${esc(ex.text)}</div>`);
      for (const f of c.fragments) {
        p.push(`<div class="ftitle">[${label(f.title, f.time)}]</div>`);
        if (f.summary) p.push(`<div class="small">${esc(f.summary)}</div>`);
        for (const ex of f.excerpts) p.push(`<div class="exc"><span class="d">·</span> ${esc(ex.text)}</div>`);
      }
    }
    p.push('<div class="shell">&lt;/World_Archive&gt;</div>');
    return p.join("");
  }
  function issueLoc(i) {
    const m = {
      SHELL_MISSING: "缺档案外壳",
      SHELL_UNCLOSED: "外壳未闭合",
      NO_CONTAINER: "无时间轴容器",
      CONTAINER_TOKEN_BROKEN: "容器标题符号不完整",
      FRAGMENT_TOKEN_BROKEN: "片段标题符号不完整",
      CONTAINER_SUMMARY_EMPTY: "容器大总结为空",
      CONTAINER_TIME_MISSING: "容器缺时间字段",
      CONTAINER_NO_FRAGMENT: "容器只有大总结",
      FRAGMENT_TIME_MISSING: "片段缺时间字段",
      FRAGMENT_NO_EXCERPT: "片段有小总结无摘录",
      BRACKET_UNBALANCED: "摘录引号疑似不闭合",
      ARCHIVED_MARKER_FORBIDDEN: "普通档含覆盖标记",
      SEGMENT_TOKEN_BROKEN: "事件段标题符号不完整",
      NO_SEGMENT: "无普通事件段",
      CONTAINER_UNEXPECTED: "出现时间轴容器",
      SEGMENT_SUMMARY_EMPTY: "事件段总结为空",
      SEGMENT_TITLE_MISSING: "事件段缺标题",
      SEGMENT_KEYWORDS_MISSING: "事件段缺关键词",
      SEGMENT_TIME_MISSING: "事件段缺时间"
    };
    return m[i.code] ?? i.code;
  }
  function issueSug(i) {
    const m = {
      SHELL_MISSING: "若正文结构清楚，可一键补正外壳；否则重新生成。",
      SHELL_UNCLOSED: "结尾漏了 </World_Archive>，可一键补正或重新生成。",
      NO_CONTAINER: "生成物必须是《》时间轴格式，重新生成。",
      CONTAINER_TOKEN_BROKEN: "若只缺闭合符可一键补正；否则手改或重新生成。",
      FRAGMENT_TOKEN_BROKEN: "若只缺闭合符可一键补正；否则手改或重新生成。",
      CONTAINER_SUMMARY_EMPTY: "这段得有内容 —— 点档案补写，或重新生成。",
      CONTAINER_TIME_MISSING: "补上时间便于时间轴定位；也可留着。",
      CONTAINER_NO_FRAGMENT: "翻一眼原文，确认要不要补一两条摘录。",
      FRAGMENT_TIME_MISSING: "补上时间范围便于定位；也可留着。",
      FRAGMENT_NO_EXCERPT: "看要不要补一两条摘录；也可留着。",
      BRACKET_UNBALANCED: "检查「」是否配对。",
      ARCHIVED_MARKER_FORBIDDEN: "删除 archived 覆盖标记；摘要 → 大总结不能接管时间轴覆盖链。",
      SEGMENT_TOKEN_BROKEN: "检查事件段的 [] 与竖线字段是否完整。",
      NO_SEGMENT: "改为一个或多个普通扁平 [] 事件段，或重新生成。",
      CONTAINER_UNEXPECTED: "摘要 → 大总结应使用 [] 事件段；可手改或保留后应用。",
      SEGMENT_SUMMARY_EMPTY: "为该事件段补上客观总结，或重新生成。",
      SEGMENT_TITLE_MISSING: "补一个简短事件标题；也可保留。",
      SEGMENT_KEYWORDS_MISSING: "补上情绪／感知关键词字段；也可保留。",
      SEGMENT_TIME_MISSING: "补上起止时间字段；也可保留。"
    };
    return m[i.code] ?? (i.severity === "hard" ? "点档案任意处改，或重新生成。" : "可斟酌，仍可保存。");
  }
  var COMMIT_STATUS_LABEL = {
    prepared: "已就绪 · 未落盘",
    committing: "提交中 · 可能中断",
    failed: "失败中断",
    completed: "已完成"
  };
  function createPanel(session, doc = document) {
    const root = doc.createElement("div");
    root.id = "mem-root";
    root.style.display = "none";
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style>
    <div class="wrap night" data-el="wrap">
      <div class="backdrop" data-act="close"></div>
      <div class="panel">
        <div class="panel-chrome"><button type="button" class="panel-close" data-act="close" aria-label="关闭记忆档案" title="关闭">×</button></div>
        <div data-el="view"></div>
      </div>
    </div>`;
    const wrap = shadow.querySelector("[data-el=wrap]");
    const panelEl = shadow.querySelector(".panel");
    const panelWindow = doc.defaultView ?? window;
    let view = "hub";
    let snap = null;
    let cand = null;
    let summaryCand = null;
    let mode = "archive";
    let summaryMode = "archive";
    let night = true;
    let flash = "";
    let nodes = [];
    let detailStart = null;
    let detailCurIdx = null;
    let editingIdx = null;
    let expandMod = null;
    let summaryExpandMod = null;
    let fullEdit = null;
    let showRetired = false;
    let candEditing = false;
    let summaryCandEditing = false;
    let reopenEditor = false;
    let summaryReopenEditor = false;
    let activeGenerationAttempt = null;
    let failedGeneration = null;
    let activeSummaryGenerationAttempt = null;
    let failedSummaryGeneration = null;
    let generationUiEpoch = 0;
    let renderedSurface = null;
    let rangeThrough = null;
    let panelOffset = { x: 0, y: 0 };
    let panelMoved = false;
    let drag = null;
    const viewEl = () => shadow.querySelector("[data-el=view]");
    function visibleViewport() {
      const vv = panelWindow.visualViewport;
      return vv ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height } : { left: 0, top: 0, width: panelWindow.innerWidth, height: panelWindow.innerHeight };
    }
    function clamp(value, min, max) {
      if (max < min) return (min + max) / 2;
      return Math.min(max, Math.max(min, value));
    }
    function layoutPanel(resetPosition = false) {
      const viewport = visibleViewport();
      if (viewport.width <= 0 || viewport.height <= 0) return;
      const coarsePointer = panelWindow.matchMedia?.("(pointer: coarse)").matches ?? false;
      const mobile = viewport.width <= 640 || coarsePointer && viewport.height <= 600;
      const fullDesktop = !!fullEdit && !mobile;
      const horizontalMargin = mobile ? 12 : fullDesktop ? 16 : viewport.width * 0.03;
      const verticalMargin = mobile ? 44 : fullDesktop ? 20 : viewport.height * 0.03;
      const maxWidth = fullDesktop ? 900 : 480;
      const maxHeight = fullDesktop ? 900 : mobile ? Number.POSITIVE_INFINITY : 620;
      const width = Math.max(1, Math.min(maxWidth, viewport.width - 2 * horizontalMargin));
      const height = Math.max(1, Math.min(maxHeight, viewport.height - 2 * verticalMargin));
      const viewportCenter = {
        x: viewport.left + viewport.width / 2,
        y: viewport.top + viewport.height / 2
      };
      if (resetPosition) {
        panelOffset = { x: 0, y: 0 };
        panelMoved = false;
      }
      let left = viewportCenter.x + panelOffset.x - width / 2;
      let top = viewportCenter.y + panelOffset.y - height / 2;
      if (panelMoved) {
        const minGrabWidth = Math.min(180, width);
        const minGrabHeight = Math.min(48, height);
        left = clamp(
          left,
          viewport.left - width + minGrabWidth,
          viewport.left + viewport.width - minGrabWidth
        );
        top = clamp(top, viewport.top - 12, viewport.top + viewport.height - minGrabHeight);
      } else {
        left = clamp(left, viewport.left, viewport.left + viewport.width - width);
        top = clamp(top, viewport.top, viewport.top + viewport.height - height);
      }
      panelOffset = {
        x: left + width / 2 - viewportCenter.x,
        y: top + height / 2 - viewportCenter.y
      };
      panelEl.style.width = `${width}px`;
      panelEl.style.height = `${height}px`;
      panelEl.style.maxWidth = "none";
      panelEl.style.maxHeight = "none";
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
      panelEl.style.left = `${left}px`;
      panelEl.style.top = `${top}px`;
      panelEl.style.transform = "none";
    }
    function onViewportChange() {
      if (root.style.display !== "none") layoutPanel();
    }
    panelWindow.addEventListener("resize", onViewportChange);
    panelWindow.visualViewport?.addEventListener("resize", onViewportChange);
    panelWindow.visualViewport?.addEventListener("scroll", onViewportChange);
    function dnToggle() {
      return `<div class="daynight"><span class="dn${night ? "" : " on"}" data-t="day">日</span><span class="dn${night ? " on" : ""}" data-t="night">夜</span></div>`;
    }
    function doRefresh() {
      snap = session.refresh();
    }
    function orchParts() {
      const entries = session.orchestrationEntries();
      const hi = entries.findIndex((e) => e.kind === "historical_context");
      const gi = entries.findIndex((e) => e.kind === "guidance");
      const start = hi < 0 ? entries.length : hi;
      const end = gi < 0 ? start - 1 : gi;
      return { pre: entries.slice(0, start), runtime: entries.slice(start, end + 1), post: entries.slice(end + 1) };
    }
    function rangeSources() {
      if (!snap) return [];
      const byFloor = /* @__PURE__ */ new Map();
      for (const e of session.collect(snap).sources) {
        if (byFloor.has(e.messageId)) continue;
        const title = parseArchiveBody(e.content).map((c) => c.title).find(Boolean) || "（无题）";
        byFloor.set(e.messageId, title);
      }
      return [...byFloor].map(([floor, title]) => ({ floor, title })).sort((a, b) => a.floor - b.floor);
    }
    function resetRangeSelection() {
      const sources = rangeSources();
      rangeThrough = sources.length ? sources[sources.length - 1].floor : null;
    }
    function selectedRangeFloors() {
      if (rangeThrough == null) return [];
      return rangeSources().filter((x) => x.floor <= rangeThrough).map((x) => x.floor);
    }
    function generationFailureHtml(kind) {
      if (!failedGeneration || failedGeneration.attempt.kind !== kind) return "";
      return `<div class="warnbar genfail"><span class="gtxt">${esc(failedGeneration.message)}</span><button type="button" class="retrybtn" data-act="retry-generation">按相同参数重试</button></div>`;
    }
    function summaryInitialFailureHtml() {
      const failed = failedSummaryGeneration;
      if (!failed || failed.attempt.kind === "reroll") return "";
      const retryable = session.summaryRetryAvailable();
      return `<div class="warnbar summary-fail">
      <div class="gtxt">${esc(failed.message)}</div>
      <div class="guide"><div class="glab">同一批来源重试的补充引导 · 可留空</div>
        <input data-el="summary-retry-guide" placeholder="例如：优先保留某段因果、动作或对白" value="${esc(failed.attempt.guidance)}"></div>
      <div class="retryrow"><button type="button" class="ghost" data-act="summary-failed-discard">放弃本轮</button><span class="subhint">${retryable ? "只重跑生成；来源批次保持不变" : "这次尚未冻结出可重试的来源批次，请重新开始"}</span>
        <button type="button" class="retrybtn" data-act="summary-retry"${retryable ? "" : " disabled"}>同一批来源重试</button></div>
    </div>`;
    }
    function summaryRerollFailureHtml() {
      const failed = failedSummaryGeneration;
      if (!failed || failed.attempt.kind !== "reroll") return "";
      return `<div class="warnbar genfail"><span class="gtxt">${esc(failed.message)} · 原候选仍保留</span></div>`;
    }
    function interruptedProgressText() {
      const log = snap?.commitLog;
      if (!log || log.status === "completed") return "无薄日志（旧版中断），无法安全推断已进行到哪一步";
      const old = log.oldSucceededFloors.length ? log.oldSucceededFloors.join("、") : "无";
      const promoted = log.promotedFloor == null ? "尚未转正" : `层 ${log.promotedFloor} 已转正`;
      const supersede = log.supersede ? ` · 既存接管${log.supersede.done ? "已完成" : "未完成"}` : "";
      return `pending 目标层 ${log.targetFloor} · 已 old 层 ${old} · ${promoted}${supersede}`;
    }
    function renderHub() {
      const s = snap;
      const liveN = s ? s.table.filter((e) => e.generation === "live").length : 0;
      const trig = s?.trigger;
      const timelineEnabled = session.config.timelineEnabled !== false;
      const summaryEnabled = session.config.summaryEnabled !== false;
      const due = trig?.eligible ? `<div class="stat due"><span class="pin"></span>该总结了 · 可总结 ${trig.range?.from}–${trig.range?.to}</div>` : `<div class="stat">上次总结至 <b>层 ${s?.boundary ?? 0}</b></div>`;
      const disabledStatus = '<div class="stat disabled">未启用 · 仍可手动开始</div>';
      const featureSwitch = (feature, enabled, label2) => `
      <button type="button" class="feature-switch" data-act="toggle-${feature}" role="switch"
        aria-checked="${enabled}" aria-label="${enabled ? "关闭" : "启用"}${label2}"
        title="${enabled ? "关闭" : "启用"}${label2}"></button>`;
      const integrityBar = s?.integrity.needed && !s.interrupted.length ? `<div class="warnbar" data-act="integrity-open">⚠ 检测到 ${s.integrity.toRestore.length} 份需复原的退役档 · 点此处理</div>` : "";
      const interruptedBar = s?.interrupted.length ? `<div class="warnbar" data-act="commitlog-open">⚠ 检测到 ${s.interrupted.length} 份未完成 pending · ${esc(interruptedProgressText())} · 点此查看／继续</div>` : "";
      const commitLogLink = s?.commitLog && !s.interrupted.length ? `<div class="txlink" data-act="commitlog-open">提交事务日志 · 最近一笔${esc(COMMIT_STATUS_LABEL[s.commitLog.status] ?? s.commitLog.status)} ›</div>` : "";
      const selectedProfile = session.connectionProfiles().find((profile) => profile.id === session.config.connectionProfileId);
      const connectionStatus = selectedProfile ? `${esc(selectedProfile.name)}${selectedProfile.model ? ` · ${esc(selectedProfile.model)}` : ""} · <b>已选</b>` : session.config.connectionProfileId ? "原连接配置已不存在 · 请重新选择" : "跟随当前酒馆连接";
      const promptUpdates = session.promptOverrideSummary().updates;
      const promptUpdateDot = promptUpdates ? `<span class="updot" title="${promptUpdates} 处自定义提示词有内置新版"></span>` : "";
      const summaryPromptUpdates = session.summaryPromptOverrideSummary().updates;
      const summaryPromptUpdateDot = summaryPromptUpdates ? `<span class="updot" title="${summaryPromptUpdates} 处摘要 → 大总结提示词有内置新版"></span>` : "";
      const summaryTrig = s?.summaryTrigger;
      const latestArchive = s?.latestLiveArchiveFloor ?? null;
      const summaryStatus = latestArchive === null ? `<div class="stat${summaryTrig?.eligible ? " due" : ""}">${summaryTrig?.eligible ? '<span class="pin"></span>' : ""}尚无 Archive · 已累计 <b>${summaryTrig?.distance ?? 0} 层</b></div>` : `<div class="stat${summaryTrig?.eligible ? " due" : ""}">${summaryTrig?.eligible ? '<span class="pin"></span>' : ""}最近 Archive 层 <b>${latestArchive}</b> · 距今 ${summaryTrig?.distance ?? 0} 层</div>`;
      return `
      <div class="head"><div class="title">记忆档案</div><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        ${interruptedBar}
        ${integrityBar}
        <div class="rect" data-act="timeline">
          <span class="mark"></span>
          <div class="tx"><div class="t">时间轴与档案</div>
            <div class="d">当前聊天的档案一览 · 点任一条进详情</div>
            <div class="st"><b>${liveN} 条</b> · 占 ~${s?.totalLiveSize ?? 0} 字</div></div>
          <span class="go">›</span>
        </div>
        <div class="rect" data-act="api">
          <span class="mark"></span>
          <div class="tx"><div class="t">API 配置</div>
            <div class="d">为归档选择酒馆保存的连接配置</div>
            <div class="st">${connectionStatus}</div></div>
          <span class="go">›</span>
        </div>
        <div class="grouplab">总结设置 · 单次设好基本不动</div>
        <div class="squares">
          <div class="sq" data-act="summary-setup">
            <div class="sqtop"><span class="dot"></span>${featureSwitch("summary", summaryEnabled, "摘要 → 大总结")}</div>
            <div class="t">摘要 → 大总结${summaryPromptUpdateDot}</div>
            <div class="sp"></div>${summaryEnabled ? summaryStatus : disabledStatus}
          </div>
          <div class="sq" data-act="setup">
            <div class="sqtop"><span class="dot"></span>${featureSwitch("timeline", timelineEnabled, "大总结时间轴化")}</div>
            <div class="t">大总结时间轴化${promptUpdateDot}</div>
            <div class="d">进一步压缩大总结的内容</div><div class="sp"></div>${timelineEnabled ? due : disabledStatus}
          </div>
        </div>
        ${commitLogLink}
      </div>`;
    }
    function renderSetup() {
      const s = snap;
      const n = session.config.n;
      const boundary = s?.boundary ?? session.config.boundary ?? 0;
      const trig = s?.trigger;
      const nextFloor = boundary + 2 * n;
      const sources = rangeSources();
      if (rangeThrough != null && !sources.some((x) => x.floor === rangeThrough)) {
        rangeThrough = sources.length ? sources[sources.length - 1].floor : null;
      }
      const selected = selectedRangeFloors();
      const interrupted = (s?.interrupted.length ?? 0) > 0;
      const integrityBlocked = !!s?.integrity.needed;
      const canRun = selected.length > 0 && !interrupted && !integrityBlocked;
      const { pre, post } = orchParts();
      const collected = snap ? session.collect(snap) : null;
      const promptSummary = session.promptOverrideSummary();
      const moduleEdit = (entries) => {
        return `<div class="modedit">${entries.map((e) => `<textarea data-oid="${esc(e.id)}">${esc(e.content)}</textarea>`).join("")}</div>`;
      };
      const moduleState = (entries) => {
        const states = entries.map((entry) => session.orchestrationState(entry.id));
        return {
          customized: states.some((state) => state.customized),
          update: states.some((state) => state.builtinUpdateAvailable)
        };
      };
      const moduleTags = (entries) => {
        const state = moduleState(entries);
        if (!state.customized) return '<span class="prompttag">跟随内置</span>';
        return `<span class="prompttag custom">自定义</span>${state.update ? '<span class="prompttag update">内置有新版</span>' : ""}`;
      };
      const moduleActions = (entries, modKey) => {
        if (expandMod !== modKey) return `<span class="pen">✎</span>`;
        const first = entries[0];
        return `${first ? `<span class="fullbtn" data-act="full-open" data-oid="${esc(first.id)}" title="全屏编辑">⛶</span>` : ""}
        ${first && session.orchestrationState(first.id).customized ? `<span class="headact" data-act="mod-reset" data-oid="${esc(first.id)}">恢复内置最新版</span>` : ""}
        <span class="headact" data-act="mod-cancel">取消</span>
        <span class="headact saveact" data-act="mod-save" data-mod="${modKey}">保存</span>`;
      };
      const preEdit = expandMod === "pre" ? moduleEdit(pre) : "";
      const postEdit = expandMod === "post" ? moduleEdit(post) : "";
      const runEdit = expandMod === "runtime" ? `<div class="modedit"><div class="runtime-summary">
            <div><b>既存档</b> ${collected?.continuity ? `层 ${collected.continuity.messageId}` : "无"}</div>
            <div><b>本轮原始档</b> ${selected.length ? selected.map((x) => `层 ${x}`).join("、") : "未选择"}</div>
            <div><b>补充引导</b> 在结果窗按需填入</div>
          </div></div>` : "";
      const rangeItems = sources.map(
        (x) => `<label class="rangeitem"><input type="checkbox" data-el="range-floor" value="${x.floor}"${rangeThrough != null && x.floor <= rangeThrough ? " checked" : ""}>
          <span class="rfloor">层 ${x.floor}</span><span class="rtitle">${esc(x.title)}</span></label>`
      ).join("");
      return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">大总结时间轴化</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        ${generationFailureHtml("initial")}
        ${interrupted ? `<div class="warnbar">⚠ 有未完成 pending；${esc(interruptedProgressText())}；当前禁止开始新归档</div>` : ""}
        ${integrityBlocked && !interrupted ? '<div class="warnbar">⚠ 档案完整性缺口尚未复原；当前禁止开始新归档</div>' : ""}
        <button class="runbtn${canRun ? "" : " off"}" data-act="run"${canRun ? "" : " disabled"}>开始总结</button>
        <div class="setwrap">
          <div class="setrow"><span>保留最近</span>
            <span class="num"><button data-act="n-dec"${n <= MIN_N ? " disabled" : ""}>−</button><input data-el="nval" type="number" min="${MIN_N}" step="50" value="${n}" inputmode="numeric"><button data-act="n-inc">＋</button></span>
            <span>层不总结</span></div>
          <div class="subhint">${trig?.eligible ? `现在可总结 ${trig?.range?.from}–${trig?.range?.to} 层` : `下次总结预计在 层 ${nextFloor}（上次总结至 ${boundary}）`}</div>
        </div>
        <div class="rangebox">
          <div class="rangehead"><b>本轮范围</b><span>按时间连续选择 · 已选 ${selected.length}/${sources.length}</span><span class="grow"></span>
            <span class="rangectl" data-act="range-all">全选</span><span class="rangectl" data-act="range-none">清空</span></div>
          <div class="rangeitems">${rangeItems || '<div class="empty" style="padding:12px 0">当前没有达到阈值的原始档</div>'}</div>
        </div>
        <div class="promptsec"><div class="seclab">预设提示词与架构 · 铅笔编辑</div><span class="grow"></span>
          ${promptSummary.customized ? `<span class="promptcontrols">${promptSummary.updates ? '<span class="promptnotice">内置提示词有新版</span>' : ""}<span class="promptreset" data-act="prompt-reset-all">全部使用内置最新版</span></span>` : '<span class="promptfollow">自动跟随内置最新版</span>'}</div>
        <div class="mods">
          <div class="mod" data-mod="pre">
            <div class="modhead" data-act="mod-toggle" data-mod="pre"><span class="mt">前置提示词</span>${moduleTags(pre)}<span class="grow"></span>${moduleActions(pre, "pre")}</div>
            ${preEdit}
          </div>
          <div class="mod ro">
            <div class="modhead" data-act="mod-toggle" data-mod="runtime"><span class="mt">运行时填入</span><span class="rotag">只读</span><span class="grow"></span><span class="pen">${expandMod === "runtime" ? "▴" : "▾"}</span></div>
            ${runEdit}
          </div>
          <div class="mod" data-mod="post">
            <div class="modhead" data-act="mod-toggle" data-mod="post"><span class="mt">后置提示词</span>${moduleTags(post)}<span class="grow"></span>${moduleActions(post, "post")}</div>
            ${postEdit}
          </div>
        </div>
      </div>`;
    }
    function renderSummarySetup() {
      const s = snap;
      const trigger = s?.summaryTrigger;
      const x = s?.latestLiveArchiveFloor ?? null;
      const q = s?.currentFloor ?? 0;
      const interrupted = (s?.interrupted.length ?? 0) > 0;
      const integrityBlocked = !!s?.integrity.needed;
      const canRun = session.phase === "idle" && !interrupted && !integrityBlocked;
      const entries = session.summaryOrchestrationEntries();
      const pre = entries.find((entry) => entry.id === "pre");
      const runtime = entries.find((entry) => entry.id === "runtime");
      const post = entries.find((entry) => entry.id === "post");
      const promptSummary = session.summaryPromptOverrideSummary();
      const archiveFloors = [...new Set((s?.table ?? []).filter((entry) => entry.generation === "live").map((entry) => entry.messageId))].sort((a, b) => a - b);
      const moduleTags = (id) => {
        const state = session.summaryOrchestrationState(id);
        if (!state.customized) return '<span class="prompttag">跟随内置</span>';
        return `<span class="prompttag custom">自定义</span>${state.builtinUpdateAvailable ? '<span class="prompttag update">内置有新版</span>' : ""}`;
      };
      const moduleActions = (entry, modKey) => {
        if (summaryExpandMod !== modKey) return '<span class="pen">✎</span>';
        const state = session.summaryOrchestrationState(entry.id);
        return `<span class="fullbtn" data-act="full-open" data-scope="summary" data-oid="${entry.id}" title="全屏编辑">⛶</span>
        ${state.customized ? `<span class="headact" data-act="summary-mod-reset" data-oid="${entry.id}">恢复内置最新版</span>` : ""}
        <span class="headact" data-act="summary-mod-cancel">取消</span>
        <span class="headact saveact" data-act="summary-mod-save" data-mod="${modKey}">保存</span>`;
      };
      const moduleEdit = (entry) => summaryExpandMod === entry.id ? `<div class="modedit"><textarea data-soid="${entry.id}">${esc(entry.content)}</textarea></div>` : "";
      const runtimeEdit = summaryExpandMod === "runtime" ? `<div class="modedit"><div class="runtime-summary">
          <div><b>Historical Context</b> 以下两类内容按顺序合并进同一个只读上下文</div>
          <div><b>World Archive</b> 全部完整在场档案${archiveFloors.length ? ` · 层 ${archiveFloors.join("、")}` : " · 无"}</div>
          <div><b>捕获 Flux</b> ${x === null ? `最早楼层至当前层 ${q}` : `层 ${x} 之后至当前层 ${q}`}的完整 Flux / Causal_Flux</div>
          <div><b>补充引导</b> 首次可空；失败重试与结果重跑均可手动填写</div>
        </div></div>` : "";
      const reminderText = trigger?.eligible ? `已达到 ${trigger.interval} 层提醒间隔；这只是提醒，仍可随时手动开始` : `距最近 Archive ${trigger?.distance ?? 0} 层 · 到层 ${trigger?.nextFloor ?? q} 时提醒；仍可现在手动开始`;
      return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">摘要 → 大总结</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        ${summaryInitialFailureHtml()}
        ${interrupted ? `<div class="warnbar">⚠ 有未完成 pending；${esc(interruptedProgressText())}；当前禁止开始摘要 → 大总结</div>` : ""}
        ${integrityBlocked && !interrupted ? '<div class="warnbar">⚠ 档案完整性缺口尚未复原；当前禁止开始摘要 → 大总结</div>' : ""}
        <button class="runbtn${canRun ? "" : " off"}" data-act="summary-run"${canRun ? "" : " disabled"}>开始生成大总结</button>
        <div class="setwrap">
          <div class="setrow"><span>每隔</span>
            <span class="num"><button data-act="summary-interval-dec"${(trigger?.interval ?? session.config.summaryInterval) <= MIN_SUMMARY_INTERVAL ? " disabled" : ""}>−</button><input data-el="summary-interval" type="number" min="${MIN_SUMMARY_INTERVAL}" step="10" value="${trigger?.interval ?? session.config.summaryInterval}" inputmode="numeric"><button data-act="summary-interval-inc">＋</button></span>
            <span>层提醒一次</span></div>
          <div class="subhint">${reminderText}</div>
          <div class="subhint">最近 Archive：${x === null ? "无（x = null）" : `层 ${x}（x = ${x}）`} · 当前聊天末层 ${q}</div>
        </div>
        <div class="promptsec"><div class="seclab">固定三段式提示词 · 铅笔编辑</div><span class="grow"></span>
          ${promptSummary.customized ? `<span class="promptcontrols">${promptSummary.updates ? '<span class="promptnotice">内置提示词有新版</span>' : ""}<span class="promptreset" data-act="summary-prompt-reset-all">全部使用内置最新版</span></span>` : '<span class="promptfollow">自动跟随内置最新版</span>'}
        </div>
        <div class="mods">
          <div class="mod" data-summary-mod="pre">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="pre"><span class="mt">${esc(pre.label)}</span>${moduleTags("pre")}<span class="grow"></span>${moduleActions(pre, "pre")}</div>
            ${moduleEdit(pre)}
          </div>
          <div class="mod ro">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="runtime"><span class="mt">${esc(runtime.label)}</span><span class="rotag">只读</span><span class="grow"></span><span class="pen">${summaryExpandMod === "runtime" ? "▴" : "▾"}</span></div>
            ${runtimeEdit}
          </div>
          <div class="mod" data-summary-mod="post">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="post"><span class="mt">${esc(post.label)}</span>${moduleTags("post")}<span class="grow"></span>${moduleActions(post, "post")}</div>
            ${moduleEdit(post)}
          </div>
        </div>
      </div>`;
    }
    function buildNodes() {
      const out = [];
      const entries = snap ? snap.table.filter((e) => e.generation === "live" || showRetired && e.generation === "old") : [];
      for (const e of entries) {
        parseArchiveBody(e.content).forEach((c, localIndex) => {
          out.push({
            floor: e.messageId,
            generation: e.generation,
            container: c,
            through: e.through,
            archiveRaw: e.raw,
            localIndex
          });
        });
      }
      return out.sort((a, b) => a.floor - b.floor);
    }
    function renderTimeline() {
      nodes = buildNodes();
      const floors = snap ? snap.table.filter((e) => e.generation === "live").map((e) => e.messageId) : [];
      const cover = floors.length ? `覆盖 ${Math.min(...floors)}–${Math.max(...floors)} 层` : "暂无在场档案";
      const lastFloor = snap?.currentFloor ?? 0;
      const spine = nodes.map((nd, i) => {
        const retired = nd.generation !== "live";
        const yr = nd.container.time || (nd.container.keywords ?? "—");
        return `<div class="ev${retired ? " retired" : ""}">
          <span class="edot${retired ? " hollow" : ""}"></span>
          <div class="card" data-act="detail" data-i="${i}"><div class="yr">${esc(yr)}${retired ? " · 退役" : ""}</div><div class="nm">${esc(nd.container.title || "（无题）")}</div></div>
        </div>`;
      }).join("");
      return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">时间轴</span><span class="grow"></span><span class="refresh">${lastFloor} 层</span>${dnToggle()}</div>
      <div class="body">
        <div class="metarow"><span class="meta">${nodes.length} 条 · ${cover}</span><span class="rettoggle" data-act="toggle-retired">${showRetired ? "隐藏退役档" : "显示退役档"}</span></div>
        ${nodes.length ? `<div class="spine">${spine}</div><div class="scrollpad"></div>` : '<div class="empty">当前聊天暂无档案</div>'}
      </div>`;
    }
    function excRow(text) {
      return `<div class="se-exc"><span class="star">·</span><span class="f line" contenteditable="true">${esc(text)}</span><span class="del" data-act="exc-del">×</span></div>`;
    }
    function structuredEditor(c, idx) {
      const isSeg = c.kind === "segment";
      const [o, cl] = isSeg ? ["[", "]"] : ["《", "》"];
      const kw = isSeg && c.keywords != null ? `<span class="tok">|</span><span class="f" contenteditable="true" data-f="keywords">${esc(c.keywords)}</span>` : "";
      const loose = (c.looseExcerpts ?? []).map((ex) => excRow(ex.text)).join("");
      const frags = c.fragments.map(
        (f) => `
        <div class="se-frag">
          <div class="se-ftitle"><span class="tok">[</span><span class="f" contenteditable="true" data-ff="title">${esc(f.title)}</span><span class="tok">|</span><span class="f time" contenteditable="true" data-ff="time">${esc(f.time ?? "")}</span><span class="tok">]</span></div>
          <div class="fblock" contenteditable="true" data-ff="summary">${esc(f.summary)}</div>
          <div class="se-excs">${f.excerpts.map((ex) => excRow(ex.text)).join("")}</div>
          <div class="excadd" data-act="exc-add">＋ 加一条摘录</div>
        </div>`
      ).join("");
      return `<div class="se-root" data-idx="${idx}">
      <div class="selegend"><span class="lk">灰色</span> 是被抓取的结构（锁定）· <span class="ed">有底框</span> 的才可改 · 摘录逐条改/删</div>
      <div class="se-ctitle"><span class="tok">${o}</span><span class="f" contenteditable="true" data-f="title">${esc(c.title)}</span>${kw}<span class="tok">|</span><span class="f time" contenteditable="true" data-f="time">${esc(c.time ?? "")}</span><span class="tok">${cl}</span></div>
      <div class="fblock" contenteditable="true" data-f="summary">${esc(c.summary)}</div>
      <div class="se-loose">${loose}${isSeg ? '<div class="excadd" data-act="exc-add-loose">＋ 加一条摘录</div>' : ""}</div>
      ${frags}
      <div class="editbar2"><span class="cancel" data-act="cedit-cancel">取消</span><span class="savem" data-act="cedit-save">保存</span></div>
    </div>`;
    }
    function readContainer(nd, idx) {
      const c = nd.container;
      const isSeg = c.kind === "segment";
      const editable = nd.generation === "live";
      const frags = c.fragments.map((f) => {
        const exc = f.excerpts.map((ex) => `<div class="dexc"><span class="d">·</span> ${esc(ex.text)}</div>`).join("");
        return `<div class="dftitle">[${label(f.title, f.time)}]</div>${f.summary ? `<div class="dsmall">${esc(f.summary)}</div>` : ""}${exc}`;
      }).join("");
      const loose = (c.looseExcerpts ?? []).map((ex) => `<div class="dexc"><span class="d">·</span> ${esc(ex.text)}</div>`).join("");
      return `<div class="rcont${editable ? " editable" : ""}" data-cidx="${idx}" data-cname="${esc(c.title || "（无题）")}" data-ctime="${esc(c.time || "")}"${editable ? ` data-act="edit-container" data-i="${idx}" title="点这个大容器 · 结构化编辑"` : ""}>
        <div class="chead"><div class="cline">${c.time ? `<span class="cyr">${esc(c.time)}</span>` : ""}<span class="cname">${isSeg ? "[" : "《"}${esc(c.title || "（无题）")}${isSeg ? "]" : "》"}</span></div></div>
        <div class="crange">来源 层 ${nd.floor}${nd.generation !== "live" ? " · 退役 old_" : ""}${isSeg ? " · 旧扁平段" : ""}${c.keywords ? " · " + esc(c.keywords) : ""}</div>
        <div class="prose">${c.summary ? paras(c.summary) : '<p style="color:var(--faint)">（无大总结）</p>'}</div>
        ${frags}${loose}
      </div>`;
    }
    function renderDetail() {
      nodes = buildNodes();
      if (detailStart == null || detailStart >= nodes.length) detailStart = 0;
      const first = nodes[detailStart];
      if (!first) return renderTimeline();
      const cur = detailCurIdx != null && nodes[detailCurIdx] ? nodes[detailCurIdx] : first;
      const c0 = cur.container;
      const head = `<div class="top"><span class="back" data-act="back-timeline" title="返回时间轴（回到当前容器位置）">‹</span><span class="now">${esc(c0.title || "（无题）")}${c0.time ? ` <small>${esc(c0.time)}</small>` : ""}</span>${cur.generation === "live" && editingIdx == null ? '<span class="badge">可编辑</span>' : ""}<span class="grow"></span>${dnToggle()}</div>`;
      const body = nodes.map((nd, idx) => {
        const sep = idx > 0 ? '<div class="sep"><span class="d">◇</span></div>' : "";
        const card = editingIdx === idx ? `<div class="editing-card" data-cidx="${idx}" data-cname="${esc(nd.container.title || "（无题）")}" data-ctime="${esc(nd.container.time || "")}">${structuredEditor(nd.container, idx)}</div>` : readContainer(nd, idx);
        return sep + card;
      }).join("");
      return `${head}
      <div class="read">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        ${body}
        <div class="readnote">${editingIdx == null ? "点任一大容器 · 结构化编辑 · 上下滑可翻到别的容器" : "结构锁定 · 只改有底框的字段"}</div>
        <div class="scrollpad"></div>
      </div>`;
    }
    function renderResult() {
      const c = cand;
      const v = c.validation;
      const hard3 = v.issues.filter((i) => i.severity === "hard");
      const soft3 = v.issues.filter((i) => i.severity === "soft");
      const state = !v.ok ? "hard" : soft3.length ? "soft" : "ok";
      const repairPreview = !candEditing ? session.repairCandidate(c) : { candidate: c, fixes: [] };
      const repairable = repairPreview.fixes.length > 0;
      const ratio = c.sourceChars > 0 ? (c.sourceChars / Math.max(1, c.body.length)).toFixed(1) : "—";
      const verify = state === "ok" ? `<div class="verify ok"><span class="mk">✓</span><span class="vt">结构通过 · 容器与片段闭合完整</span><span class="vs">${c.containers.length} 容器</span></div>` : state === "soft" ? `<div class="verify soft"><span class="mk">!</span><span class="vt">结构无硬错 · 有 ${soft3.length} 处可斟酌</span><span class="vs">软疑不拦 · 可直接保存</span></div>` : `<div class="verify hard"><span class="mk">✕</span><span class="vt">结构有硬错 · 无法保存</span><span class="vs">${hard3.length} 处 · 须改或重生成</span></div>`;
      const issueList = state === "ok" ? "" : `<div class="issues">${(state === "hard" ? hard3 : soft3).map(
        (i) => `<div class="iss ${i.severity}"><span class="ic">${i.severity === "hard" ? "✕" : "!"}</span><div class="itxt"><div class="loc">${esc(
          issueLoc(i)
        )}</div><div class="desc">${esc(i.message)}</div><div class="sug">建议：${esc(issueSug(i))}</div></div></div>`
      ).join("")}</div>`;
      let docHtml;
      if (candEditing) {
        docHtml = `<textarea class="editdoc" data-el="editdoc">${esc(c.body)}</textarea>
        <div class="ebar" style="margin-top:10px"><span class="cancel" data-act="edit-cancel">取消</span><span class="savem" data-act="edit-save">应用改动</span></div>`;
      } else if (mode === "debug") {
        docHtml = `<pre class="raw">${esc(c.raw)}</pre>`;
      } else {
        docHtml = `<div class="doc" data-act="edit-doc" title="点档案任意处 · 直接编辑">${renderDoc(c.containers)}</div>`;
      }
      const savenote = state === "hard" ? `<span class="savenote hard">改好 ${hard3.length} 处硬错才能保存</span>` : state === "soft" ? `<span class="savenote soft">${soft3.length} 处可斟酌，仍可保存</span>` : "";
      return `<div class="result-page">
      <div class="result-fixed">
        <div class="top"><div class="result-title"><div class="htitle">归档结果</div>
          <div class="hmeta">总结到层 ${c.through}　·　压缩 ${c.sourceChars} <span class="ar">→</span> ~${c.body.length} 字　·　约 ${ratio} : 1</div></div>
          <span class="grow"></span>${dnToggle()}<span class="discard" data-act="discard">放弃</span></div>
        <div class="result-status">
          ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
          ${generationFailureHtml("reroll")}
          ${verify}
          ${repairable ? '<div class="repairrow"><button class="repairbtn" data-act="repair">一键补正可确定的结构</button></div>' : ""}
        </div>
      </div>
      <div class="result-scroll">
        ${issueList}
        <div class="cand-head"><div class="seg">
          <button data-act="mode-archive" class="${mode === "archive" && !candEditing ? "on" : ""}">档案模式</button>
          <button data-act="mode-debug" class="${mode === "debug" ? "on" : ""}">调试模式</button></div>
          ${candEditing ? "" : '<span class="edit-cue">点档案任意处 · 直接编辑</span>'}</div>
        ${docHtml}
        <div class="guide"><div class="glab">重新生成的引导 · <b>会从头整段重跑</b> · 可留空</div>
          <input data-el="guide" placeholder="例如：哪些情节、哪些剧情需要专门保留？" value="${esc(c.guidance)}"></div>
      </div>
      <div class="result-footer"><div class="acts"><button class="ghost" data-act="reroll">重新生成</button>
        ${savenote}
        <button class="save${state === "hard" || candEditing ? " off" : ""}" data-act="save"${state === "hard" || candEditing ? " disabled" : ""}>保存</button></div></div>
    </div>`;
    }
    function renderSummaryResult() {
      const c = summaryCand;
      const v = c.validation;
      const hard3 = v.issues.filter((issue) => issue.severity === "hard");
      const soft3 = v.issues.filter((issue) => issue.severity === "soft");
      const state = !v.ok ? "hard" : soft3.length ? "soft" : "ok";
      const ratio = c.sourceChars > 0 ? (c.sourceChars / Math.max(1, c.body.length)).toFixed(1) : "—";
      const verify = state === "ok" ? `<div class="verify ok"><span class="mk">✓</span><span class="vt">普通 Archive 结构通过</span><span class="vs">${v.segments.length} 个事件段</span></div>` : state === "soft" ? `<div class="verify soft"><span class="mk">!</span><span class="vt">结构无硬错 · 有 ${soft3.length} 处可斟酌</span><span class="vs">软疑不拦 · 可直接应用</span></div>` : `<div class="verify hard"><span class="mk">✕</span><span class="vt">结构有硬错 · 无法应用</span><span class="vs">${hard3.length} 处 · 须改或重新生成</span></div>`;
      const issueList = state === "ok" ? "" : `<div class="issues">${(state === "hard" ? hard3 : soft3).map(
        (issue) => `<div class="iss ${issue.severity}"><span class="ic">${issue.severity === "hard" ? "✕" : "!"}</span><div class="itxt"><div class="loc">${esc(issueLoc(issue))}</div><div class="desc">${esc(issue.message)}</div><div class="sug">建议：${esc(issueSug(issue))}</div></div></div>`
      ).join("")}</div>`;
      let docHtml;
      if (summaryCandEditing) {
        docHtml = `<textarea class="editdoc" data-el="summary-editdoc">${esc(c.body)}</textarea>
        <div class="ebar" style="margin-top:10px"><span class="cancel" data-act="summary-edit-cancel">取消</span><span class="savem" data-act="summary-edit-save">应用改动</span></div>`;
      } else if (summaryMode === "debug") {
        docHtml = `<pre class="raw">${esc(c.raw)}</pre>`;
      } else {
        docHtml = `<div class="doc" data-act="summary-edit-doc" title="点档案任意处 · 直接编辑">${renderDoc(c.containers)}</div>`;
      }
      const applyNote = state === "hard" ? `<span class="savenote hard">改好 ${hard3.length} 处硬错才能应用</span>` : state === "soft" ? `<span class="savenote soft">${soft3.length} 处可斟酌，仍可应用</span>` : "";
      const archiveFloors = c.round.archiveFloors.length ? c.round.archiveFloors.join("、") : "无";
      const fluxFloors = c.round.fluxFloors.length ? c.round.fluxFloors.join("、") : "无";
      return `<div class="result-page">
      <div class="result-fixed">
        <div class="top"><div class="result-title"><div class="htitle">摘要 → 大总结结果</div>
          <div class="hmeta">来源至层 ${c.sourceThrough}　·　压缩 ${c.sourceChars} <span class="ar">→</span> ~${c.body.length} 字　·　约 ${ratio} : 1</div></div>
          <span class="grow"></span>${dnToggle()}<span class="discard" data-act="summary-discard">放弃</span></div>
        <div class="result-status">
          ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
          ${summaryRerollFailureHtml()}
          ${verify}
        </div>
      </div>
      <div class="result-scroll">
        ${issueList}
        <div class="runtime-summary" style="margin-bottom:12px">
          <div><b>Archive Context</b> 全部在场档案 · 层 ${esc(archiveFloors)}</div>
          <div><b>Target Flux</b> 本轮冻结来源 · 层 ${esc(fluxFloors)}</div>
        </div>
        <div class="cand-head"><div class="seg">
          <button data-act="summary-mode-archive" class="${summaryMode === "archive" && !summaryCandEditing ? "on" : ""}">档案模式</button>
          <button data-act="summary-mode-debug" class="${summaryMode === "debug" ? "on" : ""}">调试模式</button></div>
          ${summaryCandEditing ? "" : '<span class="edit-cue">点档案任意处 · 直接编辑</span>'}</div>
        ${docHtml}
        <div class="guide"><div class="glab">重新生成的引导 · <b>同一批来源从头重跑</b> · 可留空</div>
          <input data-el="summary-guide" placeholder="例如：优先保留哪段因果、动作或对白？" value="${esc(c.guidance)}"></div>
      </div>
      <div class="result-footer"><div class="acts"><button class="ghost" data-act="summary-reroll">重新生成</button>
        ${applyNote}
        <button class="save${state === "hard" || summaryCandEditing ? " off" : ""}" data-act="summary-apply"${state === "hard" || summaryCandEditing ? " disabled" : ""}>应用</button></div></div>
    </div>`;
    }
    function renderApi() {
      const profiles = session.connectionProfiles();
      const cur = session.config.connectionProfileId;
      const missing = cur && !profiles.some((profile) => profile.id === cur);
      const opts = [`<option value="">跟随当前酒馆连接</option>`].concat(
        missing ? [`<option value="${esc(cur)}" selected disabled>原连接配置已不存在</option>`] : [],
        profiles.map((profile) => {
          const meta = [profile.api, profile.model].filter(Boolean).join(" · ");
          return `<option value="${esc(profile.id)}"${profile.id === cur ? " selected" : ""}>${esc(profile.name)}${meta ? ` · ${esc(meta)}` : ""}</option>`;
        })
      ).join("");
      const availability = profiles.length ? "只保存连接配置 ID；地址、密钥与代理密码均由酒馆内部读取。" : "未读到可用的 Connection Profile；可继续跟随当前酒馆连接。";
      return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">API 配置</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        <div class="fnname">大总结时间轴化</div>
        <div class="flabel">API 连接（取自酒馆 Connection Profiles）</div>
        <div class="sel"><select data-el="connection-profile">${opts}</select><span class="chev">▾</span></div>
        <div class="modelhint">${esc(availability)}<br>${esc(session.config.modelHint)}</div>
        <div class="saverow"><button class="save" data-act="api-save">保存</button></div>
      </div>`;
    }
    function renderIntegrity() {
      const ig = snap?.integrity;
      const items = (ig?.toRestore ?? []).map((e) => {
        const title = parseArchiveBody(e.content).map((c) => c.title).filter(Boolean)[0] ?? "（无题）";
        return `<div class="item"><div class="itx"><div class="nm">${esc(title)}</div><div class="src">来源 层 ${e.messageId}</div></div><span class="old">退役 old_</span></div>`;
      }).join("");
      const p = snap?.previousFloor;
      const q = snap?.currentFloor ?? 0;
      const reason = snap?.floorsDecreased ? `聊天末层由上次记录的 ${p ?? "未知"} 减少至当前 ${q}` : `聊天仍为 ${q} 层；检测到生效归档或覆盖标记缺失`;
      return `
      <div class="top" style="align-items:flex-start"><span class="imk">!</span>
        <div><div class="htitle">档案完整性</div>
        <div class="hsub">${reason}</div></div>
        <span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        <div class="seclab">覆盖链缺口 · 建议复原层 ${ig?.lastMarkerFloor ?? -1} 之后</div>
        <div class="list">${items || '<div class="empty">没有需要复原的退役档</div>'}</div>
        <button class="gobtn" data-act="integrity-run">复原全部 ${ig?.toRestore.length ?? 0} 条</button>
      </div>`;
    }
    function renderCommitLog() {
      const log = snap?.commitLog ?? null;
      const interrupted = !!snap?.interrupted.length;
      if (!log) {
        return `
        <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">提交事务日志</span><span class="grow"></span>${dnToggle()}</div>
        <div class="body">
          ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
          <div class="empty">还没有任何提交记录。完成一次「大总结时间轴化」后，这里会显示最近一笔提交的分步进度。</div>
        </div>`;
      }
      const fmt = (floors) => floors.length ? floors.join("、") : "无";
      const badge = (done, ok, wait) => done ? `<span class="okmk">✓ ${ok}</span>` : `<span class="womk">… ${wait}</span>`;
      const isDone = log.status === "completed";
      const allOld = log.plannedOldFloors.every((f) => log.oldSucceededFloors.includes(f));
      const rows = [
        `<div class="item"><div class="itx"><div class="nm">pending 写入目标层 ${log.targetFloor}</div><div class="src">覆盖端点 archived: ${log.through}</div></div>${badge(log.pendingWritten, "已写", "未写")}</div>`,
        `<div class="item"><div class="itx"><div class="nm">原始档退役 → old_</div><div class="src">已 old：${esc(fmt(log.oldSucceededFloors))} ／ 计划 ${esc(fmt(log.plannedOldFloors))}</div></div>${badge(allOld, "全退役", "未完")}</div>`,
        log.supersede ? `<div class="item"><div class="itx"><div class="nm">既存末容器接管（层 ${log.supersede.plannedFloor}）</div><div class="src">同名续写时冷存既存末尾容器</div></div>${badge(log.supersede.done, "已接管", "未接管")}</div>` : `<div class="item"><div class="itx"><div class="nm">既存末容器接管</div><div class="src">本次无同名增量覆写</div></div><span class="womk">— 无</span></div>`,
        `<div class="item"><div class="itx"><div class="nm">pending 转正 → live</div><div class="src">${log.promotedFloor == null ? "尚未转正" : `层 ${log.promotedFloor} 已转正`}</div></div>${badge(log.promotedFloor === log.targetFloor, "已转正", "未转正")}</div>`
      ].join("");
      const doneNote = isDone ? `<div class="warnbar okbar" style="cursor:default">✓ 最近一笔提交已完成 · 目标层 ${log.targetFloor}</div>` : "";
      const errBar = log.error && !isDone ? `<div class="warnbar" style="cursor:default">最近错误：${esc(log.error)}</div>` : "";
      const canResume = interrupted || !isDone && log.pendingWritten && log.promotedFloor !== log.targetFloor;
      const resumeBtn = canResume ? `<button class="gobtn" data-act="commitlog-resume">一键继续未完成提交</button>` : "";
      return `
      <div class="top" style="align-items:flex-start">
        <span class="back" data-act="home">‹</span>
        <div><div class="htitle">提交事务日志</div>
        <div class="hsub" style="color:var(--mut)">${esc(COMMIT_STATUS_LABEL[log.status] ?? log.status)} · 事务 ${esc(log.txId)}</div></div>
        <span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes("✓") ? " okbar" : ""}">${esc(flash)}</div>` : ""}
        ${doneNote}
        ${errBar}
        <div class="seclab">两段提交 · 分步进度</div>
        <div class="list">${rows}</div>
        ${resumeBtn}
      </div>`;
    }
    function renderFullEdit() {
      const fe = fullEdit;
      const state = fe.scope === "summary" ? session.summaryOrchestrationState(fe.id) : session.orchestrationState(fe.id);
      const status = state.customized ? `<span class="prompttag custom">自定义</span>${state.builtinUpdateAvailable ? '<span class="prompttag update">内置有新版</span>' : ""}` : '<span class="prompttag">跟随内置</span>';
      return `
      <div class="top"><span class="back" data-act="full-cancel" title="退出全屏">‹</span><span class="htitle">${esc(fe.label)}</span>${status}<span class="grow"></span>${state.customized ? '<span class="headact" data-act="full-reset">恢复内置最新版</span>' : ""}${dnToggle()}<span class="savem" data-act="full-save">保存</span></div>
      <div class="fullwrap"><textarea class="fulltext" data-el="fulltext" spellcheck="false">${esc(fe.value)}</textarea></div>`;
    }
    function render() {
      if (snap?.interrupted.length && view === "integrity") view = "hub";
      if (snap?.integrity.needed && !snap.interrupted.length) {
        if (cand) {
          session.discard();
          cand = null;
        }
        if (summaryCand || failedSummaryGeneration) {
          session.discardSummary();
          summaryCand = null;
          failedSummaryGeneration = null;
        }
        view = "integrity";
        fullEdit = null;
        expandMod = null;
        summaryExpandMod = null;
        editingIdx = null;
        candEditing = false;
        summaryCandEditing = false;
        reopenEditor = false;
        summaryReopenEditor = false;
      }
      if (view === "result" && !cand) view = "hub";
      if (view === "summary-result" && !summaryCand) view = "summary-setup";
      if (view === "detail" && detailStart == null) view = "timeline";
      const surface = fullEdit ? "full-edit" : view;
      const surfaceChanged = surface !== renderedSurface;
      if (fullEdit) {
        panelEl.classList.add("full");
        panelEl.classList.remove("result");
        viewEl().innerHTML = renderFullEdit();
        if (surfaceChanged) panelEl.scrollTop = 0;
        renderedSurface = surface;
        layoutPanel();
        return;
      }
      panelEl.classList.remove("full");
      panelEl.classList.toggle("result", view === "result" && !!cand || view === "summary-result" && !!summaryCand);
      const map = {
        hub: renderHub,
        setup: renderSetup,
        "summary-setup": renderSummarySetup,
        timeline: renderTimeline,
        detail: renderDetail,
        result: renderResult,
        "summary-result": renderSummaryResult,
        api: renderApi,
        integrity: renderIntegrity,
        commitlog: renderCommitLog
      };
      viewEl().innerHTML = (map[view] ?? renderHub)();
      if (surfaceChanged) panelEl.scrollTop = 0;
      renderedSurface = surface;
      layoutPanel();
    }
    function showLoading(txt) {
      viewEl().innerHTML = `<div class="loading"><div>${esc(txt)}</div><button type="button" class="ghost" data-act="cancel-generation">取消生成</button></div>`;
    }
    async function runGenerationAttempt(attempt) {
      const frozen = {
        ...attempt,
        selection: attempt.selection ? [...attempt.selection] : void 0
      };
      const epoch = ++generationUiEpoch;
      activeGenerationAttempt = frozen;
      failedGeneration = null;
      flash = "";
      candEditing = false;
      reopenEditor = false;
      showLoading(frozen.kind === "initial" ? "生成中…（单次独立调用）" : "重新生成中…（从头整段重跑）");
      try {
        const next = frozen.kind === "initial" ? await session.generate(snap.table, frozen.guidance, frozen.selection) : await session.regenerate(snap.table, frozen.guidance, frozen.selection);
        if (epoch !== generationUiEpoch) return;
        activeGenerationAttempt = null;
        failedGeneration = null;
        cand = next;
        mode = "archive";
        view = "result";
        render();
      } catch (error) {
        if (epoch !== generationUiEpoch) return;
        activeGenerationAttempt = null;
        if (error instanceof GenerationCancelledError) return;
        failedGeneration = { attempt: frozen, message: `生成失败：${error.message}` };
        if (frozen.kind === "initial") {
          view = "setup";
        } else if (cand) {
          cand = { ...cand, guidance: frozen.guidance };
          view = "result";
        }
        doRefresh();
        render();
      }
    }
    async function runSummaryGenerationAttempt(attempt) {
      const frozen = { ...attempt };
      const previousCandidate = summaryCand;
      const epoch = ++generationUiEpoch;
      activeSummaryGenerationAttempt = frozen;
      failedSummaryGeneration = null;
      flash = "";
      summaryCandEditing = false;
      summaryReopenEditor = false;
      showLoading(
        frozen.kind === "initial" ? "摘要 → 大总结生成中…（冻结本轮来源）" : frozen.kind === "retry" ? "重试中…（复用同一批来源）" : "重新生成中…（同一批来源从头重跑）"
      );
      try {
        const next = frozen.kind === "initial" ? await session.generateSummary(frozen.guidance) : frozen.kind === "retry" ? await session.retrySummary(frozen.guidance) : await session.regenerateSummary(previousCandidate, frozen.guidance);
        if (epoch !== generationUiEpoch) return;
        activeSummaryGenerationAttempt = null;
        failedSummaryGeneration = null;
        summaryCand = next;
        summaryMode = "archive";
        view = "summary-result";
        render();
      } catch (error) {
        if (epoch !== generationUiEpoch) return;
        activeSummaryGenerationAttempt = null;
        if (error instanceof GenerationCancelledError) return;
        failedSummaryGeneration = { attempt: frozen, message: `生成失败：${error.message}` };
        if (frozen.kind === "reroll" && previousCandidate && session.phase === "preview") {
          summaryCand = { ...previousCandidate, guidance: frozen.guidance };
          view = "summary-result";
        } else {
          summaryCand = null;
          view = "summary-setup";
        }
        doRefresh();
        render();
      }
    }
    function cancelGeneration() {
      const summaryAttempt = activeSummaryGenerationAttempt;
      if (summaryAttempt) {
        generationUiEpoch += 1;
        activeSummaryGenerationAttempt = null;
        session.cancel();
        if (summaryAttempt.kind === "reroll") {
          view = "summary-result";
          flash = "已取消重新生成，原候选仍保留";
        } else {
          failedSummaryGeneration = { attempt: summaryAttempt, message: "已取消生成" };
          view = "summary-setup";
          flash = "";
        }
        doRefresh();
        render();
        return;
      }
      const attempt = activeGenerationAttempt;
      if (!attempt) return;
      generationUiEpoch += 1;
      activeGenerationAttempt = null;
      failedGeneration = null;
      session.cancel();
      view = attempt.kind === "initial" ? "setup" : "result";
      flash = attempt.kind === "initial" ? "已取消生成" : "已取消重新生成，原候选仍保留";
      doRefresh();
      render();
    }
    function retryGeneration() {
      const failed = failedGeneration;
      if (!failed) return;
      void runGenerationAttempt(failed.attempt);
    }
    async function startArchive() {
      doRefresh();
      if (snap.interrupted.length || snap.integrity.needed) {
        render();
        return;
      }
      const selection = selectedRangeFloors();
      if (selection.length === 0) {
        flash = "请至少勾选一份原始档";
        view = "setup";
        render();
        return;
      }
      view = "result";
      cand = null;
      await runGenerationAttempt({ kind: "initial", guidance: "", selection });
    }
    async function startSummary() {
      doRefresh();
      if (snap.interrupted.length || snap.integrity.needed || session.phase !== "idle") {
        render();
        return;
      }
      summaryCand = null;
      view = "summary-result";
      await runSummaryGenerationAttempt({ kind: "initial", guidance: "" });
    }
    function retrySummaryGeneration() {
      if (!failedSummaryGeneration || !session.summaryRetryAvailable()) return;
      const guidance = shadow.querySelector("[data-el=summary-retry-guide]")?.value ?? "";
      void runSummaryGenerationAttempt({ kind: "retry", guidance });
    }
    async function reroll() {
      const g = shadow.querySelector("[data-el=guide]")?.value ?? "";
      const selection = cand?.selection ? [...cand.selection] : void 0;
      await runGenerationAttempt({ kind: "reroll", guidance: g, selection });
    }
    async function rerollSummary() {
      if (!summaryCand) return;
      const guidance = shadow.querySelector("[data-el=summary-guide]")?.value ?? "";
      await runSummaryGenerationAttempt({ kind: "reroll", guidance });
    }
    function applyEdit() {
      const ta = shadow.querySelector("[data-el=editdoc]");
      if (!cand || !ta) return;
      cand = session.editCandidate(cand, ta.value);
      candEditing = false;
      render();
    }
    function applySummaryEdit() {
      const ta = shadow.querySelector("[data-el=summary-editdoc]");
      if (!summaryCand || !ta) return;
      summaryCand = session.editSummaryCandidate(summaryCand, ta.value);
      summaryCandEditing = false;
      render();
    }
    function collectStructured(root2, kind) {
      const inline = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const block = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      return {
        kind,
        title: inline(root2.querySelector("[data-f=title]")),
        time: inline(root2.querySelector("[data-f=time]")) || null,
        keywords: kind === "segment" ? inline(root2.querySelector("[data-f=keywords]")) || null : null,
        summary: block(root2.querySelector("[data-f=summary]")),
        fragments: [...root2.querySelectorAll(".se-frag")].map((fr) => ({
          title: inline(fr.querySelector("[data-ff=title]")),
          time: inline(fr.querySelector("[data-ff=time]")) || null,
          summary: block(fr.querySelector("[data-ff=summary]")),
          excerpts: [...fr.querySelectorAll(".se-excs .f.line")].map((el) => ({ text: inline(el) })).filter((x) => x.text)
        })),
        looseExcerpts: [...root2.querySelector(".se-loose")?.querySelectorAll(".f.line") ?? []].map((el) => ({ text: inline(el) })).filter((x) => x.text)
      };
    }
    async function saveContainerEdit() {
      if (editingIdx == null) return;
      const node = nodes[editingIdx];
      const root2 = shadow.querySelector(".se-root");
      if (!node || !root2) return;
      const container = collectStructured(root2, node.container.kind);
      const text = serializeContainers([container]);
      const floor = node.floor;
      const archiveRaw = node.archiveRaw;
      const li = node.localIndex;
      try {
        await session.editLiveContainer(floor, archiveRaw, li, text);
        doRefresh();
        nodes = buildNodes();
        editingIdx = null;
        flash = "已保存 ✓";
        render();
      } catch (e) {
        flash = "保存失败：" + e.message;
        render();
      }
    }
    function goTimelineAt(idx) {
      view = "timeline";
      editingIdx = null;
      flash = "";
      render();
      shadow.querySelector(`.ev .card[data-i="${idx}"]`)?.scrollIntoView({ block: "start" });
    }
    function scrollDetailTo(idx) {
      shadow.querySelector(`.read [data-cidx="${idx}"]`)?.scrollIntoView({ block: "start" });
    }
    async function save() {
      if (!cand || !snap) return;
      if (candEditing) {
        flash = "请先应用或取消正在编辑的内容";
        render();
        return;
      }
      if (!cand.validation.ok) {
        flash = "有硬错，先改或重生成";
        render();
        return;
      }
      showLoading("两段提交中…");
      try {
        const promotedFloor = cand.through;
        await session.commit(cand, snap.table);
        cand = null;
        view = "hub";
        flash = `已归档 ✓ · 层 ${promotedFloor} pending 已转为正式 archive`;
        doRefresh();
        render();
      } catch (e) {
        flash = "提交失败：" + e.message;
        doRefresh();
        render();
      }
    }
    async function applySummaryCandidate() {
      if (!summaryCand) return;
      if (summaryCandEditing) {
        flash = "请先应用或取消正在编辑的内容";
        render();
        return;
      }
      if (!summaryCand.validation.ok) {
        flash = "有硬错，先改或重新生成";
        render();
        return;
      }
      showLoading("应用摘要 → 大总结中…");
      try {
        const floor = await session.applySummary(summaryCand);
        summaryCand = null;
        failedSummaryGeneration = null;
        view = "hub";
        flash = `摘要 → 大总结已应用 ✓ · 层 ${floor}`;
        doRefresh();
        render();
      } catch (error) {
        flash = `应用失败：${error.message}`;
        if (session.phase === "idle") {
          summaryCand = null;
          failedSummaryGeneration = null;
          view = "summary-setup";
        }
        doRefresh();
        render();
      }
    }
    function discardSummaryFlow() {
      generationUiEpoch += 1;
      activeSummaryGenerationAttempt = null;
      failedSummaryGeneration = null;
      session.discardSummary();
      summaryCand = null;
      summaryCandEditing = false;
      summaryReopenEditor = false;
      view = "hub";
      flash = "";
      doRefresh();
      render();
    }
    async function integrityRun() {
      if (!snap?.integrity.needed) return;
      showLoading("复原退役档中…");
      try {
        await session.integrityRestore(snap.integrity.toRestore);
        session.discard();
        cand = null;
        candEditing = false;
        view = "hub";
        flash = "已复原 ✓";
        doRefresh();
        render();
      } catch (e) {
        flash = "复原失败：" + e.message;
        doRefresh();
        render();
      }
    }
    async function commitLogResume() {
      viewEl().innerHTML = `<div class="loading"><div>继续未完成的提交…</div></div>`;
      try {
        const r = await session.resumeCommit();
        cand = null;
        candEditing = false;
        view = "hub";
        flash = r.resumed ? r.steps > 0 ? "已继续并完成提交 ✓" : "已据现场收尾并完成 ✓" : "无待完成的提交，已清理记录 ✓";
        doRefresh();
        render();
      } catch (e) {
        flash = "继续提交失败：" + e.message;
        doRefresh();
        render();
      }
    }
    function setNFromInput() {
      const el = shadow.querySelector("[data-el=nval]");
      if (!el) return;
      const v = parseInt(el.value, 10);
      if (Number.isFinite(v)) session.setN(v);
    }
    function setSummaryIntervalFromInput() {
      const el = shadow.querySelector("[data-el=summary-interval]");
      if (!el) return;
      const value = parseInt(el.value, 10);
      if (Number.isFinite(value)) session.setSummaryInterval(value);
    }
    function saveMod(which) {
      shadow.querySelectorAll(`.mod[data-mod="${which}"] textarea[data-oid]`).forEach((el) => {
        const ta = el;
        session.setOrchestrationOverride(ta.dataset.oid, ta.value);
      });
      expandMod = null;
      flash = `${which === "pre" ? "前置" : "后置"}提示词已保存 ✓`;
      render();
      setTimeout(() => {
        if (flash.includes("提示词已保存")) {
          flash = "";
          if (view === "setup") render();
        }
      }, 1600);
    }
    function saveSummaryMod(which) {
      shadow.querySelectorAll(`[data-summary-mod="${which}"] textarea[data-soid]`).forEach((element) => {
        const textarea = element;
        session.setSummaryOrchestrationOverride(textarea.dataset.soid, textarea.value);
      });
      summaryExpandMod = null;
      flash = `${which === "pre" ? "前置定义" : "后置思考与输出"}已保存 ✓`;
      render();
      setTimeout(() => {
        if (flash.includes("已保存")) {
          flash = "";
          if (view === "summary-setup") render();
        }
      }, 1600);
    }
    for (const sealedType of [
      "pointerdown",
      "pointerup",
      "pointermove",
      "pointercancel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "mousedown",
      "mouseup",
      "mousemove",
      "click",
      "dblclick",
      "contextmenu",
      "wheel",
      "keydown",
      "keyup",
      "keypress"
    ]) {
      root.addEventListener(sealedType, (e) => e.stopPropagation());
    }
    const sealCaptureFromPanel = (e) => {
      if (e.composedPath().includes(root)) e.stopPropagation();
    };
    for (const capType of ["keydown", "keyup", "keypress", "contextmenu"]) {
      panelWindow.addEventListener(capType, sealCaptureFromPanel, true);
    }
    const dragBlocker = 'button,[data-act],.daynight,.dn,input,textarea,select,a,[contenteditable="true"]';
    shadow.addEventListener("pointerdown", (rawEvent) => {
      const ev = rawEvent;
      const target = ev.target;
      const handle = target?.closest?.(".head,.top");
      if (!handle || target?.closest?.(dragBlocker)) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      layoutPanel();
      drag = {
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startOffsetX: panelOffset.x,
        startOffsetY: panelOffset.y,
        handle
      };
      panelEl.classList.add("dragging");
      try {
        handle.setPointerCapture?.(ev.pointerId);
      } catch {
      }
      ev.preventDefault();
    });
    shadow.addEventListener("pointermove", (rawEvent) => {
      const ev = rawEvent;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      panelOffset = {
        x: drag.startOffsetX + ev.clientX - drag.startClientX,
        y: drag.startOffsetY + ev.clientY - drag.startClientY
      };
      panelMoved = true;
      layoutPanel();
      ev.preventDefault();
    });
    function finishDrag(rawEvent) {
      const ev = rawEvent;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const handle = drag.handle;
      drag = null;
      panelEl.classList.remove("dragging");
      try {
        if (handle.hasPointerCapture?.(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      } catch {
      }
    }
    shadow.addEventListener("pointerup", finishDrag);
    shadow.addEventListener("pointercancel", finishDrag);
    shadow.addEventListener("lostpointercapture", finishDrag);
    panelWindow.addEventListener("pointerup", finishDrag);
    panelWindow.addEventListener("pointercancel", finishDrag);
    shadow.addEventListener("click", (ev) => {
      const t = ev.target;
      const dn = t.closest?.(".dn");
      if (dn) {
        night = dn.dataset.t === "night";
        wrap.classList.toggle("night", night);
        shadow.querySelectorAll(".dn").forEach((x) => x.classList.remove("on"));
        dn.classList.add("on");
        return;
      }
      const el = t.closest?.("[data-act]");
      const act = el?.getAttribute("data-act");
      if (!act) return;
      switch (act) {
        case "close":
          close();
          break;
        case "home":
          view = "hub";
          flash = "";
          expandMod = null;
          editingIdx = null;
          doRefresh();
          render();
          break;
        case "timeline":
          view = "timeline";
          flash = "";
          editingIdx = null;
          render();
          break;
        case "toggle-retired":
          showRetired = !showRetired;
          render();
          break;
        case "detail":
          detailStart = Number(el.dataset.i);
          detailCurIdx = detailStart;
          editingIdx = null;
          view = "detail";
          flash = "";
          render();
          scrollDetailTo(detailStart);
          break;
        case "back-timeline":
          goTimelineAt(detailCurIdx ?? detailStart ?? 0);
          break;
        case "edit-container":
          editingIdx = Number(el.dataset.i);
          flash = "";
          render();
          break;
        case "full-open": {
          const oid = el.dataset.oid;
          const scope = el.dataset.scope === "summary" ? "summary" : "archive";
          const entry = scope === "summary" ? session.summaryOrchestrationEntries().find((x) => x.id === oid) : session.orchestrationEntries().find((x) => x.id === oid);
          const ta = shadow.querySelector(
            `.modedit textarea[${scope === "summary" ? "data-soid" : "data-oid"}="${oid}"]`
          );
          fullEdit = { scope, id: oid, label: entry?.label ?? "提示词", value: ta?.value ?? entry?.content ?? "" };
          flash = "";
          render();
          break;
        }
        case "full-save": {
          const ta = shadow.querySelector("[data-el=fulltext]");
          if (fullEdit && ta) {
            if (fullEdit.scope === "summary") {
              session.setSummaryOrchestrationOverride(fullEdit.id, ta.value);
            } else {
              session.setOrchestrationOverride(fullEdit.id, ta.value);
            }
          }
          fullEdit = null;
          flash = "提示词已保存 ✓";
          render();
          break;
        }
        case "full-reset":
          if (fullEdit) {
            if (fullEdit.scope === "summary") {
              session.resetSummaryOrchestrationOverride(fullEdit.id);
            } else {
              session.resetOrchestrationOverride(fullEdit.id);
            }
          }
          fullEdit = null;
          flash = "已恢复内置最新版 ✓";
          render();
          break;
        case "full-cancel":
          fullEdit = null;
          flash = "";
          render();
          break;
        case "cedit-save":
          void saveContainerEdit();
          break;
        case "cedit-cancel":
          editingIdx = null;
          flash = "";
          render();
          break;
        case "exc-del":
          el.closest(".se-exc")?.remove();
          break;
        case "exc-add": {
          const excs = el.closest(".se-frag")?.querySelector(".se-excs");
          excs?.insertAdjacentHTML("beforeend", excRow(""));
          excs?.querySelector(".se-exc:last-child .f.line")?.focus();
          break;
        }
        case "exc-add-loose":
          el.insertAdjacentHTML("beforebegin", excRow(""));
          el.previousElementSibling?.querySelector(".f.line")?.focus();
          break;
        case "api":
          view = "api";
          flash = "";
          render();
          break;
        case "toggle-summary":
          ev.stopPropagation();
          session.setSummaryEnabled(session.config.summaryEnabled === false);
          render();
          break;
        case "toggle-timeline":
          ev.stopPropagation();
          session.setTimelineEnabled(session.config.timelineEnabled === false);
          render();
          break;
        case "setup":
          view = "setup";
          flash = "";
          expandMod = null;
          doRefresh();
          resetRangeSelection();
          render();
          break;
        case "summary-setup":
          view = "summary-setup";
          flash = "";
          summaryExpandMod = null;
          doRefresh();
          render();
          break;
        case "integrity-open":
          view = "integrity";
          render();
          break;
        case "integrity-run":
          void integrityRun();
          break;
        case "commitlog-open":
          view = "commitlog";
          flash = "";
          doRefresh();
          render();
          break;
        case "commitlog-resume":
          void commitLogResume();
          break;
        case "run":
          void startArchive();
          break;
        case "summary-run":
          void startSummary();
          break;
        case "cancel-generation":
          cancelGeneration();
          break;
        case "retry-generation":
          retryGeneration();
          break;
        case "summary-retry":
          retrySummaryGeneration();
          break;
        case "summary-failed-discard":
          discardSummaryFlow();
          break;
        case "range-all":
          resetRangeSelection();
          render();
          break;
        case "range-none":
          rangeThrough = null;
          render();
          break;
        case "n-dec":
          setNFromInput();
          session.setN(session.config.n - 50);
          doRefresh();
          resetRangeSelection();
          render();
          break;
        case "n-inc":
          setNFromInput();
          session.setN(session.config.n + 50);
          doRefresh();
          resetRangeSelection();
          render();
          break;
        case "summary-interval-dec":
          setSummaryIntervalFromInput();
          session.setSummaryInterval(session.config.summaryInterval - 10);
          doRefresh();
          render();
          break;
        case "summary-interval-inc":
          setSummaryIntervalFromInput();
          session.setSummaryInterval(session.config.summaryInterval + 10);
          doRefresh();
          render();
          break;
        case "mod-toggle": {
          const m = el.dataset.mod;
          expandMod = expandMod === m ? null : m;
          render();
          break;
        }
        case "mod-cancel":
          expandMod = null;
          render();
          break;
        case "mod-reset":
          session.resetOrchestrationOverride(el.dataset.oid);
          flash = "已恢复内置最新版 ✓";
          render();
          break;
        case "mod-save":
          saveMod(el.dataset.mod);
          break;
        case "prompt-reset-all":
          session.resetAllOrchestrationOverrides();
          expandMod = null;
          fullEdit = null;
          flash = "已全部使用内置最新版 ✓";
          render();
          break;
        case "summary-mod-toggle": {
          const mod = el.dataset.mod;
          summaryExpandMod = summaryExpandMod === mod ? null : mod;
          render();
          break;
        }
        case "summary-mod-cancel":
          summaryExpandMod = null;
          render();
          break;
        case "summary-mod-reset":
          session.resetSummaryOrchestrationOverride(el.dataset.oid);
          flash = "已恢复内置最新版 ✓";
          render();
          break;
        case "summary-mod-save":
          saveSummaryMod(el.dataset.mod);
          break;
        case "summary-prompt-reset-all":
          session.resetAllSummaryOrchestrationOverrides();
          summaryExpandMod = null;
          fullEdit = null;
          flash = "已全部使用内置最新版 ✓";
          render();
          break;
        case "api-save": {
          const sel = shadow.querySelector("[data-el=connection-profile]");
          session.setConnectionProfile(sel?.value ?? null);
          flash = "已保存 ✓";
          render();
          break;
        }
        case "discard":
          session.discard();
          generationUiEpoch += 1;
          activeGenerationAttempt = null;
          failedGeneration = null;
          cand = null;
          candEditing = false;
          reopenEditor = false;
          view = "hub";
          flash = "";
          doRefresh();
          render();
          break;
        case "summary-discard":
          discardSummaryFlow();
          break;
        case "mode-archive":
          mode = "archive";
          if (reopenEditor) {
            candEditing = true;
            reopenEditor = false;
          } else {
            candEditing = false;
          }
          render();
          break;
        case "mode-debug": {
          if (candEditing) {
            const ta = shadow.querySelector("[data-el=editdoc]");
            if (ta && cand) cand = session.editCandidate(cand, ta.value);
            reopenEditor = true;
          } else {
            reopenEditor = false;
          }
          mode = "debug";
          candEditing = false;
          render();
          break;
        }
        case "summary-mode-archive":
          summaryMode = "archive";
          if (summaryReopenEditor) {
            summaryCandEditing = true;
            summaryReopenEditor = false;
          } else {
            summaryCandEditing = false;
          }
          render();
          break;
        case "summary-mode-debug": {
          if (summaryCandEditing) {
            const ta = shadow.querySelector("[data-el=summary-editdoc]");
            if (ta && summaryCand) summaryCand = session.editSummaryCandidate(summaryCand, ta.value);
            summaryReopenEditor = true;
          } else {
            summaryReopenEditor = false;
          }
          summaryMode = "debug";
          summaryCandEditing = false;
          render();
          break;
        }
        case "edit-doc":
          if (mode === "archive") {
            candEditing = true;
            render();
          }
          break;
        case "edit-save":
          applyEdit();
          break;
        case "edit-cancel":
          candEditing = false;
          render();
          break;
        case "summary-edit-doc":
          if (summaryMode === "archive") {
            summaryCandEditing = true;
            render();
          }
          break;
        case "summary-edit-save":
          applySummaryEdit();
          break;
        case "summary-edit-cancel":
          summaryCandEditing = false;
          render();
          break;
        case "repair": {
          if (!cand || candEditing) break;
          const repaired = session.repairCandidate(cand);
          if (!repaired.fixes.length) {
            flash = "没有可安全自动补正的结构";
          } else {
            cand = repaired.candidate;
            mode = "archive";
            flash = `已补正：${repaired.fixes.join("；")} ✓`;
          }
          render();
          break;
        }
        case "reroll":
          void reroll();
          break;
        case "save":
          void save();
          break;
        case "summary-reroll":
          void rerollSummary();
          break;
        case "summary-apply":
          void applySummaryCandidate();
          break;
      }
    });
    shadow.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t.matches?.("[data-el=nval]")) {
        setNFromInput();
        doRefresh();
        resetRangeSelection();
        render();
      } else if (t.matches?.("[data-el=summary-interval]")) {
        setSummaryIntervalFromInput();
        doRefresh();
        render();
      } else if (t.matches?.("[data-el=range-floor]")) {
        const input = t;
        const floor = Number(input.value);
        const floors = rangeSources().map((x) => x.floor);
        if (input.checked) {
          rangeThrough = floor;
        } else {
          rangeThrough = floors.filter((x) => x < floor).pop() ?? null;
        }
        render();
      }
    });
    shadow.addEventListener("input", (ev) => {
      const target = ev.target;
      if (target.matches?.("[data-el=summary-guide]") && summaryCand) {
        summaryCand = { ...summaryCand, guidance: target.value };
      } else if (target.matches?.("[data-el=summary-retry-guide]") && failedSummaryGeneration) {
        failedSummaryGeneration = {
          ...failedSummaryGeneration,
          attempt: { ...failedSummaryGeneration.attempt, guidance: target.value }
        };
      }
    });
    const panelScroll = panelEl;
    panelScroll.addEventListener("scroll", () => {
      if (view !== "detail") return;
      const cards = [...shadow.querySelectorAll(".read [data-cidx]")];
      if (!cards.length) return;
      const ptop = panelScroll.getBoundingClientRect().top;
      const headH = shadow.querySelector(".top")?.getBoundingClientRect().height ?? 48;
      let cur = cards[0];
      for (const c of cards) {
        if (c.getBoundingClientRect().top - ptop <= headH + 14) cur = c;
        else break;
      }
      const idx = Number(cur.getAttribute("data-cidx"));
      if (idx === detailCurIdx) return;
      detailCurIdx = idx;
      const now = shadow.querySelector(".now");
      if (now) {
        now.textContent = cur.getAttribute("data-cname") || "（无题）";
        const ctime = cur.getAttribute("data-ctime") || "";
        if (ctime) {
          const s = doc.createElement("small");
          s.textContent = ctime;
          now.append(" ", s);
        }
      }
    });
    function open() {
      generationUiEpoch += 1;
      activeGenerationAttempt = null;
      failedGeneration = null;
      activeSummaryGenerationAttempt = null;
      failedSummaryGeneration = null;
      root.style.display = "block";
      panelOffset = { x: 0, y: 0 };
      panelMoved = false;
      renderedSurface = null;
      view = "hub";
      cand = null;
      summaryCand = null;
      detailStart = null;
      detailCurIdx = null;
      editingIdx = null;
      candEditing = false;
      reopenEditor = false;
      summaryCandEditing = false;
      summaryReopenEditor = false;
      expandMod = null;
      summaryExpandMod = null;
      fullEdit = null;
      rangeThrough = null;
      flash = "";
      doRefresh();
      render();
      layoutPanel(true);
    }
    function close() {
      if (session.phase === "committing") return;
      generationUiEpoch += 1;
      activeGenerationAttempt = null;
      failedGeneration = null;
      activeSummaryGenerationAttempt = null;
      failedSummaryGeneration = null;
      root.style.display = "none";
      session.cancel();
      session.discard();
      session.discardSummary();
    }
    function destroy() {
      generationUiEpoch += 1;
      activeGenerationAttempt = null;
      failedGeneration = null;
      activeSummaryGenerationAttempt = null;
      failedSummaryGeneration = null;
      if (session.phase !== "committing") {
        session.cancel();
        session.discard();
        session.discardSummary();
      }
      panelWindow.removeEventListener("resize", onViewportChange);
      panelWindow.visualViewport?.removeEventListener("resize", onViewportChange);
      panelWindow.visualViewport?.removeEventListener("scroll", onViewportChange);
      panelWindow.removeEventListener("pointerup", finishDrag);
      panelWindow.removeEventListener("pointercancel", finishDrag);
      root.remove();
    }
    return { root, open, close, destroy };
  }

  // src/plugin/index.ts
  var BUTTON_NAME = "🗂️ 记忆归档";
  var TAG2 = "%c[记忆归档]";
  var CSS2 = "color:#b0774f;font-weight:bold";
  function topDocument() {
    let w = window;
    let highest = document;
    while (w.parent && w.parent !== w) {
      try {
        const parent = w.parent;
        void parent.document.body;
        w = parent;
        highest = w.document;
      } catch {
        break;
      }
    }
    return highest;
  }
  function runtimeTavernEventTypes() {
    const globals = globalThis;
    if (globals.tavern_events) return globals.tavern_events;
    const injected = globals.SillyTavern;
    const context = typeof injected?.getContext === "function" ? injected.getContext() : injected;
    return context?.eventTypes ?? null;
  }
  function runtimeCurrentChatIdentity() {
    const injected = globalThis.SillyTavern;
    const context = typeof injected?.getContext === "function" ? injected.getContext() : injected;
    try {
      const id = context?.getCurrentChatId?.() ?? context?.chatId;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  }
  function init() {
    console.info(TAG2, CSS2, "init 开始");
    const g = globalThis;
    const needed = [
      "getChatMessages",
      "setChatMessages",
      "createChatMessages",
      "deleteChatMessages",
      "getLastMessageId",
      "generateRaw",
      "getVariables",
      "insertOrAssignVariables",
      "appendInexistentScriptButtons",
      "updateScriptButtonsWith",
      "getButtonEvent",
      "eventOn"
    ];
    const missing = needed.filter((n) => typeof g[n] !== "function");
    if (missing.length) console.warn(TAG2, CSS2, "缺失的运行时全局函数:", missing);
    else console.info(TAG2, CSS2, "运行时全局齐全");
    const deps = createTavernDeps();
    let session;
    try {
      session = new ArchiverSession(deps, loadConfig(deps));
      console.info(TAG2, CSS2, "会话已建（配置已读）");
    } catch (e) {
      console.error("[记忆归档] 建会话失败：", e);
      return;
    }
    const doc = topDocument();
    const inIframe = doc !== document;
    let reconcileFeatureRuntime = () => null;
    let stopFeatureEnablementListener = () => {
    };
    const panel = createPanel(session, doc);
    doc.body.appendChild(panel.root);
    console.info(TAG2, CSS2, `面板已挂到 ${inIframe ? "顶层主页面" : "本页"} body`);
    let observedBoundary = session.config.boundary ?? 0;
    let reminderBlocked = false;
    let chatReloadTimer = null;
    let pendingChatIdentity = runtimeCurrentChatIdentity();
    let chatSwitchPending = false;
    let openAfterChatReload = false;
    session.chatState.reset(pendingChatIdentity);
    const runtimeRegexUpdater = typeof g.updateTavernRegexesWith === "function" ? g.updateTavernRegexesWith : void 0;
    const regexDepthController = createRegexDepthController({
      updateTavernRegexesWith: runtimeRegexUpdater,
      warn: (message, error) => {
        if (error === void 0) console.warn(TAG2, CSS2, message);
        else console.warn(TAG2, CSS2, message, error);
      }
    });
    const featureRuntimeEnabled = () => session.config.timelineEnabled || session.config.summaryEnabled;
    const syncRegexDepth = (head) => {
      if (!featureRuntimeEnabled()) return;
      regexDepthController.request(head.regexWindow);
    };
    const openPanel = () => {
      if (chatSwitchPending) {
        openAfterChatReload = true;
        return;
      }
      if (!featureRuntimeEnabled()) {
        const identity = runtimeCurrentChatIdentity();
        session.chatState.reset(identity);
        pendingChatIdentity = identity;
        session.config = loadConfig(deps);
        observedBoundary = session.config.boundary ?? 0;
        reminderBlocked = false;
        reconcileFeatureRuntime();
      }
      panel.open();
    };
    const refreshReminderBaseline = (read) => {
      try {
        const snapshot = session.refresh(read);
        observedBoundary = snapshot.boundary;
        reminderBlocked = snapshot.interrupted.length > 0 || snapshot.integrity.needed;
        return snapshot;
      } catch (e) {
        reminderBlocked = true;
        console.warn("[记忆归档] 提醒基线刷新失败：", e);
        return null;
      }
    };
    const checkReminder = (head, summaryTrigger) => {
      if (chatSwitchPending || reminderBlocked || session.phase !== "idle" || panel.root.style.display !== "none") return;
      const boundary = Math.max(observedBoundary, session.config.boundary ?? 0);
      const decision = buildReminderDecision({
        timeline: {
          currentFloor: head.currentFloor,
          boundary,
          n: session.config.n,
          lastDismissedFloor: session.config.lastDismissedFloor
        },
        summary: {
          currentFloor: head.currentFloor,
          latestArchiveFloor: head.latestLiveArchiveFloor,
          interval: session.config.summaryInterval,
          lastRemindedFloor: session.config.summaryLastRemindedFloor
        },
        summaryTrigger,
        timelineEnabled: session.config.timelineEnabled,
        summaryEnabled: session.config.summaryEnabled
      });
      if (!decision) return;
      try {
        if (typeof toastr === "undefined" || typeof toastr.info !== "function") return;
        const isTimeline = decision.kind === "timeline";
        const shown = toastr.info(
          isTimeline ? `已可总结 ${decision.notice.from}–${decision.notice.through} 层。点击打开记忆归档；忽略后 +50 层再提醒。` : `距上次摘要 → 大总结已 ${decision.notice.distance} 层，点击打开`,
          isTimeline ? "记忆归档" : "摘要 → 大总结",
          {
            timeOut: 8e3,
            extendedTimeOut: 2e3,
            closeButton: true,
            preventDuplicates: true,
            escapeHtml: true,
            onclick: openPanel
          }
        );
        if (shown === null || shown === void 0) return;
        if (isTimeline) {
          session.config.lastDismissedFloor = decision.notice.currentFloor;
        } else {
          session.config.summaryLastRemindedFloor = decision.notice.currentFloor;
        }
        session.persist();
      } catch (e) {
        console.warn("[记忆归档] 轻提醒播出失败：", e);
      }
    };
    const reloadForChangedChat = () => {
      chatReloadTimer = null;
      if (session.phase === "committing") {
        chatReloadTimer = setTimeout(reloadForChangedChat, 250);
        return;
      }
      try {
        panel.close();
        session.config = loadConfig(deps);
        observedBoundary = session.config.boundary ?? 0;
        reminderBlocked = false;
        const startedSnapshot = reconcileFeatureRuntime();
        const snapshot = featureRuntimeEnabled() ? startedSnapshot ?? refreshReminderBaseline() : null;
        if (snapshot && snapshot !== startedSnapshot) syncRegexDepth(snapshot);
        chatSwitchPending = false;
        if (openAfterChatReload) {
          openAfterChatReload = false;
          openPanel();
        } else if (snapshot) {
          checkReminder(snapshot, snapshot.summaryTrigger);
        }
      } catch (e) {
        reminderBlocked = true;
        console.warn("[记忆归档] 切换聊天后重载配置失败：", e);
      }
    };
    appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
    const ev = getButtonEvent(BUTTON_NAME);
    console.info(TAG2, CSS2, "按钮事件名 =", ev);
    const buttonSubscriptions = [];
    buttonSubscriptions.push(eventOn(ev, () => {
      console.info(TAG2, CSS2, "按钮被点击 → 打开面板");
      try {
        openPanel();
      } catch (e) {
        console.error("[记忆归档] 打开面板失败：", e);
      }
    }));
    try {
      buttonSubscriptions.push(eventOn(BUTTON_NAME, () => {
        console.info(TAG2, CSS2, "（兜底事件）按钮名事件触发 → 打开面板");
        openPanel();
      }));
    } catch {
    }
    const reminderEvents = resolveReminderEventNames(runtimeTavernEventTypes());
    let chatActivity = null;
    const bindFeatureActivity = () => {
      if (chatActivity) return;
      chatActivity = bindChatActivityMonitor({
        state: session.chatState,
        events: reminderEvents,
        eventOn: (eventType, listener) => eventOn(eventType, listener),
        initialChatIdentity: pendingChatIdentity,
        getCurrentChatIdentity: runtimeCurrentChatIdentity,
        onHeadActivity: (head) => {
          syncRegexDepth(head);
          checkReminder(head);
        },
        onArchiveInvalidated: (read) => {
          syncRegexDepth(read);
          const snapshot = refreshReminderBaseline(read);
          if (snapshot) checkReminder(snapshot, snapshot.summaryTrigger);
        },
        onChatChanged: (chatIdentity) => {
          chatSwitchPending = true;
          reminderBlocked = true;
          pendingChatIdentity = chatIdentity;
          panel.close();
          if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
          chatReloadTimer = setTimeout(reloadForChangedChat, 150);
        }
      });
    };
    reconcileFeatureRuntime = () => {
      if (!featureRuntimeEnabled()) {
        chatActivity?.destroy();
        chatActivity = null;
        regexDepthController.restoreDefault();
        return null;
      }
      if (chatActivity) return null;
      bindFeatureActivity();
      const snapshot = refreshReminderBaseline();
      if (snapshot) {
        syncRegexDepth(snapshot);
        checkReminder(snapshot, snapshot.summaryTrigger);
      }
      return snapshot;
    };
    stopFeatureEnablementListener = session.onFeatureEnablementChanged(() => {
      reconcileFeatureRuntime();
    });
    reconcileFeatureRuntime();
    $(window).on("pagehide", () => {
      if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
      chatActivity?.destroy();
      regexDepthController.destroy();
      stopFeatureEnablementListener();
      for (const subscription of buttonSubscriptions) subscription.stop();
      updateScriptButtonsWith((buttons) => buttons.filter((b) => b.name !== BUTTON_NAME));
      panel.destroy();
    });
    console.info(TAG2, CSS2, "init 完成 ✓（点按钮应看到「按钮被点击」日志）");
  }
  try {
    $(() => {
      try {
        init();
      } catch (e) {
        console.error("[记忆归档] init 抛错：", e);
      }
    });
  } catch (e) {
    console.error("[记忆归档] 启动抛错（$ 不可用？）：", e);
  }
})();
/*!
 * 记忆归档插件（此间小镇 HereBetween · 长程记忆《世界档案》）
 * 酒馆助手脚本入口。诊断版：每步 loudly 打日志，便于定位"点了没反应"。
 */

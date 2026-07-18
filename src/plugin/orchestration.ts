/**
 * 记忆插件 · 提示词编排表（§4）
 * ------------------------------------------------------------
 * 单次独立调用、整份 prompt 自己拼，所以「注入顺序」= 装配次序，injection_depth/position 用不上。
 * 编排机制与 archiver 提示词本体**解耦**：重写的是各条目内容，不动这套装配。
 *
 * 三类槽：
 *   - static             静态·可编辑内容（骨架规则 / 注意 / CoT / 输出格式指令…）
 *   - historical_context 运行时填「收集结果」（既存 + 原始）的单槽；content 是环绕模板
 *   - guidance           每轮重roll 填的个性化引导；默认空，空则整条不发
 */

import type { PromptRole, RolePrompt } from './deps';

export type SlotKind = 'static' | 'historical_context' | 'guidance';

export interface OrchestrationEntry {
  id: string;
  /** 条目显示名 */
  label: string;
  role: PromptRole;
  kind: SlotKind;
  /**
   * static：整段内容。
   * historical_context / guidance：环绕模板，用占位符标记填充点：
   *   {{HISTORICAL_CONTEXT}} / {{GUIDANCE}}；无占位符则把值接在末尾。
   */
  content: string;
  enabled: boolean;
}

/**
 * 用户只持久化真正改过的内容；内置提示词本体始终来自当前脚本。
 * acknowledgedBuiltinHash 记录用户最近确认过的内置版本，用来判断是否有尚未处理的新版。
 */
export interface OrchestrationOverride {
  content: string;
  acknowledgedBuiltinHash: string;
}

export type OrchestrationOverrides = Record<string, OrchestrationOverride>;

export const HISTORICAL_PLACEHOLDER = '{{HISTORICAL_CONTEXT}}';
export const GUIDANCE_PLACEHOLDER = '{{GUIDANCE}}';

/**
 * §4 默认编排（装的是 记忆生成_提示词_v1 的真内容，与 v1 结构一致，CoT 在记录之后）。
 * 提示词本体与本装配机制解耦：之后重写 archiver 措辞只改各条目 content，不动这套结构。
 */

const SKELETON = `你是一个「记忆归档器」。把给定的角色扮演原始记录，进一步压缩篇幅，成为一份结构化《世界档案》。以因果为时间轴，仅值得保留的细节以摘录方式存在。
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

const HISTORICAL = `<Historical_Context>
${HISTORICAL_PLACEHOLDER}
</Historical_Context>
原始记录读取完毕。`;

const NOTE = `注意：对于【既存信息】中最后一个容器（仅取其一），其时间范围与【原始记录】中某段有明显重叠且判断合并为一个容器时更有助于保持连续性。请在即将生成的世界存档中增量覆写此容器（即完整保留原本信息基础上新增本次记录，将其作为本次生成的第一个容器；既存末尾容器中的旧事实不得降精度），确保此容器：“容器标题” 保持一致。`;

const GUIDANCE_BLOCK = `对【原始记录】的补充信息（用于校正理解与调整取舍，但不得覆盖红线、事实保真及输出格式要求）：
${GUIDANCE_PLACEHOLDER}`;

const COT = `<Output_Requirements>
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

/** 设置页把“思考要求 + 正式输出指令”作为一份后置提示词编辑、也作为一条 system prompt 发送。 */
const POST = COT;

export function defaultOrchestration(): OrchestrationEntry[] {
  return [
    { id: 'skeleton', label: '骨架规则（身份 + 结构 + 红线）', role: 'system', kind: 'static', content: SKELETON, enabled: true },
    { id: 'historical_context', label: 'Historical Context（既存 + 原始）', role: 'system', kind: 'historical_context', content: HISTORICAL, enabled: true },
    { id: 'note', label: '注意（增量覆写等说明）', role: 'system', kind: 'static', content: NOTE, enabled: true },
    { id: 'guidance', label: '重roll 引导槽（本段个性化需求）', role: 'system', kind: 'guidance', content: GUIDANCE_BLOCK, enabled: true },
    { id: 'post', label: '后置提示词', role: 'system', kind: 'static', content: POST, enabled: true },
  ];
}

/** 轻量稳定指纹：只用于版本辨识，不承担安全用途。 */
export function promptFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${content.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** 用当前脚本内置版叠加少量用户 override，得到本轮真正使用/显示的编排。 */
export function resolveOrchestration(overrides: OrchestrationOverrides): OrchestrationEntry[] {
  return defaultOrchestration().map(entry => {
    const override = overrides[entry.id];
    return override ? { ...entry, content: override.content } : entry;
  });
}

export interface AssembleInput {
  /** 收集到的历史上下文（既存 + 原始，已拼好） */
  historicalContext: string;
  /** 本轮重roll 引导；空串表示不填 */
  guidance: string;
}

function fill(template: string, placeholder: string, value: string): string {
  return template.includes(placeholder) ? template.split(placeholder).join(value) : `${template}\n${value}`;
}

/**
 * 按编排表装配出 ordered_prompts。
 *  - 跳过 enabled=false 的条目。
 *  - guidance 槽在 guidance 为空时整条跳过（默认空 → 不发）。
 */
export function assemblePrompt(entries: OrchestrationEntry[], input: AssembleInput): RolePrompt[] {
  const prompts: RolePrompt[] = [];
  for (const e of entries) {
    if (!e.enabled) continue;
    let content: string;
    if (e.kind === 'historical_context') {
      content = fill(e.content, HISTORICAL_PLACEHOLDER, input.historicalContext);
    } else if (e.kind === 'guidance') {
      if (!input.guidance.trim()) continue; // 空引导不发
      content = fill(e.content, GUIDANCE_PLACEHOLDER, input.guidance);
    } else {
      content = e.content;
    }
    prompts.push({ role: e.role, content });
  }
  return prompts;
}

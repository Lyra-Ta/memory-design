/**
 * 摘要 / Flux -> 普通 World Archive 的独立提示词编排。
 *
 * 固定三段，全部作为 system 发送：
 *   1. pre     system：审计系统身份与职责；
 *   2. runtime system：本轮冻结的 Historical Context / 可空 Guidance；
 *   3. post    system：四阶段审计步骤与正式输出指令。
 *
 * 本模块只装配纯文本 ordered prompts，不依赖 UI、session、角色卡、世界书或酒馆宏。
 */

export type SummaryPromptRole = 'system' | 'user' | 'assistant';
export type SummaryPromptId = 'pre' | 'runtime' | 'post';
export type SummarySlotKind = 'static' | 'runtime';

export interface SummaryRolePrompt {
  role: SummaryPromptRole;
  content: string;
}

export interface SummaryOrchestrationEntry {
  id: SummaryPromptId;
  label: string;
  role: SummaryPromptRole;
  kind: SummarySlotKind;
  content: string;
  enabled: boolean;
}

/** 用户只覆盖文案；角色、顺序、槽类型与开关仍由当前内置版决定。 */
export interface SummaryOrchestrationOverride {
  content: string;
  /** 用户最近确认过的内置文案指纹；不同于当前内置版时提示一次更新。 */
  acknowledgedBuiltinHash: string;
}

export type SummaryOrchestrationOverrides = Partial<
  Record<SummaryPromptId, SummaryOrchestrationOverride>
>;

export const SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER =
  '{{所有符合条件的信息，也就是所有<World_Archive>以及被抓到的<Flux>}}';
export const SUMMARY_GUIDANCE_PLACEHOLDER = '{{GUIDANCE}}';

const PRE = `你是一个「记忆审计归档系统」。
该审计不参与叙事生成，不负责创作与风格选择。仅对已生成的显现内容（<Flux>）进行可逆压缩与正确性校验。其输出的 Archive 将作为后续一切系统推演的唯一历史输入。`;

const RUNTIME = `<Historical_Context>
${SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER}
</Historical_Context>

${SUMMARY_GUIDANCE_PLACEHOLDER}`;

const POST = `<Output_Requirements>
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

现在从思考<thinking>开始：`;

/** 返回全新的默认条目，调用方可以安全地局部复制/切换 enabled。 */
export function defaultSummaryOrchestration(): SummaryOrchestrationEntry[] {
  return [
    { id: 'pre', label: '前置定义', role: 'system', kind: 'static', content: PRE, enabled: true },
    { id: 'runtime', label: '运行时填入', role: 'system', kind: 'runtime', content: RUNTIME, enabled: true },
    { id: 'post', label: '后置思考与输出', role: 'system', kind: 'static', content: POST, enabled: true },
  ];
}

/** 轻量稳定指纹：仅用于辨识提示词版本，不承担安全用途。 */
export function summaryPromptFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${content.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** 为一段自定义文案生成带基线指纹的 override。 */
export function makeSummaryOrchestrationOverride(
  content: string,
  baseContent: string,
): SummaryOrchestrationOverride {
  return { content, acknowledgedBuiltinHash: summaryPromptFingerprint(baseContent) };
}

/** 当前内置结构叠加少量用户文案 override。 */
export function resolveSummaryOrchestration(
  overrides: SummaryOrchestrationOverrides,
): SummaryOrchestrationEntry[] {
  return defaultSummaryOrchestration().map(entry => {
    const override = overrides[entry.id];
    return override ? { ...entry, content: override.content } : entry;
  });
}

export interface AssembleSummaryPromptInput {
  /** Historical Context 中的全部当前有效、可见 live Archive。 */
  archiveContext: string;
  /** Historical Context 中 x < floor <= sourceThrough 的全部 Flux。 */
  targetFlux: string;
  /** 本轮可空补充引导。 */
  guidance?: string;
}

function fillOrAppend(template: string, placeholder: string, value: string, fallback: string): string {
  if (template.includes(placeholder)) return template.split(placeholder).join(value);
  return `${template.trimEnd()}\n\n${fallback}`;
}

function fillRuntime(template: string, input: AssembleSummaryPromptInput): string {
  const historicalContext = [input.archiveContext.trim(), input.targetFlux.trim()]
    .filter(Boolean)
    .join('\n\n');
  let content = fillOrAppend(
    template,
    SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER,
    historicalContext,
    `<Historical_Context>\n${historicalContext}\n</Historical_Context>`,
  );

  const guidance = input.guidance?.trim() ?? '';
  const guidanceBlock = guidance ? `<Guidance>\n${guidance}\n</Guidance>` : '';
  if (content.includes(SUMMARY_GUIDANCE_PLACEHOLDER)) {
    content = content.split(SUMMARY_GUIDANCE_PLACEHOLDER).join(guidanceBlock);
  } else if (guidanceBlock) {
    content = `${content.trimEnd()}\n\n${guidanceBlock}`;
  }
  return content.trim();
}

/** 按条目顺序装配本轮 ordered prompts；默认三段全部为 system。 */
export function assembleSummaryPrompt(
  entries: SummaryOrchestrationEntry[],
  input: AssembleSummaryPromptInput,
): SummaryRolePrompt[] {
  return entries.flatMap(entry => {
    if (!entry.enabled) return [];
    const content = entry.kind === 'runtime' ? fillRuntime(entry.content, input) : entry.content;
    return [{ role: entry.role, content }];
  });
}

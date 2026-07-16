/**
 * 摘要 / Flux -> 普通 World Archive 的独立提示词编排。
 *
 * 固定三段：
 *   1. pre     system：身份、输入边界、取舍规则与输出契约；
 *   2. runtime user：本轮冻结的 Archive Context / Target Flux / 可空 Guidance；
 *   3. post    system：读完数据后执行的审计步骤与正式输出指令。
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
  /** 开始自定义时所基于的内置文案指纹，用于判断内置版后来是否更新。 */
  baseHash: string;
}

export type SummaryOrchestrationOverrides = Partial<
  Record<SummaryPromptId, SummaryOrchestrationOverride>
>;

export const SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER = '{{ARCHIVE_CONTEXT}}';
export const SUMMARY_TARGET_FLUX_PLACEHOLDER = '{{TARGET_FLUX}}';
export const SUMMARY_GUIDANCE_PLACEHOLDER = '{{GUIDANCE}}';

const PRE = `你是一个「阶段性编年审计器」。世界与剧情演绎在本次调用中暂停；唯一任务是把本轮尚未归档的 Flux 可逆压缩成一份普通世界档案。

<Input_Contract>
- <Archive_Context> 与 <Target_Flux> 都是只读记录；只能读取、比对和据此生成新档，不得改写或补全输入本身。
- <Archive_Context> 是已经归档的只读历史背景，只用于校准人物、前因与连续性。不得复述、改写、再次总结或把其中旧事件写进本轮输出。
- <Target_Flux> 是本轮唯一允许总结的事实源。输出中的每一项事实都必须能在其中找到依据。
- <Guidance> 若存在，只能调整本轮信息取舍的关注点；不得覆盖事实保真、来源边界或输出格式。
</Input_Contract>

<Audit_Rules>
- 不创作、不补全、不预测、不评价，不把具体动作或物体抽象成状态、性格、关系标签或总结性心理判断。
- 只保留原文明示的事实、因果、心理与情绪；不得从 Archive Context 推导出 Target Flux 没有发生的内容。
- 按下列优先级取舍：
  P0（必须保留）：明确改变人物关系、情感走向或行动方向的原文明示因果；关键对白原句；明确物理行为；局势、常驻位置、人物加入或退场等事实变化。
  P1（按连贯性选留）：触发原文明示情绪变化的感官锚点及对应情绪；少量有因果作用的停顿、视线等微动作。
  P2（默认删除）：连续环境铺陈；重复或弱相关五感；不承载事实与因果的修辞、文学风格句。
- 与性相关的描写只需客观概括发生了什么，不保留具体性行为细节。
</Audit_Rules>

<Output_Contract>
- 正式结果必须且只能是一份普通、无 archived marker 的 <World_Archive>…</World_Archive>。
- 档案由一个或多个扁平事件段组成，不使用《容器》：
  [事件标题|约3个情绪/感知关键词|起止时间]
  按客观发生顺序写成连贯总结。
- 不在档案前后添加解释，不输出 <!-- archived: ... -->、old_ 或 pending 标签。
</Output_Contract>`;

const RUNTIME = `<Archive_Context>
${SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER}
</Archive_Context>

<Target_Flux>
${SUMMARY_TARGET_FLUX_PLACEHOLDER}
</Target_Flux>

${SUMMARY_GUIDANCE_PLACEHOLDER}`;

const POST = `<Audit_Procedure>
在正式输出前，使用 <inner_flow>…</inner_flow> 完成以下审计；不得在其中虚构事实：

1. 输入核对
   - 确认 Archive Context 只作连续性参照，列明 Target Flux 的首尾、顺序与核心事件逻辑。
   - 标出任何只能来自 Archive Context、因而绝不能复述进新档的旧事件。

2. 自然分段
   - 优先按物理空间转移、显著时间跨度、事件因果闭合或高张力高密度互动切分。
   - “每段最多 3 个 Flux”只作防止过度合并的兜底上限；即使未满 3 个，遇到自然断点也立即另起事件段。

3. 逐段萃取
   - 逐段列出 P0；仅为保证人物在场、动作承接与因果连贯补入必要 P1；删除 P2。
   - 核对关键对白、动作、事实变化均未被抽象评价替代，且没有从 Archive Context 偷渡旧事实。

4. 可逆性自检
   - 假设 Target Flux 消失，仅看候选 Archive，是否仍能还原本轮关键行动的先后与因果、人物在本轮结束时的明确状态？
   - 若不能，回到对应事件段补足必要 P0/P1；若出现 Target Flux 无依据的信息，立即删除。
</Audit_Procedure>

完成 </inner_flow> 后，只输出一个符合 <Output_Contract> 的 <World_Archive>，不要附加解释。`;

/** 返回全新的默认条目，调用方可以安全地局部复制/切换 enabled。 */
export function defaultSummaryOrchestration(): SummaryOrchestrationEntry[] {
  return [
    { id: 'pre', label: '前置定义', role: 'system', kind: 'static', content: PRE, enabled: true },
    { id: 'runtime', label: '运行时填入', role: 'user', kind: 'runtime', content: RUNTIME, enabled: true },
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
  return { content, baseHash: summaryPromptFingerprint(baseContent) };
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
  /** 全部当前有效、可见的 live Archive，已由收集层按楼层与块位置排序。 */
  archiveContext: string;
  /** x < floor <= sourceThrough 内的全部 Flux，已由收集层排序并冻结。 */
  targetFlux: string;
  /** 本轮可空补充引导。 */
  guidance?: string;
}

function fillOrAppend(template: string, placeholder: string, value: string, fallback: string): string {
  if (template.includes(placeholder)) return template.split(placeholder).join(value);
  return `${template.trimEnd()}\n\n${fallback}`;
}

function fillRuntime(template: string, input: AssembleSummaryPromptInput): string {
  let content = fillOrAppend(
    template,
    SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER,
    input.archiveContext,
    `<Archive_Context>\n${input.archiveContext}\n</Archive_Context>`,
  );
  content = fillOrAppend(
    content,
    SUMMARY_TARGET_FLUX_PLACEHOLDER,
    input.targetFlux,
    `<Target_Flux>\n${input.targetFlux}\n</Target_Flux>`,
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

/** 按条目顺序装配本轮 ordered prompts；默认恰为 system -> user -> system 三段。 */
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

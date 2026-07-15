/**
 * 记忆插件 · 两段提交引擎
 * ------------------------------------------------------------
 * 提交换代（F）：① 新档写边界层为 <World_Archive_pending> + 覆盖标记
 *               ② 退旧（rename → old_World_Archive）
 *               ③ 转正（_pending → World_Archive）
 * 顺序化 setChatMessages + 落盘校验再走下一条（不并发）；孤立 pending 可检测。
 * 注意：完整崩溃回滚仍需要事务日志；当前不能把“删 pending”当成整笔回滚。
 *
 * 本引擎是「机械层」：给定策略决定（写哪层、退哪些旧档）就产出有序步骤并执行。
 * 「写哪一层 / 退哪些旧档 / 增量覆写的血缘」这类策略由架子层决定后喂进来——
 * 那几处在设计里仍是开放点，不在本引擎里擅自假设。
 */

import { makeCoverageMarker, setGeneration, supersedeLastContainer, withMarkerInside, wrapArchive } from './archive-format';
import { hasOrphanPending, type LocatorEntry } from './locator';

/** 一处要退役的现存 live 块 */
export interface RetireTarget {
  message_id: number;
  /** 该楼层当前完整正文 */
  message: string;
  /** 该楼层里要退役的那个 live 块的完整含标签原文 */
  blockRaw: string;
  /** 该块在 message 里的精确字符区间 [start, end) */
  blockSpan: [number, number];
}

/** 提交所需的策略决定（由架子层算好喂进来） */
export interface CommitDecision {
  /** 写新档的楼层 */
  targetMessageId: number;
  /** 该楼层当前完整正文（新档相邻追加在其后） */
  targetMessageText: string;
  /** 结构化后的新档正文（不含外壳；引擎负责套壳） */
  pendingBody: string;
  /** 覆盖标记端点：总结到的层（写进 <!-- archived: N -->） */
  through: number;
  /**
   * 要退役的现存 live 块（可空）。
   * **可包含 targetMessageId 本身**——大总结时间轴化正是「在尾层追加新档 ＋ 把该层原有档案退成 old_」。
   */
  retire: RetireTarget[];
  /**
   * 增量覆写（可空）：上一份既存时间轴档案，其**末尾容器**被新档接管 → 就地注释包裹冷存。
   * 既存档仍是 live、只是末尾容器不再显示/注入。
   */
  supersede?: RetireTarget;
}

export type CommitPhase = 'write-pending' | 'retire-old' | 'supersede' | 'promote-live';

/** 一步提交操作：写入某楼层的完整正文，附落盘校验断言 */
export interface CommitStep {
  phase: CommitPhase;
  message_id: number;
  message: string;
  /** 写入前该楼层必须仍等于此值；避免预览/提交途中覆盖外部改动 */
  expectedBefore: string;
  note: string;
  /** 落盘后读回应满足的断言（防半截态） */
  verify: { includes: string[]; excludes: string[] };
}

export type CommitPlan = CommitStep[];

/** 按定位 span 精确替换，并确认目标内容仍与快照一致。 */
export function replaceSpanExact(
  text: string,
  span: [number, number],
  expected: string,
  replacement: string,
): string {
  const [start, end] = span;
  if (start < 0 || end < start || text.slice(start, end) !== expected) {
    throw new Error('提交前档案位置或内容已变化，请刷新并重新生成');
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

/** 本次 pending 总是追加在楼层末尾；只转正最后一个精确匹配，避免误碰旧块。 */
function replaceLastExact(text: string, expected: string, replacement: string): string {
  const start = text.lastIndexOf(expected);
  if (start < 0) throw new Error('提交现场缺少本次 pending，已停止转正');
  return text.slice(0, start) + replacement + text.slice(start + expected.length);
}

/**
 * 规划两段提交。纯函数：只做字符串变换与排序，不碰酒馆。
 *
 * 允许「同层退旧＋追加」：目标层可同时出现在 retire 里（它原有的档案退役、新档追加在其后）。
 * 为此对每个涉及楼层维护一份**工作副本**，按阶段顺序累积变换——目标层会被写 pending → 退旧 → 转正
 * 依次触及，靠工作副本把三步串起来，不互相覆盖。
 *
 * @throws 若某个退役目标的 blockRaw 是 pending 壳（那是要转正的、不是退役的）——前置条件违背。
 */
export function planCommit(d: CommitDecision): CommitPlan {
  for (const r of d.retire) {
    if (r.blockRaw.includes('<World_Archive_pending>')) {
      throw new Error('planCommit: 退役目标不应是 pending 块（pending 走转正、不走退役）');
    }
  }
  if (d.supersede && d.retire.some(r => r.message_id === d.supersede!.message_id)) {
    throw new Error('planCommit: 同一楼层不能同时作为原始档退役与既存档覆写目标');
  }

  const steps: CommitStep[] = [];
  const marker = makeCoverageMarker(d.through);
  // 覆盖标记打在档案外壳**内部末尾**、随正文套进壳里，绑定该档
  const pendingBlock = wrapArchive(withMarkerInside(d.pendingBody, d.through), 'pending');
  const liveBlock = setGeneration(pendingBlock, 'live');

  // 涉及楼层的工作副本：目标层用 targetMessageText，其余退役/覆写层用各自 message
  const work = new Map<number, string>([[d.targetMessageId, d.targetMessageText]]);
  for (const r of d.retire) {
    if (!work.has(r.message_id)) work.set(r.message_id, r.message);
  }
  if (d.supersede && !work.has(d.supersede.message_id)) work.set(d.supersede.message_id, d.supersede.message);

  // ① 写 pending：pending 壳（内含覆盖标记），相邻追加在目标楼层原文之后
  const beforeWrite = work.get(d.targetMessageId)!;
  const afterWrite = `${beforeWrite}\n\n${pendingBlock}`;
  work.set(d.targetMessageId, afterWrite);
  steps.push({
    phase: 'write-pending',
    message_id: d.targetMessageId,
    message: afterWrite,
    expectedBefore: beforeWrite,
    note: `写 pending + 内嵌覆盖标记 →${d.through}`,
    verify: { includes: [marker, '<World_Archive_pending>'], excludes: [] },
  });

  // ② 退旧：逐块 rename → old_（在各自楼层的工作副本上改；可含目标层的原有旧档）
  // 同层若有多个目标，必须从后往前替换，确保原始 span 不会因前方标签变长而漂移。
  const retireInSafeOrder = [...d.retire].sort(
    (a, b) => a.message_id - b.message_id || b.blockSpan[0] - a.blockSpan[0],
  );
  for (const r of retireInSafeOrder) {
    const retiredBlock = setGeneration(r.blockRaw, 'old');
    const before = work.get(r.message_id)!;
    const next = replaceSpanExact(before, r.blockSpan, r.blockRaw, retiredBlock);
    work.set(r.message_id, next);
    steps.push({
      phase: 'retire-old',
      message_id: r.message_id,
      message: next,
      expectedBefore: before,
      note: `退役楼层 ${r.message_id} 上的旧档`,
      verify: { includes: [retiredBlock], excludes: [] },
    });
  }

  // ②b 增量覆写：把既存档末尾容器就地注释包裹（冷存、不显示不注入；既存档仍是 live）
  if (d.supersede) {
    const superseded = supersedeLastContainer(d.supersede.blockRaw);
    if (superseded === d.supersede.blockRaw) {
      throw new Error(`planCommit: 层 ${d.supersede.message_id} 的既存档没有可覆写的末尾容器`);
    }
    const before = work.get(d.supersede.message_id)!;
    const next = replaceSpanExact(before, d.supersede.blockSpan, d.supersede.blockRaw, superseded);
    work.set(d.supersede.message_id, next);
    steps.push({
      phase: 'supersede',
      message_id: d.supersede.message_id,
      message: next,
      expectedBefore: before,
      note: `增量覆写：注释包裹既存档末尾容器（层 ${d.supersede.message_id}）`,
      verify: { includes: ['<!-- 《'], excludes: [] },
    });
  }

  // ③ 转正：pending → live（在目标层当前工作副本上换代）
  const beforePromote = work.get(d.targetMessageId)!;
  const afterPromote = replaceLastExact(beforePromote, pendingBlock, liveBlock);
  work.set(d.targetMessageId, afterPromote);
  steps.push({
    phase: 'promote-live',
    message_id: d.targetMessageId,
    message: afterPromote,
    expectedBefore: beforePromote,
    note: 'pending → live 转正',
    verify: { includes: [liveBlock], excludes: ['<World_Archive_pending>'] },
  });

  return steps;
}

/** 执行器依赖的酒馆接口（注入，便于单测） */
export interface CommitDeps {
  setChatMessages: (
    msgs: Array<{ message_id: number; message: string }>,
    option?: { refresh?: 'none' | 'affected' | 'all' },
  ) => Promise<void>;
  getChatMessages: (range: number | string) => Array<{ message_id: number; message: string }>;
}

/**
 * 执行器钩子。只在某步正文已写入、关键断言与完整正文都读回校验通过后触发。
 * 钩子可异步持久化进度；它若失败，执行器会立即停下，但该步楼层写入已经成功。
 */
export interface CommitExecutionHooks {
  afterStepVerified?: (step: CommitStep, stepIndex: number) => void | Promise<void>;
}

/** 一步一步顺序执行，每步落盘后读回校验；任何一步没通过就抛出、停在断点（现场留 pending）。 */
export async function executeCommit(
  plan: CommitPlan,
  deps: CommitDeps,
  hooks: CommitExecutionHooks = {},
): Promise<void> {
  for (const [stepIndex, step] of plan.entries()) {
    const before = deps.getChatMessages(step.message_id).find(m => m.message_id === step.message_id)?.message ?? '';
    if (before !== step.expectedBefore) {
      throw new Error(`提交前楼层 ${step.message_id} 已被改动（@${step.phase}），已停止以免覆盖新内容`);
    }
    await deps.setChatMessages([{ message_id: step.message_id, message: step.message }], { refresh: 'none' });
    const back = deps.getChatMessages(step.message_id).find(m => m.message_id === step.message_id)?.message ?? '';
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

// ------------------------------------------------------------
// 崩溃恢复
// ------------------------------------------------------------

/** 检测被中断的提交：现场任何孤立 pending 都是断点 */
export function detectInterruptedCommit(table: LocatorEntry[]): LocatorEntry[] {
  if (!hasOrphanPending(table)) return [];
  return table.filter(e => e.generation === 'pending');
}

/**
 * 只移除一个 pending 块。它仅在事务明确停在第一步、尚未 retire/supersede 时等价于回滚；
 * 后续阶段的完整回滚必须依赖事务日志。覆盖标记在 pending 内，会随块一并抹掉。
 */
export function planRollbackPending(
  messageText: string,
  pendingRaw: string,
  pendingSpan?: [number, number],
): string {
  if (pendingSpan) {
    const [rawStart, end] = pendingSpan;
    if (messageText.slice(rawStart, end) !== pendingRaw) {
      throw new Error('pending 已变化，拒绝按旧位置删除');
    }
    let start = rawStart;
    while (start > 0 && messageText[start - 1] === '\n') start -= 1;
    return (messageText.slice(0, start) + messageText.slice(end)).trimEnd();
  }
  const escaped = pendingRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return messageText.replace(new RegExp(`\\n*${escaped}`), '').trimEnd();
}

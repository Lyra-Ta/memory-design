/**
 * 记忆插件 · 归档会话引擎（架子层大脑）
 * ------------------------------------------------------------
 * 把 core 纯逻辑接上真实酒馆（deps 注入），跑主循环：
 *   刷新 → 收集(范围) → 生成 → 预览/手改/重roll/退出 → 两段提交。
 * 全程**单例锁**：一次只跑一个归档；生成/提交中不许再起新归档。
 *
 * 不含 Vue：纯状态 + 方法，便于脱离酒馆单测。Pinia store 之后把它包成响应式外壳。
 */

import {
  buildLocatorTable,
  collectTargetFlux,
  computeSummaryTriggerState,
  computeTriggerState,
  detectInterruptedCommit,
  executeCommit,
  extractArchiveBlocks,
  hasCoverageMarker,
  liveEntries,
  normalizeN,
  normalizeSummaryInterval,
  parseArchiveBody,
  parseArchiveNodes,
  planCommit,
  planRollbackPending,
  replaceSpanExact,
  serializeArchiveNodes,
  setGeneration,
  stripComments,
  supersedeLastContainer,
  repairArchiveOutput,
  totalLiveSize,
  validateArchive,
  validateSummaryArchive,
  wrapArchive,
  type ArchiveNode,
  type CommitDecision,
  type CommitDeps,
  type CommitPhase,
  type CommitStep,
  type Container,
  type LocatorEntry,
  type LocatedFluxBlock,
  type RetireTarget,
  type SummaryArchiveValidationResult,
  type SummaryTriggerState,
  type TriggerState,
  type ValidationResult,
} from '../core';
import { saveConfig, saveGlobalDefault, type ArchiverConfig } from './config';
import {
  EDITABLE_SUMMARY_PROMPT_IDS,
  EDITABLE_TIMELINE_PROMPT_IDS,
  defaultPromptPreferences,
  savePromptPreferences,
  type PromptPreferences,
} from './prompt-preferences';
import {
  clearCommitLog,
  completeCommitLog,
  createCommitLog,
  loadCommitLog,
  markCommitLogFailed,
  markCommitStepSucceeded,
  saveCommitLog,
  type CommitLog,
} from './commit-log';
import type { ArchiverTavernDeps, GenerateRawResult, RolePrompt, TavernMessage } from './deps';
import {
  assemblePrompt,
  defaultOrchestration,
  promptFingerprint,
  resolveOrchestration,
  type OrchestrationEntry,
} from './orchestration';
import {
  assembleSummaryPrompt,
  defaultSummaryOrchestration,
  makeSummaryOrchestrationOverride,
  resolveSummaryOrchestration,
  summaryPromptFingerprint,
  type SummaryOrchestrationEntry,
  type SummaryPromptId,
  type SummaryRolePrompt,
} from './summary-orchestration';
import { ChatStateReader, type ChatReadSnapshot } from './chat-state';
import type { RegexDepthWindow } from './regex-window';

/** 会话阶段（单例锁的状态） */
export type Phase = 'idle' | 'generating' | 'preview' | 'committing';

/** 单次归档生成的硬超时；超时后主动停止并释放单例锁。 */
export const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
const EDITABLE_TIMELINE_PROMPT_ID_SET = new Set<string>(EDITABLE_TIMELINE_PROMPT_IDS);
const EDITABLE_SUMMARY_PROMPT_ID_SET = new Set<SummaryPromptId>(EDITABLE_SUMMARY_PROMPT_IDS);

/** 用户主动取消；UI 可用 instanceof 将它与真正的 API 失败区分。 */
export class GenerationCancelledError extends Error {
  constructor() {
    super('已取消生成');
    this.name = 'GenerationCancelledError';
  }
}

/** 生成超过硬时限；底层请求也会同时收到 stopGenerationById。 */
export class GenerationTimeoutError extends Error {
  constructor(timeoutMs = GENERATION_TIMEOUT_MS) {
    const duration = timeoutMs === GENERATION_TIMEOUT_MS ? '5 分钟' : `${Math.ceil(timeoutMs / 1000)} 秒`;
    super(`生成超过 ${duration}，已自动取消`);
    this.name = 'GenerationTimeoutError';
  }
}

/** 真切聊天后，旧聊天冻结出的候选/事务必须立即失效。 */
export class ChatChangedDuringOperationError extends Error {
  constructor() {
    super('聊天已切换，已停止旧聊天的操作，未继续写入当前聊天');
    this.name = 'ChatChangedDuringOperationError';
  }
}

type GenerationFallbackPhase = Extract<Phase, 'idle' | 'preview'>;

interface ActiveGeneration {
  id: string;
  token: symbol;
  fallbackPhase: GenerationFallbackPhase;
  abortPromise: Promise<never>;
  rejectAbort: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** 完整性检查结果 */
export interface IntegrityCheck {
  /** 是否有需复原的退役档 */
  needed: boolean;
  /** 最近存活的覆盖标记所在层 X（无则 -1） */
  lastMarkerFloor: number;
  /** X 之后失去新档的退役 old_（建议全部复原） */
  toRestore: LocatorEntry[];
}

/** 一次刷新的只读快照 */
export interface Snapshot {
  table: LocatorEntry[];
  /** 本次刷新前记住的聊天末层；首次运行时为 null */
  previousFloor: number | null;
  /** 当前聊天的真实末层（直接来自 getLastMessageId；不是“最后一份档案所在层”） */
  currentFloor: number;
  /** 最近一份完整 live World Archive 所在层 x（压缩 2 预留）。 */
  latestLiveArchiveFloor: number | null;
  /** 与本次 q / x 同快照的正则窗口；未来压缩 2 直接消费，不重复读聊天。 */
  regexWindow: RegexDepthWindow;
  /** 摘要 → 总结的轻提醒状态（只提醒，不拦手动）。 */
  summaryTrigger: SummaryTriggerState;
  /** 实测 boundary（存活标记端点最大值 / 回退到 config.boundary / 0） */
  boundary: number;
  trigger: TriggerState;
  /** 孤立 pending（两段提交崩溃断点）——非空即需先处理 */
  interrupted: LocatorEntry[];
  /** 最近一笔提交的薄日志：只记楼层与阶段，不记正文。 */
  commitLog: CommitLog | null;
  /** 当前档案总体量 */
  totalLiveSize: number;
  /** 楼层是否比上次记录减少（q<p，删过楼层）——为真则应弹完整性回退、先修再刷 */
  floorsDecreased: boolean;
  /** 完整性检查（marker 丢 → 复原其后的 old_） */
  integrity: IntegrityCheck;
}

/** 收集结果 */
export interface Collected {
  /** 装进 Historical Context 单槽的文本（既存 + 原始） */
  historicalContext: string;
  /** 原始（无 marker 的 flux 扁平待整理档）——要消化进新档并退役 */
  sources: LocatorEntry[];
  /** 既存续写上下文（带 marker、最新的一份时间轴档；同名接续时其末尾容器才会被覆写） */
  continuity: LocatorEntry | null;
}

/** collect 只消费同一时刻的 table + q，禁止在内部偷读新楼层。 */
export interface CollectionSnapshot {
  table: LocatorEntry[];
  currentFloor: number;
}

/** 内存里的候选档（未点确认前零副作用） */
export interface Candidate {
  /** 模型最终正文的原始整段 content（可能含模型写在正文里的 thinking 标签）。 */
  raw: string;
  /** 后端独立返回的 reasoning；不拼进正文，也不参与校验或保存。 */
  reasoning: string;
  /** 本次实际交给 generateRaw 的完整提示词，供调试模式核对。 */
  prompts: RolePrompt[];
  /** 抽出的 <World_Archive> 正文（tag-free）——档案模式看/手改这个 */
  body: string;
  /** 结构校验结果（硬错拦保存 / 软疑给建议） */
  validation: ValidationResult;
  /** 解析出的顶层节点（供预览排版） */
  containers: Container[];
  /** 本次总结到的层（= 覆盖标记端点，取原始源档的最高楼层） */
  through: number;
  /** 本轮重roll 引导 */
  guidance: string;
  /** 范围选择：连续前缀在生成时的楼层列表；核心以最大值作端点，禁止中间挖洞。 */
  selection?: number[];
  /** 原始源档字数（压缩比展示用） */
  sourceChars: number;
  /** 生成时实际读取的来源身份与完整楼层快照；提交前逐项复核，防预览期间错退新内容。 */
  provenance: CandidateProvenance;
}

export interface CandidateArchiveRef {
  messageId: number;
  raw: string;
  span: [number, number];
}

export interface CandidateFloorSnapshot {
  messageId: number;
  message: string;
}

export interface CandidateProvenance {
  /** 生成开始时的聊天世代；真切聊天后旧候选不得再读写。 */
  chatEpoch: number;
  sources: CandidateArchiveRef[];
  continuity: CandidateArchiveRef | null;
  floors: CandidateFloorSnapshot[];
}

/** 一次摘要 → 大总结的冻结输入。重试/重 roll 不重扫聊天，只复用它。 */
export interface SummaryRound {
  id: string;
  /** 本轮创建时的聊天世代；即使拿不到 chat ID，也能拦跨聊天写入。 */
  chatEpoch: number;
  /** 所有完整 <World_Archive>，按楼层/块位置排序。 */
  archiveContext: string;
  /** x < floor <= sourceThrough 的全部 Flux / Causal_Flux。 */
  targetFlux: string;
  archiveFloors: number[];
  fluxFloors: number[];
  latestArchiveFloor: number | null;
  sourceThrough: number;
  placeholderFloor: number;
  sourceChars: number;
  /** 同一轮重试不跟随中途的 API 选择变化。 */
  connectionProfileId: string | null;
  /** 同一轮重试使用开始时的三段提示词快照。 */
  orchestration: SummaryOrchestrationEntry[];
}

export interface SummaryCollected {
  archiveContext: string;
  targetFlux: string;
  archiveFloors: number[];
  fluxes: LocatedFluxBlock[];
  latestArchiveFloor: number | null;
  sourceThrough: number;
  sourceChars: number;
}

/** 普通总结候选：只待写入空白 y，不带覆盖 marker。 */
export interface SummaryCandidate {
  raw: string;
  /** 后端独立返回的 reasoning；只供调试查看。 */
  reasoning: string;
  /** 本次实际交给 generateRaw 的完整提示词，供调试模式核对。 */
  prompts: SummaryRolePrompt[];
  body: string;
  validation: SummaryArchiveValidationResult;
  containers: Container[];
  sourceThrough: number;
  placeholderFloor: number;
  guidance: string;
  sourceChars: number;
  round: SummaryRound;
}

function splitGeneratedResponse(result: GenerateRawResult): { content: string; reasoning: string } {
  return typeof result === 'string'
    ? { content: result, reasoning: '' }
    : { content: result.content, reasoning: result.reasoning };
}

export class ArchiverSession {
  private currentPhase: Phase = 'idle';
  private readonly commitWaiters = new Set<() => void>();
  private activeGeneration: ActiveGeneration | null = null;
  private generationSequence = 0;
  private readonly featureEnablementListeners = new Set<() => void>();
  /** 当前普通总结的冻结来源；首次失败后仍保留，供同一批来源重试。 */
  private summaryRound: SummaryRound | null = null;
  /** 提醒、UI、生成和提交共用的唯一聊天读取层。 */
  readonly chatState: ChatStateReader;
  /** 插件级提示词偏好；只写 global，不随 chat 切换。 */
  public promptPreferences: PromptPreferences = defaultPromptPreferences();

  get phase(): Phase {
    return this.currentPhase;
  }

  private set phase(next: Phase) {
    this.currentPhase = next;
    if (next === 'committing' || this.commitWaiters.size === 0) return;
    const waiters = [...this.commitWaiters];
    this.commitWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  /** 热重载/页面销毁可等待已进入落盘的操作收尾，不在提交时立即返回。 */
  waitForCommitToFinish(): Promise<void> {
    if (this.phase !== 'committing') return Promise.resolve();
    return new Promise<void>(resolve => {
      this.commitWaiters.add(resolve);
    });
  }

  constructor(
    private readonly deps: ArchiverTavernDeps,
    public config: ArchiverConfig,
    /** 第三参数只为可测的短超时留缝；生产默认始终是 5 分钟。 */
    private readonly generationTimeoutMs = GENERATION_TIMEOUT_MS,
    chatState?: ChatStateReader,
  ) {
    this.chatState = chatState ?? new ChatStateReader(deps);
  }

  private assertCurrentChat(expectedEpoch: number): void {
    if (!this.chatState.isCurrentChatEpoch(expectedEpoch)) {
      throw new ChatChangedDuringOperationError();
    }
  }

  /** 两段提交的每次读写都在同步调用点复核聊天世代；写 await 返回后再复核一次。 */
  private guardedCommitDeps(expectedEpoch: number): CommitDeps {
    return {
      getChatMessages: range => {
        this.assertCurrentChat(expectedEpoch);
        return this.deps.getChatMessages(range);
      },
      setChatMessages: async (messages, option) => {
        this.assertCurrentChat(expectedEpoch);
        await this.deps.setChatMessages(messages, option);
        this.assertCurrentChat(expectedEpoch);
      },
    };
  }

  // ---- 刷新（只读，任何时候可调） -------------------------------------------

  refresh(read: ChatReadSnapshot = this.chatState.scanFresh()): Snapshot {
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
      lastDismissedFloor: this.config.lastDismissedFloor,
    });
    const summaryTrigger = computeSummaryTriggerState({
      currentFloor: q,
      latestArchiveFloor: read.latestLiveArchiveFloor,
      interval: this.config.summaryInterval,
      lastRemindedFloor: this.config.summaryLastRemindedFloor,
    });

    // 楼层没减少才接受并持久化新基线；删后先停、先修，别把破损当新常态记下去。
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
      integrity,
    };
  }

  // ---- 完整性回退（marker 丢 → 复原其后的 old_） ---------------------------

  /** 读最近存活的覆盖标记层 X；X 之后的退役 old_ 即失去新档、建议全部复原。 */
  integrityCheck(table: LocatorEntry[]): IntegrityCheck {
    const markerFloors = liveEntries(table)
      .filter(e => e.through !== null)
      .map(e => e.messageId);
    const lastMarkerFloor = markerFloors.length > 0 ? Math.max(...markerFloors) : -1;
    const toRestore = table.filter(e => e.generation === 'old' && e.messageId > lastMarkerFloor);
    return { needed: toRestore.length > 0, lastMarkerFloor, toRestore };
  }

  /** 执行复原：把这些退役 old_ 块改回 live（顺序落盘）。 */
  async integrityRestore(toRestore: LocatorEntry[]): Promise<void> {
    const read = this.chatState.scanFresh();
    const chatEpoch = read.chatEpoch;
    if (detectInterruptedCommit(read.table).length > 0) {
      throw new Error('检测到未完成的归档提交；必须先恢复 pending，不能同时复原退役档');
    }
    const grouped = new Map<number, LocatorEntry[]>();
    for (const e of toRestore) {
      const list = grouped.get(e.messageId) ?? [];
      list.push(e);
      grouped.set(e.messageId, list);
    }
    const byFloor = new Map<number, string>();
    for (const [messageId, entries] of grouped) {
      this.assertCurrentChat(chatEpoch);
      let text = this.readFloorText(messageId);
      for (const e of entries.sort((a, b) => b.span[0] - a.span[0])) {
        text = replaceSpanExact(text, e.span, e.raw, setGeneration(e.raw, 'live'));
      }
      byFloor.set(messageId, text);
    }
    for (const [message_id, message] of byFloor) {
      this.assertCurrentChat(chatEpoch);
      await this.deps.setChatMessages([{ message_id, message }], { refresh: 'none' });
      this.assertCurrentChat(chatEpoch);
      this.chatState.markDirty();
    }
    this.assertCurrentChat(chatEpoch);
    this.config.lastKnownFloor = this.chatState.syncHead().currentFloor; // 修完把 p 重置为当前 q
    this.persist();
  }

  // ---- 收集（纯逻辑，按 marker 分既存/原始） --------------------------------
  //
  // 带覆盖标记的在场档案 = 既存（取最新一份的末尾可见容器作续写上下文）。
  // 不带的 = 原始（flux 扁平待整理），但**只消化楼层 ≤ 当前层−N 的**——最近 N 层留新鲜（= 触发上界）。
  // 显示/喂给模型前统一滤掉注释。

  collect(snapshot: CollectionSnapshot, selection?: number[]): Collected {
    const threshold = snapshot.currentFloor - this.config.n; // 保最近 N 层不动
    const live = liveEntries(snapshot.table);
    let sources = live.filter(e => e.through === null && e.messageId <= threshold);
    if (selection) {
      const endpoint = selection.length > 0 ? Math.max(...selection) : null;
      sources = endpoint === null ? [] : sources.filter(e => e.messageId <= endpoint);
    }
    const continuity =
      live
        .filter(e => e.through !== null)
        .sort((a, b) => (b.through ?? b.messageId) - (a.through ?? a.messageId))[0] ?? null;

    const parts: string[] = [];
    if (continuity) {
      // 发送最新一份既存档的**全部可见容器**（完整续写上下文；例：200/400 各时间轴化过，只发最新的 400、不发 200）。
      // 增量覆写仍只针对其末尾容器——由 NOTE 指示、提交时按「候选首容器与既存末容器同名」判断，二者不冲突。
      parts.push(
        '【既存信息：参考以下信息，确保新的世界存档与此保持连续。】',
        stripComments(continuity.content),
        '既存信息（已归档）读取完毕。继续载入原始记录（待归档）',
      );
    }
    parts.push('【原始记录:对下面的原始记录做归档。】', ...sources.map(s => stripComments(s.content)));

    return { historicalContext: parts.join('\n\n'), sources, continuity };
  }

  /** 最新时间轴档案中最后一个可见《容器》。 */
  private lastVisibleContinuityContainer(entry: LocatorEntry): Container | null {
    const nodes = parseArchiveBody(entry.content);
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].kind === 'container') return nodes[i];
    }
    return null;
  }

  /**
   * 事务/来源校验的单层实时读取。只封装重复 I/O 形状，绝不缓存；
   * 这些 exact read 与 q 快照分属两种安全语义。
   */
  private readFloorText(messageId: number): string {
    return this.deps.getChatMessages(messageId)[0]?.message ?? '';
  }

  private readFloor(messageId: number): TavernMessage | null {
    return this.deps.getChatMessages(messageId).find(message => message.message_id === messageId) ?? null;
  }

  private isBlankAssistant(message: TavernMessage | null): boolean {
    return !!message && message.role === 'assistant' && message.message.trim() === '';
  }

  private clearSummaryPointer(): void {
    this.config.summaryPlaceholderFloor = null;
    this.persist();
  }

  /**
   * 新一轮开始前只处理本插件记住的 y：仍是空白 assistant 才删除；
   * 缺失或已被正文占用时一律不碰，只忘掉旧指针。随后总是在聊天末尾新建 y。
   */
  private async cleanRecordedSummaryPlaceholder(chatEpoch: number): Promise<void> {
    this.assertCurrentChat(chatEpoch);
    const y = this.config.summaryPlaceholderFloor;
    if (y === null) return;
    const message = this.readFloor(y);
    if (this.isBlankAssistant(message)) {
      this.assertCurrentChat(chatEpoch);
      await this.deps.deleteChatMessages([y], { refresh: 'affected' });
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
  collectSummary(read: ChatReadSnapshot): SummaryCollected {
    const archives = liveEntries(read.table).sort(
      (a, b) => a.messageId - b.messageId || a.span[0] - b.span[0],
    );
    const archiveContext = archives.length
      ? archives
          // 楼层只进入 archiveFloors 做内部溯源，不作为提示词文本发送给模型。
          .map(entry => wrapArchive(stripComments(entry.content), 'live'))
          .join('\n\n')
      : '（无既存 World Archive）';
    const fluxes = collectTargetFlux(
      read.messages,
      read.latestLiveArchiveFloor,
      read.currentFloor,
    ).filter(flux => flux.inner.trim().length > 0);
    // 楼层仍保存在 fluxes / fluxFloors 中用于 UI 溯源；模型只需要原始标签块本身。
    const targetFlux = fluxes.map(flux => flux.raw).join('\n\n');
    return {
      archiveContext,
      targetFlux,
      archiveFloors: [...new Set(archives.map(entry => entry.messageId))],
      fluxes,
      latestArchiveFloor: read.latestLiveArchiveFloor,
      sourceThrough: read.currentFloor,
      sourceChars: fluxes.reduce((sum, flux) => sum + flux.raw.length, 0),
    };
  }

  private ensureSummaryPlaceholder(round: SummaryRound): void {
    this.assertCurrentChat(round.chatEpoch);
    const current = this.readFloor(round.placeholderFloor);
    if (this.isBlankAssistant(current)) return;
    if (this.config.summaryPlaceholderFloor === round.placeholderFloor) this.clearSummaryPointer();
    if (this.summaryRound?.id === round.id) this.summaryRound = null;
    if (this.phase === 'preview') this.phase = 'idle';
    throw new Error(`总结写入位层 ${round.placeholderFloor} 已不是空白 assistant，已停止以免覆盖正文`);
  }

  /**
   * 手动开始永远不受间隔阈值拦截。先清理仍空白的旧 y，再以 fresh q 冻结来源、
   * 在末尾创建一个新的空白 assistant，最后才发起独立生成。
   */
  async generateSummary(guidance = ''): Promise<SummaryCandidate> {
    if (this.phase !== 'idle') throw new Error('单例锁：已有归档在进行，请先结束或退出');
    const chatEpoch = this.chatState.currentChatEpoch();
    await this.cleanRecordedSummaryPlaceholder(chatEpoch);
    this.assertCurrentChat(chatEpoch);
    const read = this.chatState.scanFresh();
    if (read.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
    if (detectInterruptedCommit(read.table).length > 0) {
      throw new Error('检测到未完成的归档提交；请先继续提交，再生成普通总结');
    }
    if (this.integrityCheck(read.table).needed) {
      throw new Error('检测到档案完整性缺口；请先复原退役档');
    }
    const collected = this.collectSummary(read);
    if (collected.fluxes.length === 0) throw new Error('最近一份 World Archive 之后没有可总结的 Flux');

    const roundId = `mem-summary-${collected.sourceThrough}-${++this.generationSequence}`;
    this.assertCurrentChat(chatEpoch);
    await this.deps.createChatMessages(
      [{ role: 'assistant', message: '' }],
      { insert_before: 'end', refresh: 'affected' },
    );
    this.assertCurrentChat(chatEpoch);
    this.chatState.markDirty();
    const placeholderFloor = this.chatState.syncHead().currentFloor;
    const placeholder = this.readFloor(placeholderFloor);
    if (!this.isBlankAssistant(placeholder) || placeholderFloor <= collected.sourceThrough) {
      throw new Error('末尾空白写入位创建失败，已停止生成');
    }

    const round: SummaryRound = {
      id: roundId,
      chatEpoch,
      archiveContext: collected.archiveContext,
      targetFlux: collected.targetFlux,
      archiveFloors: collected.archiveFloors,
      fluxFloors: [...new Set(collected.fluxes.map(flux => flux.floor))],
      latestArchiveFloor: collected.latestArchiveFloor,
      sourceThrough: collected.sourceThrough,
      placeholderFloor,
      sourceChars: collected.sourceChars,
      connectionProfileId: this.config.summaryConnectionProfileId,
      orchestration: this.summaryOrchestrationEntries().map(entry => ({ ...entry })),
    };
    this.assertCurrentChat(chatEpoch);
    this.summaryRound = round;
    this.config.summaryPlaceholderFloor = placeholderFloor;
    this.persist();
    return this.runSummaryGenerate(round, guidance, 'idle');
  }

  /** 首次失败/取消/超时后，用同一批冻结来源与同一个 y 重试。 */
  async retrySummary(guidance = ''): Promise<SummaryCandidate> {
    if (this.phase !== 'idle') throw new Error('只能在空闲状态重试普通总结');
    const round = this.summaryRound;
    if (!round) throw new Error('没有可重试的冻结总结来源，请新建一轮');
    this.ensureSummaryPlaceholder(round);
    return this.runSummaryGenerate(round, guidance, 'idle');
  }

  /** 结果页重 roll：来源/y/连接不变，只替换可空 guidance 并重跑整段。 */
  async regenerateSummary(cand: SummaryCandidate, guidance: string): Promise<SummaryCandidate> {
    if (this.phase !== 'preview') throw new Error('重 roll 需在预览态');
    const round = this.summaryRound;
    if (!round || round.id !== cand.round.id) throw new Error('普通总结来源已失效，请新建一轮');
    this.ensureSummaryPlaceholder(round);
    return this.runSummaryGenerate(round, guidance, 'preview');
  }

  private async runSummaryGenerate(
    round: SummaryRound,
    guidance: string,
    fallbackPhase: GenerationFallbackPhase,
  ): Promise<SummaryCandidate> {
    this.assertCurrentChat(round.chatEpoch);
    this.ensureSummaryPlaceholder(round);
    const generationId = `${round.id}-${++this.generationSequence}`;
    const op = this.beginGeneration(generationId, fallbackPhase);
    try {
      const prompts = assembleSummaryPrompt(round.orchestration, {
        archiveContext: round.archiveContext,
        targetFlux: round.targetFlux,
        guidance,
      });
      const generated = splitGeneratedResponse(await Promise.race([
        this.deps.generateRaw({
          ordered_prompts: prompts,
          generation_id: generationId,
          connection_profile_id: round.connectionProfileId ?? undefined,
        }),
        op.abortPromise,
      ]));
      if (this.activeGeneration !== op) throw new GenerationCancelledError();
      this.assertCurrentChat(round.chatEpoch);
      const candidate = this.toSummaryCandidate(
        generated.content,
        generated.reasoning,
        round,
        guidance,
        prompts,
      );
      this.releaseGeneration(op, 'preview');
      return candidate;
    } catch (error) {
      this.releaseGeneration(op, fallbackPhase);
      throw error;
    }
  }

  private toSummaryCandidate(
    raw: string,
    reasoning: string,
    round: SummaryRound,
    guidance: string,
    prompts: SummaryRolePrompt[],
  ): SummaryCandidate {
    const validation = validateSummaryArchive(raw);
    return {
      raw,
      reasoning,
      prompts,
      body: validation.block?.inner ?? '',
      validation,
      containers: validation.nodes,
      sourceThrough: round.sourceThrough,
      placeholderFloor: round.placeholderFloor,
      guidance,
      sourceChars: round.sourceChars,
      round,
    };
  }

  editSummaryCandidate(cand: SummaryCandidate, body: string): SummaryCandidate {
    const wrapped = wrapArchive(body, 'live');
    const oldBlock = cand.validation.block;
    const raw = oldBlock
      ? cand.raw.slice(0, oldBlock.span[0]) + wrapped + cand.raw.slice(oldBlock.span[1])
      : wrapped;
    return this.toSummaryCandidate(raw, cand.reasoning, cand.round, cand.guidance, cand.prompts);
  }

  /** 只有 y 仍是空白 assistant 才写入；正文变化时宁可失败也绝不覆盖。 */
  async applySummary(cand: SummaryCandidate): Promise<number> {
    if (this.phase !== 'preview') throw new Error('应用总结需在预览态');
    if (!cand.validation.ok) throw new Error('硬错未清，拦应用');
    const round = this.summaryRound;
    if (!round || round.id !== cand.round.id) throw new Error('普通总结来源已失效，请新建一轮');
    this.assertCurrentChat(round.chatEpoch);
    this.ensureSummaryPlaceholder(round);
    // 单楼写回同样是不可中断的提交窗口。UI 会在 committing 期间拒绝关闭，避免
    // 用户点“关闭/放弃”之后底层 setChatMessages 仍悄悄完成。
    this.phase = 'committing';
    try {
      this.assertCurrentChat(round.chatEpoch);
      await this.deps.setChatMessages(
        [{ message_id: round.placeholderFloor, message: wrapArchive(cand.body, 'live') }],
        { refresh: 'affected' },
      );
      this.assertCurrentChat(round.chatEpoch);
      this.chatState.markDirty();
      this.summaryRound = null;
      this.config.summaryPlaceholderFloor = null;
      this.config.summaryLastRemindedFloor = null;
      this.assertCurrentChat(round.chatEpoch);
      this.persist();
      this.phase = 'idle';
      return round.placeholderFloor;
    } catch (error) {
      // 写入失败时保留候选、冻结来源和 y，仍可再次应用或同批重生成。
      this.phase = 'preview';
      throw error;
    }
  }

  /** 放弃候选不写 y；空白 y 由下次新建总结时安全清理。 */
  discardSummary(): void {
    this.phase = 'idle';
    this.summaryRound = null;
  }

  summaryRetryAvailable(): boolean {
    return this.phase === 'idle' && this.summaryRound !== null;
  }

  // ---- 生成（单次独立调用，单例锁） ---------------------------------------

  /** 起一次归档生成（要求 idle）。selection 的最大楼层是连续范围端点；省略则走 N 外全部。 */
  async generate(table: LocatorEntry[], guidance = '', selection?: number[]): Promise<Candidate> {
    if (this.phase !== 'idle') throw new Error('单例锁：已有归档在进行，请先结束或退出');
    void table;
    return this.runGenerate(guidance, selection, 'idle');
  }

  /** 重roll：从头整段重跑（要求 preview）。 */
  async regenerate(table: LocatorEntry[], guidance: string, selection?: number[]): Promise<Candidate> {
    if (this.phase !== 'preview') throw new Error('重roll 需在预览态');
    void table;
    // UI 仍保留旧候选；重生成失败/取消/超时都回到 preview。
    return this.runGenerate(guidance, selection, 'preview');
  }

  private beginGeneration(id: string, fallbackPhase: GenerationFallbackPhase): ActiveGeneration {
    let rejectAbort!: (error: Error) => void;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const op: ActiveGeneration = {
      id,
      token: Symbol(id),
      fallbackPhase,
      abortPromise,
      rejectAbort,
      timer: null,
    };
    this.activeGeneration = op;
    this.phase = 'generating';
    op.timer = setTimeout(() => {
      this.abortGeneration(op, new GenerationTimeoutError(this.generationTimeoutMs));
    }, this.generationTimeoutMs);
    return op;
  }

  /**
   * 只中止仍是当前的那次生成。先从 active 摘掉，让旧 Promise 的 catch/finally
   * 无权碰后来发起的新请求；abortPromise 保证即使底层 stop 不 settle，上层也会立即结束。
   */
  private abortGeneration(op: ActiveGeneration, error: GenerationCancelledError | GenerationTimeoutError): void {
    if (this.activeGeneration !== op) return;
    this.activeGeneration = null;
    if (op.timer !== null) clearTimeout(op.timer);
    op.timer = null;
    this.phase = op.fallbackPhase;
    // 先让本插件的 race 以精确原因结束，再通知底层；否则 profile abort
    // 可能抢先抛出模糊的网络错误，使 UI 无法区分“取消”与“失败”。
    op.rejectAbort(error);
    try {
      this.deps.stopGenerationById(op.id);
    } catch {
      // 运行时的 stop 若自身失败，仍必须释放本插件的单例锁并结束 await。
    }
  }

  private releaseGeneration(op: ActiveGeneration, nextPhase: GenerationFallbackPhase): void {
    if (this.activeGeneration !== op) return;
    this.activeGeneration = null;
    if (op.timer !== null) clearTimeout(op.timer);
    op.timer = null;
    this.phase = nextPhase;
  }

  private async runGenerate(
    guidance: string,
    selection: number[] | undefined,
    fallbackPhase: GenerationFallbackPhase,
  ): Promise<Candidate> {
    // 生成开始是一个新的并发边界：取一次 fresh q，并严格用这个 q 建表/收集。
    const read = this.chatState.scanFresh();
    const chatEpoch = read.chatEpoch;
    if (detectInterruptedCommit(read.table).length > 0) {
      throw new Error('检测到未完成的归档提交；为避免叠加写入，已禁止开始新归档');
    }
    if (this.integrityCheck(read.table).needed) {
      throw new Error('检测到档案完整性缺口；请先复原退役档，再开始新归档');
    }
    const { historicalContext, sources, continuity } = this.collect(read, selection);
    if (sources.length === 0) throw new Error('没有可归档的原始档案');
    const provenance = this.captureProvenance(sources, continuity, chatEpoch);
    const through = sources.reduce((m, s) => Math.max(m, s.messageId), 0);
    const sourceChars = sources.reduce((s, e) => s + e.content.length, 0);
    const generationId = `mem-${through}-${++this.generationSequence}`;
    const op = this.beginGeneration(generationId, fallbackPhase);
    try {
      const prompts = assemblePrompt(this.orchestrationEntries(), { historicalContext, guidance });
      const generated = splitGeneratedResponse(await Promise.race([
        this.deps.generateRaw({
          ordered_prompts: prompts,
          generation_id: generationId,
          connection_profile_id: this.config.timelineConnectionProfileId ?? undefined,
        }),
        op.abortPromise,
      ]));
      // cancel/timeout 会先摘掉 op；防御性拦住任何异常的晚返回。
      if (this.activeGeneration !== op) throw new GenerationCancelledError();
      this.assertCurrentChat(chatEpoch);
      const cand = this.toCandidate(
        generated.content,
        generated.reasoning,
        prompts,
        through,
        guidance,
        selection,
        sourceChars,
        provenance,
      );
      this.releaseGeneration(op, 'preview');
      return cand;
    } catch (err) {
      // 若 op 已被取消，它已回到自己的 fallback；不能在此覆盖更新的请求状态。
      this.releaseGeneration(op, fallbackPhase);
      throw err;
    }
  }

  private toCandidate(
    raw: string,
    reasoning: string,
    prompts: RolePrompt[],
    through: number,
    guidance: string,
    selection: number[] | undefined,
    sourceChars: number,
    provenance: CandidateProvenance,
  ): Candidate {
    const validation = validateArchive(raw);
    const body = validation.block?.inner ?? '';
    return {
      raw,
      reasoning,
      prompts,
      body,
      validation,
      containers: validation.containers,
      through,
      guidance,
      selection,
      sourceChars,
      provenance,
    };
  }

  private archiveRef(entry: LocatorEntry): CandidateArchiveRef {
    return { messageId: entry.messageId, raw: entry.raw, span: [entry.span[0], entry.span[1]] };
  }

  private captureProvenance(
    sources: LocatorEntry[],
    continuity: LocatorEntry | null,
    chatEpoch: number,
  ): CandidateProvenance {
    this.assertCurrentChat(chatEpoch);
    const entries = continuity ? [...sources, continuity] : sources;
    const floors = new Map<number, string>();
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
      sources: sources.map(e => this.archiveRef(e)),
      continuity: continuity ? this.archiveRef(continuity) : null,
      floors: [...floors].map(([messageId, message]) => ({ messageId, message })),
    };
  }

  private sameRefs(entries: LocatorEntry[], refs: CandidateArchiveRef[]): boolean {
    if (entries.length !== refs.length) return false;
    return entries.every((entry, i) => {
      const ref = refs[i];
      return (
        entry.messageId === ref.messageId &&
        entry.raw === ref.raw &&
        entry.span[0] === ref.span[0] &&
        entry.span[1] === ref.span[1]
      );
    });
  }

  private assertCandidateProvenance(cand: Candidate, snapshot: CollectionSnapshot): Collected {
    this.assertCurrentChat(cand.provenance.chatEpoch);
    for (const floor of cand.provenance.floors) {
      const current = this.readFloorText(floor.messageId);
      if (current !== floor.message) {
        throw new Error(`层 ${floor.messageId} 的归档在预览期间发生变化，请重新生成`);
      }
    }

    const collected = this.collect(snapshot, cand.selection);
    if (!this.sameRefs(collected.sources, cand.provenance.sources)) {
      throw new Error('归档来源集合在预览期间发生变化，请重新生成');
    }
    const expectedContinuity = cand.provenance.continuity;
    const currentContinuity = collected.continuity;
    if (
      (!!expectedContinuity !== !!currentContinuity) ||
      (expectedContinuity !== null &&
        currentContinuity !== null &&
        !this.sameRefs([currentContinuity], [expectedContinuity]))
    ) {
      throw new Error('既存归档在预览期间发生变化，请重新生成');
    }
    return collected;
  }

  /** 取消生成（防卡壳）。 */
  cancel(): void {
    const op = this.activeGeneration;
    if (op) this.abortGeneration(op, new GenerationCancelledError());
  }

  /** 手改：就地改档案内容（tag-free），重新校验；标签不露、结构不坏。 */
  editCandidate(cand: Candidate, newBody: string): Candidate {
    const wrapped = wrapArchive(newBody, 'live');
    const oldBlock = cand.validation.block;
    const raw = oldBlock
      ? cand.raw.slice(0, oldBlock.span[0]) + wrapped + cand.raw.slice(oldBlock.span[1])
      : wrapped;
    const validation = validateArchive(raw);
    return {
      ...cand,
      raw,
      body: newBody,
      validation,
      containers: validation.containers,
    };
  }

  /** 对模型候选只做机械、无歧义的结构补正；补不了的硬错仍由校验继续拦截。 */
  repairCandidate(cand: Candidate): { candidate: Candidate; fixes: string[] } {
    const repaired = repairArchiveOutput(cand.raw);
    if (!repaired.changed) return { candidate: cand, fixes: [] };
    const next = this.toCandidate(
      repaired.text,
      cand.reasoning,
      cand.prompts,
      cand.through,
      cand.guidance,
      cand.selection,
      cand.sourceChars,
      cand.provenance,
    );
    return { candidate: next, fixes: repaired.fixes };
  }

  /** 退出：弃候选、回 idle，聊天不动。 */
  discard(): void {
    this.phase = 'idle';
  }

  // ---- 就地编辑写回（改已提交的在场档案，无损保住 marker/注释/其余容器） -----

  /**
   * 就地编辑一份在场（live）档案里的某个**可见容器**（按可见顺序 index，从 0 起）。
   * 无损写回：覆盖标记、被增量覆写接管的旧容器、其余容器一律保住；世代仍是 live。
   * newText = 用户改后的**单个容器** canonical 文本（`《…》…` 或旧段 `[…]…`）。
   * 楼层里 <World_Archive> 之外的内容（若有）原样保留。
   */
  async editLiveContainer(messageId: number, expectedRaw: string, index: number, newText: string): Promise<void> {
    const chatEpoch = this.chatState.currentChatEpoch();
    this.assertCurrentChat(chatEpoch);
    const floorText = this.readFloorText(messageId);
    const block = buildLocatorTable([{ message_id: messageId, message: floorText }]).find(e => e.generation === 'live');
    if (!block) throw new Error('该楼层没有在场档案');
    if (block.raw !== expectedRaw) throw new Error('档案在编辑期间已变化，请刷新后重试');

    const nodes = parseArchiveNodes(block.content);
    const containers = nodes.filter((n): n is Extract<ArchiveNode, { type: 'container' }> => n.type === 'container');
    if (index < 0 || index >= containers.length) throw new Error('容器序号越界');

    const parsed = parseArchiveBody(newText);
    if (parsed.length === 0) throw new Error('编辑内容为空或无法识别为容器');
    if (parsed.length > 1) throw new Error('编辑内容必须恰好是一个容器（检测到多个《》/[]）');

    containers[index].container = parsed[0];
    const newInner = serializeArchiveNodes(nodes);
    const rebuilt = replaceSpanExact(floorText, block.span, block.raw, wrapArchive(newInner, 'live'));
    this.assertCurrentChat(chatEpoch);
    await this.deps.setChatMessages([{ message_id: messageId, message: rebuilt }], { refresh: 'none' });
    this.assertCurrentChat(chatEpoch);
    this.chatState.markDirty();
  }

  // ---- 配置持久化（对话进度写 chat；用户设置另同步 global 种子） --------

  /** 把当前 config 落盘到 chat 作用域。 */
  persist(): void {
    saveConfig(this.deps, this.config);
  }

  /** 把当前 config 存为全局默认模板（供之后新对话 seed）。 */
  saveAsGlobalDefault(): void {
    saveGlobalDefault(this.deps, this.config);
  }

  /** 用户明确保存的设置，同时成为今后新对话的全局默认。 */
  private persistUserSetting(): void {
    this.persist();
    this.saveAsGlobalDefault();
  }

  /** 设「保留最近 N 层不总结」（规范化后持久化）。 */
  setN(n: number): void {
    this.config.n = normalizeN(n);
    this.persistUserSetting();
  }

  /** 普通总结的提醒间隔；最小 20，只影响提醒。 */
  setSummaryInterval(value: number): void {
    this.config.summaryInterval = normalizeSummaryInterval(value);
    this.persistUserSetting();
  }

  /** 启停「摘要 → 大总结」后台功能；关闭不影响手动进入与生成。 */
  setSummaryEnabled(enabled: boolean): void {
    if (this.config.summaryEnabled === enabled) return;
    this.config.summaryEnabled = enabled;
    this.persistUserSetting();
    this.notifyFeatureEnablementChanged();
  }

  /** 启停「大总结时间轴化」后台功能；关闭不影响手动进入与生成。 */
  setTimelineEnabled(enabled: boolean): void {
    if (this.config.timelineEnabled === enabled) return;
    this.config.timelineEnabled = enabled;
    this.persistUserSetting();
    this.notifyFeatureEnablementChanged();
  }

  /** 订阅两个启用开关的变化；用于运行时即时启停共享监听与动态正则。 */
  onFeatureEnablementChanged(listener: () => void): () => void {
    this.featureEnablementListeners.add(listener);
    return () => {
      this.featureEnablementListeners.delete(listener);
    };
  }

  private notifyFeatureEnablementChanged(): void {
    for (const listener of this.featureEnablementListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[记忆归档] 功能启用状态回调失败：', error);
      }
    }
  }

  /** 指派大总结时间轴化的 Connection Profile；空 → null（跟随当前连接）。 */
  setTimelineConnectionProfile(id: string | null): void {
    this.config.timelineConnectionProfileId = id?.trim() || null;
    this.persistUserSetting();
  }

  /** 指派摘要 → 大总结的 Connection Profile；空 → null（跟随当前连接）。 */
  setSummaryConnectionProfile(id: string | null): void {
    this.config.summaryConnectionProfileId = id?.trim() || null;
    this.persistUserSetting();
  }

  /** 酒馆 Connection Manager 中可独立请求的连接配置。 */
  connectionProfiles() {
    return this.deps.getConnectionProfiles();
  }

  /** 当前脚本内置提示词叠加插件级 global override 后的有效编排。 */
  orchestrationEntries(): OrchestrationEntry[] {
    return resolveOrchestration(this.promptPreferences.timelineOverrides);
  }

  builtinOrchestrationEntry(id: string): OrchestrationEntry | undefined {
    return defaultOrchestration().find(entry => entry.id === id);
  }

  /** 单模块是否自定义，以及它所基于的内置版之后是否已变化。 */
  orchestrationState(id: string): { customized: boolean; builtinUpdateAvailable: boolean } {
    const override = this.promptPreferences.timelineOverrides[id];
    if (!override) return { customized: false, builtinUpdateAvailable: false };
    const builtin = defaultOrchestration().find(entry => entry.id === id);
    return {
      customized: true,
      builtinUpdateAvailable:
        !!builtin && override.acknowledgedBuiltinHash !== promptFingerprint(builtin.content),
    };
  }

  promptOverrideSummary(): { customized: number; updates: number } {
    const ids = Object.keys(this.promptPreferences.timelineOverrides);
    return {
      customized: ids.length,
      updates: ids.filter(id => this.orchestrationState(id).builtinUpdateAvailable).length,
    };
  }

  private persistPromptPreferences(): void {
    savePromptPreferences(this.deps, this.promptPreferences);
  }

  /** 保存一条全局用户覆盖；保存本身视为已确认当前内置版本。 */
  setOrchestrationOverride(id: string, content: string): void {
    if (!EDITABLE_TIMELINE_PROMPT_ID_SET.has(id)) return;
    const builtin = defaultOrchestration().find(entry => entry.id === id);
    if (!builtin) return;
    if (content === builtin.content) {
      delete this.promptPreferences.timelineOverrides[id];
      this.persistPromptPreferences();
      return;
    }
    this.promptPreferences.timelineOverrides[id] = {
      content,
      acknowledgedBuiltinHash: promptFingerprint(builtin.content),
    };
    this.persistPromptPreferences();
  }

  /** 保留自定义正文，只确认已看过当前内置版本。 */
  acknowledgeOrchestrationBuiltin(id: string): void {
    const override = this.promptPreferences.timelineOverrides[id];
    const builtin = defaultOrchestration().find(entry => entry.id === id);
    if (!override || !builtin) return;
    override.acknowledgedBuiltinHash = promptFingerprint(builtin.content);
    this.persistPromptPreferences();
  }

  resetOrchestrationOverride(id: string): void {
    if (!(id in this.promptPreferences.timelineOverrides)) return;
    delete this.promptPreferences.timelineOverrides[id];
    this.persistPromptPreferences();
  }

  resetAllOrchestrationOverrides(): void {
    if (Object.keys(this.promptPreferences.timelineOverrides).length === 0) return;
    this.promptPreferences.timelineOverrides = {};
    this.persistPromptPreferences();
  }

  /** 兼容旧调用名；实际只写 override，不再改/存整份内置编排。 */
  updateOrchestration(id: string, content: string): void {
    this.setOrchestrationOverride(id, content);
  }

  /** 普通总结的固定三段式编排，叠加插件级 global override。 */
  summaryOrchestrationEntries(): SummaryOrchestrationEntry[] {
    return resolveSummaryOrchestration(this.promptPreferences.summaryOverrides);
  }

  builtinSummaryOrchestrationEntry(id: SummaryPromptId): SummaryOrchestrationEntry | undefined {
    return defaultSummaryOrchestration().find(entry => entry.id === id);
  }

  summaryOrchestrationState(id: SummaryPromptId): {
    customized: boolean;
    builtinUpdateAvailable: boolean;
  } {
    const override = this.promptPreferences.summaryOverrides[id];
    if (!override) return { customized: false, builtinUpdateAvailable: false };
    const builtin = defaultSummaryOrchestration().find(entry => entry.id === id);
    return {
      customized: true,
      builtinUpdateAvailable:
        !!builtin &&
        override.acknowledgedBuiltinHash !== summaryPromptFingerprint(builtin.content),
    };
  }

  summaryPromptOverrideSummary(): { customized: number; updates: number } {
    const ids = Object.keys(this.promptPreferences.summaryOverrides) as SummaryPromptId[];
    return {
      customized: ids.length,
      updates: ids.filter(id => this.summaryOrchestrationState(id).builtinUpdateAvailable).length,
    };
  }

  setSummaryOrchestrationOverride(id: SummaryPromptId, content: string): void {
    if (!EDITABLE_SUMMARY_PROMPT_ID_SET.has(id)) return;
    const builtin = defaultSummaryOrchestration().find(entry => entry.id === id);
    if (!builtin) return;
    if (content === builtin.content) {
      delete this.promptPreferences.summaryOverrides[id];
      this.persistPromptPreferences();
      return;
    }
    this.promptPreferences.summaryOverrides[id] = makeSummaryOrchestrationOverride(content, builtin.content);
    this.persistPromptPreferences();
  }

  acknowledgeSummaryOrchestrationBuiltin(id: SummaryPromptId): void {
    const override = this.promptPreferences.summaryOverrides[id];
    const builtin = defaultSummaryOrchestration().find(entry => entry.id === id);
    if (!override || !builtin) return;
    override.acknowledgedBuiltinHash = summaryPromptFingerprint(builtin.content);
    this.persistPromptPreferences();
  }

  resetSummaryOrchestrationOverride(id: SummaryPromptId): void {
    if (!(id in this.promptPreferences.summaryOverrides)) return;
    delete this.promptPreferences.summaryOverrides[id];
    this.persistPromptPreferences();
  }

  resetAllSummaryOrchestrationOverrides(): void {
    if (Object.keys(this.promptPreferences.summaryOverrides).length === 0) return;
    this.promptPreferences.summaryOverrides = {};
    this.persistPromptPreferences();
  }

  // ---- 提交决策 + 两段提交 -------------------------------------------------

  /**
   * 由候选 + 定位表构建提交决策（按 marker 分既存/原始）：
   *   - 原始（无 marker 源档）整批退役、消化进新档；
   *   - 目标层 = 原始的最高楼层（新档追加其后、同层退旧＋追加）；
   *   - 覆盖标记端点 = 该层（总结到这层），打在新档内部；
   *   - 仅当候选首容器与既存末尾容器标题完全一致时，增量覆写该末尾容器。
   */
  buildCommitDecision(cand: Candidate, snapshot: CollectionSnapshot): CommitDecision {
    if (detectInterruptedCommit(snapshot.table).length > 0) {
      throw new Error('检测到未完成的归档提交；请先恢复现场，不能继续保存');
    }
    if (this.integrityCheck(snapshot.table).needed) {
      throw new Error('检测到档案完整性缺口；请先复原退役档，不能继续保存');
    }
    const { sources, continuity } = this.assertCandidateProvenance(cand, snapshot);
    if (sources.length === 0) throw new Error('提交失败：归档来源为空');
    const target = sources.reduce((m, s) => Math.max(m, s.messageId), 0);
    if (target !== cand.through) throw new Error('提交边界与生成时来源不一致，请重新生成');
    const retire: RetireTarget[] = sources.map(s => ({
      message_id: s.messageId,
      message: this.readFloorText(s.messageId),
      blockRaw: s.raw,
      blockSpan: s.span,
    }));
    const candidateFirst = cand.containers[0];
    const continuityLast = continuity ? this.lastVisibleContinuityContainer(continuity) : null;
    const continuesLastContainer =
      candidateFirst?.kind === 'container' &&
      continuityLast?.kind === 'container' &&
      candidateFirst.title.length > 0 &&
      continuityLast.title.length > 0 &&
      candidateFirst.title === continuityLast.title;
    const supersede: RetireTarget | undefined = continuity && continuesLastContainer
      ? {
          message_id: continuity.messageId,
          message: this.readFloorText(continuity.messageId),
          blockRaw: continuity.raw,
          blockSpan: continuity.span,
        }
      : undefined;
    return {
      targetMessageId: target,
      targetMessageText: this.readFloorText(target),
      pendingBody: cand.body,
      through: cand.through,
      retire,
      supersede,
    };
  }

  /** 两段提交（要求 preview）。跑完 boundary 推进、回 idle。 */
  async commit(cand: Candidate, table: LocatorEntry[]): Promise<void> {
    if (this.phase !== 'preview') throw new Error('提交需在预览态');
    if (!cand.validation.ok) throw new Error('硬错未清，拦保存');
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
      plannedOldFloors: decision.retire.map(item => item.message_id),
      supersedeFloor: decision.supersede?.message_id,
    });
    // 在任何楼层改动之前先记下这笔计划。
    this.assertCurrentChat(chatEpoch);
    saveCommitLog(this.deps, commitLog);
    this.phase = 'committing';
    try {
      await executeCommit(plan, this.guardedCommitDeps(chatEpoch), {
        afterStepVerified: step => {
          this.assertCurrentChat(chatEpoch);
          this.chatState.markDirty();
          commitLog = markCommitStepSucceeded(commitLog, step);
          saveCommitLog(this.deps, commitLog);
        },
      });
      this.finalizeAfterCommit(decision.through, chatEpoch);
      // 边界先落盘，再记“整笔完成”；保留最近一笔便于核对 promoted 楼层。
      commitLog = completeCommitLog(commitLog);
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, commitLog);
      this.phase = 'idle';
    } catch (err) {
      if (this.chatState.isCurrentChatEpoch(chatEpoch)) {
        this.chatState.markDirty();
        try {
          commitLog = markCommitLogFailed(commitLog, err);
          saveCommitLog(this.deps, commitLog);
        } catch {
          // 日志二次写入失败时，不覆盖原始提交错误。
        }
      }
      this.phase = 'idle';
      throw err;
    }
  }

  /** 提交成功收尾：推进 boundary、重置基线与提醒。commit 与 resumeCommit 共用。 */
  private finalizeAfterCommit(through: number, chatEpoch: number): void {
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
  async resumeCommit(): Promise<{ resumed: boolean; steps: number }> {
    if (this.phase !== 'idle') throw new Error('单例锁：请先结束当前归档，再继续未完成的提交');
    const chatEpoch = this.chatState.currentChatEpoch();
    this.assertCurrentChat(chatEpoch);
    const loaded = loadCommitLog(this.deps);
    if (!loaded) throw new Error('没有找到未完成的提交记录');
    if (loaded.status === 'completed') throw new Error('该提交已完成，无需继续');
    let log: CommitLog = loaded;

    const target = log.targetFloor;
    const read = this.chatState.scanFresh();
    if (read.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
    const table = read.table;
    const pending = table.find(e => e.messageId === target && e.generation === 'pending') ?? null;

    // 现场已无 pending：要么尚未起步（清日志），要么已转正（据现场收尾）。
    if (!pending) {
      if (!log.pendingWritten) {
        this.assertCurrentChat(chatEpoch);
        clearCommitLog(this.deps);
        return { resumed: false, steps: 0 };
      }
      const promoted = table.some(
        e => e.messageId === target && e.generation === 'live' && e.through === log.through,
      );
      if (!promoted) {
        throw new Error('现场既无 pending 也无对应在场新档，无法自动继续，请人工核对档案');
      }
      log = this.reconcileCompleted(log, table, null, chatEpoch);
      this.finalizeAfterCommit(log.through, chatEpoch);
      log = completeCommitLog(log);
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, log);
      return { resumed: true, steps: 0 };
    }

    // 现场有 pending：pending 一定已写过（现场即真相）。
    if (!log.pendingWritten) {
      log = this.markStep(log, 'write-pending', target);
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, log);
    }
    const pendingFirst = parseArchiveBody(pending.content).find(c => c.kind === 'container') ?? null;
    const plan = this.planResumeSteps(log, table, pending);

    this.phase = 'committing';
    try {
      await executeCommit(plan, this.guardedCommitDeps(chatEpoch), {
        afterStepVerified: step => {
          this.assertCurrentChat(chatEpoch);
          this.chatState.markDirty();
          log = markCommitStepSucceeded(log, step);
          saveCommitLog(this.deps, log);
        },
      });
      const doneRead = this.chatState.scanFresh();
      if (doneRead.chatEpoch !== chatEpoch) throw new ChatChangedDuringOperationError();
      log = this.reconcileCompleted(log, doneRead.table, pendingFirst, chatEpoch);
      this.finalizeAfterCommit(log.through, chatEpoch);
      log = completeCommitLog(log);
      this.assertCurrentChat(chatEpoch);
      saveCommitLog(this.deps, log);
      this.phase = 'idle';
      return { resumed: true, steps: plan.length };
    } catch (err) {
      if (this.chatState.isCurrentChatEpoch(chatEpoch)) {
        this.chatState.markDirty();
        try {
          log = markCommitLogFailed(log, err);
          saveCommitLog(this.deps, log);
        } catch {
          // 二次写日志失败时不覆盖原始提交错误。
        }
      }
      this.phase = 'idle';
      throw err;
    }
  }

  /** 据薄日志与现场，重建「尚未完成」的提交步骤（幂等：已应用的步骤不会重复）。 */
  private planResumeSteps(log: CommitLog, table: LocatorEntry[], pending: LocatorEntry): CommitStep[] {
    const target = log.targetFloor;
    const steps: CommitStep[] = [];
    const work = new Map<number, string>();
    const floorText = (id: number): string => {
      if (!work.has(id)) work.set(id, this.readFloorText(id));
      return work.get(id)!;
    };

    // ① 退旧：计划退役、且现场仍是 live 的源档。
    // 目标层追加 pending 后源档在定位表里被 pending 遮蔽，故直接对楼层原文取块——
    // 取「最后一个无覆盖标记的 live 块」= 权威源档（避开 thinking 早出的示例、跳过 pending 与既存）。
    const remaining = log.plannedOldFloors.filter(f => !log.oldSucceededFloors.includes(f));
    for (const floor of [...remaining].sort((a, b) => a - b)) {
      const before = floorText(floor);
      const liveSources = extractArchiveBlocks(before).filter(b => b.generation === 'live' && !hasCoverageMarker(b.inner));
      const src = liveSources[liveSources.length - 1];
      if (!src) continue; // 已退役 → 幂等跳过
      const retired = setGeneration(src.raw, 'old');
      const next = replaceSpanExact(before, src.span, src.raw, retired);
      work.set(floor, next);
      steps.push({
        phase: 'retire-old',
        message_id: floor,
        message: next,
        expectedBefore: before,
        note: `继续退役楼层 ${floor} 上的旧档`,
        verify: { includes: [retired], excludes: [] },
      });
    }

    // ② 增量覆写：计划有、未记完成、且末尾容器仍等待接管（已包裹则末尾可见容器标题已不同 → 跳过）。
    if (log.supersede && !log.supersede.done) {
      const superFloor = log.supersede.plannedFloor;
      const cont = table.find(e => e.messageId === superFloor && e.generation === 'live' && e.through !== null);
      const pendingFirst = parseArchiveBody(pending.content).find(c => c.kind === 'container') ?? null;
      const contLast = cont ? this.lastVisibleContinuityContainer(cont) : null;
      const stillPending =
        !!cont &&
        pendingFirst?.kind === 'container' &&
        contLast?.kind === 'container' &&
        pendingFirst.title.length > 0 &&
        contLast.title.length > 0 &&
        pendingFirst.title === contLast.title;
      if (stillPending && cont) {
        const before = floorText(superFloor);
        const superseded = supersedeLastContainer(cont.raw);
        if (superseded === cont.raw) throw new Error(`层 ${superFloor} 的既存档没有可覆写的末尾容器`);
        const next = replaceSpanExact(before, cont.span, cont.raw, superseded);
        work.set(superFloor, next);
        steps.push({
          phase: 'supersede',
          message_id: superFloor,
          message: next,
          expectedBefore: before,
          note: `继续增量覆写既存档末尾容器（层 ${superFloor}）`,
          verify: { includes: ['<!-- 《'], excludes: [] },
        });
      }
    }

    // ③ 转正：现存 pending → live（现场有 pending 必未转正）。退旧改的是更前字节，pending 末尾 lastIndexOf 仍准。
    const beforePromote = floorText(target);
    const liveBlock = setGeneration(pending.raw, 'live');
    const at = beforePromote.lastIndexOf(pending.raw);
    if (at < 0) throw new Error('现场缺少本次 pending，无法转正');
    const afterPromote = beforePromote.slice(0, at) + liveBlock + beforePromote.slice(at + pending.raw.length);
    steps.push({
      phase: 'promote-live',
      message_id: target,
      message: afterPromote,
      expectedBefore: beforePromote,
      note: '继续 pending → live 转正',
      verify: { includes: [liveBlock], excludes: ['<World_Archive_pending>'] },
    });

    return steps;
  }

  /**
   * 续跑后据现场把「因幂等而跳过的步骤」补记进日志，并校验整笔确实完成。
   * 任一计划变更在现场仍未落地即抛错——绝不把半截态记成 completed。
   */
  private reconcileCompleted(
    log: CommitLog,
    table: LocatorEntry[],
    pendingFirst: Container | null,
    chatEpoch: number,
  ): CommitLog {
    this.assertCurrentChat(chatEpoch);
    let next = log;
    if (!next.pendingWritten) next = this.markStep(next, 'write-pending', next.targetFloor);

    for (const floor of next.plannedOldFloors) {
      if (next.oldSucceededFloors.includes(floor)) continue;
      const stillLive = table.some(e => e.messageId === floor && e.generation === 'live' && e.through === null);
      if (stillLive) throw new Error(`楼层 ${floor} 的源档仍未退役，继续提交未完成`);
      next = this.markStep(next, 'retire-old', floor);
    }

    if (next.supersede && !next.supersede.done) {
      const superFloor = next.supersede.plannedFloor;
      const cont = table.find(e => e.messageId === superFloor && e.generation === 'live' && e.through !== null);
      const contLast = cont ? this.lastVisibleContinuityContainer(cont) : null;
      const stillPending =
        !!cont &&
        pendingFirst?.kind === 'container' &&
        contLast?.kind === 'container' &&
        pendingFirst.title.length > 0 &&
        contLast.title.length > 0 &&
        pendingFirst.title === contLast.title;
      if (stillPending) throw new Error('既存档末尾容器仍未接管，继续提交未完成');
      next = this.markStep(next, 'supersede', superFloor);
    }

    if (next.promotedFloor !== next.targetFloor) {
      const hasPending = table.some(e => e.messageId === next.targetFloor && e.generation === 'pending');
      if (hasPending) throw new Error('pending 仍未转正，继续提交未完成');
      next = this.markStep(next, 'promote-live', next.targetFloor);
    }

    this.assertCurrentChat(chatEpoch);
    saveCommitLog(this.deps, next);
    return next;
  }

  /** 把一个「现场已确认应用」的阶段折算进日志（正文无关，只记楼层与阶段）。 */
  private markStep(log: CommitLog, phase: CommitPhase, message_id: number): CommitLog {
    return markCommitStepSucceeded(log, {
      phase,
      message_id,
      message: '',
      expectedBefore: '',
      note: '',
      verify: { includes: [], excludes: [] },
    });
  }

  /** 仅移除 pending；只有确认事务尚未退役/覆写任何旧档时才可把它当完整回滚。 */
  async rollbackPending(entry: LocatorEntry): Promise<void> {
    const chatEpoch = this.chatState.currentChatEpoch();
    this.assertCurrentChat(chatEpoch);
    const text = this.readFloorText(entry.messageId);
    const restored = planRollbackPending(text, entry.raw, entry.span);
    this.assertCurrentChat(chatEpoch);
    await this.deps.setChatMessages([{ message_id: entry.messageId, message: restored }], { refresh: 'none' });
    this.assertCurrentChat(chatEpoch);
    this.chatState.markDirty();
  }
}

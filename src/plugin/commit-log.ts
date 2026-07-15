/**
 * 记忆插件 · pending 提交薄日志
 * ------------------------------------------------------------
 * 只在 chat 变量中保留「最新一笔」提交的小量阶段信息，不保存楼层正文或档案全文。
 * 这里只负责记录与校验日志形状；断点恢复策略由 session/UI 决定。
 */

import type { CommitStep } from '../core/commit';
import type { ArchiverTavernDeps } from './deps';

export const COMMIT_LOG_KEY = 'memoryArchiverCommitTx';
export const COMMIT_LOG_VERSION = 1;

export type CommitLogStatus = 'prepared' | 'committing' | 'failed' | 'completed';

export interface CommitSupersedeLog {
  /** 计划注释覆写旧末容器的楼层。 */
  plannedFloor: number;
  /** 该步已写入且完整读回校验通过。 */
  done: boolean;
}

export interface CommitLog {
  version: typeof COMMIT_LOG_VERSION;
  txId: string;
  targetFloor: number;
  through: number;
  /** 计划退役为 old_ 的楼层（去重、升序）。 */
  plannedOldFloors: number[];
  /** 已完整落盘校验的 old_ 楼层（去重、升序）。 */
  oldSucceededFloors: number[];
  pendingWritten: boolean;
  /** pending 已转正的楼层；未转正为 null。 */
  promotedFloor: number | null;
  supersede: CommitSupersedeLog | null;
  status: CommitLogStatus;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** 最近一次执行失败的简短错误；不存堆栈或正文。 */
  error: string | null;
}

export interface CreateCommitLogInput {
  txId?: string;
  targetFloor: number;
  through: number;
  plannedOldFloors: number[];
  supersedeFloor?: number | null;
}

type CommitLogDeps = Pick<ArchiverTavernDeps, 'getVariables' | 'insertOrAssignVariables'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFloor(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeFloors(floors: number[]): number[] {
  return [...new Set(floors)].sort((a, b) => a - b);
}

function cloneLog(log: CommitLog): CommitLog {
  return {
    ...log,
    plannedOldFloors: [...log.plannedOldFloors],
    oldSucceededFloors: [...log.oldSucceededFloors],
    supersede: log.supersede ? { ...log.supersede } : null,
  };
}

function parseFloorArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.every(isFloor)) return null;
  return normalizeFloors(value);
}

function parseCommitLog(raw: unknown): CommitLog | null {
  if (!isRecord(raw) || raw.version !== COMMIT_LOG_VERSION) return null;
  if (typeof raw.txId !== 'string' || !raw.txId) return null;
  if (!isFloor(raw.targetFloor) || !isFloor(raw.through)) return null;
  const plannedOldFloors = parseFloorArray(raw.plannedOldFloors);
  const oldSucceededFloors = parseFloorArray(raw.oldSucceededFloors);
  if (!plannedOldFloors || !oldSucceededFloors) return null;
  if (!oldSucceededFloors.every(floor => plannedOldFloors.includes(floor))) return null;
  if (typeof raw.pendingWritten !== 'boolean') return null;
  if (raw.promotedFloor !== null && !isFloor(raw.promotedFloor)) return null;
  const statuses: CommitLogStatus[] = ['prepared', 'committing', 'failed', 'completed'];
  if (!statuses.includes(raw.status as CommitLogStatus)) return null;
  if (!isTimestamp(raw.startedAt) || !isTimestamp(raw.updatedAt)) return null;
  if (raw.completedAt !== null && !isTimestamp(raw.completedAt)) return null;
  if (raw.error !== null && typeof raw.error !== 'string') return null;

  let supersede: CommitSupersedeLog | null = null;
  if (raw.supersede !== null) {
    if (!isRecord(raw.supersede)) return null;
    if (!isFloor(raw.supersede.plannedFloor) || typeof raw.supersede.done !== 'boolean') return null;
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
    status: raw.status as CommitLogStatus,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    completedAt: raw.completedAt,
    error: raw.error,
  };
}

/** 创建一笔未写楼层的 prepared 日志。 */
export function createCommitLog(input: CreateCommitLogInput, now = Date.now()): CommitLog {
  if (!isFloor(input.targetFloor) || !isFloor(input.through)) {
    throw new Error('提交日志的目标楼层或覆盖端点无效');
  }
  if (!input.plannedOldFloors.every(isFloor)) throw new Error('提交日志包含无效的退役楼层');
  if (input.supersedeFloor != null && !isFloor(input.supersedeFloor)) {
    throw new Error('提交日志包含无效的增量覆写楼层');
  }
  if (!isTimestamp(now)) throw new Error('提交日志时间戳无效');
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
    supersede: input.supersedeFloor == null
      ? null
      : { plannedFloor: input.supersedeFloor, done: false },
    status: 'prepared',
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
  };
}

/** 读取 chat 中最新一笔有效日志；空值或损坏形状都视为无日志。 */
export function loadCommitLog(deps: CommitLogDeps): CommitLog | null {
  return parseCommitLog(deps.getVariables({ type: 'chat' })[COMMIT_LOG_KEY]);
}

/** 将一笔日志写入 chat；写入副本，避免后续就地修改污染存储。 */
export function saveCommitLog(deps: CommitLogDeps, log: CommitLog): void {
  deps.insertOrAssignVariables({ [COMMIT_LOG_KEY]: cloneLog(log) }, { type: 'chat' });
}

/** 清掉 active 日志。变量 API 没有删键接口，因此用 null 作墓碑。 */
export function clearCommitLog(deps: CommitLogDeps): void {
  deps.insertOrAssignVariables({ [COMMIT_LOG_KEY]: null }, { type: 'chat' });
}

/**
 * 把一个「已完整落盘校验」的 CommitStep 折算进日志。
 * 不接收正文；只记楼层与阶段。
 */
export function markCommitStepSucceeded(log: CommitLog, step: CommitStep, now = Date.now()): CommitLog {
  if (!isTimestamp(now)) throw new Error('提交日志时间戳无效');
  const next = cloneLog(log);
  next.status = 'committing';
  next.updatedAt = now;
  next.completedAt = null;
  next.error = null;

  switch (step.phase) {
    case 'write-pending':
      if (step.message_id !== next.targetFloor) throw new Error('pending 落盘楼层与日志目标不一致');
      next.pendingWritten = true;
      break;
    case 'retire-old':
      if (!next.plannedOldFloors.includes(step.message_id)) {
        throw new Error(`楼层 ${step.message_id} 不在本次计划退役列表中`);
      }
      next.oldSucceededFloors = normalizeFloors([...next.oldSucceededFloors, step.message_id]);
      break;
    case 'supersede':
      if (!next.supersede || next.supersede.plannedFloor !== step.message_id) {
        throw new Error(`楼层 ${step.message_id} 不是本次计划的增量覆写目标`);
      }
      next.supersede.done = true;
      break;
    case 'promote-live':
      if (step.message_id !== next.targetFloor) throw new Error('pending 转正楼层与日志目标不一致');
      if (!next.pendingWritten) throw new Error('pending 尚未记录落盘，不能记录转正');
      next.promotedFloor = step.message_id;
      break;
  }
  return next;
}

/** 记下最近错误；只取 message/String，不保存堆栈。 */
export function markCommitLogFailed(log: CommitLog, error: unknown, now = Date.now()): CommitLog {
  if (!isTimestamp(now)) throw new Error('提交日志时间戳无效');
  const next = cloneLog(log);
  next.status = 'failed';
  next.updatedAt = now;
  next.completedAt = null;
  next.error = error instanceof Error ? error.message : String(error);
  return next;
}

/** 只有计划的每个变更都已记录成功时，才允许标记 completed。 */
export function completeCommitLog(log: CommitLog, now = Date.now()): CommitLog {
  if (!isTimestamp(now)) throw new Error('提交日志时间戳无效');
  const missingOld = log.plannedOldFloors.filter(floor => !log.oldSucceededFloors.includes(floor));
  if (!log.pendingWritten) throw new Error('pending 尚未成功落盘');
  if (missingOld.length) throw new Error(`仍有退役楼层未成功：${missingOld.join('、')}`);
  if (log.supersede && !log.supersede.done) throw new Error('增量覆写尚未成功');
  if (log.promotedFloor !== log.targetFloor) throw new Error('pending 尚未在目标楼层转正');
  const next = cloneLog(log);
  next.status = 'completed';
  next.updatedAt = now;
  next.completedAt = now;
  next.error = null;
  return next;
}


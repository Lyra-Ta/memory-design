/**
 * 记忆插件 · 触发核心（大总结时间轴化）
 * ------------------------------------------------------------
 * 唯一要设的参数是 N（保留最近 N 层不动、保持新鲜）；boundary（上次总结到的层）随提交推进。
 * 其余全是派生，不用另设：
 *   - 提醒时机： 当前层 − boundary ≥ 2N
 *   - 本次范围（机器替你选）： boundary → 当前层 − N
 *   - 没受理： 静默 +50 层再提醒一次，直到处理
 *
 * 例（N=200）：boundary 0 → 玩到 400 提醒 → 总结 0–200 → boundary=200 →
 *              玩到 600 提醒 → 总结 200–400 → boundary=400。
 *              "400 / 600" = 2N 与 boundary+2N，是算出来的，不是第二个设置。
 *
 * 注：功能规格 v0.4 §B 曾写作「当前层 − 上一覆盖标记尾号 ≥ N」；此处以更晚定稿的
 * 《大总结时间轴化_触发与流程》与《设计定稿·关键逻辑锚点》为准，采用 2N 口径。
 */

/** N 的默认值 */
export const DEFAULT_N = 200;
/** N 的硬下限（≥100 才能保住基本连贯性） */
export const MIN_N = 100;
/** 未受理后的静默步长（层） */
export const SNOOZE_STEP = 50;

export interface TriggerParams {
  /** 当前层（= 设计里的「当前层」，本次范围的上界基准） */
  currentFloor: number;
  /** 上次总结到的层，初始 0 */
  boundary: number;
  /** 保留最近 N 层不动 */
  n?: number;
  /**
   * 上次「暂不」时所处的层；用于 +50 静默窗判定。
   * null / undefined 表示没被暂不过。
   */
  lastDismissedFloor?: number | null;
}

/** 本次可总结的层范围 [from, to]（机器算） */
export interface TriggerRange {
  from: number;
  to: number;
}

export interface TriggerState {
  /** N 的生效值 */
  n: number;
  /** 当前层 − boundary */
  gap: number;
  /** gap ≥ 2N：达到「有一整块 N 层可总结」的门槛 */
  eligible: boolean;
  /** eligible 且不在 +50 静默窗内：现在该弹提醒 */
  shouldRemind: boolean;
  /** 本次范围 boundary → 当前层 − N（eligible 时非 null） */
  range: TriggerRange | null;
  /** 可总结层数 = to − from（eligible 时 = gap − N，必 ≥ N） */
  rangeSize: number;
}

/** 归一化 N：非法值回默认；有效数值硬钳制到至少 100。 */
export function normalizeN(n: number | undefined): number {
  if (!Number.isFinite(n)) return DEFAULT_N;
  return Math.max(MIN_N, Math.floor(n as number));
}

/**
 * 根据当前层 / boundary / N 推导触发状态。纯函数、无副作用。
 */
export function computeTriggerState(params: TriggerParams): TriggerState {
  const n = normalizeN(params.n);
  const gap = params.currentFloor - params.boundary;
  const eligible = gap >= 2 * n;

  const range: TriggerRange | null = eligible
    ? { from: params.boundary, to: params.currentFloor - n }
    : null;
  const rangeSize = range ? range.to - range.from : 0;

  const dismissed = params.lastDismissedFloor;
  const inSnoozeWindow =
    dismissed !== null &&
    dismissed !== undefined &&
    params.currentFloor - dismissed < SNOOZE_STEP;

  return {
    n,
    gap,
    eligible,
    shouldRemind: eligible && !inSnoozeWindow,
    range,
    rangeSize,
  };
}

/** 提交某个范围后，新的 boundary = 该范围尾号 */
export function boundaryAfter(range: TriggerRange): number {
  return range.to;
}

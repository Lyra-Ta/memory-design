/** 摘要 / Flux → 普通 World Archive 的轻提醒。 */

export const DEFAULT_SUMMARY_INTERVAL = 50;
export const MIN_SUMMARY_INTERVAL = 20;

export function normalizeSummaryInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SUMMARY_INTERVAL;
  return Math.max(MIN_SUMMARY_INTERVAL, Math.floor(value));
}

export interface SummaryTriggerParams {
  currentFloor: number;
  latestArchiveFloor: number | null;
  interval: number;
  /** 上次成功播出这类提醒时的 q。 */
  lastRemindedFloor: number | null;
}

export interface SummaryTriggerState {
  interval: number;
  distance: number;
  eligible: boolean;
  shouldRemind: boolean;
  nextFloor: number;
}

/**
 * 只负责提醒，不拦截用户手动总结。
 * 忽略后每再增长一个 interval 可重提一次，避免每条消息都播报。
 */
export function computeSummaryTriggerState(params: SummaryTriggerParams): SummaryTriggerState {
  const interval = normalizeSummaryInterval(params.interval);
  const anchor = params.latestArchiveFloor;
  const distance = anchor === null
    ? Math.max(0, params.currentFloor + 1)
    : Math.max(0, params.currentFloor - anchor);
  const eligible = distance >= interval;
  const reminded = params.lastRemindedFloor;
  const reminderWindowPassed = reminded === null || params.currentFloor - reminded >= interval;
  return {
    interval,
    distance,
    eligible,
    shouldRemind: eligible && reminderWindowPassed,
    nextFloor: anchor === null ? interval - 1 : anchor + interval,
  };
}

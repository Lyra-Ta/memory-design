/**
 * 记忆归档 · 轻提醒纯逻辑
 *
 * 消息事件的热路径只传入已缓存的 boundary / N / 暂不楼层，
 * 不扫聊天原文。实际展示 toastr 与持久化由 index.ts 负责。
 */

import { computeTriggerState } from '../core/trigger';
import {
  computeSummaryTriggerState,
  type SummaryTriggerParams,
  type SummaryTriggerState,
} from '../core/summary-trigger';

export const REMINDER_EVENT_FALLBACKS = {
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_SWIPED: 'message_swiped',
  CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_DELETED: 'message_deleted',
} as const;

export type ReminderEventKey = keyof typeof REMINDER_EVENT_FALLBACKS;

export interface ReminderEventNames {
  MESSAGE_SENT: string;
  MESSAGE_RECEIVED: string;
  MESSAGE_UPDATED: string;
  MESSAGE_SWIPED: string;
  CHAT_CHANGED: string;
  MESSAGE_DELETED: string;
}

/** 优先用当前酒馆暴露的事件名；缺失时回退到稳定字面量。 */
export function resolveReminderEventNames(
  eventTypes?: Partial<Record<ReminderEventKey, unknown>> | null,
): ReminderEventNames {
  const value = (key: ReminderEventKey): string => {
    const candidate = eventTypes?.[key];
    return typeof candidate === 'string' && candidate ? candidate : REMINDER_EVENT_FALLBACKS[key];
  };
  return {
    MESSAGE_SENT: value('MESSAGE_SENT'),
    MESSAGE_RECEIVED: value('MESSAGE_RECEIVED'),
    MESSAGE_UPDATED: value('MESSAGE_UPDATED'),
    MESSAGE_SWIPED: value('MESSAGE_SWIPED'),
    CHAT_CHANGED: value('CHAT_CHANGED'),
    MESSAGE_DELETED: value('MESSAGE_DELETED'),
  };
}

export interface ReminderNoticeParams {
  currentFloor: number;
  boundary: number;
  n: number;
  lastDismissedFloor: number | null;
}

export interface ReminderNotice {
  /** 提醒出现时的聊天末层（成功播出后记为“暂不”基点） */
  currentFloor: number;
  /** 本轮默认可归档范围 */
  from: number;
  through: number;
}

/** 计算当前是否应播轻提醒；null 表示未到阈值或仍在 +50 静默窗。 */
export function buildReminderNotice(params: ReminderNoticeParams): ReminderNotice | null {
  const trigger = computeTriggerState(params);
  if (!trigger.shouldRemind || !trigger.range) return null;
  return {
    currentFloor: params.currentFloor,
    from: trigger.range.from,
    through: trigger.range.to,
  };
}

export interface SummaryReminderNotice {
  /** 提醒出现时的聊天末层（成功播出后记为这类提醒的静默基点） */
  currentFloor: number;
  /** 距最近一份 live World Archive 的层数；无档案时从开局计。 */
  distance: number;
}

/**
 * 构建普通总结轻提醒。
 *
 * 权威扫描路径传入 session.refresh 已算好的 trigger；热路径则用缓存 x
 * 就地做纯数学计算，两者都不会读聊天正文。
 */
export function buildSummaryReminderNotice(
  params: SummaryTriggerParams,
  trigger: SummaryTriggerState = computeSummaryTriggerState(params),
): SummaryReminderNotice | null {
  if (!trigger.shouldRemind) return null;
  return {
    currentFloor: params.currentFloor,
    distance: trigger.distance,
  };
}

export interface ReminderDecisionParams {
  timeline: ReminderNoticeParams;
  summary: SummaryTriggerParams;
  /** session.refresh 返回的同快照普通总结触发状态。 */
  summaryTrigger?: SummaryTriggerState;
  /** 对应功能关闭时不产生自动提醒；省略保持旧调用默认开启。 */
  timelineEnabled?: boolean;
  /** 对应功能关闭时不产生自动提醒；省略保持旧调用默认开启。 */
  summaryEnabled?: boolean;
}

export type ReminderDecision =
  | { kind: 'timeline'; notice: ReminderNotice }
  | { kind: 'summary'; notice: SummaryReminderNotice };

/** 同一批次最多播一类：时间轴归档到期时始终优先。 */
export function buildReminderDecision(params: ReminderDecisionParams): ReminderDecision | null {
  const timeline = params.timelineEnabled === false ? null : buildReminderNotice(params.timeline);
  if (timeline) return { kind: 'timeline', notice: timeline };

  const summary = params.summaryEnabled === false
    ? null
    : buildSummaryReminderNotice(params.summary, params.summaryTrigger);
  return summary ? { kind: 'summary', notice: summary } : null;
}

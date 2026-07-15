/**
 * 记忆归档 · 轻提醒纯逻辑
 *
 * 消息事件的热路径只传入已缓存的 boundary / N / 暂不楼层，
 * 不扫聊天原文。实际展示 toastr 与持久化由 index.ts 负责。
 */

import { computeTriggerState } from '../core/trigger';

export const REMINDER_EVENT_FALLBACKS = {
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_DELETED: 'message_deleted',
} as const;

export type ReminderEventKey = keyof typeof REMINDER_EVENT_FALLBACKS;

export interface ReminderEventNames {
  MESSAGE_SENT: string;
  MESSAGE_RECEIVED: string;
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

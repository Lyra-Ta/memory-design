/**
 * 聊天活动的唯一事件入口。
 *
 * sent/received 只合并成一次 head 更新；delete/update/swipe/同聊天 CHAT_CHANGED
 * 合并成一次完整扫描。真切聊天立即让旧状态失效，再交回 index/session 重载配置。
 */

import type { ChatHeadSnapshot, ChatReadSnapshot, ChatStateReader } from './chat-state';
import type { ReminderEventNames } from './reminder';

export interface EventSubscription {
  stop(): void;
}

export type EventRegistrar = (
  eventType: string,
  listener: (...args: unknown[]) => unknown,
) => EventSubscription;

export interface ChatActivityMonitorOptions {
  state: ChatStateReader;
  events: ReminderEventNames;
  eventOn: EventRegistrar;
  initialChatIdentity: string | null;
  getCurrentChatIdentity(): string | null;
  onHeadActivity(head: ChatHeadSnapshot): void;
  onArchiveInvalidated(snapshot: ChatReadSnapshot): void;
  onChatChanged(chatIdentity: string | null): void;
  debounceMs?: number;
}

export interface ChatActivityMonitor {
  destroy(): void;
}

export function bindChatActivityMonitor(options: ChatActivityMonitorOptions): ChatActivityMonitor {
  const debounceMs = options.debounceMs ?? 200;
  let activeChatIdentity = options.initialChatIdentity;
  let headTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const clearHeadTimer = (): void => {
    if (headTimer === null) return;
    clearTimeout(headTimer);
    headTimer = null;
  };
  const clearScanTimer = (): void => {
    if (scanTimer === null) return;
    clearTimeout(scanTimer);
    scanTimer = null;
  };

  const scheduleHead = (): void => {
    if (destroyed || scanTimer !== null) return;
    clearHeadTimer();
    headTimer = setTimeout(() => {
      headTimer = null;
      if (destroyed) return;
      options.onHeadActivity(options.state.syncHead());
    }, debounceMs);
  };

  const scheduleScan = (): void => {
    if (destroyed) return;
    clearHeadTimer();
    clearScanTimer();
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (destroyed) return;
      const head = options.state.syncHead();
      options.onArchiveInvalidated(options.state.scan(head));
    }, debounceMs);
  };

  const subscriptions: EventSubscription[] = [
    options.eventOn(options.events.MESSAGE_SENT, scheduleHead),
    options.eventOn(options.events.MESSAGE_RECEIVED, scheduleHead),
    options.eventOn(options.events.MESSAGE_DELETED, scheduleScan),
    options.eventOn(options.events.MESSAGE_UPDATED, scheduleScan),
    options.eventOn(options.events.MESSAGE_SWIPED, scheduleScan),
    options.eventOn(options.events.CHAT_CHANGED, (chatFileName: unknown) => {
      const eventIdentity =
        typeof chatFileName === 'string' && chatFileName
          ? chatFileName
          : options.getCurrentChatIdentity();
      if (eventIdentity && eventIdentity === activeChatIdentity) {
        // refresh-all / 编辑不一定改变 q，但会让定位表过期。
        options.state.markDirty();
        scheduleScan();
        return;
      }
      activeChatIdentity = eventIdentity;
      clearHeadTimer();
      clearScanTimer();
      // 同步切断旧聊天快照，不能给延迟配置重载留下“新正文 + 旧身份”的窗口。
      options.state.reset(eventIdentity);
      options.onChatChanged(eventIdentity);
    }),
  ];

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      clearHeadTimer();
      clearScanTimer();
      for (const subscription of subscriptions) subscription.stop();
    },
  };
}

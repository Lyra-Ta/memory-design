import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindChatActivityMonitor, type EventRegistrar } from '../src/plugin/chat-events';
import { ChatStateReader } from '../src/plugin/chat-state';
import type { ArchiverTavernDeps, GenerateRawArgs, VarScope } from '../src/plugin/deps';
import { REMINDER_EVENT_FALLBACKS } from '../src/plugin/reminder';

class EventDeps implements ArchiverTavernDeps {
  lastIdReads = 0;
  fullReads = 0;
  getChatMessages() {
    this.fullReads += 1;
    return [];
  }
  async setChatMessages(): Promise<void> {}
  async createChatMessages(): Promise<void> {}
  async deleteChatMessages(): Promise<void> {}
  getLastMessageId(): number {
    this.lastIdReads += 1;
    return 20;
  }
  async generateRaw(_config: GenerateRawArgs): Promise<string> {
    return '';
  }
  stopGenerationById(): boolean {
    return true;
  }
  stopAllGeneration(): boolean {
    return true;
  }
  getVariables(_option: VarScope): Record<string, unknown> {
    return {};
  }
  insertOrAssignVariables(_variables: Record<string, unknown>, _option: VarScope): void {}
  getConnectionProfiles() {
    return [];
  }
}

class EventBus {
  private listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
  readonly on: EventRegistrar = (eventType, listener) => {
    const set = this.listeners.get(eventType) ?? new Set();
    set.add(listener);
    this.listeners.set(eventType, set);
    return { stop: () => set.delete(listener) };
  };

  emit(eventType: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(eventType) ?? []) listener(...args);
  }
}

const waitForTimers = () => new Promise(resolve => setTimeout(resolve, 20));

test('聊天事件：sent/received 同窗只读一次 q，正文失效事件同窗只扫一次', async () => {
  const deps = new EventDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');
  const bus = new EventBus();
  let headCalls = 0;
  let scanCalls = 0;
  let switchCalls = 0;
  const monitor = bindChatActivityMonitor({
    state,
    events: REMINDER_EVENT_FALLBACKS,
    eventOn: bus.on,
    initialChatIdentity: 'chat-a',
    getCurrentChatIdentity: () => 'chat-a',
    onHeadActivity: () => { headCalls += 1; },
    onArchiveInvalidated: () => { scanCalls += 1; },
    onChatChanged: () => { switchCalls += 1; },
    debounceMs: 5,
  });

  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_SENT);
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_RECEIVED);
  await waitForTimers();
  assert.equal(headCalls, 1);
  assert.equal(deps.lastIdReads, 1);
  assert.equal(deps.fullReads, 0);

  deps.lastIdReads = 0;
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_DELETED);
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_UPDATED);
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_SWIPED);
  bus.emit(REMINDER_EVENT_FALLBACKS.CHAT_CHANGED, 'chat-a');
  await waitForTimers();
  assert.equal(scanCalls, 1);
  assert.equal(deps.lastIdReads, 1);
  assert.equal(deps.fullReads, 1);
  assert.equal(switchCalls, 0);

  bus.emit(REMINDER_EVENT_FALLBACKS.CHAT_CHANGED, 'chat-b');
  assert.equal(switchCalls, 1);
  assert.equal(state.peekHead(), null, '真切聊天时应同步让旧 head 失效');
  monitor.destroy();
});

test('聊天事件：destroy 清理延时任务并解绑所有监听', async () => {
  const deps = new EventDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');
  const bus = new EventBus();
  let calls = 0;
  const monitor = bindChatActivityMonitor({
    state,
    events: REMINDER_EVENT_FALLBACKS,
    eventOn: bus.on,
    initialChatIdentity: 'chat-a',
    getCurrentChatIdentity: () => 'chat-a',
    onHeadActivity: () => { calls += 1; },
    onArchiveInvalidated: () => { calls += 1; },
    onChatChanged: () => { calls += 1; },
    debounceMs: 5,
  });

  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_SENT);
  monitor.destroy();
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_DELETED);
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_UPDATED);
  bus.emit(REMINDER_EVENT_FALLBACKS.MESSAGE_SWIPED);
  await waitForTimers();
  assert.equal(calls, 0);
  assert.equal(deps.lastIdReads, 0);
});

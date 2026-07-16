import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatStateReader } from '../src/plugin/chat-state';
import type { ArchiverTavernDeps, GenerateRawArgs, VarScope } from '../src/plugin/deps';

class ReadDeps implements ArchiverTavernDeps {
  currentFloor = 40;
  lastIdReads = 0;
  messageReads: Array<string | number> = [];
  floors = new Map<number, string>([
    [10, '<World_Archive>\n[flux | x | t]\n原始。\n</World_Archive>'],
    [20, '<World_Archive_pending>未完成</World_Archive_pending>'],
    [30, '<World_Archive>\n《时间轴 | t》\n概览。\n<!-- archived: 25 -->\n</World_Archive>'],
  ]);

  getChatMessages(range: string | number) {
    this.messageReads.push(range);
    if (typeof range === 'number') {
      const message = this.floors.get(range);
      return message === undefined ? [] : [{ message_id: range, message }];
    }
    const [from, to] = range.split('-').map(Number);
    return [...this.floors]
      .filter(([id]) => id >= from && id <= to)
      .map(([message_id, message]) => ({ message_id, message }));
  }
  async setChatMessages(): Promise<void> {}
  async createChatMessages(): Promise<void> {}
  async deleteChatMessages(): Promise<void> {}
  getLastMessageId(): number {
    this.lastIdReads += 1;
    return this.currentFloor;
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

test('统一完整扫描：只读一次 q/正文，同表派生 x 与 boundary', () => {
  const deps = new ReadDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');

  const read = state.scanFresh();

  assert.equal(deps.lastIdReads, 1);
  assert.deepEqual(deps.messageReads, ['0-40']);
  assert.equal(read.currentFloor, 40);
  assert.equal(read.latestLiveArchiveFloor, 30, 'x 看最近 live Archive 所在层');
  assert.equal(read.regexWindow.unarchivedDepth, 10, '正则窗口复用同一快照的 q-x');
  assert.equal(read.regexWindow.fluxMaxDepth, 10);
  assert.equal(read.derivedBoundary, 25, 'boundary 看 marker through，不与 x 混用');
  assert.equal(read.table.some(entry => entry.generation === 'pending'), true);
});

test('统一热路径：只更新 q，不读取任何聊天正文', () => {
  const deps = new ReadDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');

  const first = state.syncHead();
  assert.equal(deps.lastIdReads, 1);
  assert.deepEqual(deps.messageReads, []);

  const again = state.syncHead();
  assert.equal(deps.lastIdReads, 2, '每个新事件批次仍取当前 q');
  assert.equal(again.revision, first.revision, 'q 未变时不制造假 revision');

  deps.currentFloor = 41;
  const changed = state.syncHead();
  assert.equal(changed.currentFloor, 41);
  assert.ok(changed.revision > again.revision);
  assert.deepEqual(deps.messageReads, []);
});

test('统一热路径：权威扫描缓存 x，后续只读 q 也会给出同快照正则窗口', () => {
  const deps = new ReadDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');
  state.scanFresh();

  deps.lastIdReads = 0;
  deps.messageReads = [];
  deps.currentFloor = 47;
  const head = state.syncHead();

  assert.equal(deps.lastIdReads, 1);
  assert.deepEqual(deps.messageReads, []);
  assert.equal(head.latestLiveArchiveFloor, 30);
  assert.equal(head.regexWindow.unarchivedDepth, 17);
  assert.equal(head.regexWindow.fluxMaxDepth, 20);
});

test('正文变更：q 不变也可标 dirty；切聊天后拒绝旧快照', () => {
  const deps = new ReadDeps();
  const state = new ChatStateReader(deps);
  state.reset('chat-a');
  const oldHead = state.scanFresh();
  assert.equal(oldHead.latestLiveArchiveFloor, 30);
  state.markDirty();
  assert.ok(state.peekHead()!.revision > oldHead.revision);
  assert.equal(state.peekHead()!.latestLiveArchiveFloor, null);
  assert.ok(
    state.peekHead()!.regexWindow.fluxMaxDepth >= state.peekHead()!.currentFloor + 1,
    '扫描完成前按无 x 扩窗，不能拿可能失效的旧 x 裁剪 Flux',
  );

  state.reset('chat-b');
  assert.throws(() => state.scan(oldHead), /聊天已切换/);
});

test('聊天身份不可得时仍用 epoch 拒绝旧快照', () => {
  const deps = new ReadDeps();
  const state = new ChatStateReader(deps);
  state.reset(null);
  const oldHead = state.scanFresh();

  state.reset(null);

  assert.notEqual(state.currentChatEpoch(), oldHead.chatEpoch);
  assert.throws(() => state.scan(oldHead), /聊天已切换/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectInterruptedCommit,
  executeCommit,
  planCommit,
  planRollbackPending,
  type CommitDecision,
  type CommitDeps,
} from '../src/core/commit';
import { buildLocatorTable, hasOrphanPending, liveEntries, type MessageLike } from '../src/core/locator';

/** 内存 mock 聊天存储 */
class MockStore implements CommitDeps {
  private m = new Map<number, string>();
  constructor(init: Record<number, string>) {
    for (const [k, v] of Object.entries(init)) this.m.set(Number(k), v);
  }
  setChatMessages = async (msgs: Array<{ message_id: number; message: string }>) => {
    for (const x of msgs) this.m.set(x.message_id, x.message);
  };
  getChatMessages = (range: number | string) => {
    const id = Number(range);
    const t = this.m.get(id);
    return t === undefined ? [] : [{ message_id: id, message: t }];
  };
  text(id: number) {
    return this.m.get(id) ?? '';
  }
  all(): MessageLike[] {
    return [...this.m.entries()].map(([message_id, message]) => ({ message_id, message }));
  }
}

function decision(): CommitDecision {
  const message = 'RP100\n<!-- archived: 100 -->\n<World_Archive>旧概览</World_Archive>';
  const blockRaw = '<World_Archive>旧概览</World_Archive>';
  const start = message.indexOf(blockRaw);
  return {
    targetMessageId: 200,
    targetMessageText: 'RP 正文 200',
    pendingBody: '《调查 | 全程》\n新概览',
    through: 200,
    retire: [
      {
        message_id: 100,
        message,
        blockRaw,
        blockSpan: [start, start + blockRaw.length],
      },
    ],
  };
}

test('planCommit：三段有序 write-pending → retire-old → promote-live', () => {
  const plan = planCommit(decision());
  assert.deepEqual(plan.map(s => s.phase), ['write-pending', 'retire-old', 'promote-live']);
});

test('planCommit 前置条件：退役目标是 pending 块则抛错', () => {
  const d = decision();
  d.retire[0].blockRaw = '<World_Archive_pending>x</World_Archive_pending>';
  assert.throws(() => planCommit(d), /pending/);
});

test('同层退旧+追加（大总结时间轴化：尾层 200 原档退役、新档追加）', async () => {
  const store = new MockStore({
    200: 'RP200\n<!-- archived: 100 -->\n<World_Archive>旧概览</World_Archive>',
  });
  const originalBlock = '<World_Archive>旧概览</World_Archive>';
  const originalStart = store.text(200).indexOf(originalBlock);
  const d: CommitDecision = {
    targetMessageId: 200,
    targetMessageText: store.text(200),
    pendingBody: '《合并 | 0-200》\n合并后的时间轴',
    through: 200,
    retire: [
      {
        message_id: 200,
        message: store.text(200),
        blockRaw: originalBlock,
        blockSpan: [originalStart, originalStart + originalBlock.length],
      },
    ],
  };
  await executeCommit(planCommit(d), store);
  const t = store.text(200);
  // 原档退役成 old_
  assert.ok(t.includes('<old_World_Archive>旧概览</old_World_Archive>'));
  // 新档 live 就位
  assert.match(t, /<World_Archive>[\s\S]*合并后的时间轴[\s\S]*<\/World_Archive>/);
  // 无 pending 残留
  assert.ok(!t.includes('<World_Archive_pending>'));
  // 定位表：1 live + 1 old
  const table = buildLocatorTable(store.all());
  assert.equal(liveEntries(table).length, 1);
  assert.equal(table.filter(e => e.generation === 'old').length, 1);
});

test('executeCommit：跑完后 live 就位、旧档退役、无 pending 残留', async () => {
  const store = new MockStore({
    100: 'RP100\n<!-- archived: 100 -->\n<World_Archive>旧概览</World_Archive>',
    200: 'RP 正文 200',
  });
  await executeCommit(planCommit(decision()), store);

  // 目标层：live 档 + 覆盖标记，pending 消失
  assert.match(store.text(200), /<World_Archive>[\s\S]*新概览[\s\S]*<\/World_Archive>/);
  assert.match(store.text(200), /<!-- archived: 200 -->/);
  assert.ok(!store.text(200).includes('<World_Archive_pending>'));

  // 旧档层：退役成 old_，不再是 live
  assert.ok(store.text(100).includes('<old_World_Archive>旧概览</old_World_Archive>'));
  assert.ok(!store.text(100).includes('<World_Archive>'));

  // 定位表复核：1 live + 1 old，无 pending
  const table = buildLocatorTable(store.all());
  assert.equal(liveEntries(table).length, 1);
  assert.equal(table.filter(e => e.generation === 'old').length, 1);
  assert.equal(hasOrphanPending(table), false);
});

test('executeCommit：每步只在完整落盘校验后顺序回调', async () => {
  const store = new MockStore({
    100: 'RP100\n<!-- archived: 100 -->\n<World_Archive>旧概览</World_Archive>',
    200: 'RP 正文 200',
  });
  const seen: Array<[number, string, number, boolean]> = [];
  await executeCommit(planCommit(decision()), store, {
    afterStepVerified: async (step, index) => {
      seen.push([index, step.phase, step.message_id, store.text(step.message_id) === step.message]);
    },
  });
  assert.deepEqual(seen, [
    [0, 'write-pending', 200, true],
    [1, 'retire-old', 100, true],
    [2, 'promote-live', 200, true],
  ]);
});

test('executeCommit：落盘校验失败即抛错（停在断点）', async () => {
  let callbackCount = 0;
  const brokenStore: CommitDeps = {
    setChatMessages: async () => {
      /* 静默丢弃，模拟没写进去 */
    },
    getChatMessages: () => [{ message_id: 200, message: 'RP 正文 200' }],
  };
  await assert.rejects(
    () => executeCommit(planCommit(decision()), brokenStore, {
      afterStepVerified: () => {
        callbackCount += 1;
      },
    }),
    /落盘校验失败/,
  );
  assert.equal(callbackCount, 0, '失败步未通过落盘校验，不得记成功日志');
});

test('executeCommit：规划后楼层被外部改动，写入前拒绝覆盖', async () => {
  const store = new MockStore({ 200: 'RP 正文 200' });
  const plan = planCommit(decision());
  await store.setChatMessages([{ message_id: 200, message: 'RP 正文 200（外部新改）' }]);
  await assert.rejects(() => executeCommit(plan, store), /已被改动/);
  assert.equal(store.text(200), 'RP 正文 200（外部新改）');
});

test('executeCommit：即使关键标签仍在，读回完整正文混写也不能通过', async () => {
  let text = 'RP 正文 200';
  const mixedStore: CommitDeps = {
    setChatMessages: async msgs => {
      text = `${msgs[0].message}\n宿主混入的额外内容`;
    },
    getChatMessages: () => [{ message_id: 200, message: text }],
  };
  await assert.rejects(() => executeCommit(planCommit(decision()), mixedStore), /完整正文与计划不一致/);
});

test('崩溃恢复：只跑到写 pending → 检测到断点 → 回滚抹掉 pending', async () => {
  const store = new MockStore({ 200: 'RP 正文 200' });
  const plan = planCommit(decision());
  // 只执行第一步（写 pending），模拟中途崩溃
  await store.setChatMessages([{ message_id: plan[0].message_id, message: plan[0].message }]);

  const table = buildLocatorTable(store.all());
  const interrupted = detectInterruptedCommit(table);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].generation, 'pending');

  // 回滚：把楼层还原到写 pending 之前
  const restored = planRollbackPending(store.text(200), interrupted[0].raw);
  assert.equal(restored, 'RP 正文 200');
});

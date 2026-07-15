import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CommitPhase, CommitStep } from '../src/core/commit';
import {
  COMMIT_LOG_KEY,
  clearCommitLog,
  completeCommitLog,
  createCommitLog,
  loadCommitLog,
  markCommitLogFailed,
  markCommitStepSucceeded,
  saveCommitLog,
} from '../src/plugin/commit-log';
import type { VarScope } from '../src/plugin/deps';

function mockVarDeps() {
  const store: Record<'chat' | 'global' | 'script', Record<string, unknown>> = {
    chat: {},
    global: {},
    script: {},
  };
  return {
    getVariables: (option: VarScope) => store[option.type],
    insertOrAssignVariables: (variables: Record<string, unknown>, option: VarScope) => {
      store[option.type] = { ...store[option.type], ...variables };
    },
    store,
  };
}

function step(phase: CommitPhase, messageId: number): CommitStep {
  return {
    phase,
    message_id: messageId,
    message: `after-${phase}-${messageId}`,
    expectedBefore: `before-${phase}-${messageId}`,
    note: phase,
    verify: { includes: [], excludes: [] },
  };
}

test('pending 薄日志：只写 chat，楼层去重升序，清除为 null 墓碑', () => {
  const deps = mockVarDeps();
  const log = createCommitLog({
    txId: 'tx-1',
    targetFloor: 300,
    through: 300,
    plannedOldFloors: [200, 100, 200],
    supersedeFloor: 50,
  }, 1_000);

  assert.deepEqual(log.plannedOldFloors, [100, 200]);
  assert.equal(log.status, 'prepared');
  assert.equal(log.pendingWritten, false);
  assert.equal(log.promotedFloor, null);
  assert.deepEqual(log.supersede, { plannedFloor: 50, done: false });

  saveCommitLog(deps, log);
  assert.equal(COMMIT_LOG_KEY in deps.store.global, false);
  assert.deepEqual(loadCommitLog(deps), log);

  // 存储的是副本，调用方后续就地改数组不会污染变量表。
  log.plannedOldFloors.push(999);
  assert.deepEqual(loadCommitLog(deps)?.plannedOldFloors, [100, 200]);

  clearCommitLog(deps);
  assert.equal(deps.store.chat[COMMIT_LOG_KEY], null);
  assert.equal(loadCommitLog(deps), null);
});

test('pending 薄日志：按已验证步骤记 pending、多个 old、supersede 与 promote', () => {
  let log = createCommitLog({
    txId: 'tx-progress',
    targetFloor: 300,
    through: 300,
    plannedOldFloors: [100, 200],
    supersedeFloor: 50,
  }, 1_000);

  log = markCommitStepSucceeded(log, step('write-pending', 300), 1_010);
  assert.equal(log.pendingWritten, true);
  assert.equal(log.status, 'committing');

  log = markCommitStepSucceeded(log, step('retire-old', 200), 1_020);
  log = markCommitStepSucceeded(log, step('retire-old', 100), 1_030);
  log = markCommitStepSucceeded(log, step('retire-old', 200), 1_040);
  assert.deepEqual(log.oldSucceededFloors, [100, 200], '重试同一楼不产生重复记录');

  log = markCommitStepSucceeded(log, step('supersede', 50), 1_050);
  assert.equal(log.supersede?.done, true);
  log = markCommitStepSucceeded(log, step('promote-live', 300), 1_060);
  assert.equal(log.promotedFloor, 300);
  assert.equal(log.status, 'committing', '转正已记录，仍等 session 持久化 boundary 后显式完成');

  log = completeCommitLog(log, 1_070);
  assert.equal(log.status, 'completed');
  assert.equal(log.completedAt, 1_070);
  assert.equal(log.error, null);
});

test('pending 薄日志：未完成所有机械步骤时拒绝标记 completed', () => {
  let log = createCommitLog({
    txId: 'tx-incomplete',
    targetFloor: 300,
    through: 300,
    plannedOldFloors: [100, 200],
    supersedeFloor: 50,
  }, 1_000);
  log = markCommitStepSucceeded(log, step('write-pending', 300), 1_010);
  log = markCommitStepSucceeded(log, step('retire-old', 100), 1_020);
  log = markCommitStepSucceeded(log, step('promote-live', 300), 1_030);
  assert.throws(() => completeCommitLog(log, 1_040), /退役楼层未成功/);

  log = markCommitStepSucceeded(log, step('retire-old', 200), 1_050);
  assert.throws(() => completeCommitLog(log, 1_060), /增量覆写尚未成功/);
});

test('pending 薄日志：拒绝把非计划楼层记为已退役，错误只存 message', () => {
  const log = createCommitLog({
    txId: 'tx-error',
    targetFloor: 300,
    through: 300,
    plannedOldFloors: [100],
  }, 1_000);
  assert.throws(() => markCommitStepSucceeded(log, step('retire-old', 999), 1_010), /不在本次计划/);
  assert.throws(() => markCommitStepSucceeded(log, step('promote-live', 300), 1_010), /pending 尚未记录落盘/);

  const error = new Error('网络断开');
  error.stack = '不应持久的堆栈';
  const failed = markCommitLogFailed(log, error, 1_020);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '网络断开');
  assert.equal(JSON.stringify(failed).includes('不应持久的堆栈'), false);
});

test('pending 薄日志：损坏形状、成功楼层超出计划时按无日志处理', () => {
  const deps = mockVarDeps();
  deps.store.chat[COMMIT_LOG_KEY] = {
    version: 1,
    txId: 'broken',
    targetFloor: 300,
    through: 300,
    plannedOldFloors: [100],
    oldSucceededFloors: [999],
    pendingWritten: true,
    promotedFloor: null,
    supersede: null,
    status: 'failed',
    startedAt: 1,
    updatedAt: 2,
    completedAt: null,
    error: '断点',
  };
  assert.equal(loadCommitLog(deps), null);
});


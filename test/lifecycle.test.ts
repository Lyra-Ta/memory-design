import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bindPanelCaptureSeal,
  claimRuntimeLifecycle,
  PANEL_CAPTURE_EVENT_TYPES,
  type DomListenerTarget,
} from '../src/plugin/lifecycle';

interface ListenerRecord {
  type: string;
  listener: EventListener;
  capture: boolean;
}

function captureOf(options?: boolean | EventListenerOptions): boolean {
  return typeof options === 'boolean' ? options : options?.capture ?? false;
}

class RecordingListenerTarget implements DomListenerTarget {
  readonly added: ListenerRecord[] = [];
  readonly removed: ListenerRecord[] = [];
  private readonly active: ListenerRecord[] = [];

  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const record = { type, listener, capture: captureOf(options) };
    this.added.push(record);
    this.active.push(record);
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture = captureOf(options);
    this.removed.push({ type, listener, capture });
    const index = this.active.findIndex(record =>
      record.type === type && record.listener === listener && record.capture === capture,
    );
    if (index >= 0) this.active.splice(index, 1);
  }

  emit(type: string, event: Event): void {
    for (const record of [...this.active]) {
      if (record.type === type) record.listener(event);
    }
  }
}

function eventWithPath(path: EventTarget[]) {
  let stopped = 0;
  const event = {
    composedPath: () => path,
    stopPropagation: () => { stopped += 1; },
  } as unknown as Event;
  return { event, stopped: () => stopped };
}

test('capture 密封：四种事件精确对称注册/解绑，且解绑幂等', () => {
  const target = new RecordingListenerTarget();
  const root = new EventTarget();
  const unbind = bindPanelCaptureSeal(target, root);

  assert.deepEqual(target.added.map(record => record.type), PANEL_CAPTURE_EVENT_TYPES);
  assert.ok(target.added.every(record => record.capture));

  for (const type of PANEL_CAPTURE_EVENT_TYPES) {
    const inside = eventWithPath([new EventTarget(), root]);
    target.emit(type, inside.event);
    assert.equal(inside.stopped(), 1, `${type} 来自面板时应拦截`);

    const outside = eventWithPath([new EventTarget()]);
    target.emit(type, outside.event);
    assert.equal(outside.stopped(), 0, `${type} 来自面板外时不应拦截`);
  }

  unbind();
  unbind();
  assert.equal(target.removed.length, PANEL_CAPTURE_EVENT_TYPES.length);
  assert.deepEqual(target.removed.map(record => record.type), PANEL_CAPTURE_EVENT_TYPES);
  assert.ok(target.removed.every(record => record.capture));
  for (let index = 0; index < target.added.length; index += 1) {
    assert.equal(target.removed[index].listener, target.added[index].listener);
  }

  const afterUnbind = eventWithPath([root]);
  target.emit('keydown', afterUnbind.event);
  assert.equal(afterUnbind.stopped(), 0);
});

test('全局单例：新 claim 销毁旧实例一次，旧 destroy 不会误删新 owner', async () => {
  const host = {};
  const firstClaim = claimRuntimeLifecycle(host);
  assert.ok(firstClaim);
  await firstClaim.ready;

  let firstCleanupCalls = 0;
  firstClaim.lifecycle.addCleanup('first', () => {
    firstCleanupCalls += 1;
  });

  const secondClaim = claimRuntimeLifecycle(host);
  assert.ok(secondClaim);
  await secondClaim.ready;
  assert.equal(firstCleanupCalls, 1);
  assert.equal(firstClaim.lifecycle.isCurrent(), false);
  assert.equal(secondClaim.lifecycle.isCurrent(), true);

  await firstClaim.lifecycle.destroy();
  assert.equal(firstCleanupCalls, 1, '旧实例重复 destroy 不得重复清理');
  assert.equal(secondClaim.lifecycle.isCurrent(), true, '旧实例不得删除新槽');

  await secondClaim.lifecycle.destroy();
  assert.equal(secondClaim.lifecycle.isCurrent(), false);
});

test('全局单例：提交期拒绝热替换并保留原 owner', async () => {
  const host = {};
  const firstClaim = claimRuntimeLifecycle(host, { canReplace: () => false });
  assert.ok(firstClaim);
  await firstClaim.ready;

  const blocked = claimRuntimeLifecycle(host);
  assert.equal(blocked, null);
  assert.equal(firstClaim.lifecycle.isCurrent(), true);
  await firstClaim.lifecycle.destroy();
});

test('全局单例：三次快速 claim 会透传等待最旧实例的异步尾巴', async () => {
  const host = {};
  const firstClaim = claimRuntimeLifecycle(host);
  assert.ok(firstClaim);
  await firstClaim.ready;

  let releaseOld!: () => void;
  const oldTail = new Promise<void>(resolve => { releaseOld = resolve; });
  firstClaim.lifecycle.addCleanup('old-tail', () => oldTail);

  const secondClaim = claimRuntimeLifecycle(host);
  assert.ok(secondClaim);
  const thirdClaim = claimRuntimeLifecycle(host);
  assert.ok(thirdClaim);

  let thirdReady = false;
  void thirdClaim.ready.then(() => { thirdReady = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(thirdReady, false, '第三次 claim 不得越过第一次的在途清理');

  releaseOld();
  await thirdClaim.ready;
  assert.equal(thirdReady, true);
  assert.equal(secondClaim.lifecycle.isCurrent(), false);
  assert.equal(thirdClaim.lifecycle.isCurrent(), true);
  await thirdClaim.lifecycle.destroy();
});

test('统一 destroy：同步项全部执行、异步尾巴会等待，单项失败不阻断其他清理', async () => {
  const host = {};
  const errors: string[] = [];
  const claim = claimRuntimeLifecycle(host, {
    onCleanupError: label => { errors.push(label); },
  });
  assert.ok(claim);
  await claim.ready;

  const calls: string[] = [];
  let releaseAsync!: () => void;
  const asyncTail = new Promise<void>(resolve => { releaseAsync = resolve; });
  claim.lifecycle.addCleanup('first', () => { calls.push('first'); });
  claim.lifecycle.addCleanup('throws', () => {
    calls.push('throws');
    throw new Error('expected');
  });
  claim.lifecycle.addCleanup('async', () => {
    calls.push('async');
    return asyncTail;
  });

  let finished = false;
  const destroying = claim.lifecycle.destroy().then(() => { finished = true; });
  assert.deepEqual(calls, ['async', 'throws', 'first'], '应逆序且同步启动所有清理');
  assert.deepEqual(errors, ['throws']);
  assert.equal(finished, false);

  releaseAsync();
  await destroying;
  assert.equal(finished, true);

  let lateCleanupCalls = 0;
  claim.lifecycle.addCleanup('late', () => { lateCleanupCalls += 1; });
  assert.equal(lateCleanupCalls, 1, '销毁后迟到的资源应立即自清理');
});

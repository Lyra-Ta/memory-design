import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReminderDecision,
  buildReminderNotice,
  buildSummaryReminderNotice,
  REMINDER_EVENT_FALLBACKS,
  resolveReminderEventNames,
} from '../src/plugin/reminder';

test('轻提醒：未到 2N 不播，刚到 2N 给出默认归档范围', () => {
  assert.equal(
    buildReminderNotice({ currentFloor: 399, boundary: 0, n: 200, lastDismissedFloor: null }),
    null,
  );
  assert.deepEqual(
    buildReminderNotice({ currentFloor: 400, boundary: 0, n: 200, lastDismissedFloor: null }),
    { currentFloor: 400, from: 0, through: 200 },
  );
});

test('轻提醒：成功播出层作为暂不基点，满 +50 才再播', () => {
  assert.equal(
    buildReminderNotice({ currentFloor: 449, boundary: 0, n: 200, lastDismissedFloor: 400 }),
    null,
  );
  assert.deepEqual(
    buildReminderNotice({ currentFloor: 450, boundary: 0, n: 200, lastDismissedFloor: 400 }),
    { currentFloor: 450, from: 0, through: 250 },
  );
});

test('提醒事件名优先读酒馆当前值，缺失则回退稳定字面量', () => {
  const resolved = resolveReminderEventNames({
    MESSAGE_SENT: 'custom_sent',
    MESSAGE_RECEIVED: '',
  });
  assert.deepEqual(resolved, {
    ...REMINDER_EVENT_FALLBACKS,
    MESSAGE_SENT: 'custom_sent',
  });
});

test('普通总结轻提醒：只在间隔到期时返回距离', () => {
  assert.equal(
    buildSummaryReminderNotice({
      currentFloor: 249,
      latestArchiveFloor: 200,
      interval: 50,
      lastRemindedFloor: null,
    }),
    null,
  );
  assert.deepEqual(
    buildSummaryReminderNotice({
      currentFloor: 250,
      latestArchiveFloor: 200,
      interval: 50,
      lastRemindedFloor: null,
    }),
    { currentFloor: 250, distance: 50 },
  );
});

test('普通总结轻提醒：权威扫描路径复用已算好的 summaryTrigger', () => {
  const cachedTrigger = {
    interval: 50,
    distance: 12,
    eligible: false,
    shouldRemind: false,
    nextFloor: 300,
  };
  assert.equal(
    buildSummaryReminderNotice(
      {
        currentFloor: 300,
        latestArchiveFloor: 200,
        interval: 50,
        lastRemindedFloor: null,
      },
      cachedTrigger,
    ),
    null,
  );
});

test('提醒决策：时间轴与普通总结同时到期时只播时间轴', () => {
  assert.deepEqual(
    buildReminderDecision({
      timeline: { currentFloor: 400, boundary: 0, n: 200, lastDismissedFloor: null },
      summary: {
        currentFloor: 400,
        latestArchiveFloor: 300,
        interval: 50,
        lastRemindedFloor: null,
      },
    }),
    { kind: 'timeline', notice: { currentFloor: 400, from: 0, through: 200 } },
  );
});

test('提醒决策：时间轴未触发时才返回普通总结', () => {
  assert.deepEqual(
    buildReminderDecision({
      timeline: { currentFloor: 250, boundary: 0, n: 200, lastDismissedFloor: null },
      summary: {
        currentFloor: 250,
        latestArchiveFloor: 200,
        interval: 50,
        lastRemindedFloor: null,
      },
    }),
    { kind: 'summary', notice: { currentFloor: 250, distance: 50 } },
  );
});

test('提醒决策：只为已启用的功能播出，两个都关时不提醒', () => {
  const due = {
    timeline: { currentFloor: 400, boundary: 0, n: 200, lastDismissedFloor: null },
    summary: {
      currentFloor: 400,
      latestArchiveFloor: 300,
      interval: 50,
      lastRemindedFloor: null,
    },
  };

  assert.deepEqual(
    buildReminderDecision({ ...due, timelineEnabled: false, summaryEnabled: true }),
    { kind: 'summary', notice: { currentFloor: 400, distance: 100 } },
  );
  assert.deepEqual(
    buildReminderDecision({ ...due, timelineEnabled: true, summaryEnabled: false }),
    { kind: 'timeline', notice: { currentFloor: 400, from: 0, through: 200 } },
  );
  assert.equal(
    buildReminderDecision({ ...due, timelineEnabled: false, summaryEnabled: false }),
    null,
  );
});

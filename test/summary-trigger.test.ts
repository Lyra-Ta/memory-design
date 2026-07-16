import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeSummaryTriggerState,
  normalizeSummaryInterval,
} from '../src/core/summary-trigger';

test('摘要转总结间隔：默认 50，硬下限 20', () => {
  assert.equal(normalizeSummaryInterval(undefined), 50);
  assert.equal(normalizeSummaryInterval(1), 20);
  assert.equal(normalizeSummaryInterval(35.9), 35);
});

test('有 x：q-x 到阈值时提醒，不会拦截手动操作', () => {
  assert.equal(computeSummaryTriggerState({
    currentFloor: 149,
    latestArchiveFloor: 100,
    interval: 50,
    lastRemindedFloor: null,
  }).eligible, false);
  const due = computeSummaryTriggerState({
    currentFloor: 150,
    latestArchiveFloor: 100,
    interval: 50,
    lastRemindedFloor: null,
  });
  assert.equal(due.shouldRemind, true);
  assert.equal(due.nextFloor, 150);
});

test('无 x：从第一层起算；忽略后每隔一个 interval 再提醒', () => {
  assert.equal(computeSummaryTriggerState({
    currentFloor: 49,
    latestArchiveFloor: null,
    interval: 50,
    lastRemindedFloor: null,
  }).shouldRemind, true);
  assert.equal(computeSummaryTriggerState({
    currentFloor: 80,
    latestArchiveFloor: null,
    interval: 50,
    lastRemindedFloor: 49,
  }).shouldRemind, false);
  assert.equal(computeSummaryTriggerState({
    currentFloor: 99,
    latestArchiveFloor: null,
    interval: 50,
    lastRemindedFloor: 49,
  }).shouldRemind, true);
});

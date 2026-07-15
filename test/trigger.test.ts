import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundaryAfter, computeTriggerState, normalizeN } from '../src/core/trigger';

test('gap < 2N → 不 eligible、无范围', () => {
  const s = computeTriggerState({ currentFloor: 399, boundary: 0, n: 200 });
  assert.equal(s.eligible, false);
  assert.equal(s.shouldRemind, false);
  assert.equal(s.range, null);
});

test('gap = 2N（worked example：boundary 0, 玩到 400）→ 提醒、总结 0–200', () => {
  const s = computeTriggerState({ currentFloor: 400, boundary: 0, n: 200 });
  assert.equal(s.eligible, true);
  assert.equal(s.shouldRemind, true);
  assert.deepEqual(s.range, { from: 0, to: 200 });
  assert.equal(s.rangeSize, 200);
});

test('worked example：boundary 200, 玩到 600 → 总结 200–400', () => {
  const s = computeTriggerState({ currentFloor: 600, boundary: 200, n: 200 });
  assert.deepEqual(s.range, { from: 200, to: 400 });
  assert.equal(boundaryAfter(s.range!), 400);
});

test('rangeSize 恒 ≥ N', () => {
  const s = computeTriggerState({ currentFloor: 750, boundary: 100, n: 200 });
  assert.ok(s.rangeSize >= 200);
  assert.equal(s.rangeSize, s.gap - s.n);
});

test('+50 静默窗：暂不于 400，未满 +50 不再提醒', () => {
  const s = computeTriggerState({ currentFloor: 430, boundary: 0, n: 200, lastDismissedFloor: 400 });
  assert.equal(s.eligible, true, '仍达到阈值');
  assert.equal(s.shouldRemind, false, '在静默窗内不提醒');
});

test('+50 静默窗：满 50 层后再次提醒', () => {
  const s = computeTriggerState({ currentFloor: 450, boundary: 0, n: 200, lastDismissedFloor: 400 });
  assert.equal(s.shouldRemind, true);
});

test('normalizeN：缺省回默认 200，有限值硬钳制为至少 100', () => {
  assert.equal(normalizeN(undefined), 200);
  assert.equal(normalizeN(Number.NaN), 200);
  assert.equal(normalizeN(0), 100);
  assert.equal(normalizeN(-5), 100);
  assert.equal(normalizeN(1), 100);
  assert.equal(normalizeN(99), 100);
  assert.equal(normalizeN(100), 100);
  assert.equal(normalizeN(150), 150);
});

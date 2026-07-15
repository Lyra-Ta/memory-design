import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReminderNotice,
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

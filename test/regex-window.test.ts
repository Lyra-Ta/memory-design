import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeRegexDepthWindow,
  INITIAL_FLUX_DEPTH,
  RAW_CONTEXT_DEPTH,
  REGEX_DEPTH_STEP,
} from '../src/plugin/regex-window';

test('尚无 x：50 只是初始下限，窗口会随 q 扩大而不漏首次总结前的 Flux', () => {
  const window = computeRegexDepthWindow({ currentFloor: 70, latestArchiveFloor: null });

  assert.deepEqual(window, {
    unarchivedDepth: 71,
    rawMaxDepth: 10,
    fluxMinDepth: 11,
    fluxMaxDepth: 80,
    archiveOnlyMinDepth: 81,
  });
  assert.ok(window.fluxMaxDepth >= window.unarchivedDepth);
});

test('已有 x：W 只依赖 q-x，并按 10 层一档向上取整', () => {
  const window = computeRegexDepthWindow({ currentFloor: 59, latestArchiveFloor: 40 });

  assert.equal(window.unarchivedDepth, 19);
  assert.equal(window.fluxMaxDepth, 20);
  assert.equal(window.archiveOnlyMinDepth, 21);
});

test('q 未越过 x 时仍保留固定的最近 10 层正文窗口', () => {
  const window = computeRegexDepthWindow({ currentFloor: 39, latestArchiveFloor: 40 });

  assert.equal(window.unarchivedDepth, 0);
  assert.equal(window.rawMaxDepth, RAW_CONTEXT_DEPTH);
  assert.equal(window.fluxMinDepth, RAW_CONTEXT_DEPTH + 1);
  assert.equal(window.fluxMaxDepth, RAW_CONTEXT_DEPTH);
  assert.equal(window.archiveOnlyMinDepth, RAW_CONTEXT_DEPTH + 1);
});

test('广泛边界下 W 均覆盖全部未总结 Flux，且只按固定步长变化', () => {
  for (let q = 0; q <= 500; q += 1) {
    for (const x of [null, 0, Math.floor(q / 2), q, q + 1] as const) {
      const window = computeRegexDepthWindow({ currentFloor: q, latestArchiveFloor: x });

      assert.ok(window.fluxMaxDepth >= window.unarchivedDepth, `q=${q}, x=${x}`);
      assert.equal(window.fluxMaxDepth % REGEX_DEPTH_STEP, 0, `q=${q}, x=${x}`);
      assert.equal(window.archiveOnlyMinDepth, window.fluxMaxDepth + 1);
      assert.equal(window.fluxMinDepth, RAW_CONTEXT_DEPTH + 1);
      if (x === null) assert.ok(window.fluxMaxDepth >= INITIAL_FLUX_DEPTH);
    }
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARCHIVE_DEFAULT_MIN_DEPTH,
  ARCHIVE_ONLY_REGEX_ID,
  createRegexDepthController,
  FLUX_DEFAULT_MAX_DEPTH,
  FLUX_WINDOW_REGEX_ID,
} from '../src/plugin/regex-controller';

function regex(
  id: string,
  enabled: boolean,
  minDepth: number | null,
  maxDepth: number | null,
): TavernRuntimeRegex {
  return {
    id,
    enabled,
    min_depth: minDepth,
    max_depth: maxDepth,
    marker: id,
  };
}

test('正则控制器：只改固定 UUID 的深度并保持 enabled 与其他正则不变', async () => {
  const rows = [
    regex(FLUX_WINDOW_REGEX_ID, false, 3, 4),
    regex(ARCHIVE_ONLY_REGEX_ID, true, 5, 6),
    regex('other-regex', false, 7, 8),
  ];
  const originalOther = { ...rows[2] };
  const scopes: TavernRuntimeRegexOption[] = [];
  let writes = 0;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async (updater, option) => {
      writes += 1;
      scopes.push(option);
      return updater(rows);
    },
  });

  controller.request({ fluxMaxDepth: 70 });
  await controller.flush();

  assert.equal(writes, 1);
  assert.deepEqual(scopes, [{ type: 'preset', name: 'in_use' }]);
  assert.deepEqual(
    rows.map(({ id, enabled, min_depth, max_depth }) => ({ id, enabled, min_depth, max_depth })),
    [
      { id: FLUX_WINDOW_REGEX_ID, enabled: false, min_depth: 11, max_depth: 70 },
      { id: ARCHIVE_ONLY_REGEX_ID, enabled: true, min_depth: 71, max_depth: null },
      { id: 'other-regex', enabled: false, min_depth: 7, max_depth: 8 },
    ],
  );
  assert.deepEqual(rows[2], originalOther);
});

test('正则控制器：成功写入后同一深度桶不再调用运行时 API', async () => {
  const rows = [
    regex(FLUX_WINDOW_REGEX_ID, true, null, null),
    regex(ARCHIVE_ONLY_REGEX_ID, true, null, null),
  ];
  let writes = 0;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async (updater) => {
      writes += 1;
      return updater(rows);
    },
  });

  controller.request({ fluxMaxDepth: 50 });
  await controller.flush();
  controller.request({ fluxMaxDepth: 50 });
  controller.request({ fluxMaxDepth: 50 });
  await controller.flush();
  assert.equal(writes, 1);

  controller.request({ fluxMaxDepth: 60 });
  await controller.flush();
  assert.equal(writes, 2);
});

test('正则控制器：恢复默认只改深度，保持 enabled 与其他字段', async () => {
  const rows = [
    regex(FLUX_WINDOW_REGEX_ID, false, 11, 90),
    regex(ARCHIVE_ONLY_REGEX_ID, true, 91, null),
    regex('other-regex', false, 7, 8),
  ];
  const originalOther = { ...rows[2] };
  let writes = 0;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async updater => {
      writes += 1;
      return updater(rows);
    },
  });

  controller.restoreDefault();
  await controller.flush();
  controller.restoreDefault();
  await controller.flush();

  assert.equal(writes, 1, '已经恢复后重复关闭不触发昂贵的正则重载');
  assert.deepEqual(
    rows.map(({ id, enabled, min_depth, max_depth }) => ({ id, enabled, min_depth, max_depth })),
    [
      {
        id: FLUX_WINDOW_REGEX_ID,
        enabled: false,
        min_depth: 11,
        max_depth: FLUX_DEFAULT_MAX_DEPTH,
      },
      {
        id: ARCHIVE_ONLY_REGEX_ID,
        enabled: true,
        min_depth: ARCHIVE_DEFAULT_MIN_DEPTH,
        max_depth: null,
      },
      { id: 'other-regex', enabled: false, min_depth: 7, max_depth: 8 },
    ],
  );
  assert.deepEqual(rows[2], originalOther);
});

test('正则控制器：关闭请求覆盖写入期间尚未开始的动态桶', async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const applied: number[] = [];
  let calls = 0;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async updater => {
      calls += 1;
      const rows = [
        regex(FLUX_WINDOW_REGEX_ID, true, null, null),
        regex(ARCHIVE_ONLY_REGEX_ID, true, null, null),
      ];
      const updated = await updater(rows);
      applied.push(updated[0].max_depth as number);
      if (calls === 1) await firstGate;
      return updated;
    },
  });

  controller.request({ fluxMaxDepth: 80 });
  await Promise.resolve();
  controller.request({ fluxMaxDepth: 60 });
  controller.restoreDefault();
  releaseFirst();
  await controller.flush();

  assert.deepEqual(applied, [80, FLUX_DEFAULT_MAX_DEPTH]);
});

test('正则控制器：写入严格串行，运行中到达的窗口只保留最新桶', async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const applied: number[] = [];
  let calls = 0;
  let active = 0;
  let peakActive = 0;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async (updater) => {
      calls += 1;
      active += 1;
      peakActive = Math.max(peakActive, active);
      const rows = [
        regex(FLUX_WINDOW_REGEX_ID, true, null, null),
        regex(ARCHIVE_ONLY_REGEX_ID, true, null, null),
      ];
      const updated = await updater(rows);
      applied.push(updated[0].max_depth as number);
      if (calls === 1) await firstGate;
      active -= 1;
      return updated;
    },
  });

  controller.request({ fluxMaxDepth: 50 });
  await Promise.resolve();
  controller.request({ fluxMaxDepth: 60 });
  controller.request({ fluxMaxDepth: 80 });
  assert.equal(calls, 1);

  releaseFirst();
  await controller.flush();
  assert.deepEqual(applied, [50, 80]);
  assert.equal(peakActive, 1);
});

test('正则控制器：中间写失败后，回到旧桶的最新请求仍会真实写回', async () => {
  const rows = [
    regex(FLUX_WINDOW_REGEX_ID, true, null, null),
    regex(ARCHIVE_ONLY_REGEX_ID, true, null, null),
  ];
  let releaseFailure!: () => void;
  const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
  const attempted: number[] = [];
  let failNext = false;
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async updater => {
      const updated = await updater(rows);
      attempted.push(updated[0].max_depth as number);
      if (failNext) {
        failNext = false;
        await failureGate;
        throw new Error('uncertain partial write');
      }
      return updated;
    },
    warn: () => {},
  });

  controller.request({ fluxMaxDepth: 50 });
  await controller.flush();
  failNext = true;
  controller.request({ fluxMaxDepth: 60 });
  await Promise.resolve();
  controller.request({ fluxMaxDepth: 50 });
  releaseFailure();
  await controller.flush();

  assert.deepEqual(attempted, [50, 60, 50]);
  assert.equal(rows[0].max_depth, 50);
  assert.equal(rows[1].min_depth, 51);
});

test('正则控制器：缺少固定 UUID 时安全告警且不重复刷同一缺失告警', async () => {
  const rows = [regex(FLUX_WINDOW_REGEX_ID, true, null, null)];
  const warnings: string[] = [];
  const controller = createRegexDepthController({
    updateTavernRegexesWith: async updater => updater(rows),
    warn: message => { warnings.push(message); },
  });

  controller.request({ fluxMaxDepth: 50 });
  await controller.flush();
  controller.request({ fluxMaxDepth: 60 });
  await controller.flush();

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /preset\/in_use/);
  assert.match(warnings[0], new RegExp(ARCHIVE_ONLY_REGEX_ID));
});

test('正则控制器：运行时 API 缺失或拒绝时只告警，不抛出未处理错误', async () => {
  const missingWarnings: string[] = [];
  const missingController = createRegexDepthController({
    warn: message => { missingWarnings.push(message); },
  });
  missingController.request({ fluxMaxDepth: 50 });
  await missingController.flush();
  assert.equal(missingWarnings.length, 1);
  assert.match(missingWarnings[0], /updateTavernRegexesWith/);

  const failureWarnings: Array<{ message: string; error?: unknown }> = [];
  const expected = new Error('runtime failed');
  const failingController = createRegexDepthController({
    updateTavernRegexesWith: async () => { throw expected; },
    warn: (message, error) => { failureWarnings.push({ message, error }); },
  });
  failingController.request({ fluxMaxDepth: 60 });
  await failingController.flush();
  assert.equal(failureWarnings.length, 1);
  assert.match(failureWarnings[0].message, /W=60/);
  assert.equal(failureWarnings[0].error, expected);
});

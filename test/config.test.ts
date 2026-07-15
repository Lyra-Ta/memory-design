import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONFIG_KEY,
  CONFIG_VERSION,
  defaultConfig,
  loadConfig,
  saveConfig,
  saveGlobalDefault,
} from '../src/plugin/config';
import { defaultOrchestration, resolveOrchestration } from '../src/plugin/orchestration';

/** 内存 mock：按作用域存变量 */
function mockVarDeps() {
  const store: Record<string, Record<string, unknown>> = { chat: {}, global: {}, script: {} };
  return {
    getVariables: (opt: { type: string }) => store[opt.type] ?? {},
    insertOrAssignVariables: (vars: Record<string, unknown>, opt: { type: string }) => {
      store[opt.type] = { ...store[opt.type], ...vars };
    },
    store,
  };
}

function storedAt(deps: ReturnType<typeof mockVarDeps>, scope: 'chat' | 'global' = 'chat') {
  return deps.store[scope][CONFIG_KEY] as Record<string, unknown>;
}

function legacyV4() {
  return {
    ...defaultConfig(),
    version: 4,
    orchestration: defaultOrchestration(),
    orchestrationOverrides: undefined,
  };
}

function legacyV2Entries() {
  const current = defaultOrchestration();
  const post = current.find(entry => entry.id === 'post')!;
  const splitAt = post.content.indexOf('\n\n思考完毕后');
  assert.ok(splitAt > 0, '测试夹具能把旧 CoT 与输出段拆开');
  const cot = post.content.slice(0, splitAt);
  const output = post.content.slice(splitAt + 2);
  return [
    ...current.filter(entry => entry.id !== 'post'),
    { id: 'cot', label: '旧 CoT', role: 'system', kind: 'static', content: cot, enabled: true },
    { id: 'output_format', label: '旧输出', role: 'system', kind: 'static', content: output, enabled: true },
  ];
}

test('空环境：种进 chat 的配置不含内置提示词全文', () => {
  const deps = mockVarDeps();
  const cfg = loadConfig(deps);
  assert.equal(cfg.n, defaultConfig().n);
  assert.deepEqual(cfg.orchestrationOverrides, {});
  assert.equal(resolveOrchestration(cfg.orchestrationOverrides).length, 5);
  const saved = storedAt(deps);
  assert.ok(saved);
  assert.equal('orchestration' in saved, false);
  assert.deepEqual(saved.orchestrationOverrides, {});
});

test('chat 已有残缺配置：补默认并精简写回 v5', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = { n: 150 };
  const cfg = loadConfig(deps);
  assert.equal(cfg.version, CONFIG_VERSION);
  assert.equal(cfg.n, 150);
  assert.equal(cfg.connectionProfileId, null);
  assert.equal('orchestration' in storedAt(deps), false);
});

test('旧配置中的 N 低于硬下限时迁移为 100', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = { version: CONFIG_VERSION, n: 50 };
  const cfg = loadConfig(deps);
  assert.equal(cfg.n, 100);
  assert.equal(storedAt(deps).n, 100);
});

test('chat 空、全局有默认：从全局种子并种进 chat', () => {
  const deps = mockVarDeps();
  deps.store.global[CONFIG_KEY] = { ...defaultConfig(), n: 300 };
  const cfg = loadConfig(deps);
  assert.equal(cfg.n, 300);
  assert.equal(storedAt(deps).n, 300);
});

test('旧 global：清空会话状态、迁移自定义，并把 global 本身重写为精简形状', () => {
  const deps = mockVarDeps();
  const polluted = legacyV4();
  polluted.n = 350;
  polluted.connectionProfileId = 'global-profile-id';
  polluted.modelHint = '全局模型提示';
  polluted.orchestration[0] = { ...polluted.orchestration[0], content: '全局自定义提示词' };
  polluted.boundary = 600;
  polluted.lastKnownFloor = 844;
  polluted.lastDismissedFloor = 800;
  deps.store.global[CONFIG_KEY] = polluted;

  const cfg = loadConfig(deps);
  assert.equal(cfg.boundary, 0);
  assert.equal(cfg.lastKnownFloor, null);
  assert.equal(cfg.lastDismissedFloor, null);
  assert.equal(cfg.n, 350);
  assert.equal(cfg.connectionProfileId, 'global-profile-id');
  assert.equal(cfg.modelHint, '全局模型提示');
  assert.equal(cfg.orchestrationOverrides.skeleton?.content, '全局自定义提示词');
  assert.equal(resolveOrchestration(cfg.orchestrationOverrides)[0].content, '全局自定义提示词');

  const globalSaved = storedAt(deps, 'global');
  assert.equal('orchestration' in globalSaved, false);
  assert.equal(globalSaved.boundary, 0);
  assert.equal(globalSaved.lastKnownFloor, null);
});

test('saveConfig 只写 chat 设置与 override，不落内置全文', () => {
  const deps = mockVarDeps();
  const cfg = defaultConfig();
  cfg.connectionProfileId = 'profile-1';
  cfg.orchestrationOverrides.skeleton = { content: '自定义', baseHash: 'old-hash' };
  saveConfig(deps, cfg);
  const saved = storedAt(deps);
  assert.equal(saved.connectionProfileId, 'profile-1');
  assert.equal('orchestration' in saved, false);
  assert.deepEqual((saved.orchestrationOverrides as Record<string, unknown>).skeleton, {
    content: '自定义',
    baseHash: 'old-hash',
  });
});

test('saveGlobalDefault 只保存可继承设置与 override，不保存 chat 进度/内置全文', () => {
  const deps = mockVarDeps();
  const cfg = defaultConfig();
  cfg.n = 250;
  cfg.connectionProfileId = 'profile-1';
  cfg.modelHint = '保留这句';
  cfg.orchestrationOverrides.post = { content: '保留这份自定义后置', baseHash: 'old-post' };
  cfg.boundary = 400;
  cfg.lastKnownFloor = 444;
  cfg.lastDismissedFloor = 420;

  saveGlobalDefault(deps, cfg);

  const saved = storedAt(deps, 'global');
  assert.equal(saved.boundary, 0);
  assert.equal(saved.lastKnownFloor, null);
  assert.equal(saved.lastDismissedFloor, null);
  assert.equal(saved.n, 250);
  assert.equal(saved.connectionProfileId, 'profile-1');
  assert.equal(saved.modelHint, '保留这句');
  assert.equal('orchestration' in saved, false);
  assert.equal(
    ((saved.orchestrationOverrides as Record<string, { content: string }>).post).content,
    '保留这份自定义后置',
  );
});

test('coerce：有限 n 低于硬下限时钳到 100；未知 override 被丢弃', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = {
    version: CONFIG_VERSION,
    n: -5,
    orchestrationOverrides: {
      unknown: { content: '孤儿', baseHash: 'x' },
      skeleton: { content: '合法', baseHash: 'base' },
    },
  };
  const cfg = loadConfig(deps);
  assert.equal(cfg.n, 100);
  assert.deepEqual(Object.keys(cfg.orchestrationOverrides), ['skeleton']);
});

test('v4 全默认副本：迁移后不产生 override，之后自动跟随内置', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = legacyV4();
  const cfg = loadConfig(deps);
  assert.deepEqual(cfg.orchestrationOverrides, {});
  assert.equal('orchestration' in storedAt(deps), false);
});

test('v4 仅真正改过的模块成为 override，空字符串也视为明确自定义', () => {
  const deps = mockVarDeps();
  const old = legacyV4();
  old.orchestration = old.orchestration.map(entry =>
    entry.id === 'skeleton'
      ? { ...entry, content: '用户自定义前置' }
      : entry.id === 'post'
        ? { ...entry, content: '' }
        : entry,
  );
  deps.store.chat[CONFIG_KEY] = old;

  const cfg = loadConfig(deps);
  assert.deepEqual(Object.keys(cfg.orchestrationOverrides).sort(), ['post', 'skeleton']);
  assert.equal(cfg.orchestrationOverrides.skeleton.content, '用户自定义前置');
  assert.equal(cfg.orchestrationOverrides.post.content, '');
  const effective = resolveOrchestration(cfg.orchestrationOverrides);
  assert.equal(effective.find(entry => entry.id === 'skeleton')?.content, '用户自定义前置');
  assert.equal(effective.find(entry => entry.id === 'post')?.content, '');
});

test('v2 全默认六段：cot/output_format 合并后仍识别为旧默认，不锁成 override', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = {
    ...defaultConfig(),
    version: 2,
    orchestration: legacyV2Entries(),
    orchestrationOverrides: undefined,
  };
  const cfg = loadConfig(deps);
  assert.deepEqual(cfg.orchestrationOverrides, {});
});

test('v2 自定义前置和旧后置：合并为 skeleton/post 两个 override', () => {
  const deps = mockVarDeps();
  const entries = legacyV2Entries().map(entry => {
    if (entry.id === 'skeleton') return { ...entry, content: '用户自定义前置' };
    if (entry.id === 'cot') return { ...entry, content: '用户自定义 CoT' };
    if (entry.id === 'output_format') return { ...entry, content: '用户自定义输出' };
    return entry;
  });
  deps.store.chat[CONFIG_KEY] = {
    ...defaultConfig(),
    version: 2,
    orchestration: entries,
    orchestrationOverrides: undefined,
  };

  const cfg = loadConfig(deps);
  assert.equal(cfg.orchestrationOverrides.skeleton.content, '用户自定义前置');
  assert.equal(cfg.orchestrationOverrides.post.content, '用户自定义 CoT\n\n用户自定义输出');
});

test('v2 同时残留 post 与旧两段时，直接 post 优先', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = {
    ...defaultConfig(),
    version: 2,
    orchestration: [
      ...legacyV2Entries(),
      { id: 'post', label: '新后置', role: 'system', kind: 'static', content: '直接 post', enabled: true },
    ],
    orchestrationOverrides: undefined,
  };
  const cfg = loadConfig(deps);
  assert.equal(cfg.orchestrationOverrides.post.content, '直接 post');
});

test('v3 → v5：旧代理选择不冒充 Connection Profile，自定义提示词仍保留', () => {
  const deps = mockVarDeps();
  const old = legacyV4();
  deps.store.chat[CONFIG_KEY] = {
    ...old,
    version: 3,
    connectionProfileId: undefined,
    proxyPreset: '旧代理名',
    orchestration: old.orchestration.map(entry =>
      entry.id === 'skeleton' ? { ...entry, content: '用户自己改过的提示词' } : entry,
    ),
  };

  const cfg = loadConfig(deps);
  assert.equal(cfg.connectionProfileId, null);
  assert.equal(cfg.orchestrationOverrides.skeleton.content, '用户自己改过的提示词');
});

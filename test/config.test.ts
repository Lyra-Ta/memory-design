import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONFIG_KEY,
  CONFIG_VERSION,
  DEFAULT_MODEL_HINT,
  defaultConfig,
  loadConfig,
  saveConfig,
  saveGlobalDefault,
} from '../src/plugin/config';
import {
  PROMPT_PREFERENCES_KEY,
  PROMPT_PREFERENCES_VERSION,
  defaultPromptPreferences,
  loadPromptPreferences,
  savePromptPreferences,
} from '../src/plugin/prompt-preferences';

/** 内存 mock：按作用域存变量。 */
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

function storedConfig(deps: ReturnType<typeof mockVarDeps>, scope: 'chat' | 'global' = 'chat') {
  return deps.store[scope][CONFIG_KEY] as Record<string, unknown>;
}

function storedPrompts(deps: ReturnType<typeof mockVarDeps>) {
  return deps.store.global[PROMPT_PREFERENCES_KEY] as Record<string, unknown>;
}

test('空环境：chat 配置与 global 提示词偏好彼此独立', () => {
  const deps = mockVarDeps();
  const cfg = loadConfig(deps);
  const prompts = loadPromptPreferences(deps);

  assert.equal(cfg.n, defaultConfig().n);
  assert.equal(cfg.timelineEnabled, true);
  assert.equal(cfg.summaryEnabled, true);
  assert.deepEqual(prompts, defaultPromptPreferences());
  assert.ok(storedConfig(deps));
  assert.equal(PROMPT_PREFERENCES_KEY in deps.store.chat, false);
  assert.equal('orchestrationOverrides' in storedConfig(deps), false);
  assert.equal('summaryOrchestrationOverrides' in storedConfig(deps), false);
});

test('chat 已有残缺配置：补默认并精简写回当前版', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = { n: 150 };
  const cfg = loadConfig(deps);

  assert.equal(cfg.version, CONFIG_VERSION);
  assert.equal(cfg.n, 150);
  assert.equal(cfg.timelineConnectionProfileId, null);
  assert.equal(cfg.summaryConnectionProfileId, null);
  assert.equal(cfg.summaryInterval, 50);
  assert.equal(cfg.summaryPlaceholderFloor, null);
  assert.equal(cfg.timelineEnabled, true);
  assert.equal(cfg.summaryEnabled, true);
});

test('v7 → v8：旧连接只归时间轴化，摘要默认跟随当前连接', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = {
    version: 7,
    connectionProfileId: 'timeline-profile',
    modelHint: '任务较复杂，推荐 Gemini 等智商尚可的模型就够。',
  };
  const cfg = loadConfig(deps);

  assert.equal(cfg.timelineConnectionProfileId, 'timeline-profile');
  assert.equal(cfg.summaryConnectionProfileId, null);
  assert.equal(cfg.modelHint, DEFAULT_MODEL_HINT);
  assert.equal('connectionProfileId' in storedConfig(deps), false);
});

test('普通总结配置：间隔、占位和提醒位置仍属于 chat', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = {
    version: CONFIG_VERSION,
    summaryInterval: 3,
    summaryPlaceholderFloor: 88,
    summaryLastRemindedFloor: 77,
    summaryOrchestrationOverrides: { pre: { content: '应忽略', baseHash: 'old' } },
  };
  const cfg = loadConfig(deps);

  assert.equal(cfg.summaryInterval, 20);
  assert.equal(cfg.summaryPlaceholderFloor, 88);
  assert.equal(cfg.summaryLastRemindedFloor, 77);
  assert.equal('summaryOrchestrationOverrides' in storedConfig(deps), false);
});

test('chat 空、全局有通用设置默认：种进 chat，但不夹带提示词', () => {
  const deps = mockVarDeps();
  deps.store.global[CONFIG_KEY] = {
    ...defaultConfig(),
    n: 300,
    orchestrationOverrides: { skeleton: { content: '旧开发数据', baseHash: 'old' } },
  };
  const cfg = loadConfig(deps);

  assert.equal(cfg.n, 300);
  assert.equal(storedConfig(deps).n, 300);
  assert.equal('orchestrationOverrides' in storedConfig(deps), false);
});

test('saveConfig 只写 chat 配置，绝不写两套提示词 override', () => {
  const deps = mockVarDeps();
  const cfg = defaultConfig();
  cfg.timelineConnectionProfileId = 'timeline-profile';
  cfg.summaryConnectionProfileId = 'summary-profile';
  saveConfig(deps, cfg);

  const saved = storedConfig(deps);
  assert.equal(saved.timelineConnectionProfileId, 'timeline-profile');
  assert.equal(saved.summaryConnectionProfileId, 'summary-profile');
  assert.equal('orchestrationOverrides' in saved, false);
  assert.equal('summaryOrchestrationOverrides' in saved, false);
  assert.equal(PROMPT_PREFERENCES_KEY in deps.store.chat, false);
});

test('saveGlobalDefault 保存通用默认但清除 chat 进度', () => {
  const deps = mockVarDeps();
  const cfg = defaultConfig();
  cfg.n = 250;
  cfg.boundary = 400;
  cfg.lastKnownFloor = 444;
  cfg.summaryPlaceholderFloor = 445;
  saveGlobalDefault(deps, cfg);

  const saved = storedConfig(deps, 'global');
  assert.equal(saved.n, 250);
  assert.equal(saved.boundary, 0);
  assert.equal(saved.lastKnownFloor, null);
  assert.equal(saved.summaryPlaceholderFloor, null);
  assert.equal('orchestrationOverrides' in saved, false);
});

test('提示词偏好只从 global 新键读取；未知模块和畸形记录被丢弃', () => {
  const deps = mockVarDeps();
  deps.store.chat[PROMPT_PREFERENCES_KEY] = {
    version: 1,
    timelineOverrides: { skeleton: { content: 'chat 不得生效', acknowledgedBuiltinHash: 'chat' } },
  };
  deps.store.global[PROMPT_PREFERENCES_KEY] = {
    version: PROMPT_PREFERENCES_VERSION,
    timelineOverrides: {
      skeleton: { content: '全局自定义', acknowledgedBuiltinHash: 'known' },
      unknown: { content: '孤儿', acknowledgedBuiltinHash: 'x' },
      post: { content: 42, acknowledgedBuiltinHash: 'bad' },
    },
    summaryOverrides: {
      pre: { content: '总结自定义', acknowledgedBuiltinHash: 'summary' },
      runtime: { content: '运行时槽不可编辑，必须丢弃', acknowledgedBuiltinHash: 'runtime' },
      unknown: { content: '孤儿', acknowledgedBuiltinHash: 'x' },
    },
  };

  const prefs = loadPromptPreferences(deps);
  assert.equal(prefs.version, PROMPT_PREFERENCES_VERSION);
  assert.deepEqual(Object.keys(prefs.timelineOverrides), ['skeleton']);
  assert.equal(prefs.timelineOverrides.skeleton.content, '全局自定义');
  assert.deepEqual(Object.keys(prefs.summaryOverrides), ['pre']);
});

test('提示词偏好不猜测迁移：未知 schema 版本从空偏好开始', () => {
  const deps = mockVarDeps();
  deps.store.global[PROMPT_PREFERENCES_KEY] = {
    version: 999,
    timelineOverrides: {
      skeleton: { content: '未来格式不得误读', acknowledgedBuiltinHash: 'future' },
    },
  };

  assert.deepEqual(loadPromptPreferences(deps), defaultPromptPreferences());
});

test('切换 chat 配置不会切换或重写插件级提示词偏好', () => {
  const deps = mockVarDeps();
  const prefs = defaultPromptPreferences();
  prefs.timelineOverrides.skeleton = {
    content: '所有聊天共用的前置提示词',
    acknowledgedBuiltinHash: 'same-global-hash',
  };
  savePromptPreferences(deps, prefs);

  deps.store.chat[CONFIG_KEY] = { ...defaultConfig(), n: 150 };
  const first = loadPromptPreferences(deps);
  deps.store.chat[CONFIG_KEY] = { ...defaultConfig(), n: 350 };
  const second = loadPromptPreferences(deps);

  assert.deepEqual(second, first);
  assert.equal(second.timelineOverrides.skeleton.content, '所有聊天共用的前置提示词');
  assert.equal(PROMPT_PREFERENCES_KEY in deps.store.chat, false);
});

test('savePromptPreferences 只覆盖 global 新键，不触碰 chat 配置', () => {
  const deps = mockVarDeps();
  deps.store.chat[CONFIG_KEY] = { ...defaultConfig(), boundary: 123 };
  const prefs = defaultPromptPreferences();
  prefs.timelineOverrides.skeleton = {
    content: '自定义时间轴提示词',
    acknowledgedBuiltinHash: 'timeline-hash',
  };
  prefs.summaryOverrides.post = {
    content: '自定义总结提示词',
    acknowledgedBuiltinHash: 'summary-hash',
  };
  savePromptPreferences(deps, prefs);

  assert.equal(storedConfig(deps).boundary, 123);
  assert.equal(PROMPT_PREFERENCES_KEY in deps.store.chat, false);
  assert.equal(storedPrompts(deps).version, PROMPT_PREFERENCES_VERSION);
  assert.equal(
    (storedPrompts(deps).timelineOverrides as Record<string, { content: string }>).skeleton.content,
    '自定义时间轴提示词',
  );
});

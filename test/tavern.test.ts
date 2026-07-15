import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { createTavernDeps } from '../src/plugin/tavern';

function mockGlobal(t: TestContext, key: string, value: unknown): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const existed = Object.prototype.hasOwnProperty.call(globals, key);
  const previous = globals[key];
  globals[key] = value;
  t.after(() => {
    if (existed) globals[key] = previous;
    else delete globals[key];
  });
}

test('Connection Profiles：只向 UI 暴露安全摘要，并用 profile 服务独立生成', async t => {
  let nativeCalls = 0;
  let request:
    | {
        profileId: string;
        maxTokens: number;
        signal: AbortSignal;
      }
    | undefined;
  const fullProfile = {
    id: 'profile-1',
    name: '归档专用',
    api: 'openai',
    model: 'gemini-test',
    preset: '归档采样',
    'api-url': 'https://sensitive.example',
    'secret-id': 'secret-reference',
  };

  mockGlobal(t, 'SillyTavern', {
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [fullProfile],
      getProfile: () => fullProfile,
      sendRequest: async (
        profileId: string,
        _prompts: unknown,
        maxTokens: number,
        options: { signal: AbortSignal },
      ) => {
        request = { profileId, maxTokens, signal: options.signal };
        return { content: '连接配置生成结果' };
      },
    },
  });
  mockGlobal(t, 'getPreset', () => ({ settings: { max_completion_tokens: 12000 } }));
  mockGlobal(t, 'generateRaw', async () => {
    nativeCalls += 1;
    return '不应调用';
  });
  mockGlobal(t, 'stopGenerationById', () => false);
  mockGlobal(t, 'stopAllGeneration', () => false);

  const deps = createTavernDeps();
  assert.deepEqual(deps.getConnectionProfiles(), [
    { id: 'profile-1', name: '归档专用', api: 'openai', model: 'gemini-test' },
  ]);

  const out = await deps.generateRaw({
    ordered_prompts: [{ role: 'system', content: '归档' }],
    generation_id: 'profile-generation',
    connection_profile_id: 'profile-1',
  });
  assert.equal(out, '连接配置生成结果');
  assert.equal(nativeCalls, 0);
  assert.equal(request?.profileId, 'profile-1');
  assert.equal(request?.maxTokens, 12000);
  assert.equal(request?.signal.aborted, false);
});

test('未选择 Connection Profile：仍走 generateRaw，内部字段不会透传', async t => {
  let received: Record<string, unknown> | undefined;
  mockGlobal(t, 'SillyTavern', {});
  mockGlobal(t, 'generateRaw', async (config: Record<string, unknown>) => {
    received = config;
    return '当前连接结果';
  });
  mockGlobal(t, 'stopGenerationById', () => false);
  mockGlobal(t, 'stopAllGeneration', () => false);

  const deps = createTavernDeps();
  const out = await deps.generateRaw({ ordered_prompts: [{ role: 'user', content: '归档' }] });
  assert.equal(out, '当前连接结果');
  assert.equal('connection_profile_id' in (received ?? {}), false);
});

test('Connection Profile 请求可由原有 generation_id 取消', async t => {
  mockGlobal(t, 'SillyTavern', {
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [{ id: 'profile-1', name: '归档专用' }],
      getProfile: () => ({ id: 'profile-1', name: '归档专用' }),
      sendRequest: async (
        _profileId: string,
        _prompts: unknown,
        _maxTokens: number,
        options: { signal: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('profile request aborted')), { once: true });
        }),
    },
  });
  mockGlobal(t, 'generateRaw', async () => '不应调用');
  mockGlobal(t, 'stopGenerationById', () => false);
  mockGlobal(t, 'stopAllGeneration', () => false);

  const deps = createTavernDeps();
  const pending = deps.generateRaw({
    ordered_prompts: [{ role: 'system', content: '归档' }],
    generation_id: 'cancel-me',
    connection_profile_id: 'profile-1',
  });
  await Promise.resolve();
  assert.equal(deps.stopGenerationById('cancel-me'), true);
  await assert.rejects(pending, /profile request aborted/);
});

test('Connection Profile 复用同一 ID：旧请求 finally 不会删掉新 controller', async t => {
  const signals: AbortSignal[] = [];
  mockGlobal(t, 'SillyTavern', {
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [{ id: 'profile-1', name: '归档专用' }],
      getProfile: () => ({ id: 'profile-1', name: '归档专用' }),
      sendRequest: async (
        _profileId: string,
        _prompts: unknown,
        _maxTokens: number,
        options: { signal: AbortSignal },
      ) => {
        signals.push(options.signal);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error(`request ${signals.length} aborted`)), {
            once: true,
          });
        });
      },
    },
  });
  mockGlobal(t, 'generateRaw', async () => '不应调用');
  mockGlobal(t, 'stopGenerationById', () => false);
  mockGlobal(t, 'stopAllGeneration', () => false);

  const deps = createTavernDeps();
  const args = {
    ordered_prompts: [{ role: 'system' as const, content: '归档' }],
    generation_id: 'reused-id',
    connection_profile_id: 'profile-1',
  };
  const first = deps.generateRaw(args);
  const second = deps.generateRaw(args); // 启动时会中止 first，并在 map 中放入新 controller

  await assert.rejects(first, /aborted/);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal(deps.stopGenerationById('reused-id'), true, '旧 finally 后仍应找到新 controller');
  await assert.rejects(second, /aborted/);
  assert.equal(signals[1].aborted, true);
});

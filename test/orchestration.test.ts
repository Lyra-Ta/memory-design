import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assemblePrompt,
  defaultOrchestration,
  promptFingerprint,
  resolveOrchestration,
} from '../src/plugin/orchestration';

test('默认编排：后置思考要求与输出指令合并成一条', () => {
  const entries = defaultOrchestration();
  const ids = entries.map(e => e.id);
  assert.deepEqual(ids, ['skeleton', 'historical_context', 'note', 'guidance', 'post']);
  assert.ok(entries.every(entry => entry.role === 'system'), '时间轴化默认编排不得包含 user / assistant');
  const post = entries.find(e => e.id === 'post')!;
  assert.match(post.content, /<Output_Requirements>/);
  assert.match(post.content, /<\/Output_Requirements>/);
  assert.match(post.content, /输出 <World_Archive>/);
  assert.match(post.content, /高置信值得被保留的示例：理由？/);
  const skeleton = entries.find(e => e.id === 'skeleton')!;
  assert.match(skeleton.content, /B别开视线把耳环放在桌上/);
});

test('assemblePrompt：填入 Historical Context', () => {
  const prompts = assemblePrompt(defaultOrchestration(), { historicalContext: '【既存】…【原始】…', guidance: '' });
  const hc = prompts.find(p => p.content.includes('【既存】'));
  assert.ok(hc);
  assert.equal(hc!.role, 'system');
});

test('assemblePrompt：空引导整条跳过', () => {
  const prompts = assemblePrompt(defaultOrchestration(), { historicalContext: 'HC', guidance: '' });
  assert.equal(prompts.length, 4); // 5 条去掉空引导
  assert.ok(prompts.every(prompt => prompt.role === 'system'));
  assert.ok(!prompts.some(prompt => prompt.role === 'user' || prompt.role === 'assistant'));
});

test('assemblePrompt：有引导则装入', () => {
  const prompts = assemblePrompt(defaultOrchestration(), { historicalContext: 'HC', guidance: '保留决斗那段' });
  assert.equal(prompts.length, 5);
  assert.ok(prompts.some(p => p.content.includes('保留决斗那段')));
  assert.ok(prompts.every(prompt => prompt.role === 'system'));
  assert.ok(!prompts.some(prompt => prompt.role === 'user' || prompt.role === 'assistant'));
});

test('assemblePrompt：跳过 enabled=false 的条目', () => {
  const entries = defaultOrchestration().map(e => (e.id === 'note' ? { ...e, enabled: false } : e));
  const prompts = assemblePrompt(entries, { historicalContext: 'HC', guidance: 'G' });
  assert.equal(prompts.length, 4); // 5 - 注意
});

test('resolveOrchestration：空 override 完全跟随当前内置版', () => {
  assert.deepEqual(resolveOrchestration({}), defaultOrchestration());
});

test('resolveOrchestration：只覆盖 content，结构元数据仍取当前内置版', () => {
  const builtin = defaultOrchestration().find(entry => entry.id === 'skeleton')!;
  const resolved = resolveOrchestration({
    skeleton: { content: '用户版', acknowledgedBuiltinHash: promptFingerprint(builtin.content) },
  }).find(entry => entry.id === 'skeleton')!;
  assert.equal(resolved.content, '用户版');
  assert.equal(resolved.label, builtin.label);
  assert.equal(resolved.role, 'system', '自定义只覆盖 content，仍继承当前内置 system 角色');
  assert.equal(resolved.role, builtin.role);
  assert.equal(resolved.kind, builtin.kind);
  assert.equal(resolved.enabled, builtin.enabled);
});

test('promptFingerprint：算法结果稳定，内容变化后指纹变化', () => {
  assert.equal(promptFingerprint('abc'), 'fnv1a:3:1a47e90b');
  assert.equal(promptFingerprint('abd'), 'fnv1a:3:1f47f0ea');
  assert.notEqual(promptFingerprint('abc'), promptFingerprint('abd'));
});

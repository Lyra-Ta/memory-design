import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SUMMARY_GUIDANCE_PLACEHOLDER,
  SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER,
  assembleSummaryPrompt,
  defaultSummaryOrchestration,
  makeSummaryOrchestrationOverride,
  resolveSummaryOrchestration,
  summaryPromptFingerprint,
} from '../src/plugin/summary-orchestration';

test('默认总结编排固定为三个 system 段', () => {
  const entries = defaultSummaryOrchestration();
  assert.deepEqual(entries.map(entry => entry.id), ['pre', 'runtime', 'post']);
  assert.deepEqual(entries.map(entry => entry.role), ['system', 'system', 'system']);
  assert.deepEqual(entries.map(entry => entry.kind), ['static', 'runtime', 'static']);
  assert.ok(entries.every(entry => entry.enabled));
});

test('前置定义锁定记忆审计身份、可逆压缩与唯一历史输入', () => {
  const pre = defaultSummaryOrchestration().find(entry => entry.id === 'pre')!.content;
  assert.equal(
    pre,
    '你是一个「记忆审计归档系统」。\n' +
      '该审计不参与叙事生成，不负责创作与风格选择。仅对已生成的显现内容（<Flux>）进行可逆压缩与正确性校验。其输出的 Archive 将作为后续一切系统推演的唯一历史输入。',
  );
  assert.doesNotMatch(pre, /\{\{lastusermessage\}\}|SIGNAL_MONITOR|World_Blueprint|角色卡|世界书/i);
});

test('后置思考完整保留四阶段、强制切分、萃取优先级与输出格式', () => {
  const post = defaultSummaryOrchestration().find(entry => entry.id === 'post')!.content;
  assert.equal(summaryPromptFingerprint(post), 'fnv1a:1535:6a078f39', '后置提示词必须逐字保持当前确认版');
  assert.match(post, /\[阶段1: 游标校准\]/);
  assert.match(post, /\[阶段2: 容器分段\]/);
  assert.match(post, /单个事件容器最多包含 \*\*3个\*\*.*必须\*\*强制截断\*\*/);
  assert.match(post, /物理空间转移.*时间显著跨度.*高张力高密度互动.*立即截断/);
  assert.match(post, /P0（必须保留）/);
  assert.match(post, /P1（可选保留）/);
  assert.match(post, /P2（默认删除）/);
  assert.match(post, /严禁将“具体的动作\/物体”转化为“抽象的状态\/评价”/);
  assert.match(post, /性行为描写.*允许多容器合并.*优先级高于阶段2容器分段/);
  assert.match(post, /\[阶段4: 蒙太奇编织\]/);
  assert.match(post, /可逆性自检/);
  assert.match(post, /\[事件标题\|情绪\/感知坐标（约3个关键词）\|起止时间\]/);
  assert.match(post, /思考完毕后，输出 <World_Archive>…<\/World_Archive>，不要额外解释/);
  assert.match(post, /<\/Output_Requirements>\n\n现在从思考<thinking>开始：$/);
  assert.doesNotMatch(post, /现在从思考<thinking>开始：\s*\n\s*<thinking>\s*$/);
});

test('assembleSummaryPrompt 将 Archive 与 Flux 合入唯一 Historical Context', () => {
  const archiveContext = '<World_Archive>旧档</World_Archive>';
  const targetFlux = '<Flux>新事实</Flux>';
  const prompts = assembleSummaryPrompt(defaultSummaryOrchestration(), {
    archiveContext,
    targetFlux,
    guidance: '务必保留门口那句原话',
  });

  assert.deepEqual(prompts.map(prompt => prompt.role), ['system', 'system', 'system']);
  assert.equal(prompts.length, 3);
  const runtime = prompts[1].content;
  assert.equal((runtime.match(/<Historical_Context>/g) ?? []).length, 1);
  assert.equal((runtime.match(/<\/Historical_Context>/g) ?? []).length, 1);
  assert.match(runtime, /<Historical_Context>[\s\S]*旧档[\s\S]*新事实[\s\S]*<\/Historical_Context>/);
  assert.ok(runtime.indexOf('旧档') < runtime.indexOf('新事实'));
  assert.doesNotMatch(runtime, /<Archive_Context>|<Target_Flux>/);
  assert.match(runtime, /<Guidance>[\s\S]*门口那句原话[\s\S]*<\/Guidance>/);
  assert.equal(prompts[0].content.includes('旧档'), false);
  assert.equal(prompts[2].content.includes('新事实'), false);
});

test('assembleSummaryPrompt 空 guidance 不留下占位符或空 Guidance 标签', () => {
  const prompts = assembleSummaryPrompt(defaultSummaryOrchestration(), {
    archiveContext: '',
    targetFlux: '<Flux>事实</Flux>',
    guidance: '   ',
  });
  const runtime = prompts[1].content;
  assert.doesNotMatch(runtime, /<Guidance>|<\/Guidance>/);
  assert.doesNotMatch(
    runtime,
    new RegExp(
      [
        SUMMARY_HISTORICAL_CONTEXT_PLACEHOLDER,
        SUMMARY_GUIDANCE_PLACEHOLDER,
      ]
        .map(value => value.replace(/[{}]/g, '\\$&'))
        .join('|'),
    ),
  );
});

test('resolve 只覆盖 content，结构元数据仍取内置版', () => {
  const builtin = defaultSummaryOrchestration().find(entry => entry.id === 'pre')!;
  const override = makeSummaryOrchestrationOverride('用户前置', builtin.content);
  const resolved = resolveSummaryOrchestration({ pre: override }).find(entry => entry.id === 'pre')!;

  assert.equal(resolved.content, '用户前置');
  assert.equal(resolved.role, builtin.role);
  assert.equal(resolved.kind, builtin.kind);
  assert.equal(resolved.enabled, builtin.enabled);
  assert.equal(override.acknowledgedBuiltinHash, summaryPromptFingerprint(builtin.content));
});

test('summaryPromptFingerprint 稳定且随内容变化', () => {
  assert.equal(summaryPromptFingerprint('abc'), 'fnv1a:3:1a47e90b');
  assert.notEqual(summaryPromptFingerprint('abc'), summaryPromptFingerprint('abd'));
});

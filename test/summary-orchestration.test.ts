import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER,
  SUMMARY_GUIDANCE_PLACEHOLDER,
  SUMMARY_TARGET_FLUX_PLACEHOLDER,
  assembleSummaryPrompt,
  defaultSummaryOrchestration,
  makeSummaryOrchestrationOverride,
  resolveSummaryOrchestration,
  summaryPromptFingerprint,
} from '../src/plugin/summary-orchestration';

test('默认总结编排固定为 system -> user -> system 三段', () => {
  const entries = defaultSummaryOrchestration();
  assert.deepEqual(entries.map(entry => entry.id), ['pre', 'runtime', 'post']);
  assert.deepEqual(entries.map(entry => entry.role), ['system', 'user', 'system']);
  assert.deepEqual(entries.map(entry => entry.kind), ['static', 'runtime', 'static']);
  assert.ok(entries.every(entry => entry.enabled));
});

test('前置定义锁定只读 Archive Context、唯一 Target Flux 与普通无 marker 输出', () => {
  const pre = defaultSummaryOrchestration().find(entry => entry.id === 'pre')!.content;
  assert.match(pre, /Archive_Context.*Target_Flux.*只读记录/);
  assert.match(pre, /Archive_Context.*只读历史背景/);
  assert.match(pre, /不得复述、改写、再次总结/);
  assert.match(pre, /Target_Flux.*唯一允许总结的事实源/);
  assert.match(pre, /P0（必须保留）/);
  assert.match(pre, /P1（按连贯性选留）/);
  assert.match(pre, /P2（默认删除）/);
  assert.match(pre, /无 archived marker/);
  assert.match(pre, /\[事件标题\|约3个情绪\/感知关键词\|起止时间\]/);
  assert.doesNotMatch(pre, /\{\{lastusermessage\}\}|SIGNAL_MONITOR|World_Blueprint|角色卡|世界书/i);
});

test('后置思考以自然断点优先，3 Flux 仅兜底，并执行可逆性自检', () => {
  const post = defaultSummaryOrchestration().find(entry => entry.id === 'post')!.content;
  assert.match(post, /<inner_flow>…<\/inner_flow>/);
  assert.match(post, /每段最多 3 个 Flux.*兜底上限/);
  assert.match(post, /遇到自然断点也立即另起事件段/);
  assert.match(post, /可逆性自检/);
  assert.match(post, /只输出一个.*<World_Archive>/s);
});

test('assembleSummaryPrompt 将三类运行量只填入中间 user 段', () => {
  const archiveContext = '<World_Archive>旧档</World_Archive>';
  const targetFlux = '<Flux>新事实</Flux>';
  const prompts = assembleSummaryPrompt(defaultSummaryOrchestration(), {
    archiveContext,
    targetFlux,
    guidance: '务必保留门口那句原话',
  });

  assert.deepEqual(prompts.map(prompt => prompt.role), ['system', 'user', 'system']);
  assert.equal(prompts.length, 3);
  assert.match(prompts[1].content, /<Archive_Context>[\s\S]*旧档[\s\S]*<\/Archive_Context>/);
  assert.match(prompts[1].content, /<Target_Flux>[\s\S]*新事实[\s\S]*<\/Target_Flux>/);
  assert.match(prompts[1].content, /<Guidance>[\s\S]*门口那句原话[\s\S]*<\/Guidance>/);
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
        SUMMARY_ARCHIVE_CONTEXT_PLACEHOLDER,
        SUMMARY_TARGET_FLUX_PLACEHOLDER,
        SUMMARY_GUIDANCE_PLACEHOLDER,
      ]
        .map(value => value.replace(/[{}]/g, '\\$&'))
        .join('|'),
    ),
  );
});

test('自定义 runtime 即使删掉占位符，装配仍追加不可丢的运行时数据', () => {
  const entries = resolveSummaryOrchestration({
    runtime: makeSummaryOrchestrationOverride('自定义运行时说明', '内置运行时说明'),
  });
  const runtime = assembleSummaryPrompt(entries, {
    archiveContext: 'ARCHIVE_DATA',
    targetFlux: 'FLUX_DATA',
    guidance: 'GUIDE_DATA',
  })[1].content;

  assert.match(runtime, /^自定义运行时说明/);
  assert.match(runtime, /<Archive_Context>\nARCHIVE_DATA\n<\/Archive_Context>/);
  assert.match(runtime, /<Target_Flux>\nFLUX_DATA\n<\/Target_Flux>/);
  assert.match(runtime, /<Guidance>\nGUIDE_DATA\n<\/Guidance>/);
});

test('resolve 只覆盖 content，结构元数据仍取内置版', () => {
  const builtin = defaultSummaryOrchestration().find(entry => entry.id === 'pre')!;
  const override = makeSummaryOrchestrationOverride('用户前置', builtin.content);
  const resolved = resolveSummaryOrchestration({ pre: override }).find(entry => entry.id === 'pre')!;

  assert.equal(resolved.content, '用户前置');
  assert.equal(resolved.role, builtin.role);
  assert.equal(resolved.kind, builtin.kind);
  assert.equal(resolved.enabled, builtin.enabled);
  assert.equal(override.baseHash, summaryPromptFingerprint(builtin.content));
});

test('summaryPromptFingerprint 稳定且随内容变化', () => {
  assert.equal(summaryPromptFingerprint('abc'), 'fnv1a:3:1a47e90b');
  assert.notEqual(summaryPromptFingerprint('abc'), summaryPromptFingerprint('abd'));
});

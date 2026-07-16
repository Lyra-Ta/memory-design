import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectTargetFlux,
  extractFluxBlocks,
  validateSummaryArchive,
  type SummaryMessageLike,
} from '../src/core';

function message(floor: number, text: string): SummaryMessageLike {
  return { message_id: floor, message: text };
}

test('extractFluxBlocks 同层抽取 Flux / Causal_Flux，保留 raw 与精确 span', () => {
  const text = '前文\n<Causal_Flux>因果甲</Causal_Flux>\n中间\n<Flux>事实乙</Flux>\n尾声';
  const blocks = extractFluxBlocks(text);

  assert.deepEqual(blocks.map(block => block.tag), ['Causal_Flux', 'Flux']);
  assert.deepEqual(blocks.map(block => block.inner), ['因果甲', '事实乙']);
  for (const block of blocks) {
    assert.equal(text.slice(block.span[0], block.span[1]), block.raw);
  }
});

test('extractFluxBlocks 跳过落单开标签，不让它吞掉后面的完整块', () => {
  const text = '示例 <Flux> 未闭合\n正文 <Flux>真正内容</Flux>';
  const blocks = extractFluxBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].raw, '<Flux>真正内容</Flux>');
});

test('extractFluxBlocks 跳过 HTML 注释里的冷存 Flux，只收可见块', () => {
  const text = '<!-- <Flux>已冷存</Flux> -->\n<Flux>仍可见</Flux>';
  const blocks = extractFluxBlocks(text);
  assert.deepEqual(blocks.map(block => block.inner), ['仍可见']);
});

test('collectTargetFlux 严格过滤 x < floor <= sourceThrough，并按楼层/块位置排序', () => {
  const messages = [
    message(13, '<Flux>十三乙</Flux>...<Causal_Flux>十三丙</Causal_Flux>'),
    message(9, '<Flux>九（在 x 前）</Flux>'),
    message(12, '<Flux>十二甲</Flux>'),
    message(16, '<Flux>十六（越过快照）</Flux>'),
    message(10, '<Flux>十（等于 x）</Flux>'),
  ];

  const blocks = collectTargetFlux(messages, 10, 13);
  assert.deepEqual(blocks.map(block => [block.floor, block.inner]), [
    [12, '十二甲'],
    [13, '十三乙'],
    [13, '十三丙'],
  ]);
});

test('collectTargetFlux x=null 时从最早楼层收集到 sourceThrough', () => {
  const blocks = collectTargetFlux(
    [message(5, '<Flux>五</Flux>'), message(0, '<Flux>零</Flux>'), message(6, '<Flux>六</Flux>')],
    null,
    5,
  );
  assert.deepEqual(blocks.map(block => [block.floor, block.inner]), [
    [0, '零'],
    [5, '五'],
  ]);
});

const VALID_FLAT = `<inner_flow>已完成审计，但这里不产生档案。</inner_flow>
<World_Archive>
[雨夜重逢 | 雨声、迟疑、体温 | 1988-08-12 22:10-22:40]
A在门口遇见B。B先避开视线，随后把钥匙交给A，并原样说明来意。

[回到公寓 | 灯光、药味、安静 | 1988-08-12 22:40-23:20]
两人回到公寓，A处理B的伤口，B留在客房过夜。
</World_Archive>`;

test('validateSummaryArchive 接受无《容器》的普通扁平 Archive', () => {
  const result = validateSummaryArchive(VALID_FLAT);
  assert.equal(result.ok, true);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments.map(segment => segment.title), ['雨夜重逢', '回到公寓']);
  assert.equal(result.issues.some(issue => issue.severity === 'hard'), false);
});

test('validateSummaryArchive 取最后一份正式 Archive，不误收前面的完整示例', () => {
  const text = `<inner_flow><World_Archive>
[示例 | 假、旧、错 | 过去]
不应采用。
</World_Archive></inner_flow>
${VALID_FLAT}`;
  const result = validateSummaryArchive(text);
  assert.equal(result.ok, true);
  assert.equal(result.segments[0].title, '雨夜重逢');
});

test('validateSummaryArchive 硬拦外壳缺失与最终外壳未闭合', () => {
  const missing = validateSummaryArchive('[事件 | 甲、乙、丙 | t]\n总结');
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some(issue => issue.code === 'SHELL_MISSING'));

  const unclosed = validateSummaryArchive('<World_Archive>\n[事件 | 甲、乙、丙 | t]\n总结');
  assert.equal(unclosed.ok, false);
  assert.ok(unclosed.issues.some(issue => issue.code === 'SHELL_UNCLOSED'));
});

test('validateSummaryArchive 硬拦没有 flat segment', () => {
  const result = validateSummaryArchive('<World_Archive>\n《时间轴容器 | t》\n概览\n</World_Archive>');
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'NO_SEGMENT'));
  assert.ok(result.issues.some(issue => issue.code === 'CONTAINER_UNEXPECTED' && issue.severity === 'soft'));
});

test('validateSummaryArchive 硬拦事件段总结为空', () => {
  const result = validateSummaryArchive(`<World_Archive>
[空事件 | 风、灯、门 | t1]
[下一事件 | 雨、夜、路 | t2]
这里有总结。
</World_Archive>`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'SEGMENT_SUMMARY_EMPTY'));
});

test('未闭合的下一标题不能冒充上一事件段的总结正文', () => {
  const result = validateSummaryArchive(`<World_Archive>
[空事件 | 风、灯、门 | t1]
[下一事件 | 雨、夜、路 | t2
</World_Archive>`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'SEGMENT_TOKEN_BROKEN'));
  assert.ok(result.issues.some(issue => issue.code === 'SEGMENT_SUMMARY_EMPTY'));
});

test('validateSummaryArchive 硬拦 archived marker，保证输出仍是普通档', () => {
  const result = validateSummaryArchive(`<World_Archive>
[事件 | 风、灯、门 | t]
事件总结。
<!-- archived: 20 -->
</World_Archive>`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'ARCHIVED_MARKER_FORBIDDEN'));
});

test('字段缺失只作软疑，不把有总结的扁平段判成硬错', () => {
  const result = validateSummaryArchive('<World_Archive>\n[只有标题]\n仍有事实总结。\n</World_Archive>');
  assert.equal(result.ok, true);
  const codes = result.issues.map(issue => issue.code);
  assert.ok(codes.includes('SEGMENT_KEYWORDS_MISSING'));
  assert.ok(codes.includes('SEGMENT_TIME_MISSING'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildLocatorTable,
  deriveBoundary,
  hasOrphanPending,
  liveEntries,
  totalLiveSize,
  type MessageLike,
} from '../src/core/locator';

function msg(id: number, message: string): MessageLike {
  return { message_id: id, message };
}

test('跳过无档案的楼层', () => {
  const table = buildLocatorTable([msg(0, '开场白'), msg(1, '普通正文没有标签')]);
  assert.equal(table.length, 0);
});

test('抽出 live + 覆盖标记，兼容紧贴在档案前的旧写法', () => {
  const table = buildLocatorTable([
    msg(200, '<!-- archived: 200 -->\n<World_Archive>《c | t》\n概览</World_Archive>'),
  ]);
  assert.equal(table.length, 1);
  const e = table[0];
  assert.equal(e.messageId, 200);
  assert.equal(e.generation, 'live');
  assert.equal(e.through, 200);
  assert.ok(e.size > 0);
});

test('三世代混排 + 按楼层排序', () => {
  const table = buildLocatorTable([
    msg(400, '<!-- archived: 400 -->\n<World_Archive>新</World_Archive>'),
    msg(200, '<old_World_Archive>旧</old_World_Archive>'),
    msg(410, '<World_Archive_pending>暂存</World_Archive_pending>'),
  ]);
  assert.deepEqual(
    table.map(e => [e.messageId, e.generation]),
    [
      [200, 'old'],
      [400, 'live'],
      [410, 'pending'],
    ],
  );
});

test('同层多 live：只有整条消息最后的完整档有效', () => {
  const text =
    '<!-- archived: 100 --><World_Archive>甲</World_Archive>\n' +
    '<!-- archived: 200 --><World_Archive>乙</World_Archive>';
  const table = buildLocatorTable([msg(200, text)]);
  assert.equal(table.length, 1);
  assert.equal(table[0].content, '乙');
  assert.equal(table[0].through, 200);
});

test('thinking / inner_flow 内完整 live 不进定位表，只读末尾正式档', () => {
  const text = `<inner_flow>
<World_Archive>
这是思维链里的完整示例，没有可解析标题。
</World_Archive>
</inner_flow>
<World_Archive>
[书房抢钢笔与写字 | 钢笔、字迹 | 1988年8月13日]
正式原始档。
</World_Archive>`;
  const table = buildLocatorTable([msg(150, text)]);
  assert.equal(table.length, 1);
  assert.match(table[0].content, /书房抢钢笔与写字/);
  assert.doesNotMatch(table[0].content, /思维链里的完整示例/);
});

test('正式档退役为 old 后，thinking 里更早的 live 不得复活', () => {
  const text =
    '<inner_flow><World_Archive>思维链示例</World_Archive></inner_flow>\n' +
    '<old_World_Archive>已退役的正式档</old_World_Archive>';
  const table = buildLocatorTable([msg(200, text)]);
  assert.deepEqual(table.map(e => [e.generation, e.content]), [['old', '已退役的正式档']]);
  assert.equal(liveEntries(table).length, 0);
});

test('old + pending 同层合法共存时全部保留，早期 thinking live 仍忽略', () => {
  const text =
    '<inner_flow><World_Archive>思维链示例</World_Archive></inner_flow>\n' +
    '<old_World_Archive>退役原始档</old_World_Archive>\n' +
    '<World_Archive_pending>未完成新档</World_Archive_pending>';
  const table = buildLocatorTable([msg(300, text)]);
  assert.deepEqual(
    table.map(e => [e.generation, e.content]),
    [
      ['old', '退役原始档'],
      ['pending', '未完成新档'],
    ],
  );
  assert.equal(hasOrphanPending(table), true);
});

test('离档案较远的块外 marker 不再按距离猜配', () => {
  const table = buildLocatorTable([
    msg(400, '<!-- archived: 400 -->\n这里夹着普通正文，不是空白。\n<World_Archive>正式档</World_Archive>'),
  ]);
  assert.equal(table.length, 1);
  assert.equal(table[0].through, null);
});

test('无标记的档案 → through=null', () => {
  const table = buildLocatorTable([msg(5, '<World_Archive>无标记</World_Archive>')]);
  assert.equal(table[0].through, null);
});

test('marker 打在档案内部：归属含它的块，不被同层旧档抢走', () => {
  // 同层：前面一份退役 old_，后面一份新 live（marker 在其内部末尾）
  const text =
    '<old_World_Archive>[旧 | 意象 | t]\n旧概览</old_World_Archive>\n\n' +
    '<World_Archive>\n《c | t》\n概览\n<!-- archived: 300 -->\n</World_Archive>';
  const table = buildLocatorTable([msg(300, text)]);
  const live = table.find(e => e.generation === 'live')!;
  const old = table.find(e => e.generation === 'old')!;
  assert.equal(live.through, 300, 'live 档拿到内部 marker');
  assert.equal(old.through, null, '旧档不抢 marker');
  assert.equal(deriveBoundary(table), 300);
});

test('选择器：liveEntries / totalLiveSize / deriveBoundary / hasOrphanPending', () => {
  const table = buildLocatorTable([
    msg(200, '<!-- archived: 200 --><World_Archive>AAAA</World_Archive>'),
    msg(400, '<!-- archived: 400 --><World_Archive>BBBBBB</World_Archive>'),
    msg(150, '<old_World_Archive>旧档不计入盖住范围</old_World_Archive>'),
  ]);
  assert.equal(liveEntries(table).length, 2);
  assert.equal(totalLiveSize(table), 4 + 6);
  assert.equal(deriveBoundary(table), 400);
  assert.equal(hasOrphanPending(table), false);
});

test('hasOrphanPending 命中孤立 pending（崩溃断点）', () => {
  const table = buildLocatorTable([msg(400, '<World_Archive_pending>半截</World_Archive_pending>')]);
  assert.equal(hasOrphanPending(table), true);
});

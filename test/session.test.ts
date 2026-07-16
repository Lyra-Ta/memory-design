import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLocatorTable, extractArchiveBlocks, hasCoverageMarker, liveEntries, parseArchiveBody } from '../src/core';
import { defaultConfig } from '../src/plugin/config';
import type {
  ArchiverTavernDeps,
  GenerateRawArgs,
  TavernMessageCreating,
  VarScope,
} from '../src/plugin/deps';
import { defaultOrchestration, promptFingerprint } from '../src/plugin/orchestration';
import {
  ArchiverSession,
  ChatChangedDuringOperationError,
  GenerationCancelledError,
  GenerationTimeoutError,
} from '../src/plugin/session';

/** 内存 mock 酒馆：楼层存储 + 脚本化 generateRaw + 变量表 */
class MockDeps implements ArchiverTavernDeps {
  floors = new Map<number, string>();
  roles = new Map<number, 'system' | 'user' | 'assistant'>();
  vars: Record<string, Record<string, unknown>> = { chat: {}, global: {}, script: {} };
  lastId: number;
  genResult = '';
  genError: Error | null = null;
  genCalls: GenerateRawArgs[] = [];
  stoppedGenerationIds: string[] = [];
  lastIdReads = 0;
  messageReads: Array<string | number> = [];

  constructor(init: Record<number, string>, lastId: number) {
    for (const [k, v] of Object.entries(init)) {
      this.floors.set(Number(k), v);
      this.roles.set(Number(k), 'assistant');
    }
    this.lastId = lastId;
  }
  private one(id: number) {
    const m = this.floors.get(id);
    return m === undefined ? [] : [{ message_id: id, message: m, role: this.roles.get(id) ?? 'assistant' }];
  }
  getChatMessages(range: string | number) {
    this.messageReads.push(range);
    if (typeof range === 'number') return this.one(range);
    const s = String(range);
    if (s.includes('-')) {
      const [a, b] = s.split('-').map(Number);
      return [...this.floors.entries()]
        .filter(([id]) => id >= a && id <= b)
        .sort((x, y) => x[0] - y[0])
        .map(([message_id, message]) => ({
          message_id,
          message,
          role: this.roles.get(message_id) ?? 'assistant',
        }));
    }
    return this.one(Number(s));
  }
  async setChatMessages(msgs: Array<{ message_id: number; message: string }>) {
    for (const x of msgs) this.floors.set(x.message_id, x.message);
  }
  async createChatMessages(msgs: TavernMessageCreating[]) {
    for (const message of msgs) {
      this.lastId += 1;
      this.floors.set(this.lastId, message.message);
      this.roles.set(this.lastId, message.role);
    }
  }
  async deleteChatMessages(ids: number[]) {
    for (const id of [...ids].sort((a, b) => b - a)) {
      this.floors.delete(id);
      this.roles.delete(id);
      const shiftedFloors = [...this.floors.entries()]
        .filter(([floor]) => floor > id)
        .sort((a, b) => a[0] - b[0]);
      for (const [floor, message] of shiftedFloors) {
        const role = this.roles.get(floor);
        this.floors.delete(floor);
        this.roles.delete(floor);
        this.floors.set(floor - 1, message);
        if (role) this.roles.set(floor - 1, role);
      }
      this.lastId = Math.max(-1, this.lastId - 1);
    }
  }
  getLastMessageId() {
    this.lastIdReads += 1;
    return this.lastId;
  }
  async generateRaw(config: GenerateRawArgs) {
    this.genCalls.push(config);
    if (this.genError) throw this.genError;
    return this.genResult;
  }
  stopGenerationById(id: string) {
    this.stoppedGenerationIds.push(id);
    return true;
  }
  stopAllGeneration() {
    return true;
  }
  getVariables(opt: VarScope) {
    return this.vars[opt.type] ?? {};
  }
  insertOrAssignVariables(v: Record<string, unknown>, opt: VarScope) {
    this.vars[opt.type] = { ...this.vars[opt.type], ...structuredClone(v) };
  }
  getConnectionProfiles() {
    return [{ id: 'profile-1', name: '归档专用', api: 'openai', model: 'gemini-test' }];
  }
  all() {
    return [...this.floors.entries()].map(([message_id, message]) => ({ message_id, message }));
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MERGED = `<World_Archive>
《合并档 | 1988年》
将若干段合并成的时间轴大总结，交代来龙去脉。
[初见 | 时间1]
两人相遇并同行。
· 「你叫什么名字」，对方没有回答。
</World_Archive>`;

const MERGED_CONTINUATION = `<World_Archive>
《旧末尾 | 下半年至年末》
既存末尾容器与新记录合并后的完整概览。
[继续调查 | 年末]
两人继续调查。
· 「接着查。」

《合并档 | 次年》
随后进入新的时间容器。
</World_Archive>`;

const SUMMARY_RESULT = `<World_Archive>
[新一轮事件|雨声、停顿、余温|7月1日—7月3日]
两人在本轮原始摘要中见面并完成了一次交谈。
</World_Archive>`;

function liveRawAt(deps: MockDeps, messageId: number): string {
  return buildLocatorTable(deps.getChatMessages(messageId)).find(e => e.generation === 'live')?.raw ?? '';
}

/** 场景一：四份 flux 扁平待整理档在 50/100/150/200（都无 marker），聊天到 400 */
function scene1(): MockDeps {
  return new MockDeps(
    {
      50: '<World_Archive>[事件A | 意象、气味 | 时间1]\n总结A发生了什么。</World_Archive>',
      100: '<World_Archive>[事件B | 意象、气味 | 时间2]\n总结B发生了什么。</World_Archive>',
      150: '<World_Archive>[事件C | 意象、气味 | 时间3]\n总结C发生了什么。</World_Archive>',
      200: '<World_Archive>[事件D | 意象、气味 | 时间4]\n总结D发生了什么。</World_Archive>',
    },
    400,
  );
}

/** 场景二：已有一份既存时间轴档（带 marker）在 200，新的 flux 原始档在 250/300 */
function scene2(): MockDeps {
  return new MockDeps(
    {
      200:
        '<World_Archive>\n《旧容器1 | 上半年》\n概览1发生了什么。\n' +
        '《旧末尾 | 下半年》\n概览2发生了什么。\n<!-- archived: 200 -->\n</World_Archive>',
      250: '<World_Archive>[事件E | 意象 | 时间5]\n总结E。</World_Archive>',
      300: '<World_Archive>[事件F | 意象 | 时间6]\n总结F。</World_Archive>',
    },
    600,
  );
}

function summaryScene(): MockDeps {
  return new MockDeps(
    {
      10: '<World_Archive>\n[早期相识|日光、木香、门铃|早期]\n两人早期相识。\n</World_Archive>',
      20: '<old_World_Archive>\n[已退役事件|冷风、旧纸、远声|过去]\n不应进入上下文。\n</old_World_Archive>',
      25: '<World_Archive_pending>\n[未完成|雨、灯、窗|当前]\n不应进入上下文。\n</World_Archive_pending>',
      30:
        '<World_Archive>\n《近期容器 | 7月》\n两人来到小镇。\n' +
        '<!-- 《已接管旧容器 | 6月》\n不应可见。 -->\n<!-- archived: 30 -->\n</World_Archive>',
      31: '<Flux>\n层31：两人在雨中见面。\n</Flux>',
      32: '这是没有 Flux 标签的普通正文，不应直接进入本轮输入。',
      33: '<Causal_Flux>\n层33：这次见面使他们决定继续交谈。\n</Causal_Flux>',
    },
    33,
  );
}

function readySummaryScene(): MockDeps {
  const deps = summaryScene();
  deps.floors.delete(25);
  deps.roles.delete(25);
  return deps;
}

// ---------------------------------------------------------------------------
// 场景一：首次时间轴化（无既存）
// ---------------------------------------------------------------------------

test('refresh：无 marker → boundary 落回 0、触发 0–200', () => {
  const s = new ArchiverSession(scene1(), defaultConfig());
  const snap = s.refresh();
  assert.equal(snap.boundary, 0);
  assert.equal(snap.latestLiveArchiveFloor, 200);
  assert.deepEqual(snap.trigger.range, { from: 0, to: 200 });
  assert.equal(snap.table.length, 4);
});

test('collect：四份无 marker = 原始、无既存', () => {
  const deps = scene1();
  const s = new ArchiverSession(deps, defaultConfig());
  const snapshot = s.refresh();
  deps.lastIdReads = 0;
  const c = s.collect(snapshot);
  assert.equal(c.sources.length, 4);
  assert.equal(c.continuity, null);
  assert.ok(c.historicalContext.includes('总结A'));
  assert.equal(deps.lastIdReads, 0, 'collect 必须严格消费传入快照，不偷读另一个 q');
});

test('collect 上界：最近 N 层内的原始档不消化（保新鲜）', () => {
  // N=200，当前 600 → 阈值 400；50 层收、550 层（>400）不收
  const deps = new MockDeps(
    {
      50: '<World_Archive>[事件A | x | t]\n总结A。</World_Archive>',
      550: '<World_Archive>[很近的事 | x | t]\n最近 N 层内、这轮不该动。</World_Archive>',
    },
    600,
  );
  const s = new ArchiverSession(deps, defaultConfig());
  const c = s.collect(s.refresh());
  assert.deepEqual(
    c.sources.map(x => x.messageId),
    [50],
  );
});

test('范围选择：以最后勾选层为端点，强制纳入此前全部原始档', () => {
  const s = new ArchiverSession(scene1(), defaultConfig());
  const snapshot = s.refresh();
  const c = s.collect(snapshot, [50, 150]); // 即使传入列表有洞，核心也按端点 150 连续收取
  assert.deepEqual(
    c.sources.map(x => x.messageId).sort((a, b) => a - b),
    [50, 100, 150],
  );
});

test('setN：低于硬下限时钳到 100 并持久化', () => {
  const deps = scene1();
  const s = new ArchiverSession(deps, defaultConfig());
  s.setN(1);
  assert.equal(s.config.n, 100);
  assert.equal((deps.vars.chat.memoryArchiver as { n: number }).n, 100);
  assert.equal((deps.vars.global.memoryArchiver as { n: number }).n, 100, '用户保存后同步成为全局默认');
  assert.equal((deps.vars.global.memoryArchiver as { boundary: number }).boundary, 0, '全局不夹带当前对话进度');
});

test('功能启用 setters：分别持久化到当前聊天与今后新聊天的全局种子', () => {
  const deps = scene1();
  const s = new ArchiverSession(deps, defaultConfig());
  let changes = 0;
  const stop = s.onFeatureEnablementChanged(() => { changes += 1; });

  s.setTimelineEnabled(false);
  s.setSummaryEnabled(false);
  s.setSummaryEnabled(false);

  assert.equal(s.config.timelineEnabled, false);
  assert.equal(s.config.summaryEnabled, false);
  assert.equal((deps.vars.chat.memoryArchiver as { timelineEnabled: boolean }).timelineEnabled, false);
  assert.equal((deps.vars.chat.memoryArchiver as { summaryEnabled: boolean }).summaryEnabled, false);
  assert.equal((deps.vars.global.memoryArchiver as { timelineEnabled: boolean }).timelineEnabled, false);
  assert.equal((deps.vars.global.memoryArchiver as { summaryEnabled: boolean }).summaryEnabled, false);
  assert.equal(changes, 2, '只在真实变化时通知运行时对齐');

  stop();
  s.setSummaryEnabled(true);
  assert.equal(changes, 2, '解绑后不再通知');
});

test('两个 API setters：分别持久化且互不覆盖', () => {
  const deps = scene1();
  const s = new ArchiverSession(deps, defaultConfig());

  s.setSummaryConnectionProfile(' summary-profile ');
  s.setTimelineConnectionProfile('timeline-profile');

  assert.equal(s.config.summaryConnectionProfileId, 'summary-profile');
  assert.equal(s.config.timelineConnectionProfileId, 'timeline-profile');
  const chat = deps.vars.chat.memoryArchiver as {
    summaryConnectionProfileId: string | null;
    timelineConnectionProfileId: string | null;
  };
  const global = deps.vars.global.memoryArchiver as typeof chat;
  assert.equal(chat.summaryConnectionProfileId, 'summary-profile');
  assert.equal(chat.timelineConnectionProfileId, 'timeline-profile');
  assert.equal(global.summaryConnectionProfileId, 'summary-profile');
  assert.equal(global.timelineConnectionProfileId, 'timeline-profile');

  s.setSummaryConnectionProfile('');
  assert.equal(s.config.summaryConnectionProfileId, null);
  assert.equal(s.config.timelineConnectionProfileId, 'timeline-profile');
});

test('generate：时间轴化只使用自己的 Connection Profile ID', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const cfg = defaultConfig();
  cfg.timelineConnectionProfileId = 'timeline-profile';
  cfg.summaryConnectionProfileId = 'summary-profile';
  const s = new ArchiverSession(deps, cfg);
  const uiSnapshot = s.refresh();
  deps.lastIdReads = 0;
  deps.messageReads = [];
  const cand = await s.generate(uiSnapshot.table, '');
  assert.equal(s.phase, 'preview');
  assert.equal(cand.validation.ok, true);
  assert.equal(cand.through, 200);
  assert.equal(deps.genCalls[0].connection_profile_id, 'timeline-profile');
  assert.equal(deps.lastIdReads, 1, '生成开始只取一份 fresh q');
  assert.equal(deps.messageReads.filter(range => range === '0-400').length, 1, '同一 q 只建一张完整表');
});

test('generate 核心防线：空来源直接拒绝、不会调用模型、phase 保持 idle', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  await assert.rejects(() => s.generate(s.refresh().table, '', []), /没有可归档/);
  assert.equal(deps.genCalls.length, 0);
  assert.equal(s.phase, 'idle');
});

test('generate 核心防线：存在孤立 pending 时禁止叠加新归档', async () => {
  const deps = new MockDeps(
    {
      50: '<World_Archive>[原始 | x | t]\n待整理。</World_Archive>',
      200: '<World_Archive_pending>未完成事务</World_Archive_pending>',
    },
    400,
  );
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  await assert.rejects(() => s.generate(s.refresh().table, ''), /未完成的归档提交/);
  assert.equal(deps.genCalls.length, 0);
});

test('generate 核心防线：完整性缺口未复原时禁止开始新归档', async () => {
  const deps = new MockDeps(
    {
      50: '<World_Archive>[原始 | x | t]\n待整理。</World_Archive>',
      200: '<World_Archive>\n《既存 | t》\n概览。\n<!-- archived: 200 -->\n</World_Archive>',
      250: '<old_World_Archive>[待复原 | x | t]\n旧档。</old_World_Archive>',
    },
    400,
  );
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  await assert.rejects(() => s.generate(s.refresh().table, ''), /完整性缺口/);
  assert.equal(deps.genCalls.length, 0);
});

test('generate：thinking 中有完整档时，候选正文/校验/容器都只取最后正式档', async () => {
  const deps = scene1();
  deps.genResult = `<thinking><World_Archive>\n《思考示例 | 旧》\n不能采用。\n</World_Archive></thinking>\n${MERGED}`;
  const s = new ArchiverSession(deps, defaultConfig());
  const cand = await s.generate(s.refresh().table, '');
  assert.match(cand.body, /合并档/);
  assert.doesNotMatch(cand.body, /思考示例/);
  assert.equal(cand.containers[0].title, '合并档');
  assert.equal(cand.validation.block?.inner, cand.body);
});

test('大总结调试 raw：保留本次整段输出；手改后表示当前候选全量', async () => {
  const deps = scene1();
  const fullOutput = `<thinking>先整理时间线，不属于正式正文。</thinking>\n${MERGED}\n模型尾注。`;
  deps.genResult = fullOutput;
  const session = new ArchiverSession(deps, defaultConfig());
  const candidate = await session.generate(session.refresh().table, '');

  assert.equal(candidate.raw, fullOutput);
  const edited = session.editCandidate(candidate, candidate.body.replace('两人相遇并同行。', '两人相遇后结伴同行。'));
  assert.match(edited.raw, /^<thinking>先整理时间线/);
  assert.match(edited.raw, /两人相遇后结伴同行/);
  assert.match(edited.raw, /模型尾注。$/);
});

test('一键补正候选：只补机械闭合符并重新校验，不改变本轮范围', async () => {
  const deps = scene1();
  deps.genResult = '<World_Archive>\n《合并档 | 1988年\n概览。';
  const s = new ArchiverSession(deps, defaultConfig());
  const cand = await s.generate(s.refresh().table, '', [50, 100]);
  assert.equal(cand.validation.ok, false);
  const repaired = s.repairCandidate(cand);
  assert.ok(repaired.fixes.length >= 2);
  assert.equal(repaired.candidate.validation.ok, true);
  assert.deepEqual(repaired.candidate.selection, [50, 100]);
  assert.equal(repaired.candidate.containers[0].title, '合并档');
});

test('单例锁：preview 态再起 generate 抛错', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  await s.generate(table, '');
  await assert.rejects(() => s.generate(table, ''), /单例锁/);
});

test('重生成失败：保留旧候选对应的 preview 状态，不把结果页变成死状态', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const oldCand = await s.generate(table, '', [50, 100]);
  deps.generateRaw = async () => {
    throw new Error('模拟 API 失败');
  };

  await assert.rejects(() => s.regenerate(table, '再试一次', oldCand.selection), /模拟 API 失败/);
  assert.equal(s.phase, 'preview', '旧候选仍可继续保存、重试或放弃');
});

test('取消初次生成：立即结束 await，晚返回不会将 idle 改回 preview', async () => {
  const deps = scene1();
  const gate = deferred<string>();
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return gate.promise;
  };
  const s = new ArchiverSession(deps, defaultConfig());
  const pending = s.generate(s.refresh().table, '', [50, 100]);

  assert.equal(s.phase, 'generating');
  s.cancel();
  assert.equal(s.phase, 'idle');
  await assert.rejects(pending, err => err instanceof GenerationCancelledError);
  assert.deepEqual(deps.stoppedGenerationIds, [deps.genCalls[0].generation_id]);

  gate.resolve(MERGED);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.phase, 'idle');
});

test('取消后立即重试：旧 Promise 无权碰新请求，且每次 generation_id 唯一', async () => {
  const deps = scene1();
  const gates = [deferred<string>(), deferred<string>()];
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return gates[deps.genCalls.length - 1].promise;
  };
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;

  const first = s.generate(table, '同长', [50, 100]);
  s.cancel();
  await assert.rejects(first, err => err instanceof GenerationCancelledError);

  const second = s.generate(table, '同长', [50, 100]);
  assert.notEqual(deps.genCalls[0].generation_id, deps.genCalls[1].generation_id);
  gates[0].resolve(MERGED);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.phase, 'generating', '旧请求晚返回时，新请求仍持有单例锁');

  const secondResult = MERGED.replace('《合并档 | 1988年》', '《第二次 | 1988年》');
  gates[1].resolve(secondResult);
  const cand = await second;
  assert.equal(cand.containers[0].title, '第二次');
  assert.equal(s.phase, 'preview');
});

test('取消重生成：恢复 preview，旧候选仍可保存/重试/放弃', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const oldCand = await s.generate(table, '', [50, 100]);
  const gate = deferred<string>();
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return gate.promise;
  };

  const pending = s.regenerate(table, '重试引导', oldCand.selection);
  assert.equal(s.phase, 'generating');
  s.cancel();
  assert.equal(s.phase, 'preview');
  await assert.rejects(pending, err => err instanceof GenerationCancelledError);
  gate.resolve(MERGED);
  await Promise.resolve();
  assert.equal(s.phase, 'preview');
});

test('初次生成超时：主动 stop 并回到 idle，不等底层 Promise settle', async () => {
  const deps = scene1();
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return new Promise<string>(() => undefined);
  };
  const s = new ArchiverSession(deps, defaultConfig(), 10);

  await assert.rejects(s.generate(s.refresh().table, '', [50]), err => err instanceof GenerationTimeoutError);
  assert.equal(s.phase, 'idle');
  assert.deepEqual(deps.stoppedGenerationIds, [deps.genCalls[0].generation_id]);
});

test('重生成超时：主动 stop 并恢复 preview', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig(), 10);
  const table = s.refresh().table;
  const oldCand = await s.generate(table, '', [50, 100]);
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return new Promise<string>(() => undefined);
  };

  await assert.rejects(
    s.regenerate(table, '会超时', oldCand.selection),
    err => err instanceof GenerationTimeoutError,
  );
  assert.equal(s.phase, 'preview');
  assert.equal(deps.stoppedGenerationIds.at(-1), deps.genCalls.at(-1)?.generation_id);
});

test('generate → commit：新档 live（marker 内嵌）、四份原始退役、boundary=200', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  await s.commit(cand, table);

  assert.equal(s.phase, 'idle');
  assert.equal(s.config.boundary, 200);
  assert.equal((deps.vars.chat.memoryArchiver as { boundary: number }).boundary, 200, '提交边界已持久化');
  const commitLog = deps.vars.chat.memoryArchiverCommitTx as {
    plannedOldFloors: number[];
    oldSucceededFloors: number[];
    pendingWritten: boolean;
    promotedFloor: number | null;
    status: string;
  };
  assert.deepEqual(commitLog.plannedOldFloors, [50, 100, 150, 200]);
  assert.deepEqual(commitLog.oldSucceededFloors, [50, 100, 150, 200]);
  assert.equal(commitLog.pendingWritten, true);
  assert.equal(commitLog.promotedFloor, 200);
  assert.equal(commitLog.status, 'completed', '薄日志保留最近一笔 old/pending/promote 楼层事实');

  const t200 = deps.floors.get(200)!;
  assert.match(t200, /<World_Archive>[\s\S]*合并档[\s\S]*<!-- archived: 200 -->[\s\S]*<\/World_Archive>/);
  assert.ok(t200.includes('<old_World_Archive>[事件D'));
  assert.ok(!t200.includes('<World_Archive_pending>'));

  const tbl = buildLocatorTable(deps.all());
  assert.equal(liveEntries(tbl).length, 1);
  assert.equal(tbl.filter(e => e.generation === 'old').length, 4);

  // 提交后再刷新：新档的内部 marker 应被认出 → 完整性检查不误报
  const after = s.refresh();
  assert.equal(after.boundary, 200);
  assert.equal(after.integrity.needed, false, '提交后不应把刚退役的 old_ 误判为需复原');
});

test('commit 提交前复核：预览期间来源被改动则零写入拒绝', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '', [50, 100]);
  deps.floors.set(100, '<World_Archive>[事件B已被外部改写 | x | t]\n新内容。</World_Archive>');
  const before = new Map(deps.floors);

  await assert.rejects(() => s.commit(cand, table), /预览期间发生变化|来源集合/);
  assert.deepEqual(deps.floors, before, '拒绝发生在写 pending 之前，所有楼层不动');
  assert.equal(s.phase, 'preview');
});

test('commit 中途失败：薄日志精确留下 pending 与已 old 的楼层', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  let writes = 0;
  deps.setChatMessages = async messages => {
    writes += 1;
    if (writes === 3) throw new Error('模拟第二份 old 落盘失败');
    await write(messages);
  };

  await assert.rejects(() => s.commit(cand, table), /模拟第二份 old/);
  const log = deps.vars.chat.memoryArchiverCommitTx as {
    pendingWritten: boolean;
    oldSucceededFloors: number[];
    promotedFloor: number | null;
    status: string;
    error: string;
  };
  assert.equal(log.pendingWritten, true);
  assert.deepEqual(log.oldSucceededFloors, [50]);
  assert.equal(log.promotedFloor, null);
  assert.equal(log.status, 'failed');
  assert.match(log.error, /第二份 old/);
  assert.equal(s.refresh().interrupted[0]?.messageId, 200);
});

test('commit 中途真切聊天：首个 await 返回即停止，不在新聊天继续退旧或写日志', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const session = new ArchiverSession(deps, defaultConfig());
  session.chatState.reset('chat-a');
  const table = session.refresh().table;
  const candidate = await session.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  const entered = deferred<void>();
  const gate = deferred<void>();
  let writes = 0;
  deps.setChatMessages = async messages => {
    writes += 1;
    entered.resolve();
    await gate.promise;
    await write(messages);
  };

  const committing = session.commit(candidate, table);
  await entered.promise;
  session.chatState.reset('chat-b');
  gate.resolve();

  await assert.rejects(committing, ChatChangedDuringOperationError);
  assert.equal(writes, 1, '只允许切换前已经发起的 pending 写入，不得继续执行后续步骤');
  assert.equal(session.phase, 'idle');
  assert.doesNotMatch(deps.floors.get(50)!, /old_World_Archive/, '后续退旧没有触发');
  assert.equal(
    (deps.vars.chat.memoryArchiverCommitTx as { status: string }).status,
    'prepared',
    '切换后不得把失败日志写进当前聊天；原聊天保留已预写的事务计划供恢复',
  );
});

test('续跑未完成提交（无既存）：从第二份 old 断点补完 = 完整提交', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  let writes = 0;
  deps.setChatMessages = async messages => {
    writes += 1;
    if (writes === 3) throw new Error('模拟第二份 old 落盘失败');
    await write(messages);
  };
  await assert.rejects(() => s.commit(cand, table), /第二份 old/);
  assert.equal(s.phase, 'idle');
  assert.equal(s.refresh().interrupted.length, 1);

  deps.setChatMessages = write; // 恢复写入，一键续跑
  const r = await s.resumeCommit();
  assert.equal(r.resumed, true);
  assert.equal(s.phase, 'idle');

  // 最终态与一次成功提交完全一致
  assert.equal(s.config.boundary, 200);
  const tbl = buildLocatorTable(deps.all());
  assert.equal(liveEntries(tbl).length, 1);
  assert.equal(tbl.filter(e => e.generation === 'old').length, 4);
  assert.equal(tbl.filter(e => e.generation === 'pending').length, 0);
  const t200 = deps.floors.get(200)!;
  assert.match(t200, /<World_Archive>[\s\S]*合并档[\s\S]*<!-- archived: 200 -->[\s\S]*<\/World_Archive>/);
  assert.ok(!t200.includes('<World_Archive_pending>'));
  const log = deps.vars.chat.memoryArchiverCommitTx as {
    status: string;
    oldSucceededFloors: number[];
    promotedFloor: number | null;
  };
  assert.equal(log.status, 'completed');
  assert.deepEqual(log.oldSucceededFloors, [50, 100, 150, 200]);
  assert.equal(log.promotedFloor, 200);
  assert.equal(s.refresh().interrupted.length, 0);
});

test('续跑未完成提交（同名增量覆写）：断在退旧前，补完退旧＋覆写＋转正', async () => {
  const deps = scene2();
  deps.genResult = MERGED_CONTINUATION;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  let writes = 0;
  deps.setChatMessages = async messages => {
    writes += 1;
    if (writes === 2) throw new Error('模拟首份 old 落盘失败');
    await write(messages);
  };
  await assert.rejects(() => s.commit(cand, table), /首份 old/);
  const midLog = deps.vars.chat.memoryArchiverCommitTx as {
    pendingWritten: boolean;
    supersede: { done: boolean } | null;
  };
  assert.equal(midLog.pendingWritten, true, '断点前 pending 已写');
  assert.equal(midLog.supersede?.done, false, '断点前覆写尚未发生');

  deps.setChatMessages = write;
  const r = await s.resumeCommit();
  assert.equal(r.resumed, true);
  assert.equal(s.config.boundary, 300);

  // 既存(200) 末尾容器被覆写、仍 live；新档在 300；250/300 原始退役
  const t200 = deps.floors.get(200)!;
  assert.ok(t200.includes('<!-- 《旧末尾'), '续跑补上了增量覆写');
  assert.equal(extractArchiveBlocks(t200)[0].generation, 'live');
  assert.deepEqual(parseArchiveBody(extractArchiveBlocks(t200)[0].inner).map(n => n.title), ['旧容器1']);
  const t300 = deps.floors.get(300)!;
  assert.match(t300, /<World_Archive>[\s\S]*<!-- archived: 300 -->[\s\S]*<\/World_Archive>/);
  assert.ok(!t300.includes('<World_Archive_pending>'));
  const tbl = buildLocatorTable(deps.all());
  assert.equal(liveEntries(tbl).length, 2);
  assert.equal(tbl.filter(e => e.generation === 'old').length, 2);
  assert.equal(tbl.filter(e => e.generation === 'pending').length, 0);
  const log = deps.vars.chat.memoryArchiverCommitTx as { status: string; supersede: { done: boolean } | null };
  assert.equal(log.status, 'completed');
  assert.equal(log.supersede?.done, true);
});

test('续跑未完成提交：断点仅剩转正时只补转正，退旧/覆写不被重复执行', async () => {
  const deps = scene2();
  deps.genResult = MERGED_CONTINUATION;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  let writes = 0;
  deps.setChatMessages = async messages => {
    writes += 1;
    if (writes === 5) throw new Error('模拟转正落盘失败');
    await write(messages);
  };
  await assert.rejects(() => s.commit(cand, table), /转正落盘/);
  const midT200 = deps.floors.get(200)!;
  assert.ok(midT200.includes('<!-- 《旧末尾'), '覆写在断点前已完成');
  assert.equal(s.refresh().interrupted.length, 1, '仅剩 pending 未转正');

  deps.setChatMessages = write;
  const r = await s.resumeCommit();
  assert.equal(r.steps, 1, '只补转正这一步');
  assert.equal(s.config.boundary, 300);
  // 覆写不被重复：仍只有一个被包裹的《旧末尾》、旧容器1 仍可见
  const t200 = deps.floors.get(200)!;
  assert.deepEqual(parseArchiveBody(extractArchiveBlocks(t200)[0].inner).map(n => n.title), ['旧容器1']);
  assert.equal(deps.floors.get(300)!.includes('<World_Archive_pending>'), false);
  assert.equal((deps.vars.chat.memoryArchiverCommitTx as { status: string }).status, 'completed');
  assert.equal(s.refresh().interrupted.length, 0);
});

test('续跑未完成提交：pending 从未写入时只清日志、不改任何楼层', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  const write = deps.setChatMessages.bind(deps);
  deps.setChatMessages = async () => {
    throw new Error('模拟写 pending 就失败');
  };
  await assert.rejects(() => s.commit(cand, table), /写 pending 就失败/);
  const before = new Map(deps.floors);

  deps.setChatMessages = write;
  const r = await s.resumeCommit();
  assert.equal(r.resumed, false, 'pending 未写入 → 无需续跑');
  assert.deepEqual(deps.floors, before, '楼层一字未动');
  assert.equal(deps.vars.chat.memoryArchiverCommitTx, null, '计划日志已清为墓碑');
});

test('commit 核心防线：预览期间出现 pending 时禁止叠加提交', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '', [50, 100]);
  deps.floors.set(350, '<World_Archive_pending>另一笔未完成事务</World_Archive_pending>');
  const before = new Map(deps.floors);

  await assert.rejects(() => s.commit(cand, table), /未完成的归档提交/);
  assert.deepEqual(deps.floors, before);
  assert.equal(s.phase, 'preview');
});

test('commit 连续范围防线：预览期间端点前新增原始档会要求重生成，不能留下中间洞', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '', [50, 100]);
  deps.floors.set(75, '<World_Archive>[后来插入的中间档 | x | t]\n必须纳入连续范围。</World_Archive>');
  const before = new Map(deps.floors);

  await assert.rejects(() => s.commit(cand, table), /来源集合在预览期间发生变化/);
  assert.deepEqual(deps.floors, before);
  assert.equal(s.phase, 'preview');
});

test('commit 按最后正式块的 span 退役：相同 thinking 块不被 String.replace 误伤', async () => {
  const raw = '<World_Archive>[相同原始档 | x | t]\n原始总结。</World_Archive>';
  const deps = new MockDeps({ 50: `<thinking>${raw}</thinking>\n${raw}` }, 250);
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '', [50]);
  await s.commit(cand, table);

  const after = deps.floors.get(50)!;
  assert.ok(after.includes(`<thinking>${raw}</thinking>`), '前方 thinking 原文保持不动');
  assert.ok(after.includes('<old_World_Archive>[相同原始档'), '末尾正式原始档被精确退役');
  assert.match(after, /<World_Archive>[\s\S]*合并档/);
});

test('硬错拦保存：validation 不 ok 时 commit 抛错', async () => {
  const deps = scene1();
  deps.genResult = '模型没吐出任何标签';
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  assert.equal(cand.validation.ok, false);
  await assert.rejects(() => s.commit(cand, table), /硬错/);
});

// ---------------------------------------------------------------------------
// 场景二：有既存 → 增量覆写末尾容器
// ---------------------------------------------------------------------------

test('collect：marker 分既存/原始（既存=200、原始=250/300）', () => {
  const s = new ArchiverSession(scene2(), defaultConfig());
  const c = s.collect(s.refresh());
  assert.deepEqual(
    c.sources.map(x => x.messageId).sort((a, b) => a - b),
    [250, 300],
  );
  assert.equal(c.continuity?.messageId, 200);
  assert.ok(c.historicalContext.includes('既存信息'));
  assert.ok(c.historicalContext.includes('《旧末尾 | 下半年》'), '发送最新既存档的全部可见容器（含末尾）');
  assert.ok(c.historicalContext.includes('《旧容器1 | 上半年》'), '最新既存档的全部可见容器都发，不只末尾');
  assert.ok(!c.historicalContext.includes('<!-- archived'), '喂给模型前注释已滤掉');
});

test('generate → commit（同名增量覆写）：既存末尾容器冷存、既存档仍 live、新档在 300', async () => {
  const deps = scene2();
  deps.genResult = MERGED_CONTINUATION;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  assert.equal(cand.through, 300);
  await s.commit(cand, table);
  assert.equal(s.config.boundary, 300);

  // 既存档（200）仍 live、marker 仍可读、末尾容器《旧末尾》被注释包裹
  const t200 = deps.floors.get(200)!;
  assert.equal(extractArchiveBlocks(t200)[0].generation, 'live');
  assert.ok(hasCoverageMarker(t200));
  assert.ok(t200.includes('<!-- 《旧末尾'), '末尾容器被增量覆写包裹');
  assert.deepEqual(
    parseArchiveBody(extractArchiveBlocks(t200)[0].inner).map(n => n.title),
    ['旧容器1'],
    '显示时只剩未被接管的容器',
  );

  // 新档在 300，带内嵌 marker 300
  const t300 = deps.floors.get(300)!;
  assert.match(t300, /<World_Archive>[\s\S]*旧末尾[\s\S]*合并档[\s\S]*<!-- archived: 300 -->[\s\S]*<\/World_Archive>/);

  // 定位表：既存(200) + 新档(300) = 2 live；250、300 原始退役 = 2 old
  const tbl = buildLocatorTable(deps.all());
  assert.equal(liveEntries(tbl).length, 2);
  assert.equal(tbl.filter(e => e.generation === 'old').length, 2);
});

test('generate → commit（标题不同）：宁可保留既存末尾容器，也不执行 supersede', async () => {
  const deps = scene2();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '');
  await s.commit(cand, table);

  const t200 = deps.floors.get(200)!;
  assert.ok(!t200.includes('<!-- 《旧末尾'), '不同名时不得隐藏既存末尾容器');
  assert.deepEqual(
    parseArchiveBody(extractArchiveBlocks(t200)[0].inner).map(n => n.title),
    ['旧容器1', '旧末尾'],
  );
});

test('commit 核心防线：预览后出现完整性缺口时零写入拒绝', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const s = new ArchiverSession(deps, defaultConfig());
  const table = s.refresh().table;
  const cand = await s.generate(table, '', [50, 100]);
  deps.floors.set(350, '<old_World_Archive>[待复原 | x | t]\n旧档。</old_World_Archive>');
  const before = new Map(deps.floors);

  await assert.rejects(() => s.commit(cand, table), /完整性缺口/);
  assert.deepEqual(deps.floors, before);
  assert.equal(s.phase, 'preview');
});

// ---------------------------------------------------------------------------
// 完整性回退：删楼层 → 复原最近 marker 之后的 old_
// ---------------------------------------------------------------------------

test('就地编辑写回：改可见容器，marker + 被接管旧容器 + 其余容器一律保住', async () => {
  const deps = new MockDeps(
    {
      200:
        '<World_Archive>\n《旧容器1 | 上半年》\n概览1。\n' +
        '<!-- 《旧末尾 | 下半年》\n概览2。 -->\n' +
        '《合并档 | 全年》\n合并大总结。\n<!-- archived: 200 -->\n</World_Archive>',
    },
    400,
  );
  const s = new ArchiverSession(deps, defaultConfig());
  // 可见容器 index 0 = 旧容器1；改它的正文
  await s.editLiveContainer(
    200,
    liveRawAt(deps, 200),
    0,
    '《旧容器1 | 上半年》\n改写后的概览1。\n[新片段 | 春]\n补的小总结。\n· 补的摘录。',
  );

  const t200 = deps.floors.get(200)!;
  assert.ok(t200.includes('改写后的概览1。'), '改动写回');
  assert.ok(t200.includes('<!-- 《旧末尾 | 下半年》'), '被接管旧容器仍在（无损）');
  assert.ok(hasCoverageMarker(t200), 'marker 仍在');
  assert.equal(extractArchiveBlocks(t200)[0].generation, 'live', '世代仍是 live');
  // 可见容器仍是两个、顺序不变；第一个多了新片段
  const vis = parseArchiveBody(extractArchiveBlocks(t200)[0].inner);
  assert.deepEqual(vis.map(c => c.title), ['旧容器1', '合并档']);
  assert.equal(vis[0].fragments[0].title, '新片段');
});

test('就地编辑写回：越界 / 多容器 抛错，不落盘', async () => {
  const deps = new MockDeps({ 200: '<World_Archive>\n《c1 | t》\n概览。\n<!-- archived: 200 -->\n</World_Archive>' }, 400);
  const s = new ArchiverSession(deps, defaultConfig());
  const before = deps.floors.get(200);
  const expectedRaw = liveRawAt(deps, 200);
  await assert.rejects(() => s.editLiveContainer(200, expectedRaw, 5, '《x | t》\n概览。'), /越界/);
  await assert.rejects(
    () => s.editLiveContainer(200, expectedRaw, 0, '《a | t》\n概览。\n《b | t》\n概览。'),
    /恰好是一个容器/,
  );
  assert.equal(deps.floors.get(200), before, '抛错时聊天不动');
});

test('就地编辑只改消息末尾权威 live；前方 thinking 即使正文相同也不误写', async () => {
  const raw = '<World_Archive>\n《同名 | t》\n概览。\n</World_Archive>';
  const deps = new MockDeps({ 200: `<thinking>${raw}</thinking>\n${raw}` }, 400);
  const s = new ArchiverSession(deps, defaultConfig());
  const expectedRaw = liveRawAt(deps, 200);
  await s.editLiveContainer(200, expectedRaw, 0, '《同名 | t》\n只改正式档。');
  const after = deps.floors.get(200)!;
  assert.equal((after.match(/概览。/g) ?? []).length, 1, 'thinking 中第一份保持原样');
  assert.equal((after.match(/只改正式档。/g) ?? []).length, 1, '只修改末尾正式档');
  assert.ok(after.indexOf('概览。') < after.indexOf('只改正式档。'));
});

test('就地编辑并发保护：打开编辑后档案外部变化则拒绝覆盖', async () => {
  const deps = new MockDeps({ 200: '<World_Archive>\n《c | t》\n概览。\n</World_Archive>' }, 400);
  const s = new ArchiverSession(deps, defaultConfig());
  const expectedRaw = liveRawAt(deps, 200);
  deps.floors.set(200, '<World_Archive>\n《c | t》\n外部新改。\n</World_Archive>');
  const before = deps.floors.get(200);
  await assert.rejects(() => s.editLiveContainer(200, expectedRaw, 0, '《c | t》\n我的改动。'), /编辑期间已变化/);
  assert.equal(deps.floors.get(200), before);
});

test('完整性回退：楼层减少 → 检测 → 复原最近 marker 之后的 old_', async () => {
  // 200 层存活 marker 档；250/300 是被某次（marker 已随删楼层丢失）总结退役的 old_
  const deps = new MockDeps(
    {
      200: '<World_Archive>\n《c | t》\n概览\n<!-- archived: 200 -->\n</World_Archive>',
      250: '<old_World_Archive>[事件X | x | t]\n失去新档的旧档1。</old_World_Archive>',
      300: '<old_World_Archive>[事件Y | x | t]\n失去新档的旧档2。</old_World_Archive>',
    },
    350,
  );
  const s = new ArchiverSession(deps, defaultConfig());
  s.config.lastKnownFloor = 400; // 上次记录 400，现在 350 → 删过楼层

  const snap = s.refresh();
  assert.equal(snap.previousFloor, 400);
  assert.equal(snap.currentFloor, 350);
  assert.equal(snap.floorsDecreased, true);
  assert.equal(snap.integrity.needed, true);
  assert.equal(snap.integrity.lastMarkerFloor, 200);
  assert.deepEqual(
    snap.integrity.toRestore.map(e => e.messageId).sort((a, b) => a - b),
    [250, 300],
  );

  await s.integrityRestore(snap.integrity.toRestore);
  for (const f of [250, 300]) {
    assert.ok(deps.floors.get(f)!.includes('<World_Archive>'), '已复原为 live');
    assert.ok(!deps.floors.get(f)!.includes('<old_World_Archive>'));
  }
});

test('完整性回退：pending 优先，存在中断事务时不得同时复原 old_', async () => {
  const deps = new MockDeps(
    {
      200: '<World_Archive>\n《既存 | t》\n概览。\n<!-- archived: 200 -->\n</World_Archive>',
      250: '<old_World_Archive>[待复原 | x | t]\n旧档。</old_World_Archive>',
      300: '<World_Archive_pending>未完成事务</World_Archive_pending>',
    },
    400,
  );
  const cfg = defaultConfig();
  cfg.lastKnownFloor = 350;
  const s = new ArchiverSession(deps, cfg);
  const snap = s.refresh();
  assert.equal(snap.interrupted.length, 1);
  assert.equal(s.config.lastKnownFloor, 350, '恢复现场未清时不得推进完整性基线');
  await assert.rejects(() => s.integrityRestore(snap.integrity.toRestore), /先恢复 pending/);
  assert.ok(deps.floors.get(250)!.includes('<old_World_Archive>'));
});

test('完整性回退：只删正式归档、不删聊天楼层时，真实当前层不被最高归档层冒充', () => {
  const deps = new MockDeps(
    {
      150: '<old_World_Archive>[事件X | x | t]\n待复原。\n</old_World_Archive>',
      400: '<World_Archive>\n《较早档 | t》\n概览。\n</World_Archive>',
      // 聊天实际到 444；原本位于 444 的带 marker 正式档已被用户删除，所以 floor map 里不再有归档块。
    },
    444,
  );
  const cfg = defaultConfig();
  cfg.lastKnownFloor = 444;
  const s = new ArchiverSession(deps, cfg);
  const snap = s.refresh();
  assert.equal(snap.currentFloor, 444, '当前聊天层必须直接来自 getLastMessageId');
  assert.equal(snap.floorsDecreased, false, '只删归档不等于删除楼层');
  assert.equal(snap.integrity.needed, true, '最新 marker 丢失仍应提示覆盖链缺口');
});

// ---------------------------------------------------------------------------
// 提示词内置版 + 用户 override
// ---------------------------------------------------------------------------

test('提示词 override：首次编辑只存覆盖，保存成内置内容时自动删除', () => {
  const deps = scene1();
  const s = new ArchiverSession(deps, defaultConfig());
  const builtin = defaultOrchestration().find(entry => entry.id === 'skeleton')!;

  s.setOrchestrationOverride('skeleton', '用户自定义前置');
  assert.equal(s.orchestrationEntries().find(entry => entry.id === 'skeleton')?.content, '用户自定义前置');
  assert.deepEqual(s.orchestrationState('skeleton'), {
    customized: true,
    builtinUpdateAvailable: false,
  });
  assert.equal(s.config.orchestrationOverrides.skeleton.baseHash, promptFingerprint(builtin.content));

  const stored = deps.vars.chat.memoryArchiver as Record<string, unknown>;
  assert.equal('orchestration' in stored, false, '落盘中不应含整份内置编排');
  assert.ok((stored.orchestrationOverrides as Record<string, unknown>).skeleton);
  const globalStored = deps.vars.global.memoryArchiver as Record<string, unknown>;
  assert.ok(
    (globalStored.orchestrationOverrides as Record<string, unknown>).skeleton,
    '提示词保存后同步成为新对话默认',
  );

  s.setOrchestrationOverride('skeleton', builtin.content);
  assert.equal(s.orchestrationState('skeleton').customized, false);
  assert.equal(s.orchestrationEntries().find(entry => entry.id === 'skeleton')?.content, builtin.content);
  assert.equal(
    'skeleton' in ((deps.vars.global.memoryArchiver as Record<string, unknown>).orchestrationOverrides as Record<string, unknown>),
    false,
    '恢复内置后全局种子也删除该 override',
  );
});

test('提示词 override：内置已变化时重复编辑仍保留旧 baseHash 与更新提示', () => {
  const cfg = defaultConfig();
  cfg.orchestrationOverrides.skeleton = { content: '旧自定义', baseHash: '旧内置指纹' };
  const s = new ArchiverSession(scene1(), cfg);

  assert.equal(s.orchestrationState('skeleton').builtinUpdateAvailable, true);
  s.setOrchestrationOverride('skeleton', '继续修改后的自定义');
  assert.equal(s.config.orchestrationOverrides.skeleton.baseHash, '旧内置指纹');
  assert.equal(s.orchestrationState('skeleton').builtinUpdateAvailable, true);
});

test('提示词 override：单项恢复与全部恢复立即切回内置版', () => {
  const cfg = defaultConfig();
  cfg.orchestrationOverrides.skeleton = { content: '自定义前置', baseHash: 'old-1' };
  cfg.orchestrationOverrides.post = { content: '自定义后置', baseHash: 'old-2' };
  const s = new ArchiverSession(scene1(), cfg);
  assert.deepEqual(s.promptOverrideSummary(), { customized: 2, updates: 2 });

  s.resetOrchestrationOverride('skeleton');
  assert.deepEqual(s.promptOverrideSummary(), { customized: 1, updates: 1 });
  assert.equal(
    s.orchestrationEntries().find(entry => entry.id === 'skeleton')?.content,
    defaultOrchestration().find(entry => entry.id === 'skeleton')?.content,
  );

  s.resetAllOrchestrationOverrides();
  assert.deepEqual(s.promptOverrideSummary(), { customized: 0, updates: 0 });
  assert.deepEqual(s.orchestrationEntries(), defaultOrchestration());
});

test('generate 使用内置版叠加后的有效编排', async () => {
  const deps = scene1();
  deps.genResult = MERGED;
  const cfg = defaultConfig();
  cfg.orchestrationOverrides.skeleton = {
    content: '生成时应发送这份自定义前置',
    baseHash: 'old',
  };
  const s = new ArchiverSession(deps, cfg);
  await s.generate(s.refresh().table);
  assert.equal(deps.genCalls.length, 1);
  assert.equal(deps.genCalls[0].ordered_prompts[0].content, '生成时应发送这份自定义前置');
});

// ---------------------------------------------------------------------------
// 摘要 → 普通总结：全部在场 Archive + x 后 Flux + 空白 y
// ---------------------------------------------------------------------------

test('普通总结收集：给全部完整 World Archive，仅给 x 后完整 Flux', () => {
  const deps = summaryScene();
  const session = new ArchiverSession(deps, defaultConfig());
  const read = session.chatState.scanFresh();
  const collected = session.collectSummary(read);

  assert.deepEqual(collected.archiveFloors, [10, 30]);
  assert.match(collected.archiveContext, /早期相识/);
  assert.match(collected.archiveContext, /近期容器/);
  assert.doesNotMatch(collected.archiveContext, /已退役事件/);
  assert.doesNotMatch(collected.archiveContext, /未完成/);
  assert.doesNotMatch(collected.archiveContext, /已接管旧容器/);
  assert.deepEqual(collected.fluxes.map(flux => flux.floor), [31, 33]);
  assert.match(collected.targetFlux, /<Flux>/);
  assert.match(collected.targetFlux, /<Causal_Flux>/);
  assert.doesNotMatch(collected.targetFlux, /没有 Flux 标签的普通正文/);
});

test('普通总结主路：先创建末尾空白 y，应用后只把 y 写成无 marker Archive', async () => {
  const deps = readySummaryScene();
  deps.genResult = SUMMARY_RESULT;
  const session = new ArchiverSession(deps, defaultConfig());

  const candidate = await session.generateSummary();
  assert.equal(candidate.sourceThrough, 33);
  assert.equal(candidate.placeholderFloor, 34);
  assert.equal(deps.floors.get(34), '');
  assert.equal(deps.roles.get(34), 'assistant');
  assert.equal(session.config.summaryPlaceholderFloor, 34);
  assert.equal(candidate.validation.ok, true);
  const runtimePrompt = deps.genCalls[0].ordered_prompts[1].content;
  assert.equal((runtimePrompt.match(/<Historical_Context>/g) ?? []).length, 1);
  assert.equal((runtimePrompt.match(/<\/Historical_Context>/g) ?? []).length, 1);
  assert.match(runtimePrompt, /早期相识/);
  assert.match(runtimePrompt, /层31：两人在雨中见面/);
  assert.ok(runtimePrompt.indexOf('早期相识') < runtimePrompt.indexOf('层31：两人在雨中见面'));
  assert.doesNotMatch(runtimePrompt, /<Archive_Context>|<Target_Flux>/);

  const appliedFloor = await session.applySummary(candidate);
  assert.equal(appliedFloor, 34);
  assert.equal(deps.floors.get(34), SUMMARY_RESULT);
  assert.doesNotMatch(deps.floors.get(34)!, /archived:/);
  assert.equal(session.config.summaryPlaceholderFloor, null);
  assert.equal(session.phase, 'idle');
});

test('普通总结调试 raw：保留本次整段输出；手改后表示当前候选全量', async () => {
  const deps = readySummaryScene();
  const fullOutput = `<thinking>先核对 Flux，不属于正式正文。</thinking>\n${SUMMARY_RESULT}\n核对完毕。`;
  deps.genResult = fullOutput;
  const session = new ArchiverSession(deps, defaultConfig());
  const candidate = await session.generateSummary();

  assert.equal(candidate.raw, fullOutput);
  const edited = session.editSummaryCandidate(candidate, candidate.body.replace('完成了一次交谈', '完成了关键交谈'));
  assert.match(edited.raw, /^<thinking>先核对 Flux/);
  assert.match(edited.raw, /完成了关键交谈/);
  assert.match(edited.raw, /核对完毕。$/);
});

test('普通总结应用：写回期间进入 committing，写入失败则回 preview 保留候选', async () => {
  const deps = readySummaryScene();
  deps.genResult = SUMMARY_RESULT;
  const session = new ArchiverSession(deps, defaultConfig());
  const candidate = await session.generateSummary();
  const gate = deferred<void>();
  deps.setChatMessages = async () => {
    await gate.promise;
    throw new Error('模拟落盘失败');
  };

  const applying = session.applySummary(candidate);
  assert.equal(session.phase, 'committing', '写位尚未落盘时 UI 必须禁止关闭/放弃');
  gate.resolve();
  await assert.rejects(() => applying, /模拟落盘失败/);
  assert.equal(session.phase, 'preview');
  assert.equal(session.config.summaryPlaceholderFloor, candidate.placeholderFloor);
  assert.equal(session.summaryRetryAvailable(), false, '仍处于结果预览态，而非首次失败重试态');
});

test('普通总结应用中真切聊天：await 返回后停止，不清除旧轮 y/候选状态到新聊天', async () => {
  const deps = readySummaryScene();
  deps.genResult = SUMMARY_RESULT;
  const session = new ArchiverSession(deps, defaultConfig());
  session.chatState.reset('chat-a');
  const candidate = await session.generateSummary();
  const entered = deferred<void>();
  const gate = deferred<void>();
  deps.setChatMessages = async () => {
    entered.resolve();
    await gate.promise;
  };

  const applying = session.applySummary(candidate);
  await entered.promise;
  session.chatState.reset('chat-b');
  gate.resolve();

  await assert.rejects(applying, ChatChangedDuringOperationError);
  assert.equal(session.phase, 'preview');
  assert.equal(session.config.summaryPlaceholderFloor, candidate.placeholderFloor);
  assert.equal(deps.floors.get(candidate.placeholderFloor), '', '旧 y 仍待原聊天后续核对，不迁移候选');
});

test('普通总结失败重试：保持同一 y/来源/连接，只允许更换手动 guidance', async () => {
  const deps = readySummaryScene();
  deps.genError = new Error('临时 API 失败');
  const cfg = defaultConfig();
  cfg.timelineConnectionProfileId = 'timeline-profile';
  cfg.summaryConnectionProfileId = 'summary-profile';
  const session = new ArchiverSession(deps, cfg);

  await assert.rejects(() => session.generateSummary(), /临时 API 失败/);
  const firstY = session.config.summaryPlaceholderFloor;
  assert.equal(firstY, 34);
  assert.equal(session.summaryRetryAvailable(), true);
  const firstRuntime = deps.genCalls[0].ordered_prompts[1].content;

  deps.genError = null;
  deps.genResult = SUMMARY_RESULT;
  session.config.summaryConnectionProfileId = null;
  session.config.summaryOrchestrationOverrides.pre = { content: '中途修改不应污染已冻结轮次', baseHash: 'old' };
  const candidate = await session.retrySummary('请优先保留雨中的那句原话');
  const secondRuntime = deps.genCalls[1].ordered_prompts[1].content;
  assert.equal(candidate.placeholderFloor, firstY);
  assert.equal(deps.floors.get(firstY!), '');
  assert.match(firstRuntime, /层31：两人在雨中见面/);
  assert.match(secondRuntime, /层31：两人在雨中见面/);
  assert.match(secondRuntime, /请优先保留雨中的那句原话/);
  assert.equal(deps.genCalls[0].connection_profile_id, 'summary-profile');
  assert.equal(deps.genCalls[1].connection_profile_id, 'summary-profile');
  assert.equal(
    deps.genCalls[1].ordered_prompts[0].content,
    deps.genCalls[0].ordered_prompts[0].content,
    '同一批来源重试也应冻结开始时的提示词版本',
  );
});

test('普通总结安全写入：y 被正文占用后不覆盖，直接作废本轮', async () => {
  const deps = readySummaryScene();
  deps.genResult = SUMMARY_RESULT;
  const session = new ArchiverSession(deps, defaultConfig());
  const candidate = await session.generateSummary();
  deps.floors.set(candidate.placeholderFloor, '这是后来生成的正文，不能覆盖。');

  await assert.rejects(() => session.applySummary(candidate), /已不是空白 assistant/);
  assert.equal(deps.floors.get(candidate.placeholderFloor), '这是后来生成的正文，不能覆盖。');
  assert.equal(session.config.summaryPlaceholderFloor, null);
  assert.equal(session.phase, 'idle');
});

test('普通总结新一轮：只删除记录中仍空白的旧 y，然后始终在最新末尾创建', async () => {
  const deps = readySummaryScene();
  deps.floors.set(34, '');
  deps.roles.set(34, 'assistant');
  deps.lastId = 34;
  const cfg = defaultConfig();
  cfg.summaryPlaceholderFloor = 34;
  deps.genResult = SUMMARY_RESULT;
  const session = new ArchiverSession(deps, cfg);

  const candidate = await session.generateSummary();
  const blanks = [...deps.floors].filter(([, message]) => message.trim() === '');
  assert.equal(blanks.length, 1, '插件不应累积多个自己记住的空白位');
  assert.equal(candidate.placeholderFloor, deps.lastId);
  assert.equal(deps.floors.get(candidate.placeholderFloor), '');
});

test('普通总结取消：立即释放锁，保留空白 y 与冻结来源供重试', async () => {
  const deps = readySummaryScene();
  const gate = deferred<string>();
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return gate.promise;
  };
  const session = new ArchiverSession(deps, defaultConfig());
  const pending = session.generateSummary();
  await Promise.resolve();
  await Promise.resolve();
  session.cancel();

  await assert.rejects(() => pending, GenerationCancelledError);
  assert.equal(session.phase, 'idle');
  assert.equal(session.summaryRetryAvailable(), true);
  assert.equal(deps.floors.get(session.config.summaryPlaceholderFloor!), '');
});

test('普通总结超时：主动 stop 但不清 y，仍可按同一批来源重试', async () => {
  const deps = readySummaryScene();
  deps.generateRaw = async config => {
    deps.genCalls.push(config);
    return new Promise<string>(() => {});
  };
  const session = new ArchiverSession(deps, defaultConfig(), 10);

  await assert.rejects(() => session.generateSummary(), GenerationTimeoutError);
  assert.equal(session.phase, 'idle');
  assert.equal(session.summaryRetryAvailable(), true);
  assert.equal(deps.floors.get(session.config.summaryPlaceholderFloor!), '');
  assert.equal(deps.stoppedGenerationIds.length, 1);
});

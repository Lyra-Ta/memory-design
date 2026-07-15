import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  commentWrapLastContainer,
  extractArchiveBlocks,
  extractLastArchiveBlock,
  extractCoverageMarkers,
  hasCoverageMarker,
  hasHardError,
  makeCoverageMarker,
  parseArchiveBody,
  parseArchiveNodes,
  repairArchiveOutput,
  serializeArchiveNodes,
  serializeContainers,
  setGeneration,
  stripComments,
  supersedeLastContainer,
  validateArchive,
  withMarkerInside,
  wrapArchive,
} from '../src/core/archive-format';

const VALID = `<World_Archive>
《都市传说调查 | 盛夏》
这个夏天很热，A与B在城市中展开了一系列关于都市传说的调查。两人先调查了废弃大楼，随后前往图书馆查阅资料，其间遇到神秘人物C。

[废弃大楼 | 第一日]
A与B一同进入废弃大楼3楼左侧空房间，发现一个装置。B基于图书馆信息提出新的按键顺序，两人成功启动，房间亮起地图。
· A说“这里不对劲”。B反击后，沉默许久。
· B别开视线把耳环放在桌上，称“只是随便买的”。

[图书馆 | 第二日]
两人在图书馆查阅资料时遇到C。B以高温犯困为借口先行离开。
· B低声说「先走一步」，没有回头。
</World_Archive>`;

// ---------------------------------------------------------------------------
// 抽取：标签世代
// ---------------------------------------------------------------------------

test('extractArchiveBlocks 抽出单个 live 块', () => {
  const blocks = extractArchiveBlocks(VALID);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].generation, 'live');
  assert.match(blocks[0].inner, /都市传说调查/);
});

test('标签天然隔离：live 正则不误伤 old_ / _pending', () => {
  const text = `<old_World_Archive>旧档</old_World_Archive>
<World_Archive_pending>暂存</World_Archive_pending>
<World_Archive>在场</World_Archive>`;
  const blocks = extractArchiveBlocks(text);
  const byGen = Object.fromEntries(blocks.map(b => [b.generation, b.inner]));
  assert.equal(blocks.length, 3);
  assert.equal(byGen.live, '在场');
  assert.equal(byGen.old, '旧档');
  assert.equal(byGen.pending, '暂存');
});

test('extractArchiveBlocks 按出现顺序排序', () => {
  const text = `<World_Archive>甲</World_Archive> 中间 <old_World_Archive>乙</old_World_Archive>`;
  const blocks = extractArchiveBlocks(text);
  assert.deepEqual(blocks.map(b => b.inner), ['甲', '乙']);
});

test('extractLastArchiveBlock：thinking 内完整示例不抢正式归档，取最后闭壳向上最近的开壳', () => {
  const text = `<thinking>示例：<World_Archive>\n《思考里的档 | 旧》\n不应采用。\n</World_Archive></thinking>
<World_Archive>
《正式归档 | 新》
应该采用这一份。
</World_Archive>`;
  const block = extractLastArchiveBlock(text);
  assert.ok(block);
  assert.match(block!.inner, /正式归档/);
  assert.doesNotMatch(block!.inner, /思考里的档/);

  const validation = validateArchive(text);
  assert.equal(validation.block?.inner, block!.inner);
  assert.equal(validation.containers[0].title, '正式归档');
});

test('validateArchive：thinking 有完整档但最后正式档未闭壳时，不回退误收 thinking', () => {
  const text = `<thinking><World_Archive>\n《思考里的档 | 旧》\n不应采用。\n</World_Archive></thinking>
<World_Archive>
《正式归档 | 新》
缺少最终闭壳。`;
  const validation = validateArchive(text);
  assert.equal(validation.block, null);
  assert.ok(validation.issues.some(i => i.code === 'SHELL_UNCLOSED'));
});

test('validateArchive：最后只有落单闭壳时，不得复用 thinking 的开壳拼成伪正式档', () => {
  const text = `<thinking><World_Archive>\n《思考里的档 | 旧》\n不应采用。\n</World_Archive></thinking>
《正式正文 | 新》
缺少正式开壳。
</World_Archive>`;
  const validation = validateArchive(text);
  assert.equal(extractLastArchiveBlock(text), null);
  assert.equal(validation.ok, false);
});

test('repairArchiveOutput：机械补最终闭壳、容器/片段闭合符', () => {
  const broken = `<thinking>已分析</thinking>
<World_Archive>
《正式归档 | 新
概览。
[片段 | 当日
小结。`;
  const repaired = repairArchiveOutput(broken);
  assert.equal(repaired.changed, true);
  assert.match(repaired.text, /《正式归档 \| 新》/);
  assert.match(repaired.text, /\[片段 \| 当日\]/);
  assert.match(repaired.text, /<\/World_Archive>$/);
  assert.equal(validateArchive(repaired.text).ok, true);
});

test('repairArchiveOutput：无外壳但有正式容器时补外壳，不包入 thinking', () => {
  const broken = `<thinking>这里讨论了别的内容。</thinking>
《正式归档 | 新》
概览。`;
  const repaired = repairArchiveOutput(broken);
  assert.equal(repaired.changed, true);
  const block = extractLastArchiveBlock(repaired.text);
  assert.ok(block);
  assert.equal(block!.inner.includes('这里讨论了别的内容'), false);
  assert.equal(validateArchive(repaired.text).ok, true);
});

// ---------------------------------------------------------------------------
// 覆盖标记
// ---------------------------------------------------------------------------

test('extractCoverageMarkers 单端点（只记总结到哪层）', () => {
  const markers = extractCoverageMarkers('前 <!-- archived: 200 --> 后');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].through, 200);
});

test('extractCoverageMarkers 容错旧的 a-b 写法（取尾号为端点）', () => {
  const markers = extractCoverageMarkers('<!-- archived: 200-400 -->');
  assert.equal(markers[0].through, 400);
});

test('makeCoverageMarker 往返', () => {
  const m = extractCoverageMarkers(makeCoverageMarker(200))[0];
  assert.equal(m.through, 200);
});

// ---------------------------------------------------------------------------
// 结构解析
// ---------------------------------------------------------------------------

test('parseArchiveBody：容器 / 片段 / 摘录 / 名·时间', () => {
  const blocks = extractArchiveBlocks(VALID);
  const containers = parseArchiveBody(blocks[0].inner);
  assert.equal(containers.length, 1);
  const c = containers[0];
  assert.equal(c.title, '都市传说调查');
  assert.equal(c.time, '盛夏');
  assert.ok(c.summary.includes('这个夏天'));
  assert.equal(c.fragments.length, 2);
  assert.equal(c.fragments[0].title, '废弃大楼');
  assert.equal(c.fragments[0].time, '第一日');
  assert.equal(c.fragments[0].excerpts.length, 2);
  assert.equal(c.fragments[1].excerpts.length, 1);
});

test('缺时间字段的标题 → time=null', () => {
  const containers = parseArchiveBody('《只有名》\n概览');
  assert.equal(containers[0].title, '只有名');
  assert.equal(containers[0].time, null);
});

test('时间轴容器节点 kind=container、keywords=null', () => {
  const nodes = parseArchiveBody(extractArchiveBlocks(VALID)[0].inner);
  assert.equal(nodes[0].kind, 'container');
  assert.equal(nodes[0].keywords, null);
});

// ---------------------------------------------------------------------------
// 旧扁平格式（此间小镇现有 world archive：<World_Archive> 内一串顶层 [标题|关键词|时间]，无《》）
// ---------------------------------------------------------------------------

const LEGACY = `<World_Archive>
[九龙城大火与初见 | 废墟、烟灰、应激 | 1988年8月12日 15:00-15:40]
江晦在废墟遇到安宁，将其带走。

[诊所上药与带回 | 刺痛、拖鞋、打火机 | 1988年8月12日 15:40-16:40]
明叔上药，江晦把安宁带回公寓。
</World_Archive>`;

test('旧扁平格式：顶层 [] 解析为顶层段（segment），绝不丢内容', () => {
  const nodes = parseArchiveBody(extractArchiveBlocks(LEGACY)[0].inner);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].kind, 'segment');
  assert.equal(nodes[0].title, '九龙城大火与初见');
  assert.equal(nodes[0].keywords, '废墟、烟灰、应激');
  assert.equal(nodes[0].time, '1988年8月12日 15:00-15:40');
  assert.ok(nodes[0].summary.includes('废墟遇到安宁'));
  assert.equal(nodes[0].fragments.length, 0);
  assert.equal(nodes[1].kind, 'segment');
  assert.equal(nodes[1].title, '诊所上药与带回');
});

test('旧扁平格式 解析→序列化→再解析 结构无损', () => {
  const first = parseArchiveBody(extractArchiveBlocks(LEGACY)[0].inner);
  const round = parseArchiveBody(serializeContainers(first));
  assert.deepEqual(round, first);
});

test('结构判定：三段式 [标题|关键词|时间] 即使夹在容器后也识别为顶层段', () => {
  const nodes = parseArchiveBody('《容器 | t》\n概览\n[旧事件 | 意象 | 时间X]\n旧总结');
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].kind, 'container');
  assert.equal(nodes[1].kind, 'segment');
  assert.equal(nodes[1].title, '旧事件');
});

test('结构判定：两段式 [] 在容器内 = 片段，不会被误抓成顶层', () => {
  const nodes = parseArchiveBody('《容器 | t》\n概览\n[片段 | 时间]\n小结');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].fragments.length, 1);
  assert.equal(nodes[0].fragments[0].title, '片段');
});

test('结构判定：两段式 [] 无开启容器时不丢，收作顶层段', () => {
  const nodes = parseArchiveBody('[孤立 | 时间]\n总结');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'segment');
});

test('旧扁平格式送进生成校验闸 → NO_CONTAINER 硬错（生成产物必须是时间轴格式）', () => {
  const r = validateArchive(LEGACY);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'NO_CONTAINER'));
});

// ---------------------------------------------------------------------------
// 序列化 + 往返
// ---------------------------------------------------------------------------

test('解析 → 序列化 → 再解析：结构无损', () => {
  const first = parseArchiveBody(extractArchiveBlocks(VALID)[0].inner);
  const round = parseArchiveBody(serializeContainers(first));
  assert.deepEqual(round, first);
});

test('wrapArchive 套外壳后可被重新抽取', () => {
  const body = serializeContainers(parseArchiveBody(extractArchiveBlocks(VALID)[0].inner));
  const wrapped = wrapArchive(body, 'pending');
  const blocks = extractArchiveBlocks(wrapped);
  assert.equal(blocks[0].generation, 'pending');
});

// ---------------------------------------------------------------------------
// 换代（两段提交用）
// ---------------------------------------------------------------------------

test('setGeneration：pending → live，内容不动', () => {
  const raw = `<World_Archive_pending>\n《c | t》\n概览\n</World_Archive_pending>`;
  const live = setGeneration(raw, 'live');
  assert.equal(live, `<World_Archive>\n《c | t》\n概览\n</World_Archive>`);
});

test('setGeneration：live → old', () => {
  const raw = `<World_Archive>正文</World_Archive>`;
  assert.equal(setGeneration(raw, 'old'), `<old_World_Archive>正文</old_World_Archive>`);
});

// ---------------------------------------------------------------------------
// 校验：合法档案
// ---------------------------------------------------------------------------

test('validateArchive：合法档案 ok、无硬错', () => {
  const r = validateArchive(VALID);
  assert.equal(r.ok, true);
  assert.equal(hasHardError(r.issues), false);
});

// ---------------------------------------------------------------------------
// 校验：硬错（拦保存）
// ---------------------------------------------------------------------------

test('硬错 SHELL_MISSING', () => {
  const r = validateArchive('没有任何标签的裸文本');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'SHELL_MISSING'));
});

test('硬错 SHELL_UNCLOSED', () => {
  const r = validateArchive('<World_Archive>《c | t》\n概览');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'SHELL_UNCLOSED'));
});

test('硬错 NO_CONTAINER（空外壳）', () => {
  const r = validateArchive('<World_Archive>\n\n</World_Archive>');
  assert.ok(r.issues.some(i => i.code === 'NO_CONTAINER'));
});

test('硬错 CONTAINER_SUMMARY_EMPTY（标题直接接标题）', () => {
  const r = validateArchive('<World_Archive>\n《空容器 | t》\n《下一个 | t2》\n有总结\n</World_Archive>');
  assert.ok(r.issues.some(i => i.code === 'CONTAINER_SUMMARY_EMPTY'));
});

test('硬错 CONTAINER_TOKEN_BROKEN（半个容器 token）', () => {
  const r = validateArchive('<World_Archive>\n《没闭合的标题\n概览\n</World_Archive>');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'CONTAINER_TOKEN_BROKEN'));
});

test('硬错 FRAGMENT_TOKEN_BROKEN（半个片段 token）', () => {
  const r = validateArchive('<World_Archive>\n《c | t》\n概览\n[没闭合的片段\n小结\n</World_Archive>');
  assert.ok(r.issues.some(i => i.code === 'FRAGMENT_TOKEN_BROKEN'));
});

// ---------------------------------------------------------------------------
// 校验：假阳性守卫——中文书名号《》出现在正文里不能误判硬错
// ---------------------------------------------------------------------------

test('正文中段的书名号《…》不触发硬错', () => {
  const text = `<World_Archive>
《调查 | 盛夏》
两人在图书馆读了《都市传说考》与《民俗志》，随后离开。
[图书馆 | 第二日]
他们查阅资料。
· A把《民俗志》塞进包里。
</World_Archive>`;
  const r = validateArchive(text);
  assert.equal(hasHardError(r.issues), false, '书名号不应被判成半个容器 token');
});

// ---------------------------------------------------------------------------
// 校验：软疑（不拦，只建议）
// ---------------------------------------------------------------------------

test('软疑 CONTAINER_TIME_MISSING + CONTAINER_NO_FRAGMENT', () => {
  const r = validateArchive('<World_Archive>\n《只有名》\n只有大总结、没有片段。\n</World_Archive>');
  assert.equal(r.ok, true); // 软疑不拦
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes('CONTAINER_TIME_MISSING'));
  assert.ok(codes.includes('CONTAINER_NO_FRAGMENT'));
});

test('软疑 FRAGMENT_NO_EXCERPT', () => {
  const r = validateArchive('<World_Archive>\n《c | t》\n概览\n[片段 | t2]\n只有小总结、没有摘录。\n</World_Archive>');
  assert.equal(r.ok, true);
  assert.ok(r.issues.some(i => i.code === 'FRAGMENT_NO_EXCERPT'));
});

test('软疑 BRACKET_UNBALANCED（「」不闭合）', () => {
  const r = validateArchive('<World_Archive>\n《c | t》\n概览\n[片段 | t2]\n小结\n· 他说「还没说完\n</World_Archive>');
  assert.equal(r.ok, true);
  assert.ok(r.issues.some(i => i.code === 'BRACKET_UNBALANCED'));
});

// ---------------------------------------------------------------------------
// 覆盖标记打在档案内部 · 注释剥离 · 增量覆写包裹
// ---------------------------------------------------------------------------

test('withMarkerInside + hasCoverageMarker：带标记=既存、不带=原始', () => {
  const body = withMarkerInside('《c | t》\n概览', 200);
  assert.ok(body.endsWith('<!-- archived: 200 -->'));
  assert.equal(hasCoverageMarker(body), true);
  assert.equal(hasCoverageMarker('《c | t》\n概览'), false);
});

test('stripComments：抹掉 marker 与被包裹的旧容器', () => {
  const t = '《c1 | t》\n概览\n<!-- 《旧容器》\n旧概览 -->\n<!-- archived: 200 -->';
  const s = stripComments(t);
  assert.ok(!s.includes('<!--'));
  assert.ok(!s.includes('旧容器'));
  assert.ok(s.includes('c1'));
});

test('parseArchiveBody 显示前滤注释：内嵌 marker 与被包裹容器不成节点', () => {
  const nodes = parseArchiveBody('《c1 | t》\n概览\n<!-- 《被接管 | t》\n旧 -->\n<!-- archived: 200 -->');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].title, 'c1');
});

test('commentWrapLastContainer：只包末尾容器、marker 留在包裹外仍可读', () => {
  const inner = '《容器1 | t1》\n概览1\n《容器2 | t2》\n概览2\n<!-- archived: 200 -->';
  const w = commentWrapLastContainer(inner);
  assert.ok(w.includes('<!-- 《容器2'), '末尾容器被包裹');
  assert.ok(w.includes('《容器1 | t1》'), '前面的容器不动');
  assert.ok(w.includes('<!-- archived: 200 -->'), 'marker 不进包裹、仍可读');
  // 显示（滤注释）后只剩容器1
  assert.deepEqual(
    parseArchiveBody(w).map(n => n.title),
    ['容器1'],
  );
});

test('supersedeLastContainer：既存档仍 live、marker 仍可读、末尾容器已冷存', () => {
  const raw = '<World_Archive>\n《c1 | t1》\n概览1\n《c2 | t2》\n概览2\n<!-- archived: 200 -->\n</World_Archive>';
  const out = supersedeLastContainer(raw);
  assert.equal(extractArchiveBlocks(out)[0].generation, 'live');
  assert.equal(hasCoverageMarker(out), true);
  assert.deepEqual(
    parseArchiveBody(extractArchiveBlocks(out)[0].inner).map(n => n.title),
    ['c1'],
  );
});

// ---------------------------------------------------------------------------
// 无损节点层：编辑写回用（保住 marker + 被接管旧容器）
// ---------------------------------------------------------------------------

const WITH_COMMENTS = `《旧容器1 | 上半年》
概览1发生了什么。
[片段1 | 早春]
片段小总结。
· 一条摘录。
<!-- 《旧末尾 | 下半年》
概览2发生了什么。 -->
《合并档 | 全年》
把若干段合并成的时间轴大总结。
<!-- archived: 200 -->`;

test('extractArchiveBlocks：思维链里的游离 <World_Archive> 不误抓，取真正的那份', () => {
  const text =
    '<inner_flow>\n分析：输出格式用 <World_Archive> 包裹。\n无<old_World_Archive>。\n</inner_flow>\n' +
    '<World_Archive>\n《真档 | 时间》\n概览。\n</World_Archive>';
  const live = extractArchiveBlocks(text).filter(b => b.generation === 'live');
  assert.equal(live.length, 1);
  assert.match(live[0].inner, /真档/);
  assert.ok(!live[0].inner.includes('分析：'), '没从思维链里的游离开标签开抓');
  assert.ok(!live[0].inner.includes('inner_flow'), '没把思维链卷进档案');
});

test('extractArchiveBlocks：同层 old_ 在前、live 在后，两块都正确配对', () => {
  const text = '<old_World_Archive>\n[旧 | x | t]\n旧总结。\n</old_World_Archive>\n\n<World_Archive>\n《新 | t》\n新总结。\n</World_Archive>';
  const blocks = extractArchiveBlocks(text);
  assert.deepEqual(
    blocks.map(b => b.generation),
    ['old', 'live'],
  );
  assert.match(blocks[0].inner, /旧总结/);
  assert.match(blocks[1].inner, /新总结/);
});

test('parseArchiveBody：滤掉游离标签行（旧损坏档/框架残留），不渲染成乱码', () => {
  const junk = '《正常容器 | 时间》\n概览一句。\n<World_Archive>\n</inner_flow>\n<Manifestation_Laws>';
  const cs = parseArchiveBody(junk);
  // 三行游离标签（<World_Archive> / </inner_flow> / <Manifestation_Laws>）被跳过，不混进总结
  assert.equal(cs.length, 1);
  assert.equal(cs[0].title, '正常容器');
  assert.equal(cs[0].summary, '概览一句。');
  assert.ok(!cs[0].summary.includes('<'), '尖括号标签没混进总结');
});

test('parseArchiveNodes：可见容器解析、注释块（被接管旧容器 + marker）原样留存', () => {
  const nodes = parseArchiveNodes(WITH_COMMENTS);
  assert.deepEqual(
    nodes.map(n => (n.type === 'container' ? `C:${n.container.title}` : 'COMMENT')),
    ['C:旧容器1', 'COMMENT', 'C:合并档', 'COMMENT'],
  );
  // 可见容器只有两个（被接管的旧末尾不算可见）
  assert.equal(nodes.filter(n => n.type === 'container').length, 2);
});

test('节点层 round-trip：注释块（旧容器 + marker）一字不丢、可见结构不变', () => {
  const out = serializeArchiveNodes(parseArchiveNodes(WITH_COMMENTS));
  assert.ok(out.includes('<!-- 《旧末尾 | 下半年》'), '被接管旧容器原样留存');
  assert.ok(out.includes('<!-- archived: 200 -->'), '覆盖标记原样留存');
  // 再解析一遍：可见容器、摘录都在
  assert.deepEqual(
    parseArchiveBody(out).map(c => c.title),
    ['旧容器1', '合并档'],
  );
  assert.equal(parseArchiveBody(out)[0].fragments[0].excerpts[0].text, '一条摘录。');
  // marker 仍可被 hasCoverageMarker 认出
  assert.equal(hasCoverageMarker(out), true);
});

test('节点层：改一个可见容器，注释块与其余容器不受影响', () => {
  const nodes = parseArchiveNodes(WITH_COMMENTS);
  const first = nodes.find(n => n.type === 'container');
  if (first?.type === 'container') first.container.summary = '改写后的概览1。';
  const out = serializeArchiveNodes(nodes);
  assert.ok(out.includes('改写后的概览1。'), '改动生效');
  assert.ok(out.includes('<!-- 《旧末尾 | 下半年》'), '注释旧容器仍在');
  assert.ok(out.includes('<!-- archived: 200 -->'), 'marker 仍在');
  assert.deepEqual(parseArchiveBody(out).map(c => c.title), ['旧容器1', '合并档'], '其余容器不受影响');
});

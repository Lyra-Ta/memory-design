/**
 * 记忆插件 · 档案格式核心（canonical token · 一套三家共用）
 * ------------------------------------------------------------
 * 一套 token → 正则抓取 / 结构化编辑 / 生成校验 三家共用。
 * 时间轴 canonical（2026-07-11 锁定）：
 *   容器 《标题 | 时间》 · 片段 [标题 | 时间] · 摘录 ·（行首中点）· 外壳 <World_Archive>…</World_Archive>
 *
 * **两种格式并存**（过渡期）：
 *   - 时间轴档案：《》容器 + 其下 [] 片段 + · 摘录。
 *   - 旧「待整理」档案（此间小镇 正文→flux→archive 的产物）：<World_Archive> 内是一串
 *     **顶层 [标题 | 关键词 | 时间] 段**（三段·两处隔断）、无《》容器。解析**按 token 结构**判定：
 *     三段式 [] = 旧式顶层段（segment），两段式 [] 且有开着的容器 = 该容器的片段——
 *     这样绝不把容器内片段误抓成顶层，旧档也绝不丢内容。
 *
 * 覆盖标记（2026-07-11）：只记「总结到哪一层」的端点 <!-- archived: N -->，**打在 <World_Archive> 内部末尾**、
 *   绑定该档；带标记 = 既存（时间轴化过）、不带 = 原始（flux 扁平待整理）。
 *   预览/时间轴/编辑显示前用 stripComments 滤掉所有注释（marker + 被接管的旧容器），插件绝不暴露这些标签。
 */

import type {
  ArchiveBlock,
  Container,
  CoverageMarker,
  Excerpt,
  Fragment,
  Generation,
  ParsedArchive,
  ValidationIssue,
} from './types';

/** 档案外壳基名（未来可配置）。live / old / pending 均由它派生，换名只改这一处。 */
export const TAG = 'World_Archive';

const OPEN: Record<Generation, string> = {
  live: `<${TAG}>`,
  old: `<old_${TAG}>`,
  pending: `<${TAG}_pending>`,
};
const CLOSE: Record<Generation, string> = {
  live: `</${TAG}>`,
  old: `</old_${TAG}>`,
  pending: `</${TAG}_pending>`,
};

/** 摘录行首可接受的中点变体（都归一化为 canonical `·`） */
const EXCERPT_MARKERS = ['·', '•', '・'];
/** canonical 摘录标记 */
export const EXCERPT_MARK = '·';

const CONTAINER_LINE = /^《\s*([^《》]*?)\s*》$/;
const FRAGMENT_LINE = /^\[\s*([^[\]]*?)\s*\]$/;
/**
 * 游离的 XML 式标签行（如 <World_Archive>、</inner_flow>、<Manifestation_Laws>）。
 * 档案正文是散文，绝不会整行是一个尖括号标签；这种行只可能是**旧损坏档 / 别的预设框架残留**混进来的。
 * 显示解析时跳过，避免把标签汤渲染成乱码容器（不改动落盘数据）。
 */
const STRAY_TAG_LINE = /^<\/?[A-Za-z_][\w:.-]*(\s[^<>]*)?\/?>$/;

// ============================================================
// 抽取：标签世代 与 覆盖标记
// ============================================================

/** 某世代所有开/闭标签的下标（字面 indexOf，标签天然隔离，互不误伤） */
function tagIndices(text: string, tag: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(tag); i !== -1; i = text.indexOf(tag, i + tag.length)) out.push(i);
  return out;
}

/**
 * 抽某一世代的档案块：**以闭合标签为锚**，每个 `</…>` 配「离它最近、且在上一块之后」的 `<…>`。
 * 这样能跳过真正档案之前的**游离开标签**（如此间小镇 flux 思维链 <inner_flow> 里出现的 <World_Archive> 字样）——
 * 之前用「第一个开标签非贪婪到第一个闭标签」会从思维链那个就开抓，抓错。
 */
function blocksForGen(text: string, gen: Generation): ArchiveBlock[] {
  const open = OPEN[gen];
  const close = CLOSE[gen];
  const opens = tagIndices(text, open);
  const closes = tagIndices(text, close);
  const blocks: ArchiveBlock[] = [];
  let consumed = -1; // 已配对到的最右闭标签位置，防止把它之前的开标签再用
  for (const c of closes) {
    let best = -1;
    for (const o of opens) {
      if (o >= c) break; // opens 升序，越过当前闭标签即止
      if (o > consumed) best = o; // 取最右（离闭标签最近）的合法开标签
    }
    if (best === -1) continue; // 落单的闭标签（如思维链里的），无开标签可配 → 跳过
    const end = c + close.length;
    blocks.push({ generation: gen, raw: text.slice(best, end), inner: text.slice(best + open.length, c).trim(), span: [best, end] });
    consumed = c;
  }
  return blocks;
}

/**
 * 抽取一段文本里所有的档案块（三种世代），按出现顺序返回。
 * 依赖「标签天然隔离」：live 外壳与 old_ / _pending 是字面不同的串，各自互不误伤。
 * 配对以闭合标签为锚（见 blocksForGen）——绕开真正档案之前的游离开标签。
 */
export function extractArchiveBlocks(text: string): ArchiveBlock[] {
  const blocks: ArchiveBlock[] = [];
  for (const gen of ['live', 'old', 'pending'] as Generation[]) blocks.push(...blocksForGen(text, gen));
  return blocks.sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * 取某世代在文本里的**最后一份完整档案**：先锚定最后一个闭标签，再向上找离它最近的开标签。
 *
 * 生成结果专用语义：模型可能在 thinking 中先举出一份完整 `<World_Archive>`，正式归档则在输出末尾；
 * 此时不能用 `find()` 取第一份。聊天楼层扫描仍应使用 `extractArchiveBlocks()`，因为同层多档都要保留。
 */
export function extractLastArchiveBlock(text: string, generation: Generation = 'live'): ArchiveBlock | null {
  const close = CLOSE[generation];
  const closeAt = text.lastIndexOf(close);
  if (closeAt < 0) return null;
  const end = closeAt + close.length;
  // 复用“不重复使用已配对开标签”的通用配对结果；最后闭标签若是落单的，不能倒回去偷用 thinking 的开标签。
  return blocksForGen(text, generation).find(b => b.span[1] === end) ?? null;
}

export interface ArchiveRepairResult {
  text: string;
  changed: boolean;
  fixes: string[];
}

/** 只补机械且无歧义的行首结构符号；正文语义一字不改。 */
function repairStructureLines(inner: string, fixes: string[]): string {
  return inner
    .split('\n')
    .map(raw => {
      const line = raw.trim();
      if (line.startsWith('《') && !line.includes('》')) {
        fixes.push('补上容器标题闭合符 》');
        return `${raw}》`;
      }
      if (line.startsWith('[') && !line.includes(']')) {
        fixes.push('补上片段标题闭合符 ]');
        return `${raw}]`;
      }
      return raw;
    })
    .join('\n');
}

/**
 * 对模型输出做保守的一键补正：
 * - 最后一份正式档案只有开壳时，补 `</World_Archive>`；
 * - 完全没外壳但存在正式《容器》正文时，补上外壳；
 * - 标题行明显只缺 `》` / `]` 时补闭合符。
 *
 * 不改写内容、不猜标题/时间、不修语义；无法机械确定的错误原样留下，继续由校验拦截。
 */
export function repairArchiveOutput(text: string): ArchiveRepairResult {
  let repaired = text;
  const fixes: string[] = [];
  const lastOpen = repaired.lastIndexOf(OPEN.live);
  const lastClose = repaired.lastIndexOf(CLOSE.live);

  // 正式输出常在 thinking 之后；若最后一个开壳落在最后闭壳之后，它就是未闭合的最终档案。
  if (lastOpen >= 0 && lastOpen > lastClose) {
    repaired = `${repaired.trimEnd()}\n${CLOSE.live}`;
    fixes.push(`补上 ${CLOSE.live}`);
  } else if (lastOpen < 0 && lastClose < 0) {
    // 无任何外壳：只在能找到独立成行的《容器》时补壳；优先丢掉 </thinking> 之前的思考文本。
    const thinkingEnd = repaired.lastIndexOf('</thinking>');
    const searchFrom = thinkingEnd >= 0 ? thinkingEnd + '</thinking>'.length : 0;
    const tail = repaired.slice(searchFrom);
    const container = tail.match(/^\s*《[^\n]*$/m);
    if (container && container.index !== undefined) {
      const body = tail.slice(container.index).trim();
      repaired = `${repaired.slice(0, searchFrom).trimEnd()}${searchFrom > 0 ? '\n' : ''}${OPEN.live}\n${body}\n${CLOSE.live}`;
      fixes.push(`补上 ${OPEN.live}…${CLOSE.live} 外壳`);
    }
  }

  const block = extractLastArchiveBlock(repaired, 'live');
  if (block) {
    const inner = repairStructureLines(block.inner, fixes);
    if (inner !== block.inner) {
      const rebuilt = `${OPEN.live}\n${inner}\n${CLOSE.live}`;
      repaired = repaired.slice(0, block.span[0]) + rebuilt + repaired.slice(block.span[1]);
    }
  }

  return { text: repaired, changed: fixes.length > 0, fixes: [...new Set(fixes)] };
}

/**
 * 抽取覆盖标记。canonical 是单端点 `<!-- archived: N -->`（总结到哪一层）；
 * 也**容错**旧的 `a-b` 两端写法，取尾号 b 作为端点。
 */
export function extractCoverageMarkers(text: string): CoverageMarker[] {
  const re = /<!--\s*archived:\s*(?:\d+\s*-\s*)?(\d+)\s*-->/g;
  const markers: CoverageMarker[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    markers.push({ through: Number(m[1]), span: [m.index, m.index + m[0].length] });
  }
  return markers;
}

/** 生成一条覆盖标记文本：只记总结到的层 N。**打在档案外壳内部末尾**、绑定该档。 */
export function makeCoverageMarker(through: number): string {
  return `<!-- archived: ${through} -->`;
}

/** 把覆盖标记接在正文末尾（提交时随正文一起套进 <World_Archive> 内部） */
export function withMarkerInside(body: string, through: number): string {
  return `${body}\n${makeCoverageMarker(through)}`;
}

/** 该档案正文里是否带覆盖标记——带 = 既存（时间轴化过），不带 = 原始（flux 扁平待整理） */
export function hasCoverageMarker(text: string): boolean {
  return /<!--\s*archived:\s*\d+\s*-->/.test(text);
}

/** 抹掉所有 HTML 注释（marker + 被注释包裹的旧容器）——预览/时间轴/编辑显示前用 */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 用 HTML 注释就地包裹一段文本（被增量覆写接管的旧容器 → 冷存、不显示、不注入） */
export function commentWrap(text: string): string {
  return `<!-- ${text} -->`;
}

/**
 * 把一份档案正文里**最后一个《》容器**用 HTML 注释就地包裹（增量覆写：末尾容器被新档接管）。
 * 只包容器本体，跨过末尾可能存在的 `<!-- archived -->` marker（marker 不进包裹、仍可读）。
 * 没有容器则原样返回。
 */
export function commentWrapLastContainer(inner: string): string {
  const lines = inner.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (CONTAINER_LINE.test(lines[i].trim())) start = i;
  if (start === -1) return inner;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (CONTAINER_LINE.test(lines[i].trim()) || /<!--\s*archived:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const head = lines.slice(0, start).join('\n').replace(/\n+$/, '');
  const wrapped = commentWrap(lines.slice(start, end).join('\n').trim());
  const tail = lines.slice(end).join('\n').replace(/^\n+/, '');
  return [head, wrapped, tail].filter(s => s.length > 0).join('\n');
}

// ============================================================
// 结构解析：文本 → 容器 / 片段 / 摘录（格式自适应）
// ============================================================

function splitLabel(raw: string): { title: string; keywords: string | null; time: string | null } {
  const parts = raw.split('|').map(s => s.trim());
  if (parts.length <= 1) return { title: raw.trim(), keywords: null, time: null };
  const title = parts[0];
  const time = parts[parts.length - 1] || null;
  const keywords = parts.length >= 3 ? parts.slice(1, -1).join(' | ') || null : null;
  return { title, keywords, time };
}

function excerptMark(line: string): string | null {
  for (const mark of EXCERPT_MARKERS) if (line.startsWith(mark)) return mark;
  return null;
}

function newContainer(kind: 'container' | 'segment', label: string): Container {
  const { title, keywords, time } = splitLabel(label);
  return { kind, title, time, keywords, summary: '', fragments: [] };
}

/**
 * 把外壳内部的正文解析成顶层节点数组（容器或旧段），**按 token 结构自适应**、绝不丢内容。
 *
 * 判定靠**结构**，不靠"块内有没有《》"（那样易把容器内片段也误抓成顶层）：
 *  - `《标题 | 时间》`                → 时间轴容器（顶层节点）。
 *  - `[标题 | 关键词 | 时间]`（三段·两处隔断）→ 旧式顶层段（kind='segment'，顶层节点）。
 *  - `[标题 | 时间]`（两段）且当前有开着的《》容器 → 该容器的片段。
 *  - 两段 [] 但当前没有开着的容器 → 也收作顶层段，绝不丢。
 * 解析→序列化 对内容无损（空白会规整，但标题/关键词/时间/总结/摘录不丢）。
 */
export function parseArchiveBody(rawInner: string): Container[] {
  // 显示前先滤掉所有 HTML 注释（覆盖标记 + 被接管的旧容器）：插件里绝不显示这些
  const inner = stripComments(rawInner);
  const nodes: Container[] = [];
  let node: Container | null = null; // 最近的顶层节点（容器或旧段）——总结/散摘录挂这
  let container: Container | null = null; // 最近的《》容器——片段挂这
  let fragment: Fragment | null = null;

  const appendSummary = (line: string) => {
    if (fragment) fragment.summary = fragment.summary ? `${fragment.summary}\n${line}` : line;
    else if (node) node.summary = node.summary ? `${node.summary}\n${line}` : line;
  };

  for (const rawLine of inner.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (STRAY_TAG_LINE.test(line)) continue; // 游离标签行（旧损坏档/别的框架残留）——不当内容

    const cm = line.match(CONTAINER_LINE);
    if (cm) {
      node = container = newContainer('container', cm[1]);
      fragment = null;
      nodes.push(node);
      continue;
    }

    const fm = line.match(FRAGMENT_LINE);
    if (fm) {
      const fieldCount = fm[1].split('|').length;
      if (fieldCount >= 3 || !container) {
        // 三段式旧标题，或当前无开着的容器 → 顶层段
        node = newContainer('segment', fm[1]);
        container = null; // 旧段不接片段
        fragment = null;
        nodes.push(node);
      } else {
        // 两段式片段，挂在当前容器下
        const { title, time } = splitLabel(fm[1]);
        fragment = { title, time, summary: '', excerpts: [] };
        container.fragments.push(fragment);
      }
      continue;
    }

    const mark = excerptMark(line);
    if (mark) {
      const ex: Excerpt = { text: line.slice(mark.length).trim() };
      if (fragment) fragment.excerpts.push(ex);
      else if (node) (node.looseExcerpts ??= []).push(ex);
      continue;
    }

    appendSummary(line);
  }

  return nodes;
}

/** 抽取并解析一段文本里指定世代的第一份档案（默认 live）。找不到返回 null。 */
export function parseArchive(text: string, generation: Generation = 'live'): ParsedArchive | null {
  const block = extractArchiveBlocks(text).find(b => b.generation === generation);
  if (!block) return null;
  return { generation, containers: parseArchiveBody(block.inner) };
}

// ============================================================
// 序列化：结构 → canonical 文本
// ============================================================

function labelToken(open: string, close: string, title: string, keywords: string | null, time: string | null): string {
  const parts = [title];
  if (keywords) parts.push(keywords);
  if (time) parts.push(time);
  return `${open}${parts.join(' | ')}${close}`;
}

/** 顶层节点数组 → canonical 正文（不含外壳标签）。容器出《》、旧段出 []。 */
export function serializeContainers(nodes: Container[]): string {
  const blocks: string[] = [];
  for (const c of nodes) {
    const [open, close] = c.kind === 'segment' ? ['[', ']'] : ['《', '》'];
    const lines: string[] = [labelToken(open, close, c.title, c.keywords, c.time)];
    if (c.summary) lines.push(c.summary);
    for (const ex of c.looseExcerpts ?? []) lines.push(`${EXCERPT_MARK} ${ex.text}`);
    for (const f of c.fragments) {
      lines.push('');
      lines.push(labelToken('[', ']', f.title, null, f.time));
      if (f.summary) lines.push(f.summary);
      for (const ex of f.excerpts) lines.push(`${EXCERPT_MARK} ${ex.text}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n').trim();
}

/** 给正文套上指定世代的外壳标签 */
export function wrapArchive(body: string, generation: Generation = 'live'): string {
  return `${OPEN[generation]}\n${body}\n${CLOSE[generation]}`;
}

// ============================================================
// 无损节点层：就地编辑写回用（保住注释：marker + 被接管的旧容器）
// ------------------------------------------------------------
// parseArchiveBody 为「显示」而生，会滤掉所有注释——直接拿它的结果反序列化写回，
// 会丢掉覆盖标记与被增量覆写包裹的旧容器。编辑写回必须无损，所以在「可见容器」之外
// 把注释区当作**不透明节点**原样保留，序列化时按原顺序穿插回去。
// ============================================================

/** 档案正文的一个顶层节点：可见容器 或 不透明注释块（marker / 被接管的旧容器，原样保留）。 */
export type ArchiveNode =
  | { type: 'container'; container: Container }
  | { type: 'comment'; raw: string };

/**
 * 把外壳内部正文解析成**无损节点序列**：注释块原样留存、可见容器解析成结构。
 * 编辑只动 container 节点，序列化时 comment 节点原样穿插回去 → marker 与被接管旧容器一个不丢。
 */
export function parseArchiveNodes(inner: string): ArchiveNode[] {
  const nodes: ArchiveNode[] = [];
  // 用捕获组 split：注释块被单独切出来、原样留存；其余按可见容器解析
  for (const part of inner.split(/(<!--[\s\S]*?-->)/g)) {
    if (!part.trim()) continue;
    if (/^<!--[\s\S]*-->$/.test(part.trim())) {
      nodes.push({ type: 'comment', raw: part.trim() });
    } else {
      for (const container of parseArchiveBody(part)) nodes.push({ type: 'container', container });
    }
  }
  return nodes;
}

/** 无损节点序列 → canonical 正文：相邻容器合并序列化，注释块原样穿插。 */
export function serializeArchiveNodes(nodes: ArchiveNode[]): string {
  const pieces: string[] = [];
  let buf: Container[] = [];
  const flush = () => {
    if (buf.length) {
      pieces.push(serializeContainers(buf));
      buf = [];
    }
  };
  for (const n of nodes) {
    if (n.type === 'container') buf.push(n.container);
    else {
      flush();
      pieces.push(n.raw);
    }
  }
  flush();
  return pieces.join('\n\n').trim();
}

/**
 * 只改外壳标签、不动内容——把一个档案块换代（如 pending→live、live→old）。
 * 传入含标签的完整原文，返回换代后的完整原文。识别不出当前世代时原样返回。
 */
export function setGeneration(raw: string, to: Generation): string {
  const trimmed = raw.trim();
  for (const from of ['live', 'old', 'pending'] as Generation[]) {
    if (trimmed.startsWith(OPEN[from]) && trimmed.endsWith(CLOSE[from])) {
      const inner = trimmed.slice(OPEN[from].length, trimmed.length - CLOSE[from].length);
      return `${OPEN[to]}${inner}${CLOSE[to]}`;
    }
  }
  return raw;
}

/**
 * 增量覆写：把一份档案的**最后一个《》容器**就地注释包裹（被新档接管、冷存、不显示不注入），
 * 世代标签不变（既存档仍是 live）。识别不出世代则原样返回。
 */
export function supersedeLastContainer(archiveRaw: string): string {
  const trimmed = archiveRaw.trim();
  for (const gen of ['live', 'old', 'pending'] as Generation[]) {
    if (trimmed.startsWith(OPEN[gen]) && trimmed.endsWith(CLOSE[gen])) {
      const inner = trimmed.slice(OPEN[gen].length, trimmed.length - CLOSE[gen].length).trim();
      return `${OPEN[gen]}\n${commentWrapLastContainer(inner)}\n${CLOSE[gen]}`;
    }
  }
  return archiveRaw;
}

// ============================================================
// 结构校验：硬错拦保存 / 软疑给建议（只查结构，不查语义）
// ============================================================

export interface ValidationResult {
  /** 无硬错即 ok（软疑不拦） */
  ok: boolean;
  issues: ValidationIssue[];
  /** 命中的 live 档案块（若有） */
  block: ArchiveBlock | null;
  /** 解析出的顶层节点（若外壳存在） */
  containers: Container[];
}

function hard(code: string, message: string, extra?: Partial<ValidationIssue>): ValidationIssue {
  return { severity: 'hard', code, message, ...extra };
}
function soft(code: string, message: string, extra?: Partial<ValidationIssue>): ValidationIssue {
  return { severity: 'soft', code, message, ...extra };
}

/** 一行里是否夹着「半个/落单」的容器或片段 token（高精度，避开中文书名号《》与正文方括号） */
function brokenTokenIssue(line: string): ValidationIssue | null {
  if (line.startsWith('《') && !CONTAINER_LINE.test(line)) {
    return hard('CONTAINER_TOKEN_BROKEN', `容器标题 token 不完整或未独立成行：「${line}」`);
  }
  if (line.startsWith('》')) {
    return hard('CONTAINER_TOKEN_BROKEN', `落单的容器闭合符 》：「${line}」`);
  }
  if (line.startsWith('[') && !FRAGMENT_LINE.test(line)) {
    return hard('FRAGMENT_TOKEN_BROKEN', `片段标题 token 不完整或未独立成行：「${line}」`);
  }
  return null;
}

/**
 * 校验一段（generateRaw 的）输出里的 live 档案是否结构合法 —— 生成校验闸，**严格要求时间轴格式**。
 * 铁律：只认 token 在不在 / 闭没闭合 / 空没空；语义（时间粒度、总结质量）一律不碰。
 * 旧扁平 [] 格式在这里会因「无《》容器」判 NO_CONTAINER 硬错——这是对的：生成产物必须是时间轴格式。
 */
export function validateArchive(text: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  const lastOpen = text.lastIndexOf(OPEN.live);
  const lastClose = text.lastIndexOf(CLOSE.live);
  const hasOpen = lastOpen >= 0;
  // 若最后又出现一个未闭合开壳，它比前面 thinking 中的完整示例更像正式输出；不能退回误收前一份。
  const block = lastOpen > lastClose ? null : extractLastArchiveBlock(text, 'live');

  if (!block) {
    issues.push(
      hasOpen
        ? hard('SHELL_UNCLOSED', `<${TAG}> 外壳未闭合（缺 </${TAG}>）`)
        : hard('SHELL_MISSING', `缺少 <${TAG}>…</${TAG}> 外壳`),
    );
    return { ok: false, issues, block: null, containers: [] };
  }

  for (const rawLine of block.inner.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const broken = brokenTokenIssue(line);
    if (broken) issues.push(broken);
  }

  const containers = parseArchiveBody(block.inner);
  const realContainers = containers.filter(c => c.kind === 'container');

  if (realContainers.length === 0) {
    issues.push(hard('NO_CONTAINER', '外壳内无任何时间轴容器《》'));
  }

  containers.forEach((c, ci) => {
    if (c.kind !== 'container') return; // 旧段不走时间轴结构校验
    if (!c.summary.trim()) {
      issues.push(hard('CONTAINER_SUMMARY_EMPTY', `容器《${c.title || '?'}》缺大总结`, { containerIndex: ci }));
    }
    if (c.time === null) {
      issues.push(soft('CONTAINER_TIME_MISSING', `容器《${c.title || '?'}》标题缺「| 时间」字段`, { containerIndex: ci }));
    }
    const hasLoose = (c.looseExcerpts?.length ?? 0) > 0;
    if (c.fragments.length === 0 && !hasLoose) {
      issues.push(soft('CONTAINER_NO_FRAGMENT', `容器《${c.title || '?'}》只有大总结、无任何片段/摘录`, { containerIndex: ci }));
    }
    c.fragments.forEach((f, fi) => {
      if (f.time === null) {
        issues.push(soft('FRAGMENT_TIME_MISSING', `片段[${f.title || '?'}]标题缺「| 时间」字段`, { containerIndex: ci, fragmentIndex: fi }));
      }
      if (f.summary.trim() && f.excerpts.length === 0) {
        issues.push(soft('FRAGMENT_NO_EXCERPT', `片段[${f.title || '?'}]有小总结但无摘录`, { containerIndex: ci, fragmentIndex: fi }));
      }
      for (const ex of f.excerpts) {
        const open = (ex.text.match(/「/g) ?? []).length;
        const close = (ex.text.match(/」/g) ?? []).length;
        if (open !== close) {
          issues.push(soft('BRACKET_UNBALANCED', `摘录里「」疑似不闭合：「${ex.text}」`, { containerIndex: ci, fragmentIndex: fi }));
          break;
        }
      }
    });
  });

  return { ok: !issues.some(i => i.severity === 'hard'), issues, block, containers };
}

/** 便捷判断：这组 issue 里有没有硬错 */
export function hasHardError(issues: ValidationIssue[]): boolean {
  return issues.some(i => i.severity === 'hard');
}

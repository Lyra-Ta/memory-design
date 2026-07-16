/**
 * 摘要 -> 普通 Archive 的纯格式层。
 *
 * 这里只做两件事：
 *   - 从聊天存储原文精确收集 Flux / Causal_Flux；
 *   - 校验此间小镇使用的普通扁平 World Archive。
 *
 * 不读取酒馆全局，不决定 x/sourceThrough，也不做任何写回。
 */

import {
  TAG,
  extractCoverageMarkers,
  extractLastArchiveBlock,
  parseArchiveBody,
  stripComments,
} from './archive-format';
import type { ArchiveBlock, Container, ValidationIssue } from './types';

export type FluxTag = 'Flux' | 'Causal_Flux';

/** 尚未绑定聊天楼层的一份完整 Flux 标签块。 */
export interface FluxBlock {
  tag: FluxTag;
  /** 含开闭标签的原文，一字不改。 */
  raw: string;
  /** 去掉标签后的正文（仅去两侧空白）。 */
  inner: string;
  /** 在消息原文中的字符区间 [start, end)。 */
  span: [number, number];
}

/** 从某一聊天楼层定位出的 Flux。 */
export interface LocatedFluxBlock extends FluxBlock {
  floor: number;
}

/** getChatMessages 结果中收集器真正需要的最小字段。 */
export interface SummaryMessageLike {
  message_id: number;
  message: string;
}

function tokenIndices(text: string, token: string): number[] {
  const indices: number[] = [];
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) {
    indices.push(i);
  }
  return indices;
}

function htmlCommentSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /<!--[\s\S]*?-->/g;
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/**
 * 以闭标签为锚，每个闭标签只配对其前方最近、且未被上一块消费的开标签。
 * 这能跳过正文里落单的示例开标签，避免它吞掉后面真正的 Flux。
 */
function blocksForTag(text: string, tag: FluxTag): FluxBlock[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const opens = tokenIndices(text, open);
  const closes = tokenIndices(text, close);
  const blocks: FluxBlock[] = [];
  let consumedThrough = -1;

  for (const closeAt of closes) {
    let openAt = -1;
    for (const candidate of opens) {
      if (candidate >= closeAt) break;
      if (candidate > consumedThrough) openAt = candidate;
    }
    if (openAt < 0) continue;
    const end = closeAt + close.length;
    blocks.push({
      tag,
      raw: text.slice(openAt, end),
      inner: text.slice(openAt + open.length, closeAt).trim(),
      span: [openAt, end],
    });
    consumedThrough = closeAt;
  }
  return blocks;
}

/** 抽取一条消息中的全部完整 Flux / Causal_Flux，按块内位置排序。 */
export function extractFluxBlocks(text: string): FluxBlock[] {
  const comments = htmlCommentSpans(text);
  return ([...blocksForTag(text, 'Flux'), ...blocksForTag(text, 'Causal_Flux')] as FluxBlock[])
    .filter(block => !comments.some(([start, end]) => block.span[0] >= start && block.span[1] <= end))
    .sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * 收集本轮唯一允许总结的 Flux：严格满足 x < floor <= sourceThrough。
 * x=null 表示尚无 Archive，从最早消息开始。结果按（楼层，块内位置）排序。
 */
export function collectTargetFlux(
  messages: SummaryMessageLike[],
  x: number | null,
  sourceThrough: number,
): LocatedFluxBlock[] {
  const lowerExclusive = x ?? Number.NEGATIVE_INFINITY;
  const blocks: LocatedFluxBlock[] = [];

  for (const message of messages) {
    if (message.message_id <= lowerExclusive || message.message_id > sourceThrough) continue;
    for (const block of extractFluxBlocks(message.message)) {
      blocks.push({ ...block, floor: message.message_id });
    }
  }

  return blocks.sort((a, b) => a.floor - b.floor || a.span[0] - b.span[0]);
}

export interface SummaryArchiveValidationResult {
  /** 无 hard issue 即可写入；soft issue 仅供结果窗提示。 */
  ok: boolean;
  issues: ValidationIssue[];
  /** 模型输出中最后一份完整 live Archive。 */
  block: ArchiveBlock | null;
  /** 外壳内解析出的所有可见顶层节点。 */
  nodes: Container[];
  /** 其中的普通扁平事件段。 */
  segments: Container[];
}

function hard(code: string, message: string, extra?: Partial<ValidationIssue>): ValidationIssue {
  return { severity: 'hard', code, message, ...extra };
}

function soft(code: string, message: string, extra?: Partial<ValidationIssue>): ValidationIssue {
  return { severity: 'soft', code, message, ...extra };
}

const FLAT_SEGMENT_LINE = /^\[\s*([^\[\]]*?)\s*\]$/;

/** 半截的下一标题不能冒充上一事件段的总结正文。 */
function hasMeaningfulSummary(segment: Container): boolean {
  return segment.summary.split('\n').some(rawLine => {
    const line = rawLine.trim();
    if (!line) return false;
    return !(line.startsWith('[') && !FLAT_SEGMENT_LINE.test(line));
  });
}

/**
 * 校验普通、无 marker、扁平 [] 段式 World Archive。
 *
 * 硬错只处理可机械确定、会令普通档不可用的情况；标题字段缺失等保留为软疑，
 * 不在格式层猜测关键词数量、时间精度或总结质量。
 */
export function validateSummaryArchive(text: string): SummaryArchiveValidationResult {
  const issues: ValidationIssue[] = [];
  const open = `<${TAG}>`;
  const close = `</${TAG}>`;
  const lastOpen = text.lastIndexOf(open);
  const lastClose = text.lastIndexOf(close);
  const hasOpen = lastOpen >= 0;
  const block = lastOpen > lastClose ? null : extractLastArchiveBlock(text, 'live');

  if (!block) {
    issues.push(
      hasOpen
        ? hard('SHELL_UNCLOSED', `${open} 外壳未闭合（缺 ${close}）`)
        : hard('SHELL_MISSING', `缺少 ${open}…${close} 外壳`),
    );
    return { ok: false, issues, block: null, nodes: [], segments: [] };
  }

  if (extractCoverageMarkers(block.raw).length > 0) {
    issues.push(hard('ARCHIVED_MARKER_FORBIDDEN', '普通 Archive 不得包含 archived 覆盖标记'));
  }

  for (const rawLine of stripComments(block.inner).split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[') && !FLAT_SEGMENT_LINE.test(line)) {
      issues.push(soft('SEGMENT_TOKEN_BROKEN', `事件段标题 token 疑似不完整：「${line}」`));
    }
  }

  const nodes = parseArchiveBody(block.inner);
  const segments = nodes.filter(node => node.kind === 'segment');
  const containers = nodes.filter(node => node.kind === 'container');

  if (segments.length === 0) {
    issues.push(hard('NO_SEGMENT', '外壳内无任何普通扁平事件段 []'));
  }

  if (containers.length > 0) {
    issues.push(soft('CONTAINER_UNEXPECTED', '普通 Archive 应使用扁平事件段 []，不需要《容器》'));
  }

  segments.forEach(segment => {
    const index = nodes.indexOf(segment);
    if (!hasMeaningfulSummary(segment)) {
      issues.push(
        hard('SEGMENT_SUMMARY_EMPTY', `事件段[${segment.title || '?'}]缺总结正文`, {
          containerIndex: index,
        }),
      );
    }
    if (!segment.title.trim()) {
      issues.push(soft('SEGMENT_TITLE_MISSING', '事件段标题为空', { containerIndex: index }));
    }
    if (segment.keywords === null) {
      issues.push(
        soft('SEGMENT_KEYWORDS_MISSING', `事件段[${segment.title || '?'}]缺情绪/感知关键词字段`, {
          containerIndex: index,
        }),
      );
    }
    if (segment.time === null) {
      issues.push(
        soft('SEGMENT_TIME_MISSING', `事件段[${segment.title || '?'}]缺起止时间字段`, {
          containerIndex: index,
        }),
      );
    }
  });

  return {
    ok: !issues.some(issue => issue.severity === 'hard'),
    issues,
    block,
    nodes,
    segments,
  };
}

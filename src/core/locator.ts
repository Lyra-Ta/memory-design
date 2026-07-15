/**
 * 记忆插件 · 定位表核心
 * ------------------------------------------------------------
 * 遍历所有楼层 → 抽出有效档案，记 {楼层, 世代, 覆盖范围, 内容, 体量}。
 * 一张表回答三件事：哪些读进 Historical Context、哪些已处理别重复、新档写哪层。
 *
 * 纯函数：入参是楼层原文，出参是条目数组。真正调 getChatMessages 的活在架子层（store）。
 */

import { extractArchiveBlocks, extractCoverageMarkers } from './archive-format';
import type { CoverageMarker, Generation } from './types';

/** getChatMessages 返回的最小子集——只要这两样就能建定位表 */
export interface MessageLike {
  message_id: number;
  message: string;
}

/** 定位表的一条 */
export interface LocatorEntry {
  /** 所在楼层号 */
  messageId: number;
  /** 标签世代 */
  generation: Generation;
  /** 覆盖标记端点：总结到的层（= boundary）；无标记则 null */
  through: number | null;
  /** 去壳正文 */
  content: string;
  /** 体量（字符数，作为 token 的粗估；架子层有真 token 计数器时可替换） */
  size: number;
  /** 含标签完整原文 */
  raw: string;
  /** 在该楼层文本里的字符区间 [start, end) */
  span: [number, number];
}

/**
 * 把同一楼层内的档案块与覆盖标记配对。
 * marker 现在**打在档案外壳内部**，所以先按**包含关系**归属（marker 落在哪个块的 span 内就属于哪个块）。
 * 为兼容旧数据，只再承认「marker 紧贴在档案前，中间只有空白」的写法；
 * 其他块外 marker 不猜归属，避免把边界错配给附近档案。唯一分配。
 */
function pairMarkers(
  text: string,
  blocks: { span: [number, number] }[],
  markers: CoverageMarker[],
): (CoverageMarker | null)[] {
  const remaining = markers.slice();
  const result: (CoverageMarker | null)[] = blocks.map(() => null);

  // pass 1：包含关系——marker 落在块内部则归该块
  blocks.forEach((b, i) => {
    const idx = remaining.findIndex(m => m.span[0] >= b.span[0] && m.span[1] <= b.span[1]);
    if (idx !== -1) result[i] = remaining.splice(idx, 1)[0];
  });

  // pass 2：仅兼容旧的前置相邻写法。marker 若落在任一块内，不得再分配给别的块。
  blocks.forEach((b, i) => {
    if (result[i]) return;
    const idx = remaining.findIndex(m => {
      const insideSomeBlock = blocks.some(other => m.span[0] >= other.span[0] && m.span[1] <= other.span[1]);
      if (insideSomeBlock || m.span[1] > b.span[0]) return false;
      return text.slice(m.span[1], b.span[0]).trim() === '';
    });
    if (idx !== -1) result[i] = remaining.splice(idx, 1)[0];
  });

  return result;
}

/**
 * 遍历楼层建定位表。按 (楼层, 块在楼层内位置) 排序。
 *
 * 模型可能在 thinking / inner_flow 中先输出一份完整 live 示例，再在消息末尾输出正式档：
 * - 只有「整条消息最后一个完整档案块」有资格成为 live；
 * - old / pending 全部保留，两段提交与崩溃恢复仍能看到同层多世代块。
 *
 * 关键是「最后一个块」而非「最后一个 live」：当正式档被退役为 old 后，
 * 思维链里更早的 live 不得重新复活成待整理档。
 */
export function buildLocatorTable(messages: MessageLike[]): LocatorEntry[] {
  const table: LocatorEntry[] = [];

  for (const msg of messages) {
    const blocks = extractArchiveBlocks(msg.message);
    if (blocks.length === 0) continue;
    const markers = extractCoverageMarkers(msg.message);
    const paired = pairMarkers(msg.message, blocks, markers);
    const lastBlock = blocks[blocks.length - 1];

    blocks.forEach((b, i) => {
      if (b.generation === 'live' && b !== lastBlock) return;
      const m = paired[i];
      table.push({
        messageId: msg.message_id,
        generation: b.generation,
        through: m ? m.through : null,
        content: b.inner,
        size: b.inner.length,
        raw: b.raw,
        span: b.span,
      });
    });
  }

  return table.sort((a, b) => a.messageId - b.messageId || a.span[0] - b.span[0]);
}

// ------------------------------------------------------------
// 选择器（仪表盘 / 触发 / 完整性检查会用）
// ------------------------------------------------------------

/** 只取在场档案 */
export function liveEntries(table: LocatorEntry[]): LocatorEntry[] {
  return table.filter(e => e.generation === 'live');
}

/** 在场档案的总体量——回答「当前档案共占 ~X」 */
export function totalLiveSize(table: LocatorEntry[]): number {
  return liveEntries(table).reduce((sum, e) => sum + e.size, 0);
}

/**
 * 从定位表实测 boundary：存活（非退役）楼层里「最后一个还在的覆盖标记端点」。
 * 也就是完整性检查里的 X。没有任何在场标记则 null（视作 0）。
 */
export function deriveBoundary(table: LocatorEntry[]): number | null {
  let end: number | null = null;
  for (const e of table) {
    if (e.generation === 'old') continue; // 退役档不算「还在盖」的
    if (e.through !== null && (end === null || e.through > end)) end = e.through;
  }
  return end;
}

/** 是否存在孤立 pending（两段提交的崩溃断点） */
export function hasOrphanPending(table: LocatorEntry[]): boolean {
  return table.some(e => e.generation === 'pending');
}

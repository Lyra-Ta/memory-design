/**
 * 当前聊天的统一读取层。
 *
 * - q 只在 syncHead() 内读取；
 * - 一次完整扫描严格复用同一份 head.q；
 * - 只缓存轻量 head，不按 q 缓存正文/定位表——q 不变时正文仍可被编辑。
 */

import {
  buildLocatorTable,
  deriveBoundary,
  latestLiveArchiveFloor,
  type LocatorEntry,
} from '../core';
import type { ArchiverTavernDeps, TavernMessage } from './deps';
import { computeRegexDepthWindow, type RegexDepthWindow } from './regex-window';

export interface ChatHeadSnapshot {
  chatIdentity: string | null;
  /** 真切聊天时递增；即使运行时拿不到 chatIdentity，也能让旧操作立即失效。 */
  chatEpoch: number;
  /** 当前聊天末层 q。 */
  currentFloor: number;
  /** 最近一次权威扫描确认的 live World Archive 所在层 x；未找到 / 尚未扫描为 null。 */
  latestLiveArchiveFloor: number | null;
  /** 只由本快照的 q 与缓存 x 计算；普通楼层事件无需扫描正文。 */
  regexWindow: RegexDepthWindow;
  /** q、聊天身份或已知正文变化时递增。 */
  revision: number;
}

export interface ChatReadSnapshot extends ChatHeadSnapshot {
  messages: TavernMessage[];
  table: LocatorEntry[];
  /** marker 实测覆盖端点；无 marker 时为 null。 */
  derivedBoundary: number | null;
}

export class ChatStateReader {
  private chatIdentity: string | null = null;
  private head: ChatHeadSnapshot | null = null;
  private latestArchiveFloor: number | null = null;
  private revision = 0;
  private chatEpoch = 0;

  constructor(private readonly deps: ArchiverTavernDeps) {}

  peekHead(): ChatHeadSnapshot | null {
    return this.head;
  }

  currentChatEpoch(): number {
    return this.chatEpoch;
  }

  isCurrentChatEpoch(expected: number): boolean {
    return expected === this.chatEpoch;
  }

  /** 真正切换聊天时忘掉旧 head；下次读取属于新聊天。 */
  reset(chatIdentity: string | null): void {
    this.chatIdentity = chatIdentity;
    this.head = null;
    this.latestArchiveFloor = null;
    this.chatEpoch += 1;
    this.revision += 1;
  }

  /**
   * 标记“q 未必变，但聊天正文/档案索引已可能变化”。
   * 在权威扫描完成前保守忘掉 x：正则窗口会扩大为“尚无 x”，宁可多留上下文也不误裁 Flux。
   */
  markDirty(): void {
    this.latestArchiveFloor = null;
    this.revision += 1;
    if (this.head) {
      this.head = {
        ...this.head,
        latestLiveArchiveFloor: null,
        regexWindow: computeRegexDepthWindow({
          currentFloor: this.head.currentFloor,
          latestArchiveFloor: null,
        }),
        revision: this.revision,
      };
    }
  }

  /** 全插件读取 q 的唯一入口。 */
  syncHead(): ChatHeadSnapshot {
    const currentFloor = this.deps.getLastMessageId();
    if (
      this.head &&
      this.head.chatIdentity === this.chatIdentity &&
      this.head.currentFloor === currentFloor
    ) {
      return this.head;
    }
    this.revision += 1;
    this.head = {
      chatIdentity: this.chatIdentity,
      chatEpoch: this.chatEpoch,
      currentFloor,
      latestLiveArchiveFloor: this.latestArchiveFloor,
      regexWindow: computeRegexDepthWindow({
        currentFloor,
        latestArchiveFloor: this.latestArchiveFloor,
      }),
      revision: this.revision,
    };
    return this.head;
  }

  /**
   * 按已经取得的 head 建一张权威表，不再读 q。
   * 消息删除/同聊天正文变更的事件点可用此保证“一个事件批次一次 q”。
   */
  scan(head: ChatHeadSnapshot = this.syncHead()): ChatReadSnapshot {
    if (head.chatIdentity !== this.chatIdentity || head.chatEpoch !== this.chatEpoch) {
      throw new Error('聊天已切换，拒绝使用旧的楼层快照');
    }
    const messages = this.deps.getChatMessages(`0-${head.currentFloor}`);
    const table = buildLocatorTable(messages);
    const latestArchiveFloor = latestLiveArchiveFloor(table);
    if (latestArchiveFloor !== this.latestArchiveFloor) {
      this.latestArchiveFloor = latestArchiveFloor;
      this.revision += 1;
    }
    const resolvedHead: ChatHeadSnapshot = {
      chatIdentity: head.chatIdentity,
      chatEpoch: head.chatEpoch,
      currentFloor: head.currentFloor,
      latestLiveArchiveFloor: latestArchiveFloor,
      regexWindow: computeRegexDepthWindow({
        currentFloor: head.currentFloor,
        latestArchiveFloor,
      }),
      revision: this.revision,
    };
    this.head = resolvedHead;
    return {
      ...resolvedHead,
      messages,
      table,
      derivedBoundary: deriveBoundary(table),
    };
  }

  /** 操作边界的新鲜快照：一次 q + 一次 0-q 扫描。 */
  scanFresh(): ChatReadSnapshot {
    return this.scan(this.syncHead());
  }
}

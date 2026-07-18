/*!
 * 记忆归档插件（此间小镇 HereBetween · 长程记忆《世界档案》）
 * 酒馆助手脚本入口。诊断版：每步 loudly 打日志，便于定位"点了没反应"。
 */

import { loadConfig } from './config';
import { loadPromptPreferences } from './prompt-preferences';
import {
  bindChatActivityMonitor,
  type ChatActivityMonitor,
  type EventSubscription,
} from './chat-events';
import type { ChatReadSnapshot } from './chat-state';
import {
  buildReminderDecision,
  resolveReminderEventNames,
  type ReminderEventKey,
} from './reminder';
import { claimRuntimeLifecycle } from './lifecycle';
import { createRegexDepthController } from './regex-controller';
import { ArchiverSession, type Snapshot } from './session';
import { createTavernDeps } from './tavern';
import { createPanel } from './ui';

const BUTTON_NAME = '🗂️ 记忆归档';
const TAG = '%c[记忆归档]';
const CSS = 'color:#b0774f;font-weight:bold';

/** 取最顶层可访问的 document——脚本若跑在沙箱 iframe 里，面板要挂到主页面才可见 */
function topDocument(): Document {
  let w: Window = window;
  let highest = document;
  while (w.parent && w.parent !== w) {
    try {
      const parent = w.parent;
      void parent.document.body; // 触发同源访问检测
      w = parent;
      highest = w.document;
    } catch {
      // 保留已经爬到的最高可访问页面，不因更上层跨域而退回最内层 iframe。
      break;
    }
  }
  return highest;
}

/**
 * 酒馆助手新版会直接注入 tavern_events，部分版本只从 SillyTavern context 暴露。
 * 两处都没有时由 reminder.ts 回退到稳定的事件字面量。
 */
function runtimeTavernEventTypes(): Partial<Record<ReminderEventKey, unknown>> | null {
  type RuntimeContext = {
    eventTypes?: Partial<Record<ReminderEventKey, unknown>>;
    getContext?: () => RuntimeContext;
  };
  const globals = globalThis as unknown as {
    tavern_events?: Partial<Record<ReminderEventKey, unknown>>;
    SillyTavern?: RuntimeContext;
  };
  if (globals.tavern_events) return globals.tavern_events;
  const injected = globals.SillyTavern;
  const context = typeof injected?.getContext === 'function' ? injected.getContext() : injected;
  return context?.eventTypes ?? null;
}

/** 用于区分“真切聊天”与当前聊天的 refresh-all CHAT_CHANGED。 */
function runtimeCurrentChatIdentity(): string | null {
  type RuntimeContext = {
    chatId?: unknown;
    getCurrentChatId?: () => unknown;
    getContext?: () => RuntimeContext;
  };
  const injected = (globalThis as unknown as { SillyTavern?: RuntimeContext }).SillyTavern;
  const context = typeof injected?.getContext === 'function' ? injected.getContext() : injected;
  try {
    const id = context?.getCurrentChatId?.() ?? context?.chatId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  console.info(TAG, CSS, 'init 开始');

  // 1) 先看运行时全局齐不齐（哪个缺就报哪个）
  const g = globalThis as unknown as Record<string, unknown>;
  const needed = [
    'getChatMessages',
    'setChatMessages',
    'createChatMessages',
    'deleteChatMessages',
    'getLastMessageId',
    'generateRaw',
    'getVariables',
    'insertOrAssignVariables',
    'appendInexistentScriptButtons',
    'updateScriptButtonsWith',
    'getButtonEvent',
    'eventOn',
  ];
  const missing = needed.filter(n => typeof g[n] !== 'function');
  if (missing.length) console.warn(TAG, CSS, '缺失的运行时全局函数:', missing);
  else console.info(TAG, CSS, '运行时全局齐全');

  // 2) 建会话 + 面板（各自 try，定位到底哪步炸）
  const deps = createTavernDeps();
  let session: ArchiverSession;
  try {
    session = new ArchiverSession(deps, loadConfig(deps));
    session.promptPreferences = loadPromptPreferences(deps);
    console.info(TAG, CSS, '会话已建（chat 配置与 global 提示词偏好已读）');
  } catch (e) {
    console.error('[记忆归档] 建会话失败：', e);
    return;
  }

  const doc = topDocument();
  const inIframe = doc !== document;
  const lifecycleHost = doc.defaultView ?? window;
  const claim = claimRuntimeLifecycle(lifecycleHost, {
    canReplace: () => session.phase !== 'committing',
    onCleanupError: (label, error) => {
      console.warn(TAG, CSS, `清理失败（${label}）：`, error);
    },
  });
  if (!claim) {
    console.warn(TAG, CSS, '旧实例正在提交，本次热重载已跳过');
    return;
  }
  const { lifecycle } = claim;

  try {
    await claim.ready;
    // 多次快速热载时，只允许最后一次 claim 继续创建资源。
    if (!lifecycle.isCurrent()) return;

    // Session 的开关 setter 会发布变更；具体对齐逻辑在正则控制器与事件处理
    // 函数齐备后再赋值，前端无需理解运行时生命周期。
    let reconcileFeatureRuntime = (): Snapshot | null => null;
    let stopFeatureEnablementListener = (): void => {};
    lifecycle.addCleanup('在途提交', () => session.waitForCommitToFinish());
    const panel = createPanel(session, doc);
    lifecycle.addCleanup('面板', () => panel.destroy());
    lifecycle.addCleanup('功能开关监听', () => {
      const stop = stopFeatureEnablementListener;
      stopFeatureEnablementListener = (): void => {};
      stop();
    });
    doc.body.appendChild(panel.root);
    console.info(TAG, CSS, `面板已挂到 ${inIframe ? '顶层主页面' : '本页'} body`);

    // 提醒热路径不扫聊天：统一读 q + 会话内存配置。完整扫描仅用于启动/切聊天/删楼/正文变更。
    let observedBoundary = session.config.boundary ?? 0;
    let reminderBlocked = false;
    let chatReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingChatIdentity = runtimeCurrentChatIdentity();
    let chatSwitchPending = false;
    let openAfterChatReload = false;
    lifecycle.addCleanup('聊天切换定时器', () => {
      if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
      chatReloadTimer = null;
    });
    session.chatState.reset(pendingChatIdentity);

    const runtimeRegexUpdater = typeof g.updateTavernRegexesWith === 'function'
      ? g.updateTavernRegexesWith as typeof updateTavernRegexesWith
      : undefined;
    const regexDepthController = createRegexDepthController({
      updateTavernRegexesWith: runtimeRegexUpdater,
      warn: (message, error) => {
        if (error === undefined) console.warn(TAG, CSS, message);
        else console.warn(TAG, CSS, message, error);
      },
    });
    lifecycle.addCleanup('正则深度控制器', () => {
      regexDepthController.destroy();
      return regexDepthController.flush();
    });
    const featureRuntimeEnabled = (): boolean =>
      session.config.timelineEnabled || session.config.summaryEnabled;
    const syncRegexDepth = (head: Pick<Snapshot, 'regexWindow'>): void => {
      if (!featureRuntimeEnabled()) return;
      regexDepthController.request(head.regexWindow);
    };

    const openPanel = (): void => {
      if (chatSwitchPending) {
        // 真切聊天后的短防抖窗内不许旧 config 接触新聊天；重载完成后补开。
        openAfterChatReload = true;
        return;
      }
      // 两项全关时没有 CHAT_CHANGED 监听；用户手动打开就是一次显式同步点。
      // 重新读取当前 chat 配置，既避免跨聊天沿用旧开关，也允许新聊天按全局
      // 默认重新启用后台。手动面板本身随后仍会做自己的 fresh scan。
      if (!featureRuntimeEnabled()) {
        const identity = runtimeCurrentChatIdentity();
        session.chatState.reset(identity);
        pendingChatIdentity = identity;
        session.config = loadConfig(deps);
        observedBoundary = session.config.boundary ?? 0;
        reminderBlocked = false;
        reconcileFeatureRuntime();
      }
      panel.open();
    };

    const refreshReminderBaseline = (read?: ChatReadSnapshot): Snapshot | null => {
      try {
        const snapshot = session.refresh(read);
        observedBoundary = snapshot.boundary;
        reminderBlocked = snapshot.interrupted.length > 0 || snapshot.integrity.needed;
        return snapshot;
      } catch (e) {
        // 基线不可信时宁可不提醒，不用错边界 nag 用户。
        reminderBlocked = true;
        console.warn('[记忆归档] 提醒基线刷新失败：', e);
        return null;
      }
    };

    /** 只消费已取得的 q / 缓存 x，不再自行读楼层或扫描正文。 */
    const checkReminder = (
      head: Pick<ChatReadSnapshot, 'currentFloor' | 'latestLiveArchiveFloor'>,
      summaryTrigger?: Snapshot['summaryTrigger'],
    ): void => {
      if (
        chatSwitchPending ||
        reminderBlocked ||
        session.phase !== 'idle' ||
        panel.root.style.display !== 'none'
      ) return;

      // 实测 marker 基线能修正导入聊天；commit 后 config.boundary 又能立即超过旧快照。
      const boundary = Math.max(observedBoundary, session.config.boundary ?? 0);
      const decision = buildReminderDecision({
        timeline: {
          currentFloor: head.currentFloor,
          boundary,
          n: session.config.n,
          lastDismissedFloor: session.config.lastDismissedFloor,
        },
        summary: {
          currentFloor: head.currentFloor,
          latestArchiveFloor: head.latestLiveArchiveFloor,
          interval: session.config.summaryInterval,
          lastRemindedFloor: session.config.summaryLastRemindedFloor,
        },
        summaryTrigger,
        timelineEnabled: session.config.timelineEnabled,
        summaryEnabled: session.config.summaryEnabled,
      });
      if (!decision) return;

      try {
        if (typeof toastr === 'undefined' || typeof toastr.info !== 'function') return;
        const isTimeline = decision.kind === 'timeline';
        const shown = toastr.info(
          isTimeline
            ? `已可总结 ${decision.notice.from}–${decision.notice.through} 层。点击打开记忆归档；忽略后 +50 层再提醒。`
            : `距上次摘要 → 大总结已 ${decision.notice.distance} 层，点击打开`,
          isTimeline ? '记忆归档' : '摘要 → 大总结',
          {
            timeOut: 8000,
            extendedTimeOut: 2000,
            closeButton: true,
            preventDuplicates: true,
            escapeHtml: true,
            onclick: openPanel,
          },
        );
        if (shown === null || shown === undefined) return;

        // toastr 没有稳定的双按钮 API：成功播出就视为本次已告知。
        if (isTimeline) {
          // 点击会打开面板；关闭/超时/忽略则自然成为“暂不”，+50 层才再播。
          session.config.lastDismissedFloor = decision.notice.currentFloor;
        } else {
          session.config.summaryLastRemindedFloor = decision.notice.currentFloor;
        }
        session.persist();
      } catch (e) {
        // 提示失败不记静默基点，保留下次事件重试机会。
        console.warn('[记忆归档] 轻提醒播出失败：', e);
      }
    };

    const reloadForChangedChat = (): void => {
      chatReloadTimer = null;
      if (session.phase === 'committing') {
        // commit 不能半途换 config；它结束后再读当前聊天。
        chatReloadTimer = setTimeout(reloadForChangedChat, 250);
        return;
      }
      try {
        // 正常情况已同步关掉；若切换恰逢 commit，当时 close 会被保护，这里在提交结束后补关。
        panel.close();
        session.config = loadConfig(deps);
        observedBoundary = session.config.boundary ?? 0;
        reminderBlocked = false;
        // 新聊天可能继承不同的功能开关：先启停共享后台。若本来就在运行，
        // reconcile 不会重复绑定，此处仍需为新聊天重建一次权威快照。
        const startedSnapshot = reconcileFeatureRuntime();
        const snapshot = featureRuntimeEnabled()
          ? startedSnapshot ?? refreshReminderBaseline()
          : null;
        if (snapshot && snapshot !== startedSnapshot) syncRegexDepth(snapshot);
        chatSwitchPending = false;
        if (openAfterChatReload) {
          openAfterChatReload = false;
          openPanel();
        } else if (snapshot) {
          checkReminder(snapshot, snapshot.summaryTrigger);
        }
      } catch (e) {
        reminderBlocked = true;
        console.warn('[记忆归档] 切换聊天后重载配置失败：', e);
      }
    };

    // 3) 注册按钮 + 绑定点击事件
    lifecycle.addCleanup('脚本按钮', () => {
      updateScriptButtonsWith(buttons => buttons.filter(b => b.name !== BUTTON_NAME));
    });
    appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
    const ev = getButtonEvent(BUTTON_NAME);
    console.info(TAG, CSS, '按钮事件名 =', ev);
    const trackButtonSubscription = (subscription: EventSubscription): void => {
      lifecycle.addCleanup('按钮事件监听', () => subscription.stop());
    };
    trackButtonSubscription(eventOn(ev, () => {
      console.info(TAG, CSS, '按钮被点击 → 打开面板');
      try {
        openPanel();
      } catch (e) {
        console.error('[记忆归档] 打开面板失败：', e);
      }
    }));

    // 兜底：万一 getButtonEvent 事件在这个版本不触发，也监听通用按钮事件名做对照
    try {
      trackButtonSubscription(eventOn(BUTTON_NAME, () => {
        console.info(TAG, CSS, '（兜底事件）按钮名事件触发 → 打开面板');
        openPanel();
      }));
    } catch {
      /* 忽略 */
    }

    // 聊天事件只在这一处按需绑定、防抖、解绑；每个事件批次只生产一份共享 q/扫描快照。
    const reminderEvents = resolveReminderEventNames(runtimeTavernEventTypes());
    let chatActivity: ChatActivityMonitor | null = null;
    lifecycle.addCleanup('聊天活动监听', () => {
      const activity = chatActivity;
      chatActivity = null;
      activity?.destroy();
    });

    const bindFeatureActivity = (): void => {
      if (chatActivity) return;
      chatActivity = bindChatActivityMonitor({
        state: session.chatState,
        events: reminderEvents,
        eventOn: (eventType, listener) => eventOn(eventType, listener),
        initialChatIdentity: pendingChatIdentity,
        getCurrentChatIdentity: runtimeCurrentChatIdentity,
        onHeadActivity: head => {
          syncRegexDepth(head);
          checkReminder(head);
        },
        onArchiveInvalidated: read => {
          // setChatMessages(refresh:'all') 也可能发同一聊天的 CHAT_CHANGED；只校正基线，不丢预览。
          syncRegexDepth(read);
          const snapshot = refreshReminderBaseline(read);
          if (snapshot) checkReminder(snapshot, snapshot.summaryTrigger);
        },
        onChatChanged: chatIdentity => {
          // 监视器已同步 reset 旧 head；这里同步冻结 UI/config，延迟只负责合并重载。
          chatSwitchPending = true;
          reminderBlocked = true;
          pendingChatIdentity = chatIdentity;
          panel.close();
          if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
          chatReloadTimer = setTimeout(reloadForChangedChat, 150);
        },
      });
    };

    reconcileFeatureRuntime = (): Snapshot | null => {
      if (!featureRuntimeEnabled()) {
        chatActivity?.destroy();
        chatActivity = null;
        // 先停监听再改正则，避免 updateTavernRegexesWith 触发的 CHAT_CHANGED
        // 又被本插件消费；控制器会串行覆盖尚未开始的动态窗口请求。
        regexDepthController.restoreDefault();
        return null;
      }

      if (chatActivity) return null;
      bindFeatureActivity();
      const snapshot = refreshReminderBaseline();
      if (snapshot) {
        syncRegexDepth(snapshot);
        checkReminder(snapshot, snapshot.summaryTrigger);
      }
      return snapshot;
    };

    // 初始配置决定是否真正启动共享后台；两项全关时这里只做一次幂等默认深度恢复。
    stopFeatureEnablementListener = session.onFeatureEnablementChanged(() => {
      reconcileFeatureRuntime();
    });
    reconcileFeatureRuntime();

    const onPageHide = (event: PageTransitionEvent): void => {
      // bfcache 会冻结整个页面；恢复时 ready 不会重跑，因此保留原实例。
      if (event.persisted) return;
      void lifecycle.destroy();
    };
    // 顶层页离开与脚本 sandbox iframe 被单独移除都要收尾；同一 window 不重复绑定。
    const pageHideTargets = lifecycleHost === window ? [window] : [window, lifecycleHost];
    for (const target of pageHideTargets) target.addEventListener('pagehide', onPageHide);
    lifecycle.addCleanup('pagehide 监听', () => {
      for (const target of pageHideTargets) target.removeEventListener('pagehide', onPageHide);
    });

    console.info(TAG, CSS, 'init 完成 ✓（点按钮应看到「按钮被点击」日志）');
  } catch (error) {
    await lifecycle.destroy();
    throw error;
  }
}

try {
  $(() => {
    void init().catch(e => {
      console.error('[记忆归档] init 抛错：', e);
    });
  });
} catch (e) {
  console.error('[记忆归档] 启动抛错（$ 不可用？）：', e);
}

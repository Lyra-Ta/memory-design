/*!
 * 记忆归档插件（此间小镇 HereBetween · 长程记忆《世界档案》）
 * 酒馆助手脚本入口。诊断版：每步 loudly 打日志，便于定位"点了没反应"。
 */

import { loadConfig } from './config';
import {
  buildReminderNotice,
  resolveReminderEventNames,
  type ReminderEventKey,
} from './reminder';
import { ArchiverSession } from './session';
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

function init(): void {
  console.info(TAG, CSS, 'init 开始');

  // 1) 先看运行时全局齐不齐（哪个缺就报哪个）
  const g = globalThis as unknown as Record<string, unknown>;
  const needed = [
    'getChatMessages',
    'setChatMessages',
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
    console.info(TAG, CSS, '会话已建（配置已读）');
  } catch (e) {
    console.error('[记忆归档] 建会话失败：', e);
    return;
  }

  const doc = topDocument();
  const inIframe = doc !== document;
  const panel = createPanel(session, doc);
  doc.body.appendChild(panel.root);
  console.info(TAG, CSS, `面板已挂到 ${inIframe ? '顶层主页面' : '本页'} body`);

  // 提醒热路径不扫聊天：只读 q + 会话内存配置。完整扫描仅用于启动/切聊天/删楼。
  let observedBoundary = session.config.boundary ?? 0;
  let reminderBlocked = false;
  let reminderTimer: ReturnType<typeof setTimeout> | null = null;
  let chatReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let activeChatIdentity = runtimeCurrentChatIdentity();

  const refreshReminderBaseline = (): void => {
    try {
      const snapshot = session.refresh();
      observedBoundary = snapshot.boundary;
      reminderBlocked = snapshot.interrupted.length > 0 || snapshot.integrity.needed;
    } catch (e) {
      // 基线不可信时宁可不提醒，不用错边界 nag 用户。
      reminderBlocked = true;
      console.warn('[记忆归档] 提醒基线刷新失败：', e);
    }
  };

  const checkReminder = (): void => {
    reminderTimer = null;
    if (reminderBlocked || session.phase !== 'idle' || panel.root.style.display !== 'none') return;

    const currentFloor = deps.getLastMessageId();
    // 实测 marker 基线能修正导入聊天；commit 后 config.boundary 又能立即超过旧快照。
    const boundary = Math.max(observedBoundary, session.config.boundary ?? 0);
    const notice = buildReminderNotice({
      currentFloor,
      boundary,
      n: session.config.n,
      lastDismissedFloor: session.config.lastDismissedFloor,
    });
    if (!notice) return;

    try {
      if (typeof toastr === 'undefined' || typeof toastr.info !== 'function') return;
      const shown = toastr.info(
        `已可总结 ${notice.from}–${notice.through} 层。点击打开记忆归档；忽略后 +50 层再提醒。`,
        '记忆归档',
        {
          timeOut: 8000,
          extendedTimeOut: 2000,
          closeButton: true,
          preventDuplicates: true,
          escapeHtml: true,
          onclick: () => panel.open(),
        },
      );
      if (shown === null || shown === undefined) return;

      // toastr 没有稳定的双按钮 API：成功播出就视为本次已告知。
      // 点击会打开面板；关闭/超时/忽略则自然成为“暂不”，+50 层才再播。
      session.config.lastDismissedFloor = notice.currentFloor;
      session.persist();
    } catch (e) {
      // 提示失败不记静默基点，保留下次事件重试机会。
      console.warn('[记忆归档] 轻提醒播出失败：', e);
    }
  };

  const scheduleReminderCheck = (): void => {
    if (reminderTimer !== null) clearTimeout(reminderTimer);
    reminderTimer = setTimeout(checkReminder, 200);
  };

  const reloadForChangedChat = (): void => {
    chatReloadTimer = null;
    if (session.phase === 'committing') {
      // commit 不能半途换 config；它结束后再读当前聊天。
      chatReloadTimer = setTimeout(reloadForChangedChat, 250);
      return;
    }
    try {
      // 生成/预览属于旧聊天，切换时关掉并丢弃；panel 持有同一 session 对象可继续复用。
      panel.close();
      session.config = loadConfig(deps);
      observedBoundary = session.config.boundary ?? 0;
      reminderBlocked = false;
      refreshReminderBaseline();
      scheduleReminderCheck();
    } catch (e) {
      reminderBlocked = true;
      console.warn('[记忆归档] 切换聊天后重载配置失败：', e);
    }
  };

  refreshReminderBaseline();

  // 3) 注册按钮 + 绑定点击事件
  appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
  const ev = getButtonEvent(BUTTON_NAME);
  console.info(TAG, CSS, '按钮事件名 =', ev);
  eventOn(ev, () => {
    console.info(TAG, CSS, '按钮被点击 → 打开面板');
    try {
      panel.open();
    } catch (e) {
      console.error('[记忆归档] 打开面板失败：', e);
    }
  });

  // 兜底：万一 getButtonEvent 事件在这个版本不触发，也监听通用按钮事件名做对照
  try {
    eventOn(BUTTON_NAME, () => {
      console.info(TAG, CSS, '（兜底事件）按钮名事件触发 → 打开面板');
      panel.open();
    });
  } catch {
    /* 忽略 */
  }

  // 聊天增长事件只跑轻量数学；切聊天/删楼是低频安全点，才重扫基线。
  const reminderEvents = resolveReminderEventNames(runtimeTavernEventTypes());
  eventOn(reminderEvents.MESSAGE_SENT, scheduleReminderCheck);
  eventOn(reminderEvents.MESSAGE_RECEIVED, scheduleReminderCheck);
  eventOn(reminderEvents.CHAT_CHANGED, (chatFileName: unknown) => {
    const eventIdentity =
      typeof chatFileName === 'string' && chatFileName ? chatFileName : runtimeCurrentChatIdentity();
    if (eventIdentity && eventIdentity === activeChatIdentity) {
      // setChatMessages(refresh:'all') 也可能发同一聊天的 CHAT_CHANGED；只校正基线，不丢预览。
      refreshReminderBaseline();
      scheduleReminderCheck();
      return;
    }
    activeChatIdentity = eventIdentity;
    if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
    chatReloadTimer = setTimeout(reloadForChangedChat, 150);
  });
  eventOn(reminderEvents.MESSAGE_DELETED, () => {
    if (reminderTimer !== null) clearTimeout(reminderTimer);
    reminderTimer = setTimeout(() => {
      reminderTimer = null;
      refreshReminderBaseline();
    }, 200);
  });

  $(window).on('pagehide', () => {
    if (reminderTimer !== null) clearTimeout(reminderTimer);
    if (chatReloadTimer !== null) clearTimeout(chatReloadTimer);
    updateScriptButtonsWith(buttons => buttons.filter(b => b.name !== BUTTON_NAME));
    panel.destroy();
  });

  console.info(TAG, CSS, 'init 完成 ✓（点按钮应看到「按钮被点击」日志）');
}

try {
  $(() => {
    try {
      init();
    } catch (e) {
      console.error('[记忆归档] init 抛错：', e);
    }
  });
} catch (e) {
  console.error('[记忆归档] 启动抛错（$ 不可用？）：', e);
}

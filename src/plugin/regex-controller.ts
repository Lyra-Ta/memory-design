import type { RegexDepthWindow } from './regex-window';

export const FLUX_WINDOW_REGEX_ID = '1a7548c3-d1c5-4fc2-8955-1933510e164c';
export const ARCHIVE_ONLY_REGEX_ID = 'dd0c4c41-36dd-4c99-87bc-6e77eec4252e';

const PRESET_TARGET: TavernRuntimeRegexOption = { type: 'preset', name: 'in_use' };
const FLUX_MIN_DEPTH = 11;
export const FLUX_DEFAULT_MAX_DEPTH = 50;
export const ARCHIVE_DEFAULT_MIN_DEPTH = 51;

export interface RegexDepthControllerOptions {
  updateTavernRegexesWith?: typeof updateTavernRegexesWith;
  warn?: (message: string, error?: unknown) => void;
}

export interface RegexDepthController {
  /** 提交最新深度桶；同桶空闲态不写，写入中只保留最后一次请求。 */
  request(window: Pick<RegexDepthWindow, 'fluxMaxDepth'>): void;
  /** 恢复未启用记忆框架时的原始深度：Flux 11–50、Archive 51–∞。 */
  restoreDefault(): void;
  /** 等待当前写入和已合并的最后一次写入完成，供测试及显式收尾使用。 */
  flush(): Promise<void>;
  /** 停止接受新请求并丢弃尚未开始的写入；已进入运行时 API 的调用无法取消。 */
  destroy(): void;
}

/**
 * 把共享聊天快照算出的 W 同步到当前预设中的两条固定正则。
 *
 * 运行时写入严格串行；第一笔尚未完成时到达的多个窗口只保留最新 W。
 * 成功写入过的同一 W 不会再次调用昂贵的正则更新 API，避免该 API 自己
 * 触发 CHAT_CHANGED 后形成反馈写入。
 */
export function createRegexDepthController(
  options: RegexDepthControllerOptions,
): RegexDepthController {
  const updateRegexes = options.updateTavernRegexesWith;
  const warn = options.warn ?? ((message: string, error?: unknown) => {
    if (error === undefined) console.warn(message);
    else console.warn(message, error);
  });

  let appliedW: number | null = null;
  let activeW: number | null = null;
  let pendingW: number | null = null;
  let running: Promise<void> | null = null;
  let destroyed = false;
  let warnedMissingApi = false;
  let lastMissingIds = '';

  const report = (message: string, error?: unknown): void => {
    try {
      warn(message, error);
    } catch {
      // 告警通道自身失效也不能把聊天事件回调炸出未处理异常。
    }
  };

  const applyWindow = async (w: number): Promise<boolean> => {
    if (!updateRegexes) {
      if (!warnedMissingApi) {
        warnedMissingApi = true;
        report('缺少运行时 API updateTavernRegexesWith，已跳过 preset/in_use 正则深度同步');
      }
      return false;
    }

    let foundFlux = false;
    let foundArchiveOnly = false;
    try {
      await updateRegexes(
        regexes => {
          for (const regex of regexes) {
            if (regex.id === FLUX_WINDOW_REGEX_ID) {
              foundFlux = true;
              regex.min_depth = FLUX_MIN_DEPTH;
              regex.max_depth = w;
            } else if (regex.id === ARCHIVE_ONLY_REGEX_ID) {
              foundArchiveOnly = true;
              regex.min_depth = w + 1;
              regex.max_depth = null;
            }
          }
          return regexes;
        },
        PRESET_TARGET,
      );
    } catch (error) {
      report(`更新 preset/in_use 正则深度失败（W=${w}）`, error);
      return false;
    }

    const missingIds = [
      ...(!foundFlux ? [FLUX_WINDOW_REGEX_ID] : []),
      ...(!foundArchiveOnly ? [ARCHIVE_ONLY_REGEX_ID] : []),
    ];
    const missingKey = missingIds.join(',');
    if (missingKey && missingKey !== lastMissingIds) {
      report(`preset/in_use 缺少固定正则 UUID：${missingIds.join('、')}`);
    }
    lastMissingIds = missingKey;
    return true;
  };

  const drain = async (): Promise<void> => {
    while (!destroyed && pendingW !== null) {
      const w = pendingW;
      pendingW = null;
      if (w === appliedW) continue;

      activeW = w;
      const applied = await applyWindow(w);
      activeW = null;
      // 失败后运行时是否已部分落盘不可知，旧缓存也不再可信；下一笔即使回到
      // 先前的 W 也必须实际写回，而不能被“同桶”捷径误吞。
      appliedW = applied ? w : null;
    }
  };

  const startDrain = (): void => {
    if (destroyed || running !== null || pendingW === null) return;
    const task = drain().catch(error => {
      activeW = null;
      report('正则深度同步控制器发生未预期错误', error);
    });
    running = task;
    void task.then(() => {
      if (running !== task) return;
      running = null;
      if (!destroyed && pendingW !== null) startDrain();
    });
  };

  return {
    request(window): void {
      if (destroyed) return;
      const w = window.fluxMaxDepth;
      if (!Number.isSafeInteger(w) || w < 0) {
        report(`收到无效的正则深度桶 W=${String(w)}，已跳过`);
        return;
      }
      if (activeW === null && pendingW === null && w === appliedW) return;
      if (w === pendingW) return;

      // 即使 w 等于当前正在写的桶也先记作“最新请求”：当前写成功后会由 appliedW
      // 消掉它；当前写失败时则允许这次后来请求再试一次。
      pendingW = w;
      startDrain();
    },

    restoreDefault(): void {
      if (destroyed) return;
      // 默认深度与 W=50 的动态窗口在字段上完全相同；复用同一串行队列，
      // 可让“关闭”覆盖尚未开始的动态请求，同时继续享受同值去重。
      pendingW = FLUX_DEFAULT_MAX_DEPTH;
      startDrain();
    },

    async flush(): Promise<void> {
      while (true) {
        startDrain();
        const task = running;
        if (!task) return;
        await task;
        // 让 startDrain 注册的收尾回调先清空 running / 接上合并后的下一笔。
        await Promise.resolve();
      }
    },

    destroy(): void {
      destroyed = true;
      pendingW = null;
    },
  };
}

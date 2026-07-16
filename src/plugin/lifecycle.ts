/** 面板内事件需要在 window capture 阶段拦下的类型。 */
export const PANEL_CAPTURE_EVENT_TYPES = [
  'keydown',
  'keyup',
  'keypress',
  'contextmenu',
] as const;

export interface DomListenerTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * 密封从面板发出的键盘/右键 capture 事件，并返回对称、幂等的解绑器。
 */
export function bindPanelCaptureSeal(
  target: DomListenerTarget,
  root: EventTarget,
): () => void {
  const sealCaptureFromPanel: EventListener = event => {
    if (event.composedPath().includes(root)) event.stopPropagation();
  };
  for (const type of PANEL_CAPTURE_EVENT_TYPES) {
    target.addEventListener(type, sealCaptureFromPanel, true);
  }

  let bound = true;
  return (): void => {
    if (!bound) return;
    bound = false;
    for (const type of PANEL_CAPTURE_EVENT_TYPES) {
      target.removeEventListener(type, sealCaptureFromPanel, true);
    }
  };
}

const RUNTIME_INSTANCE_KEY = Symbol.for('HereBetween.MemoryArchiver.Runtime');

export interface RuntimeInstance {
  destroy(): void | Promise<void>;
  /** false 表示当前处于不可中断步骤（例如正在提交）。 */
  canReplace?(): boolean;
}

export type RuntimeCleanup = () => void | Promise<void>;

export interface RuntimeLifecycle extends RuntimeInstance {
  addCleanup(label: string, cleanup: RuntimeCleanup): void;
  isCurrent(): boolean;
  destroy(): Promise<void>;
}

export interface RuntimeLifecycleOptions {
  canReplace?: () => boolean;
  onCleanupError?: (label: string, error: unknown) => void;
}

export interface RuntimeClaim {
  lifecycle: RuntimeLifecycle;
  /** 旧实例的完整清理；新实例应在创建面板/监听前等它完成。 */
  ready: Promise<void>;
}

function asRuntimeInstance(value: unknown): RuntimeInstance | null {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
  return typeof (value as Partial<RuntimeInstance>).destroy === 'function'
    ? value as RuntimeInstance
    : null;
}

/**
 * 在稳定的顶层 window 上抢占唯一运行时槽。
 *
 * 新 claim 先成为 owner，再销毁旧实例；因此旧实例迟到的清理不会误删新槽。
 * 若旧实例正处于不可中断阶段，返回 null 并保留旧实例。
 */
export function claimRuntimeLifecycle(
  host: object,
  options: RuntimeLifecycleOptions = {},
): RuntimeClaim | null {
  const previous = asRuntimeInstance(Reflect.get(host, RUNTIME_INSTANCE_KEY));
  if (previous?.canReplace && !previous.canReplace()) return null;

  const cleanups: Array<{ label: string; cleanup: RuntimeCleanup }> = [];
  let destroyed = false;
  let destroyPromise: Promise<void> | null = null;
  let lifecycle: RuntimeLifecycle;

  const reportCleanupError = (label: string, error: unknown): void => {
    try {
      options.onCleanupError?.(label, error);
    } catch {
      // 告警通道自身失效也不应打断后续清理。
    }
  };

  const runCleanup = (
    entry: { label: string; cleanup: RuntimeCleanup },
  ): Promise<void> | null => {
    try {
      const result = entry.cleanup();
      if (result && typeof (result as PromiseLike<void>).then === 'function') {
        return Promise.resolve(result).catch(error => {
          reportCleanupError(entry.label, error);
        });
      }
    } catch (error) {
      reportCleanupError(entry.label, error);
    }
    return null;
  };

  lifecycle = {
    addCleanup(label, cleanup): void {
      const entry = { label, cleanup };
      if (!destroyed) {
        cleanups.push(entry);
        return;
      }
      const pending = runCleanup(entry);
      if (pending) void pending;
    },

    canReplace(): boolean {
      if (destroyed) return true;
      return options.canReplace?.() ?? true;
    },

    isCurrent(): boolean {
      return !destroyed && Reflect.get(host, RUNTIME_INSTANCE_KEY) === lifecycle;
    },

    destroy(): Promise<void> {
      if (destroyPromise) return destroyPromise;
      destroyed = true;

      let resolveDestroy: (() => void) | null = null;
      destroyPromise = new Promise<void>(resolve => {
        resolveDestroy = resolve;
      });

      // 所有同步解绑在 destroy() 返回前就执行；仅等已进入 API 的异步尾巴。
      const pending: Promise<void>[] = [];
      while (cleanups.length > 0) {
        const task = runCleanup(cleanups.pop()!);
        if (task) pending.push(task);
      }

      const finish = (): void => {
        try {
          if (Reflect.get(host, RUNTIME_INSTANCE_KEY) === lifecycle) {
            Reflect.deleteProperty(host, RUNTIME_INSTANCE_KEY);
          }
        } catch (error) {
          reportCleanupError('全局单例槽', error);
        } finally {
          resolveDestroy?.();
        }
      };
      void Promise.all(pending).then(finish, error => {
        // runCleanup 已隔离每个拒绝；这里只是最后一层保险。
        reportCleanupError('异步清理', error);
        finish();
      });
      return destroyPromise;
    },
  };

  if (!Reflect.set(host, RUNTIME_INSTANCE_KEY, lifecycle)) {
    throw new Error('无法在顶层页面注册记忆归档单例');
  }

  let ready: Promise<void>;
  try {
    ready = previous ? Promise.resolve(previous.destroy()) : Promise.resolve();
  } catch (error) {
    ready = Promise.reject(error);
  }
  // 若这一次 claim 尚在等旧实例时又被更新的 claim 替代，
  // 它的 destroy 也必须传递等待这道前序屏障，不让第三次热载越过旧异步写入。
  lifecycle.addCleanup('前序实例清理', () => ready);
  return { lifecycle, ready };
}

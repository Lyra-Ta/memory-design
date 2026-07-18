/**
 * 记忆插件 · 配置（chat 作用域持久化 + 全局默认种子）
 * ------------------------------------------------------------
 * 本文件只负责聊天状态与既有通用设置。插件级提示词偏好由
 * prompt-preferences.ts 单独存进 global，绝不复制到 chat。
 */

import { DEFAULT_N, normalizeN } from '../core/trigger';
import {
  DEFAULT_SUMMARY_INTERVAL,
  normalizeSummaryInterval,
} from '../core/summary-trigger';
import type { ArchiverTavernDeps } from './deps';

/** 存进变量表用的命名空间键 */
export const CONFIG_KEY = 'memoryArchiver';
/** v8：摘要大总结与时间轴化分别保存自己的 Connection Profile ID。 */
export const CONFIG_VERSION = 8;

export const DEFAULT_MODEL_HINT = '任务较复杂，推荐 Gemini 3.1pro等智商尚可的模型。';
const LEGACY_DEFAULT_MODEL_HINTS = new Set([
  '任务较复杂，推荐 Gemini 等智商尚可的模型就够。',
]);

export interface ArchiverConfig {
  /** 配置版本 */
  version: number;
  /** 保留最近 N 层不动 */
  n: number;
  /** 上次总结到的层（初始 0）；刷新时以 deriveBoundary 实测为准、这里作种子/回退 */
  boundary: number;
  /** 上次记录的楼层数 p（完整性检查用：q<p 即删过楼层）；null=首次 */
  lastKnownFloor: number | null;
  /** 上次「暂不」所处的层（+50 静默窗判定）；null=没暂不过 */
  lastDismissedFloor: number | null;
  /** 大总结时间轴化使用的 Connection Profile ID；null=跟随当前酒馆连接。 */
  timelineConnectionProfileId: string | null;
  /** 摘要 → 大总结使用的 Connection Profile ID；null=跟随当前酒馆连接。 */
  summaryConnectionProfileId: string | null;
  /** API 页那句「建议模型」提示文案 */
  modelHint: string;
  /** Flux 积累多少层后提醒做一次普通总结（只提醒，不拦手动）。 */
  summaryInterval: number;
  /** 当前记录的空白 assistant 写入位 y；只有仍空白时才能删/写。 */
  summaryPlaceholderFloor: number | null;
  /** 上次播出「摘要 → 大总结」轻提醒时的 q。 */
  summaryLastRemindedFloor: number | null;
  /** 是否启用「大总结时间轴化」的后台监听与自动提醒。手动入口始终保留。 */
  timelineEnabled: boolean;
  /** 是否启用「摘要 → 大总结」的后台监听与自动提醒。手动入口始终保留。 */
  summaryEnabled: boolean;
}

export function defaultConfig(): ArchiverConfig {
  return {
    version: CONFIG_VERSION,
    n: DEFAULT_N,
    boundary: 0,
    lastKnownFloor: null,
    lastDismissedFloor: null,
    timelineConnectionProfileId: null,
    summaryConnectionProfileId: null,
    modelHint: DEFAULT_MODEL_HINT,
    summaryInterval: DEFAULT_SUMMARY_INTERVAL,
    summaryPlaceholderFloor: null,
    summaryLastRemindedFloor: null,
    timelineEnabled: true,
    summaryEnabled: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function coerceModelHint(raw: unknown): string {
  if (typeof raw !== 'string' || LEGACY_DEFAULT_MODEL_HINTS.has(raw)) return DEFAULT_MODEL_HINT;
  return raw;
}

/** 把存下来的（可能残缺/旧版）配置并到默认上。 */
function coerce(raw: unknown): ArchiverConfig {
  const d = defaultConfig();
  if (!isRecord(raw)) return d;
  return {
    version: CONFIG_VERSION,
    n: normalizeN(typeof raw.n === 'number' ? raw.n : undefined),
    boundary: typeof raw.boundary === 'number' ? raw.boundary : d.boundary,
    lastKnownFloor: typeof raw.lastKnownFloor === 'number' ? raw.lastKnownFloor : null,
    lastDismissedFloor: typeof raw.lastDismissedFloor === 'number' ? raw.lastDismissedFloor : null,
    timelineConnectionProfileId:
      typeof raw.timelineConnectionProfileId === 'string'
        ? raw.timelineConnectionProfileId
        : typeof raw.connectionProfileId === 'string'
          ? raw.connectionProfileId
          : null,
    summaryConnectionProfileId:
      typeof raw.summaryConnectionProfileId === 'string' ? raw.summaryConnectionProfileId : null,
    modelHint: coerceModelHint(raw.modelHint),
    summaryInterval: normalizeSummaryInterval(raw.summaryInterval),
    summaryPlaceholderFloor:
      typeof raw.summaryPlaceholderFloor === 'number' && Number.isInteger(raw.summaryPlaceholderFloor)
        ? raw.summaryPlaceholderFloor
        : null,
    summaryLastRemindedFloor:
      typeof raw.summaryLastRemindedFloor === 'number' && Number.isInteger(raw.summaryLastRemindedFloor)
        ? raw.summaryLastRemindedFloor
        : null,
    timelineEnabled: typeof raw.timelineEnabled === 'boolean' ? raw.timelineEnabled : d.timelineEnabled,
    summaryEnabled: typeof raw.summaryEnabled === 'boolean' ? raw.summaryEnabled : d.summaryEnabled,
  };
}

type ConfigDeps = Pick<ArchiverTavernDeps, 'getVariables' | 'insertOrAssignVariables'>;

/** 全局默认不得夹带当前对话的归档进度/提醒状态。 */
function asGlobalSeed(cfg: ArchiverConfig): ArchiverConfig {
  return {
    ...cfg,
    boundary: 0,
    lastKnownFloor: null,
    lastDismissedFloor: null,
    summaryPlaceholderFloor: null,
    summaryLastRemindedFloor: null,
  };
}

/** 读配置：优先 chat；chat 没有则用 global 模板做种子。 */
export function loadConfig(deps: ConfigDeps): ArchiverConfig {
  const chat = deps.getVariables({ type: 'chat' })[CONFIG_KEY];
  if (chat !== undefined) {
    const cfg = coerce(chat);
    // 无论从哪一版读入，都按当前精简形状写回，确保旧 orchestration 全文从 chat 消失。
    saveConfig(deps, cfg);
    return cfg;
  }

  const globalSeed = deps.getVariables({ type: 'global' })[CONFIG_KEY];
  const seeded = asGlobalSeed(coerce(globalSeed));
  if (globalSeed !== undefined) saveGlobalDefault(deps, seeded); // 顺手清掉旧 global 里的整份提示词副本
  saveConfig(deps, seeded);
  return seeded;
}

/** 存配置到 chat；提示词偏好不属于本对象，也就不可能被写进 chat。 */
export function saveConfig(deps: ConfigDeps, cfg: ArchiverConfig): void {
  deps.insertOrAssignVariables(
    { [CONFIG_KEY]: { ...cfg } },
    { type: 'chat' },
  );
}

/** 把当前可继承的非提示词设置存成新对话模板。 */
export function saveGlobalDefault(deps: ConfigDeps, cfg: ArchiverConfig): void {
  const seed = asGlobalSeed(cfg);
  deps.insertOrAssignVariables({ [CONFIG_KEY]: seed }, { type: 'global' });
}

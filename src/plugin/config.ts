/**
 * 记忆插件 · 配置（chat 作用域持久化 + 全局默认种子）
 * ------------------------------------------------------------
 * 内置提示词只存在当前脚本中；chat/global 仅保存用户真正改过的模块 override。
 * 这样远程 import 更新脚本后，未自定义的聊天会无感跟随最新版。
 */

import { DEFAULT_N, normalizeN } from '../core/trigger';
import type { ArchiverTavernDeps } from './deps';
import {
  defaultOrchestration,
  promptFingerprint,
  type OrchestrationEntry,
  type OrchestrationOverrides,
} from './orchestration';

/** 存进变量表用的命名空间键 */
export const CONFIG_KEY = 'memoryArchiver';
/** v5：不再把整份内置提示词复制进变量，只持久化 override。 */
export const CONFIG_VERSION = 5;

/**
 * v2-v4 已发布内置提示词的冻结指纹。
 * 以后修改 defaultOrchestration() 时不得改写这些值：跳版本升级的旧聊天仍靠它辨认“旧默认”。
 */
const LEGACY_DEFAULT_PROMPT_HASHES: Readonly<Record<string, readonly string[]>> = {
  skeleton: ['fnv1a:2088:eeafee11'],
  historical_context: ['fnv1a:75:492c7d5d'],
  note: ['fnv1a:156:e4051a79'],
  guidance: ['fnv1a:59:32dae3b4'],
  post: ['fnv1a:674:80798d0e'],
};

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
  /** 选中的酒馆 Connection Profile ID（只记稳定 ID、不碰 URL/key）；null=用当前酒馆连接 */
  connectionProfileId: string | null;
  /** API 页那句「建议模型」提示文案 */
  modelHint: string;
  /** 仅保存真正自定义过的提示词模块；其余模块运行时读取当前脚本内置版。 */
  orchestrationOverrides: OrchestrationOverrides;
}

export function defaultConfig(): ArchiverConfig {
  return {
    version: CONFIG_VERSION,
    n: DEFAULT_N,
    boundary: 0,
    lastKnownFloor: null,
    lastDismissedFloor: null,
    connectionProfileId: null,
    modelHint: '任务较复杂，推荐 Gemini 等智商尚可的模型就够。',
    orchestrationOverrides: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function coerceOverrides(raw: unknown): OrchestrationOverrides {
  if (!isRecord(raw)) return {};
  const overrides: OrchestrationOverrides = {};
  const knownIds = new Set(defaultOrchestration().map(entry => entry.id));
  for (const [id, value] of Object.entries(raw)) {
    if (!knownIds.has(id)) continue;
    if (!isRecord(value) || typeof value.content !== 'string' || typeof value.baseHash !== 'string') continue;
    overrides[id] = { content: value.content, baseHash: value.baseHash };
  }
  return overrides;
}

function legacyEntries(raw: unknown): OrchestrationEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(value => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string') return [];
    return [value as unknown as OrchestrationEntry];
  });
}

/** v2 的 cot + output_format 在判定前先还原成 v3/v4 的 post。 */
function legacyContentFor(id: string, byId: Map<string, OrchestrationEntry>): string | undefined {
  const direct = byId.get(id);
  if (direct) return direct.content;
  if (id !== 'post') return undefined;
  const oldParts = ['cot', 'output_format']
    .map(oldId => byId.get(oldId)?.content?.trim())
    .filter((content): content is string => !!content);
  return oldParts.length ? oldParts.join('\n\n') : undefined;
}

/**
 * 一次性迁移旧编排副本：
 * - 内容是任一已发布内置版 → 丢掉副本，之后自动跟随当前脚本；
 * - 内容确有差异 → 转成 override，并记住它基于旧内置版。
 */
function migrateLegacyOrchestration(raw: unknown): OrchestrationOverrides {
  const entries = legacyEntries(raw);
  if (!entries.length) return {};
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const overrides: OrchestrationOverrides = {};

  for (const builtin of defaultOrchestration()) {
    const content = legacyContentFor(builtin.id, byId);
    if (content === undefined) continue;
    const contentHash = promptFingerprint(content);
    const legacyHashes = LEGACY_DEFAULT_PROMPT_HASHES[builtin.id] ?? [];
    const knownBuiltinHashes = new Set([...legacyHashes, promptFingerprint(builtin.content)]);
    if (knownBuiltinHashes.has(contentHash)) continue;
    overrides[builtin.id] = {
      content,
      baseHash: legacyHashes[0] ?? promptFingerprint(builtin.content),
    };
  }
  return overrides;
}

/** 把存下来的（可能残缺/旧版）配置并到默认上。 */
function coerce(raw: unknown): ArchiverConfig {
  const d = defaultConfig();
  if (!isRecord(raw)) return d;
  const oldVersion = typeof raw.version === 'number' ? raw.version : 0;
  const migrated = oldVersion < CONFIG_VERSION ? migrateLegacyOrchestration(raw.orchestration) : {};
  const explicit = coerceOverrides(raw.orchestrationOverrides);
  return {
    version: CONFIG_VERSION,
    n: normalizeN(typeof raw.n === 'number' ? raw.n : undefined),
    boundary: typeof raw.boundary === 'number' ? raw.boundary : d.boundary,
    lastKnownFloor: typeof raw.lastKnownFloor === 'number' ? raw.lastKnownFloor : null,
    lastDismissedFloor: typeof raw.lastDismissedFloor === 'number' ? raw.lastDismissedFloor : null,
    connectionProfileId: typeof raw.connectionProfileId === 'string' ? raw.connectionProfileId : null,
    modelHint: typeof raw.modelHint === 'string' ? raw.modelHint : d.modelHint,
    orchestrationOverrides: { ...migrated, ...explicit },
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
    orchestrationOverrides: { ...cfg.orchestrationOverrides },
  };
}

/** 读配置：优先 chat；chat 没有则用 global 模板做种子。 */
export function loadConfig(deps: ConfigDeps): ArchiverConfig {
  const chat = deps.getVariables({ type: 'chat' })[CONFIG_KEY];
  if (chat !== undefined) {
    const cfg = coerce(chat);
    // 无论从哪一版读入，都按 v5 精简形状写回，确保旧 orchestration 全文从 chat 消失。
    saveConfig(deps, cfg);
    return cfg;
  }

  const globalSeed = deps.getVariables({ type: 'global' })[CONFIG_KEY];
  const seeded = asGlobalSeed(coerce(globalSeed));
  if (globalSeed !== undefined) saveGlobalDefault(deps, seeded); // 顺手清掉旧 global 里的整份提示词副本
  saveConfig(deps, seeded);
  return seeded;
}

/** 存配置到 chat；ArchiverConfig 本身已不含内置提示词全文。 */
export function saveConfig(deps: ConfigDeps, cfg: ArchiverConfig): void {
  deps.insertOrAssignVariables(
    { [CONFIG_KEY]: { ...cfg, orchestrationOverrides: { ...cfg.orchestrationOverrides } } },
    { type: 'chat' },
  );
}

/** 把当前可继承设置存成新对话模板；同样只带 override，不带内置提示词。 */
export function saveGlobalDefault(deps: ConfigDeps, cfg: ArchiverConfig): void {
  const seed = asGlobalSeed(cfg);
  deps.insertOrAssignVariables({ [CONFIG_KEY]: seed }, { type: 'global' });
}

/**
 * 插件级提示词偏好。
 *
 * 这里只使用 global 变量域：提示词属于用户安装的插件，不属于任何一段聊天。
 * chat 配置不得复制这份数据，切换聊天也不会产生另一份 override。
 */

import type { ArchiverTavernDeps } from './deps';
import type { OrchestrationOverrides } from './orchestration';
import {
  type SummaryOrchestrationOverrides,
  type SummaryPromptId,
} from './summary-orchestration';

export const PROMPT_PREFERENCES_KEY = 'memoryArchiverPromptPreferences';
export const PROMPT_PREFERENCES_VERSION = 1;
/** 运行时槽由插件装配，只允许持久化 UI 中真正可编辑的静态提示词。 */
export const EDITABLE_TIMELINE_PROMPT_IDS = ['skeleton', 'post'] as const;
export const EDITABLE_SUMMARY_PROMPT_IDS = ['pre', 'post'] as const;

export interface PromptPreferences {
  version: number;
  timelineOverrides: OrchestrationOverrides;
  summaryOverrides: SummaryOrchestrationOverrides;
}

export function defaultPromptPreferences(): PromptPreferences {
  return {
    version: PROMPT_PREFERENCES_VERSION,
    timelineOverrides: {},
    summaryOverrides: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function coerceTimelineOverrides(raw: unknown): OrchestrationOverrides {
  if (!isRecord(raw)) return {};
  const knownIds = new Set<string>(EDITABLE_TIMELINE_PROMPT_IDS);
  const overrides: OrchestrationOverrides = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!knownIds.has(id) || !isRecord(value)) continue;
    if (typeof value.content !== 'string' || typeof value.acknowledgedBuiltinHash !== 'string') continue;
    overrides[id] = {
      content: value.content,
      acknowledgedBuiltinHash: value.acknowledgedBuiltinHash,
    };
  }
  return overrides;
}

function coerceSummaryOverrides(raw: unknown): SummaryOrchestrationOverrides {
  if (!isRecord(raw)) return {};
  const knownIds = new Set<SummaryPromptId>(EDITABLE_SUMMARY_PROMPT_IDS);
  const overrides: SummaryOrchestrationOverrides = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!knownIds.has(id as SummaryPromptId) || !isRecord(value)) continue;
    if (typeof value.content !== 'string' || typeof value.acknowledgedBuiltinHash !== 'string') continue;
    overrides[id as SummaryPromptId] = {
      content: value.content,
      acknowledgedBuiltinHash: value.acknowledgedBuiltinHash,
    };
  }
  return overrides;
}

type PromptPreferenceDeps = Pick<ArchiverTavernDeps, 'getVariables' | 'insertOrAssignVariables'>;

/** 不迁移 chat 旧值：global 新键不存在就从空偏好开始。 */
export function loadPromptPreferences(deps: PromptPreferenceDeps): PromptPreferences {
  const raw = deps.getVariables({ type: 'global' })[PROMPT_PREFERENCES_KEY];
  if (!isRecord(raw) || raw.version !== PROMPT_PREFERENCES_VERSION) {
    return defaultPromptPreferences();
  }
  return {
    version: PROMPT_PREFERENCES_VERSION,
    timelineOverrides: coerceTimelineOverrides(raw.timelineOverrides),
    summaryOverrides: coerceSummaryOverrides(raw.summaryOverrides),
  };
}

export function savePromptPreferences(deps: PromptPreferenceDeps, preferences: PromptPreferences): void {
  const timelineOverrides = Object.fromEntries(
    Object.entries(preferences.timelineOverrides).map(([id, override]) => [id, { ...override }]),
  );
  const summaryOverrides = Object.fromEntries(
    Object.entries(preferences.summaryOverrides).map(([id, override]) => [id, { ...override }]),
  );
  deps.insertOrAssignVariables(
    {
      [PROMPT_PREFERENCES_KEY]: {
        version: PROMPT_PREFERENCES_VERSION,
        timelineOverrides,
        summaryOverrides,
      },
    },
    { type: 'global' },
  );
}

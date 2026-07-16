/**
 * 记忆插件 · TavernDeps 实现（把酒馆助手运行时全局包成依赖缝）
 * ------------------------------------------------------------
 * 只有这一处真正碰酒馆全局；其余全走 ArchiverTavernDeps 接口。
 */

import type {
  ArchiverTavernDeps,
  ConnectionProfileOption,
  GenerateRawArgs,
  RolePrompt,
  TavernMessage,
  VarScope,
} from './deps';

interface RuntimeConnectionProfile {
  id?: unknown;
  name?: unknown;
  api?: unknown;
  model?: unknown;
  preset?: unknown;
}

interface ConnectionManagerService {
  getSupportedProfiles?: () => RuntimeConnectionProfile[];
  getProfile?: (id: string) => RuntimeConnectionProfile;
  sendRequest?: (
    profileId: string,
    prompts: RolePrompt[],
    maxTokens: number,
    options: {
      stream: false;
      signal: AbortSignal;
      extractData: true;
      includePreset: true;
      includeInstruct: true;
    },
  ) => Promise<unknown>;
}

interface TavernRuntimeContext {
  ConnectionManagerRequestService?: ConnectionManagerService;
  getContext?: () => TavernRuntimeContext;
}

function connectionManagerService(): ConnectionManagerService | null {
  const injected = (globalThis as unknown as { SillyTavern?: TavernRuntimeContext }).SillyTavern;
  const context = typeof injected?.getContext === 'function' ? injected.getContext() : injected;
  return context?.ConnectionManagerRequestService ?? null;
}

/** 只把无敏感信息的摘要交给 UI；完整 profile 不进插件配置或日志。 */
function getConnectionProfiles(): ConnectionProfileOption[] {
  try {
    const profiles = connectionManagerService()?.getSupportedProfiles?.() ?? [];
    return profiles.flatMap(profile => {
      if (typeof profile.id !== 'string' || typeof profile.name !== 'string') return [];
      return [
        {
          id: profile.id,
          name: profile.name,
          api: typeof profile.api === 'string' ? profile.api : undefined,
          model: typeof profile.model === 'string' ? profile.model : undefined,
        },
      ];
    });
  } catch {
    // 旧版酒馆或 Connection Manager 被禁用时显示空列表，仍可跟随当前连接。
    return [];
  }
}

/** ConnectionManagerRequestService 强制要求 maxTokens；优先沿用 profile 绑定的生成预设。 */
function profileMaxTokens(profile: RuntimeConnectionProfile | undefined): number {
  const getPresetSafe = (globalThis as unknown as {
    getPreset?: (name: string) => { settings?: { max_completion_tokens?: unknown } };
  }).getPreset;
  if (typeof getPresetSafe === 'function') {
    for (const name of [profile?.preset, 'in_use']) {
      if (typeof name !== 'string' || !name) continue;
      try {
        const n = Number(getPresetSafe(name)?.settings?.max_completion_tokens);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
      } catch {
        // profile 可能属于另一类 API；继续尝试当前预设或安全回退值。
      }
    }
  }
  return 8192;
}

/**
 * 只显式携带本插件声明过的消息字段，避免把酒馆内部的临时对象泄进架子层。
 * role 必须保留：压缩 2 的空白占位只能识别 assistant 消息。
 */
function mapChatMessage(message: ReturnType<typeof getChatMessages>[number]): TavernMessage {
  return {
    message_id: message.message_id,
    message: message.message,
    name: message.name,
    role: message.role,
    is_hidden: message.is_hidden,
    data: message.data,
    extra: message.extra,
    swipe_id: message.swipe_id,
    swipes: message.swipes,
    swipes_data: message.swipes_data,
    swipes_info: message.swipes_info,
  };
}

export function createTavernDeps(): ArchiverTavernDeps {
  const profileControllers = new Map<string, AbortController>();

  async function generateWithConnectionProfile(config: GenerateRawArgs, profileId: string): Promise<string> {
    const service = connectionManagerService();
    if (!service?.sendRequest) {
      throw new Error('当前酒馆不支持按连接配置独立生成；请升级酒馆或改为使用当前连接');
    }
    const controller = new AbortController();
    const generationId = config.generation_id ?? `memory-profile-${Date.now()}`;
    profileControllers.get(generationId)?.abort();
    profileControllers.set(generationId, controller);
    try {
      const profile = service.getProfile?.(profileId);
      // Connection Manager 这里的 preset / instruct 不是酒馆提示词上下文：
      // - preset 只转成连接配置的采样参数；
      // - instruct 只在 Text Completion 下把下方 ordered_prompts 序列化成后端模板。
      // 它们不会追加角色卡、世界书、聊天历史或当前提示词预设条目；真正的消息仍只有
      // config.ordered_prompts。保留这两项，才能正确复用 Profile 的采样与文本后端格式。
      const result = await service.sendRequest(
        profileId,
        config.ordered_prompts,
        profileMaxTokens(profile),
        {
          stream: false,
          signal: controller.signal,
          extractData: true,
          includePreset: true,
          includeInstruct: true,
        },
      );
      if (typeof result === 'string') return result;
      return String((result as { content?: unknown } | null)?.content ?? '');
    } finally {
      // 同一 ID 被后一次请求复用时，旧请求的 finally 不得删掉新 controller。
      if (profileControllers.get(generationId) === controller) {
        profileControllers.delete(generationId);
      }
    }
  }

  return {
    getChatMessages: (range: string | number) => getChatMessages(range).map(mapChatMessage),
    setChatMessages: (messages, option) => setChatMessages(messages, option),
    createChatMessages: (messages, option) => createChatMessages(messages, option),
    deleteChatMessages: (messageIds, option) => deleteChatMessages(messageIds, option),
    getLastMessageId: () => getLastMessageId(),
    generateRaw: async (config: GenerateRawArgs) => {
      if (config.connection_profile_id) {
        return generateWithConnectionProfile(config, config.connection_profile_id);
      }
      const nativeConfig = { ...config };
      delete nativeConfig.connection_profile_id;
      const out = await generateRaw(nativeConfig);
      return typeof out === 'string' ? out : String((out as { content?: string })?.content ?? '');
    },
    stopGenerationById: (id: string) => {
      const controller = profileControllers.get(id);
      controller?.abort();
      profileControllers.delete(id);
      return stopGenerationById(id) || !!controller;
    },
    stopAllGeneration: () => {
      const hadProfiles = profileControllers.size > 0;
      for (const controller of profileControllers.values()) controller.abort();
      profileControllers.clear();
      return stopAllGeneration() || hadProfiles;
    },
    getVariables: (option: VarScope) => getVariables(option),
    insertOrAssignVariables: (variables, option: VarScope) => {
      insertOrAssignVariables(variables, option);
    },
    getConnectionProfiles,
  };
}

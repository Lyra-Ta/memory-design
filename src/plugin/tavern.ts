/**
 * 记忆插件 · TavernDeps 实现（把酒馆助手运行时全局包成依赖缝）
 * ------------------------------------------------------------
 * 只有这一处真正碰酒馆全局；其余全走 ArchiverTavernDeps 接口。
 */

import type {
  ArchiverTavernDeps,
  ConnectionProfileOption,
  GenerateRawArgs,
  GeneratedResponse,
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
  /** SillyTavern 1.17+ 导出：返回尚未压成纯正文的完整响应。 */
  generateRawData?: (params: { prompt: RolePrompt[]; prefill: string }) => Promise<unknown>;
  /** generateRawData 通过 GENERATION_STOPPED 事件响应这个停止入口。 */
  stopGeneration?: () => boolean;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function joinTextParts(value: unknown, mode: 'content' | 'reasoning'): string {
  if (typeof value === 'string') return mode === 'content' ? value : '';
  if (!Array.isArray(value)) return '';
  return value
    .flatMap(part => {
      const item = record(part);
      if (!item) return [];
      const type = stringValue(item.type).toLowerCase();
      const isReasoning = type === 'thinking' || type === 'reasoning' || item.thought === true;
      if (mode === 'reasoning') {
        if (!isReasoning && !('thinking' in item) && !('reasoning' in item)) return [];
        const nestedThinking = Array.isArray(item.thinking)
          ? item.thinking
              .map(value => stringValue(record(value)?.text))
              .filter(Boolean)
              .join('\n\n')
          : '';
        const text =
          stringValue(item.thinking) ||
          nestedThinking ||
          stringValue(item.reasoning) ||
          stringValue(item.text);
        return text ? [text] : [];
      }
      if (isReasoning) return [];
      const text = stringValue(item.text) || stringValue(item.content) || stringValue(item.output_text);
      return text ? [text] : [];
    })
    .join('\n\n');
}

function reasoningFromParts(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap(part => {
      const item = record(part);
      if (!item?.thought) return [];
      const text = stringValue(item.text);
      return text ? [text] : [];
    })
    .join('\n\n');
}

/**
 * 把酒馆/Connection Manager 的常见返回统一成正文 + 独立 reasoning。
 * 覆盖 OpenAI-compatible、Gemini、Claude、Mistral 及简单 `{ content, reasoning }`；
 * 旧运行时若只给 string，则 reasoning 保持为空。
 */
export function normalizeGeneratedResponse(value: unknown): GeneratedResponse {
  if (typeof value === 'string') return { content: value, reasoning: '' };

  const root = record(value);
  if (!root) return { content: '', reasoning: '' };

  // 某些服务会再包一层 data；只在外层没有可用正文时解包，避免误读元数据。
  const nested = record(root.data);
  const directContent = stringValue(root.content) || joinTextParts(root.content, 'content');
  if (!directContent && nested) {
    const unpacked = normalizeGeneratedResponse(nested);
    if (unpacked.content || unpacked.reasoning) return unpacked;
  }

  const choice = Array.isArray(root.choices) ? record(root.choices[0]) : null;
  const message = record(choice?.message) ?? record(root.message);
  const responseContent = record(root.responseContent);
  const candidate = Array.isArray(root.candidates) ? record(root.candidates[0]) : null;
  const candidateContent = record(candidate?.content);

  const content =
    directContent ||
    stringValue(message?.content) ||
    joinTextParts(message?.content, 'content') ||
    stringValue(choice?.text) ||
    joinTextParts(responseContent?.parts, 'content') ||
    joinTextParts(candidateContent?.parts, 'content') ||
    stringValue(root.text) ||
    stringValue(root.output_text);

  const reasoning =
    stringValue(root.reasoning_content) ||
    stringValue(root.reasoning) ||
    stringValue(root.thinking) ||
    stringValue(choice?.reasoning) ||
    stringValue(message?.reasoning_content) ||
    stringValue(message?.reasoning) ||
    joinTextParts(message?.content, 'reasoning') ||
    reasoningFromParts(responseContent?.parts) ||
    reasoningFromParts(candidateContent?.parts) ||
    joinTextParts(root.content, 'reasoning');

  return { content, reasoning };
}

function tavernRuntimeContext(): TavernRuntimeContext | null {
  const injected = (globalThis as unknown as { SillyTavern?: TavernRuntimeContext }).SillyTavern;
  return (typeof injected?.getContext === 'function' ? injected.getContext() : injected) ?? null;
}

function connectionManagerService(): ConnectionManagerService | null {
  return tavernRuntimeContext()?.ConnectionManagerRequestService ?? null;
}

interface CurrentConnectionRawRuntime {
  generateRawData: (params: { prompt: RolePrompt[]; prefill: string }) => Promise<unknown>;
  stopGeneration: () => boolean;
}

/**
 * 只在“原始响应 + 可停止”两项都存在时切换新路径。
 * 旧酒馆仍回退 TavernHelper generateRaw，不以 reasoning 换取无法取消的悬挂请求。
 */
function currentConnectionRawRuntime(): CurrentConnectionRawRuntime | null {
  const context = tavernRuntimeContext();
  if (typeof context?.generateRawData !== 'function' || typeof context.stopGeneration !== 'function') return null;
  return {
    generateRawData: context.generateRawData.bind(context),
    stopGeneration: context.stopGeneration.bind(context),
  };
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
  const currentConnectionRawGenerations = new Map<
    string,
    { token: symbol; stopGeneration: () => boolean }
  >();

  async function generateWithCurrentConnectionRawData(
    config: GenerateRawArgs,
    runtime: CurrentConnectionRawRuntime,
  ): Promise<GeneratedResponse> {
    const generationId = config.generation_id ?? `memory-current-${Date.now()}`;
    const previous = currentConnectionRawGenerations.get(generationId);
    if (previous) {
      try {
        previous.stopGeneration();
      } catch {
        // 新请求仍可继续；旧请求的晚返回会被 session 世代锁拦下。
      }
    }
    const token = Symbol(generationId);
    currentConnectionRawGenerations.set(generationId, { token, stopGeneration: runtime.stopGeneration });
    try {
      const result = await runtime.generateRawData({
        // createRawPrompt 会就地替换宏；传副本，避免篡改候选页保存的调试提示词。
        prompt: config.ordered_prompts.map(prompt => ({ ...prompt })),
        // 明确不加 assistant prefill。
        prefill: '',
      });
      return normalizeGeneratedResponse(result);
    } finally {
      if (currentConnectionRawGenerations.get(generationId)?.token === token) {
        currentConnectionRawGenerations.delete(generationId);
      }
    }
  }

  async function generateWithConnectionProfile(
    config: GenerateRawArgs,
    profileId: string,
  ): Promise<GeneratedResponse> {
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
      return normalizeGeneratedResponse(result);
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
      const rawRuntime = currentConnectionRawRuntime();
      if (rawRuntime) {
        return generateWithCurrentConnectionRawData(config, rawRuntime);
      }
      const nativeConfig = { ...config };
      delete nativeConfig.connection_profile_id;
      const out = await generateRaw(nativeConfig);
      return normalizeGeneratedResponse(out);
    },
    stopGenerationById: (id: string) => {
      const controller = profileControllers.get(id);
      controller?.abort();
      profileControllers.delete(id);
      const rawGeneration = currentConnectionRawGenerations.get(id);
      currentConnectionRawGenerations.delete(id);
      let rawStopped = false;
      if (rawGeneration) {
        rawStopped = true;
        try {
          rawGeneration.stopGeneration();
        } catch {
          // session 已经释放锁；即使宿主 stop 异常，也不能把取消变成二次错误。
        }
      }
      return stopGenerationById(id) || !!controller || rawStopped;
    },
    stopAllGeneration: () => {
      const hadProfiles = profileControllers.size > 0;
      for (const controller of profileControllers.values()) controller.abort();
      profileControllers.clear();
      const rawGeneration = currentConnectionRawGenerations.values().next().value as
        | { stopGeneration: () => boolean }
        | undefined;
      const hadCurrentConnectionRaw = currentConnectionRawGenerations.size > 0;
      currentConnectionRawGenerations.clear();
      if (rawGeneration) {
        try {
          rawGeneration.stopGeneration();
        } catch {
          // 同上：底层停止失败不影响插件自身释放。
        }
      }
      return stopAllGeneration() || hadProfiles || hadCurrentConnectionRaw;
    },
    getVariables: (option: VarScope) => getVariables(option),
    insertOrAssignVariables: (variables, option: VarScope) => {
      insertOrAssignVariables(variables, option);
    },
    getConnectionProfiles,
  };
}

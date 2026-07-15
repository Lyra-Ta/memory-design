/**
 * 记忆插件 · 架子层依赖缝（TavernDeps）
 * ------------------------------------------------------------
 * 引擎/store 只依赖这个接口，不直接摸酒馆全局——于是：
 *   - 云端可用 mock 注入、脱离酒馆单测；
 *   - 真正的实现（createTavernDeps，调 window.TavernHelper.*）到 index.ts 再接。
 * 这里只声明「本插件用得到的那几样」，不照搬酒馆全部接口。
 */

export type PromptRole = 'system' | 'user' | 'assistant';

/** 一条角色提示词（喂给 generateRaw 的 ordered_prompts 元素） */
export interface RolePrompt {
  role: PromptRole;
  content: string;
}

/** 酒馆 Connection Manager 中可供本插件选择的安全摘要（不暴露 URL / secret-id）。 */
export interface ConnectionProfileOption {
  id: string;
  name: string;
  api?: string;
  model?: string;
}

/** generateRaw 的最小参数子集（本插件单次独立调用只用到这些） */
export interface GenerateRawArgs {
  ordered_prompts: RolePrompt[];
  /** 唯一标识，便于 stopGenerationById 取消 / 监听对应事件 */
  generation_id?: string;
  should_stream?: boolean;
  should_silence?: boolean;
  /** 本插件内部扩展：按 ID 使用酒馆 Connection Profile；适配层会截掉，不透传给 generateRaw。 */
  connection_profile_id?: string;
}

/** 变量作用域（本插件只用 chat 存配置、global 存种子） */
export type VarScope = { type: 'chat' | 'global' } | { type: 'script'; script_id?: string };

/** 一层楼的最小形状 */
export interface TavernMessage {
  message_id: number;
  message: string;
}

/**
 * 架子层依赖缝：本插件消费的酒馆助手接口集合。
 * 真接口来自 window.TavernHelper.*，此处按用途收窄类型。
 */
export interface ArchiverTavernDeps {
  /** 读楼层原文（建定位表、收集） */
  getChatMessages(range: string | number): TavernMessage[];
  /** 写/改楼层（两段提交、手改覆盖），落盘 */
  setChatMessages(
    messages: Array<{ message_id: number; message: string }>,
    option?: { refresh?: 'none' | 'affected' | 'all' },
  ): Promise<void>;
  /** 当前最高楼层号 */
  getLastMessageId(): number;
  /** 单次独立调用生成候选档 */
  generateRaw(config: GenerateRawArgs): Promise<string>;
  /** 按 id 取消某次生成 */
  stopGenerationById(generation_id: string): boolean;
  /** 取消所有生成 */
  stopAllGeneration(): boolean;
  /** 读变量表（配置/种子） */
  getVariables(option: VarScope): Record<string, unknown>;
  /** 插入或覆盖变量（配置/种子持久化） */
  insertOrAssignVariables(variables: Record<string, unknown>, option: VarScope): void;
  /** 列出酒馆 Connection Manager 中可独立请求的连接配置。 */
  getConnectionProfiles(): ConnectionProfileOption[];
}

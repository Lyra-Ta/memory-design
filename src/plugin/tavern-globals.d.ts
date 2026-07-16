/**
 * 酒馆助手运行时全局（值由酒馆助手在脚本作用域注入；这里只声明类型让 TS 通过）。
 * 打包时这些标识符不被解析成模块导入，原样留作运行时全局引用。
 */

// —— 数据 / 生成 ——
type TavernRuntimeRecord = Record<string, unknown>;
type TavernRuntimeMessage = {
  message_id: number;
  name: string;
  role: 'system' | 'assistant' | 'user';
  is_hidden: boolean;
  message: string;
  data: TavernRuntimeRecord;
  extra: TavernRuntimeRecord;
  /** 当前运行时在 include_swipes=false 时也会带回这三项兼容字段。 */
  swipe_id?: number;
  swipes?: string[];
  swipes_data?: TavernRuntimeRecord[];
  swipes_info?: TavernRuntimeRecord[];
};
type TavernRuntimeMessageCreating = {
  name?: string;
  role: 'system' | 'assistant' | 'user';
  is_hidden?: boolean;
  message: string;
  data?: TavernRuntimeRecord;
  extra?: TavernRuntimeRecord;
};
type TavernRuntimeMessagesRefreshOption = {
  refresh?: 'none' | 'affected' | 'all';
};
type TavernRuntimeCreateMessagesOption = TavernRuntimeMessagesRefreshOption & {
  /** @deprecated 请使用 insert_before。 */
  insert_at?: number | 'end';
  insert_before?: number | 'end';
};
declare function getChatMessages(
  range: string | number,
  option?: unknown,
): TavernRuntimeMessage[];
declare function setChatMessages(
  messages: Array<{ message_id: number; message: string }>,
  option?: TavernRuntimeMessagesRefreshOption,
): Promise<void>;
declare function createChatMessages(
  messages: TavernRuntimeMessageCreating[],
  option?: TavernRuntimeCreateMessagesOption,
): Promise<void>;
declare function deleteChatMessages(
  message_ids: number[],
  option?: TavernRuntimeMessagesRefreshOption,
): Promise<void>;
declare function getLastMessageId(): number;
declare function generateRaw(config: unknown): Promise<unknown>;
declare function stopGenerationById(generation_id: string): boolean;
declare function stopAllGeneration(): boolean;
declare function getVariables(option: unknown): Record<string, unknown>;
declare function insertOrAssignVariables(variables: Record<string, unknown>, option: unknown): unknown;

// —— 酒馆正则（本插件只需要当前预设与深度字段的最小契约） ——
type TavernRuntimeRegex = {
  id: string;
  enabled: boolean;
  min_depth: number | null;
  max_depth: number | null;
  [key: string]: unknown;
};
type TavernRuntimeRegexOption = {
  type: 'preset';
  name: 'in_use';
};
type TavernRuntimeRegexUpdater = (
  regexes: TavernRuntimeRegex[],
) => TavernRuntimeRegex[] | Promise<TavernRuntimeRegex[]>;
declare function updateTavernRegexesWith(
  updater: TavernRuntimeRegexUpdater,
  option: TavernRuntimeRegexOption,
): Promise<TavernRuntimeRegex[]>;

// —— 脚本按钮 / 事件 / 杂项 ——
declare function appendInexistentScriptButtons(buttons: Array<{ name: string; visible: boolean }>): void;
declare function updateScriptButtonsWith(updater: (buttons: Array<{ name: string; visible: boolean }>) => Array<{ name: string; visible: boolean }>): void;
declare function getButtonEvent(button_name: string): string;
declare function eventOn(event_type: string, listener: (...args: unknown[]) => unknown): { stop: () => void };
declare function getScriptId(): string;
declare function errorCatched<T extends (...args: unknown[]) => unknown>(fn: T): T;

/** 酒馆顶部轻提示（toastr 2.x 的本插件所需最小子集） */
declare const toastr: {
  info: (
    message: string,
    title?: string,
    options?: {
      timeOut?: number;
      extendedTimeOut?: number;
      closeButton?: boolean;
      preventDuplicates?: boolean;
      escapeHtml?: boolean;
      onclick?: () => void;
    },
  ) => unknown;
};

/** jQuery（酒馆环境全局） */
declare const $: (selector: unknown) => {
  on: (...args: unknown[]) => unknown;
  [k: string]: unknown;
};

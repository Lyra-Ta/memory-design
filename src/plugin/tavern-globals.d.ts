/**
 * 酒馆助手运行时全局（值由酒馆助手在脚本作用域注入；这里只声明类型让 TS 通过）。
 * 打包时这些标识符不被解析成模块导入，原样留作运行时全局引用。
 */

// —— 数据 / 生成 ——
declare function getChatMessages(
  range: string | number,
  option?: unknown,
): Array<{ message_id: number; message: string; [k: string]: unknown }>;
declare function setChatMessages(
  messages: Array<{ message_id: number; message: string }>,
  option?: { refresh?: 'none' | 'affected' | 'all' },
): Promise<void>;
declare function getLastMessageId(): number;
declare function generateRaw(config: unknown): Promise<unknown>;
declare function stopGenerationById(generation_id: string): boolean;
declare function stopAllGeneration(): boolean;
declare function getVariables(option: unknown): Record<string, unknown>;
declare function insertOrAssignVariables(variables: Record<string, unknown>, option: unknown): unknown;

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

/**
 * 记忆插件 · 核心层统一出口
 * ------------------------------------------------------------
 * 「引擎/架子分离」里架子侧的纯逻辑内核：档案格式、定位表、触发、两段提交。
 * 全部纯函数、零副作用、不依赖酒馆全局（提交执行器的酒馆接口靠注入），
 * 因而可在酒馆之外独立单测；也可原样放进 tavern_helper 模板打包。
 */

export * from './types';
export * from './archive-format';
export * from './summary-format';
export * from './locator';
export * from './trigger';
export * from './summary-trigger';
export * from './commit';

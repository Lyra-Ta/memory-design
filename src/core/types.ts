/**
 * 记忆插件 · 核心域模型
 * ------------------------------------------------------------
 * 这些类型是「引擎/架子分离」里架子侧的通用词汇：
 * 档案结构、标签世代、覆盖标记、定位表条目、触发状态。
 * 纯数据、零副作用、不依赖酒馆全局，因而可独立单测。
 */

/** 标签世代：在场 / 退役 / 暂存 */
export type Generation = 'live' | 'old' | 'pending';

/** 一条摘录（· 行）：保留原动作 / 原对话 / 原意象 */
export interface Excerpt {
  /** · 之后的正文（已去掉行首中点与两侧空白） */
  text: string;
}

/** 一个片段 `[标题 | 时间]`：小总结 + 弹性条数摘录 */
export interface Fragment {
  /** 标题的「名」部分 */
  title: string;
  /** 标题的「时间」部分；缺 `| 时间` 字段时为 null */
  time: string | null;
  /** 小总结正文 */
  summary: string;
  /** 摘录列表（可为空） */
  excerpts: Excerpt[];
}

/**
 * 一个顶层节点：
 *  - `kind:'container'` = 时间轴容器 `《标题 | 时间》`，大总结（总领）+ 若干片段。
 *  - `kind:'segment'`   = 旧扁平格式的顶层段 `[标题 | 关键词 | 时间]`（无《》时），只有总结、无片段。
 */
export interface Container {
  /** 节点种类：时间轴容器 vs 旧扁平顶层段 */
  kind: 'container' | 'segment';
  title: string;
  time: string | null;
  /** 旧扁平段 `[标题 | 关键词 | 时间]` 的中段（意象/关键词）；时间轴容器为 null */
  keywords: string | null;
  /** 大总结（总领全容器），契约要求非空 */
  summary: string;
  fragments: Fragment[];
  /**
   * 无所属片段、直接挂在节点下的摘录（非常规输入）。
   * 保留它只为让 解析→序列化 对内容无损；正常档案里应为空。
   */
  looseExcerpts?: Excerpt[];
}

/** 结构解析后的一份档案 */
export interface ParsedArchive {
  generation: Generation;
  containers: Container[];
}

/**
 * 覆盖标记 `<!-- archived: N -->`：只记「总结到了哪一层」这一个端点（= boundary）。
 * 起点不必记——它就是上一条标记的端点（首条则为 0），可派生，故省去。
 */
export interface CoverageMarker {
  /** 总结到的层（端点 / boundary） */
  through: number;
  /** 该标记在源文本中的字符区间 [start, end) */
  span: [number, number];
}

/** 从楼层文本中抽出的一个档案块（尚未做结构解析） */
export interface ArchiveBlock {
  generation: Generation;
  /** 含标签的完整原文 */
  raw: string;
  /** 去掉外壳标签后的内部正文 */
  inner: string;
  /** 该块在源文本中的字符区间 [start, end) */
  span: [number, number];
}

/** 校验问题的严重度 */
export type IssueSeverity = 'hard' | 'soft';

/** 一条结构校验问题 */
export interface ValidationIssue {
  severity: IssueSeverity;
  /** 机器码，便于测试/一键补正定位 */
  code: string;
  /** 中文描述（给用户看） */
  message: string;
  /** 出问题的容器序号（从 0 起，尽力而为） */
  containerIndex?: number;
  /** 出问题的片段序号（从 0 起，尽力而为） */
  fragmentIndex?: number;
}

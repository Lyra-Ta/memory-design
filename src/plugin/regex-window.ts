/** 最近多少层始终保留原始正文（深度 0 = 最新消息）。 */
export const RAW_CONTEXT_DEPTH = 10;

/** 正则深度按多少层一档向上取整，避免频繁改动。 */
export const REGEX_DEPTH_STEP = 10;

/** 尚无任何 World Archive 时，Flux 可见区间的最小初始深度。 */
export const INITIAL_FLUX_DEPTH = 50;

export interface RegexDepthWindowParams {
  /** 当前聊天的最后楼层 q。 */
  currentFloor: number;
  /** 最近一份完整、在场的 World Archive 所在楼层 x；尚无则为 null。 */
  latestArchiveFloor: number | null;
}

export interface RegexDepthWindow {
  /** 尚未被最新 Archive 覆盖的最大深度。无 x 时需覆盖 0..q，共 q+1 层。 */
  unarchivedDepth: number;
  /** 0..rawMaxDepth：保留原始正文。 */
  rawMaxDepth: number;
  /** fluxMinDepth..fluxMaxDepth：保留 Flux 或 Archive。 */
  fluxMinDepth: number;
  fluxMaxDepth: number;
  /** archiveOnlyMinDepth..∞：只保留 Archive。 */
  archiveOnlyMinDepth: number;
}

function roundDepthUp(depth: number): number {
  return Math.ceil(depth / REGEX_DEPTH_STEP) * REGEX_DEPTH_STEP;
}

/**
 * 由共享聊天状态里的 q / x 计算正则窗口；纯函数、无读取与写入副作用。
 *
 * W 始终不小于 unarchivedDepth，因此最新 Archive 之后（或首次 Archive 之前）
 * 尚未总结的 Flux 不会落入“只留 Archive”的区间。
 */
export function computeRegexDepthWindow(params: RegexDepthWindowParams): RegexDepthWindow {
  const { currentFloor: q, latestArchiveFloor: x } = params;
  const unarchivedDepth = x === null ? q + 1 : Math.max(0, q - x);
  const minimumFluxDepth = x === null ? INITIAL_FLUX_DEPTH : RAW_CONTEXT_DEPTH;
  const fluxMaxDepth = Math.max(minimumFluxDepth, roundDepthUp(unarchivedDepth));

  return {
    unarchivedDepth,
    rawMaxDepth: RAW_CONTEXT_DEPTH,
    fluxMinDepth: RAW_CONTEXT_DEPTH + 1,
    fluxMaxDepth,
    archiveOnlyMinDepth: fluxMaxDepth + 1,
  };
}

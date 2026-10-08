/**
 * isopleth — composable charts on Apache ECharts 6 with built-in insights.
 *
 * ```ts
 * import * as ip from "isopleth";
 *
 * const chart = ip.plot({
 *   marks: [
 *     ip.areaY(data, ip.windowY(7, { x: "date", y: "value", fill: "series", fillOpacity: 0.3 })),
 *     ip.lineY(data, { x: "date", y: "value", stroke: "series" }),
 *     ip.ruleY([0]),
 *   ],
 *   insights: { anomalies: true, forecast: { horizon: 30 } },
 * });
 * await chart.render(document.getElementById("chart")!);
 * ```
 */

// Core
export { plot, Chart } from "./chart.js";
export type { ChartInstance, RenderOptions } from "./chart.js";
export { compile } from "./compile/index.js";
export { renderChart, renderSVG, disposeChart, registerECharts } from "./render.js";

// Marks
export {
  line, lineX, lineY, area, areaX, areaY, barX, barY, rect, rectX, rectY, cell, dot, dotX, dotY,
  ruleX, ruleY, text, textX, textY, differenceX, differenceY, frame, gridX, gridY, marks, createMark, flattenMarks,
} from "./marks.js";
export type { DifferenceOptions } from "./marks.js";
export { auto, autoSpec } from "./auto.js";
export { fromSpec, specMarks, specToCode, inspectFields } from "./spec.js";
export type { ChartSpec, SpecMark, FieldInfo } from "./spec.js";
export type { AutoOptions, AutoSpec, AutoChannel } from "./auto.js";

// Transforms
export { filter, sort, reverse, shuffle, basic, column, composeTransform, seriesOf, zOf, isDataChannel } from "./transforms/basic.js";
export { bin, binX, binY, group, groupX, groupY, groupZ } from "./transforms/group.js";
export type { BinOutputs, GroupOutputs, Thresholds } from "./transforms/group.js";
export { stackX, stackY, stackX1, stackX2, stackY1, stackY2 } from "./transforms/stack.js";
export type { StackOptions, StackOffset, StackOrder } from "./transforms/stack.js";
export { map, mapX, mapY, window, windowX, windowY, normalizeX, normalizeY, imputeX, imputeY, diffY, cumsumY, shiftX } from "./transforms/map.js";
export type { MapFn, MapMethod, WindowOptions, Basis, ImputeMethod } from "./transforms/map.js";
export { intervalX, intervalY } from "./transforms/interval.js";
export type { IntervalTransformOptions } from "./transforms/interval.js";
export { selectFirst, selectLast, selectMinX, selectMaxX, selectMinY, selectMaxY } from "./transforms/select.js";

// Channels, intervals, scales
export { identity, indexOf, valueof, inferType, isColor, formatValue } from "./channel.js";
export { numberInterval, utcInterval, maybeInterval, medianStep, guessTimeInterval } from "./interval.js";
export { SCHEMES, INSIGHT_COLORS, fadeGradient, withOpacity } from "./compile/palette.js";
export { themes, light as lightTheme, dark as darkTheme, ink as inkTheme, defineTheme, resolveTheme, themeToCSSVars } from "./theme.js";
export type { Theme, ThemeInsightColors, ThemeMarkSpecs } from "./theme.js";

// Backend
export { getBackend, useBackend, init, jsBackend } from "./backend/index.js";
export type { Backend, AnomalyResult, ForecastResult, ChangepointResult, SeasonalityResult, TrendResult, Decomposition, FrequencyOutlierResult, CategoryOutlierResult, SeriesOutlierResult } from "./backend/types.js";
export { BackendError } from "./backend/types.js";

// Types
export type * from "./types.js";

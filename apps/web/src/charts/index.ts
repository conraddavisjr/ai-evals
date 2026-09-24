/**
 * Hand-rolled SVG charts on the app's tokens. Hover tooltips are a mouse-only
 * affordance on plain SVG marks (biome's static-interaction rule is off for this
 * directory): every chart carries an aria-label and sits beside a table view,
 * which is the accessible path.
 */
export { BarChart, type BarDatum, type BarSeries } from './BarChart.js'
export { DotStrip, type DotStripGroup } from './DotStrip.js'
export { type HeatCell, Heatmap } from './Heatmap.js'
export { Legend, type LegendItem } from './Legend.js'
export { LineChart, type LinePoint, type LineSeries } from './LineChart.js'
export { CATEGORICAL, ROLE_COLOR, roleColor, SERIES, STATUS_BAD } from './palette.js'

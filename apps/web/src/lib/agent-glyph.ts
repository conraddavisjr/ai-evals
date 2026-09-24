/**
 * The robot mark that says "this is a sub-agent, not a person". One SVG string so
 * the React panels and the DOM-built Trace board draw the identical glyph.
 * Colour comes from `currentColor`, so it takes the layer or role colour around it.
 */
export const AGENT_GLYPH_SVG =
  '<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">' +
  '<rect x="2.5" y="5" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="6" cy="9" r="1.2" fill="currentColor"/><circle cx="10" cy="9" r="1.2" fill="currentColor"/>' +
  '<path d="M8 5V2.8M6.2 2.8h3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<path d="M6 11.6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
  '</svg>'

export { agentLabel, isAgentId } from './nomenclature.js'

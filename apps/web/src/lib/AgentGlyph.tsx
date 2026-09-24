/** Inline robot mark before an agent's name. The DOM Trace board draws the same shape from agent-glyph.ts. */
export function AgentGlyph({ className = '' }: { className?: string }) {
  return (
    <span className={`agent-glyph ${className}`}>
      <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
        <rect
          x="2.5"
          y="5"
          width="11"
          height="8"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="6" cy="9" r="1.2" fill="currentColor" />
        <circle cx="10" cy="9" r="1.2" fill="currentColor" />
        <path
          d="M8 5V2.8M6.2 2.8h3.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M6 11.6h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  )
}

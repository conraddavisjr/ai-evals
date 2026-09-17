import type { CafeStore } from '@cafe/db'
import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { ulid } from 'ulid'

export type Listener = (event: CafeEvent) => void

/**
 * Per-run event bus: stamps id/seq/t, validates against the protocol, keeps an
 * in-memory buffer for live subscribers and replay-from-seq, and persists in
 * order. Every subsystem's `emit` ends up here.
 */
export class EventBus {
  readonly buffer: CafeEvent[] = []
  private seq = 0
  private listeners = new Set<Listener>()
  private persistChain: Promise<void> = Promise.resolve()
  private persistErrors = 0

  constructor(
    readonly runId: string,
    private readonly store: CafeStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  emit = (input: CafeEventInput): CafeEvent => {
    const event = CafeEvent.parse({
      ...input,
      id: ulid(),
      runId: this.runId,
      seq: this.seq++,
      t: this.now(),
    })
    this.buffer.push(event)
    for (const l of this.listeners) {
      try {
        l(event)
      } catch (err) {
        console.error('[event-bus] listener threw', err)
      }
    }
    this.persistChain = this.persistChain
      .then(() => this.store.events.append(event))
      .catch((err) => {
        this.persistErrors += 1
        if (this.persistErrors <= 3)
          console.error('[event-bus] failed to persist event', event.type, err)
      })
    return event
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolve the next event matching a predicate (optionally checking the buffer first). */
  waitFor(
    pred: (e: CafeEvent) => boolean,
    opts: { includeBuffered?: boolean; signal?: AbortSignal } = {},
  ): Promise<CafeEvent> {
    if (opts.includeBuffered) {
      const hit = this.buffer.find(pred)
      if (hit) return Promise.resolve(hit)
    }
    return new Promise((resolve, reject) => {
      const off = this.subscribe((e) => {
        if (pred(e)) {
          off()
          resolve(e)
        }
      })
      opts.signal?.addEventListener(
        'abort',
        () => {
          off()
          reject(new Error('aborted'))
        },
        { once: true },
      )
    })
  }

  /** Wait until every emitted event has hit the database. */
  flush(): Promise<void> {
    return this.persistChain
  }
}

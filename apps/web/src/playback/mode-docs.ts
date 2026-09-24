import type { PlaybackMode } from './TimelinePlayer.js'

export interface ModeDoc {
  id: PlaybackMode
  label: string
  /** The keyboard shortcut that selects the mode. */
  key: string
  /** Two sentences: what the mode does and how to drive it. Shown collapsed. */
  summary: string
  /** The long form, one paragraph per entry. Shown after "See more". */
  details: string[]
}

/**
 * User-facing help for each playback mode. Lives next to the player so the stage
 * carries its own documentation when it is embedded somewhere else.
 */
export const MODE_DOCS: readonly ModeDoc[] = [
  {
    id: 'live-buffered',
    label: 'Live',
    key: '1',
    summary:
      'Watches a run in progress a few seconds behind real time, so every walk, bubble and ticket gets animated instead of piling up. The buffer menu sets how far behind; pause holds the picture and play catches back up.',
    details: [
      'Live is the default while a run is going. Events arrive over the stream as they happen, but the player only applies each one once it is older than the buffer, which gives the scene time to finish one animation before the next begins. The buffer menu sets that delay: 1s is closest to real time, 5s gives the smoothest picture on a busy shift. The lag readout under the scrubber shows how far behind you are. Once the shift finishes, whatever is left in the buffer drains on its own.',
      'Play and pause hold or resume the buffered feed; while paused the stream keeps buffering, so nothing is lost. The step buttons move one beat at a time, where a beat is an arrival, an utterance, a tool call, a ticket milestone, an error or a verdict. Press 1 to switch here from the keyboard and space to play or pause. When no shift is loaded the transport is disabled: open the cafe to start one, or pick a recent shift in the Shift tab to replay it.',
    ],
  },
  {
    id: 'live-raw',
    label: 'Raw',
    key: '2',
    summary:
      'Applies every event the instant it arrives, with no buffer at all. Honest wall-clock timing, but bursts land all at once and quick beats get no animation.',
    details: [
      'Raw is Live without the safety margin. The moment an event reaches the browser it is applied to the scene and the panels, so what you see is exactly as far along as the server. Use it when the true clock matters more than a readable picture: checking how long a hang really lasted, or watching a race between two agents that a buffer would smooth over. The lag readout should sit at zero.',
      'There is nothing to play or pause in Raw, which is why that button is disabled here. Stepping back is possible, but the next event to arrive snaps the scene forward again, so switch to Step when you want to read at your own pace; your position carries across. Press 2 to switch here from the keyboard.',
    ],
  },
  {
    id: 'replay',
    label: 'Replay',
    key: '3',
    summary:
      'Plays a run back with its real timing at the speed you choose. Click anywhere on the scrubber to jump; the markers are case arrivals.',
    details: [
      'Replay reads the same event stream a live view showed, so what you see is exactly what happened, only on your clock. The speed menu runs from 0.25x for a close look at a single visit to 8x for skimming a long shift. Play, pause and the step buttons work as expected, and playback stops on its own at the last event. If a shift is still running, Replay shows what has arrived so far and waits at the end until you switch back to Live.',
      'The scrubber is a timeline of the whole run. Each marker is a case arriving, coloured by how it ended: white for served, gold for refused, red for failed or abandoned. Clicking rebuilds the scene at that instant with no animation, so seeking is instant. Press 3 to switch here, space to play or pause, and the arrow keys to step by beat.',
    ],
  },
  {
    id: 'step',
    label: 'Step',
    key: '4',
    summary:
      'Pauses on every beat so you can read what happened, then moves on with Next, the arrow keys or space. The gold readout shows the real time that passed since the previous beat.',
    details: [
      'Step is for reading a run rather than watching it. The scene stops after each beat and waits, and bubbles linger instead of fading so there is time to read them. The granularity menu chooses what counts as a beat: "beats" are the coarse milestones (arrivals, utterances, tool calls, ticket changes, errors, verdicts) and "every visible event" also stops on walks and thinking. Bookkeeping events such as usage records ride along with the beat before them.',
      'Next and the right arrow advance one beat; the left arrow goes back, which rebuilds the scene at the earlier point. The +3.2s style readout under the scrubber is the real gap between the two most recent beats, which is how a hang shows up. Clicking the scrubber jumps to any point and stays paused. Press 4 to switch here. Step works on a live shift too: you fall behind, but nothing is lost, and switching back to Live catches you up.',
    ],
  },
  {
    id: 'directors-cut',
    label: "Director's cut",
    key: '5',
    summary:
      'Replay with the timing edited for watchability: tiny gaps are stretched so each beat is readable and long hangs are compressed, with the order of events preserved. Three sliders tune the cut.',
    details: [
      "Real runs have both instantaneous beats (a tool returning and the next thought 10 ms later) and dead air (agent 2 hung for 40 seconds). The cut remaps time so neither wastes your attention. Scale multiplies every real gap before clamping. Min gap is the shortest a visible beat stays on screen before the same character's next one, so one barista's steps stay readable without slowing everyone else down. Max gap caps any single wait, which is what turns a 40 second hang into a three second one.",
      'Order is never changed, only spacing, so cause and effect still read correctly. The readout at the end of the slider row shows how much real time was mapped onto how much screen time. The speed menu, scrubber and step buttons work as in Replay. Press 5 to switch here. This is also the best mode for a demo: a low max gap and 2x speed plays a whole shift in under a minute.',
    ],
  },
]

export function modeDoc(id: PlaybackMode): ModeDoc {
  const doc = MODE_DOCS.find((m) => m.id === id)
  if (!doc) throw new Error(`no docs for playback mode ${id}`)
  return doc
}

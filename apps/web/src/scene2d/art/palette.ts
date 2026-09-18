/**
 * One shared palette keyed by single characters. Sprite grids are strings of
 * these characters, so art is editable in a text editor and diffable in git.
 * Characters may be remapped per sprite (hair, shirt, skin) for variety.
 */
export const PALETTE: Record<string, string> = {
  '.': 'transparent',
  K: '#2b1d16', // outline
  // walls & floors
  W: '#f3e6cc',
  w: '#dccaa6',
  V: '#c9b48c',
  F: '#b9834f',
  f: '#9b6a3d',
  g: '#cf9a66',
  T: '#e9dcc6',
  t: '#d6c6aa',
  // wood & counters
  C: '#8d5a2b',
  c: '#dba46a',
  d: '#5f3b1b',
  D: '#3f2612',
  // metals
  M: '#9ba6b2',
  m: '#5f6b78',
  l: '#dfe6ee',
  // accents
  R: '#c94a3d',
  r: '#7f2a22',
  G: '#5e9b45',
  n: '#3d6b2e',
  Y: '#f2c94c',
  y: '#c9962a',
  O: '#e08a3c',
  B: '#4d7fc4',
  b: '#2f4f80',
  P: '#e7a0b8',
  p: '#b3536f',
  U: '#8b6fd1',
  // people
  S: '#f2c9a3', // skin
  s: '#d9a578', // skin shade
  H: '#4a2f1f', // hair
  h: '#2c1a10', // hair shade
  A: '#f4efe4', // apron
  a: '#cfc6b3', // apron shade
  E: '#ffffff', // eye white
  e: '#1a1a1a', // pupil
  X: '#6b4a2b', // shirt (generic)
  x: '#4b3219', // shirt shade
  Q: '#3b3f5c', // pants
  q: '#23263a', // pants shade
  Z: '#2a2a2a', // shoes
  // paper / ui
  I: '#fffdf5',
  i: '#e6dfc9',
  '#': '#000000',
}

export type Recolor = Partial<Record<string, string>>

/** Named looks: which palette characters get swapped for a given character. */
export const CHARACTER_LOOKS: Record<string, Recolor> = {
  cashier_a: {
    H: '#7a3b1e',
    h: '#4d2311',
    X: '#3d7a5a',
    x: '#2a5740',
    Q: '#3b3f5c',
    S: '#f2c9a3',
    s: '#d9a578',
  },
  cashier_b: {
    H: '#1f1f1f',
    h: '#0d0d0d',
    X: '#3d7a5a',
    x: '#2a5740',
    Q: '#4a3a2a',
    S: '#b57a4e',
    s: '#8f5a34',
  },
  barista_a: {
    H: '#d9a441',
    h: '#a87a25',
    X: '#8a4b3a',
    x: '#5f3126',
    Q: '#2f3542',
    S: '#f2c9a3',
    s: '#d9a578',
  },
  barista_b: {
    H: '#5b3a8c',
    h: '#3b2460',
    X: '#8a4b3a',
    x: '#5f3126',
    Q: '#2f3542',
    S: '#e8b58c',
    s: '#c48c62',
  },
  manager: {
    H: '#2c1a10',
    h: '#150b05',
    X: '#2b3a67',
    x: '#1b2544',
    Q: '#1f1f1f',
    S: '#c68a5a',
    s: '#9d6a3f',
    A: '#2b3a67',
    a: '#1b2544',
  },
  judge: {
    H: '#9a9a9a',
    h: '#6d6d6d',
    X: '#4a4a4a',
    x: '#2e2e2e',
    Q: '#2e2e2e',
    S: '#f2c9a3',
    s: '#d9a578',
    A: '#4a4a4a',
    a: '#2e2e2e',
  },
  customer_a: {
    H: '#1b1b1b',
    h: '#000000',
    X: '#c94a3d',
    x: '#7f2a22',
    Q: '#3b3f5c',
    S: '#8d5a3a',
    s: '#6a4128',
  },
  customer_b: {
    H: '#c96f2f',
    h: '#8f4a1c',
    X: '#4d7fc4',
    x: '#2f4f80',
    Q: '#2a2a2a',
    S: '#f2c9a3',
    s: '#d9a578',
  },
  customer_c: {
    H: '#4a2f1f',
    h: '#2c1a10',
    X: '#f2c94c',
    x: '#c9962a',
    Q: '#2f4f80',
    S: '#e8b58c',
    s: '#c48c62',
  },
  customer_d: {
    H: '#e8e0d0',
    h: '#b8b0a0',
    X: '#8b6fd1',
    x: '#5d47a0',
    Q: '#3b3f5c',
    S: '#f2c9a3',
    s: '#d9a578',
  },
  customer_e: {
    H: '#2c1a10',
    h: '#150b05',
    X: '#5e9b45',
    x: '#3d6b2e',
    Q: '#1f1f1f',
    S: '#b57a4e',
    s: '#8f5a34',
  },
  customer_f: {
    H: '#7a3b1e',
    h: '#4d2311',
    X: '#e7a0b8',
    x: '#b3536f',
    Q: '#2a2a2a',
    S: '#f2c9a3',
    s: '#d9a578',
  },
}

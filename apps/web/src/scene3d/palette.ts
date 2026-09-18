/**
 * Character looks: hair, shirt, pants, skin (and apron for staff). Shared between
 * the 3D figures and any 2D fallbacks so a persona keeps its colours everywhere.
 */
export interface Look {
  hair: string
  shirt: string
  pants: string
  skin: string
  apron?: string
  hat?: string
}

export const LOOKS: Record<string, Look> = {
  cashier_a: {
    hair: '#8a4a26',
    shirt: '#3f8f6a',
    pants: '#3a3f66',
    skin: '#f2c9a3',
    apron: '#e9d9c3',
  },
  cashier_b: {
    hair: '#232323',
    shirt: '#3f8f6a',
    pants: '#4a3a2a',
    skin: '#b57a4e',
    apron: '#e9d9c3',
  },
  barista_a: {
    hair: '#e0ad45',
    shirt: '#8a4b3a',
    pants: '#2f3542',
    skin: '#f2c9a3',
    apron: '#3c2a24',
    hat: '#3c2a24',
  },
  barista_b: {
    hair: '#5f3f95',
    shirt: '#8a4b3a',
    pants: '#2f3542',
    skin: '#e8b58c',
    apron: '#3c2a24',
    hat: '#3c2a24',
  },
  manager: {
    hair: '#2c1a10',
    shirt: '#2b3a67',
    pants: '#1f1f1f',
    skin: '#c68a5a',
    apron: '#2b3a67',
  },
  judge: { hair: '#a8a8a8', shirt: '#4a4a52', pants: '#2e2e2e', skin: '#f2c9a3' },
  customer_a: { hair: '#1b1b1b', shirt: '#c94a3d', pants: '#3b3f5c', skin: '#8d5a3a' },
  customer_b: { hair: '#c96f2f', shirt: '#4d7fc4', pants: '#2a2a2a', skin: '#f2c9a3' },
  customer_c: { hair: '#4a2f1f', shirt: '#f2c94c', pants: '#2f4f80', skin: '#e8b58c' },
  customer_d: { hair: '#e8e0d0', shirt: '#8b6fd1', pants: '#3b3f5c', skin: '#f2c9a3' },
  customer_e: { hair: '#2c1a10', shirt: '#5e9b45', pants: '#1f1f1f', skin: '#b57a4e' },
  customer_f: { hair: '#7a3b1e', shirt: '#e7a0b8', pants: '#2a2a2a', skin: '#f2c9a3' },
}

export const lookFor = (sprite: string): Look =>
  LOOKS[sprite] ??
  LOOKS.customer_a ?? { hair: '#222', shirt: '#888', pants: '#333', skin: '#f2c9a3' }

/** Scene palette (kept in one place so the world reads as one painting). */
export const P = {
  cobble: ['#718e91', '#80999a', '#637f86', '#8ba3a0', '#788b91', '#777f98'],
  cobbleDark: '#263e4a',
  timber: '#596563',
  timberDark: '#2b4246',
  plank: '#9a8970',
  stone: '#88a5a8',
  stoneDark: '#48616f',
  plaster: '#9cb6ad',
  roof: '#305967',
  roofDark: '#203b50',
  awningA: '#6d6399',
  awningB: '#b8d1bf',
  copper: '#c47a48',
  brass: '#d9b25a',
  iron: '#3a3a42',
  water: '#2f9fc8',
  waterDeep: '#1e6f95',
  moss: '#6fa25a',
  mossDark: '#4b7a3c',
  flower: '#e46c8a',
  paper: '#f6efdd',
  glow: '#ffb15c',
  glowHot: '#fff0c8',
} as const

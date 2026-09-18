/**
 * 16x24 character frames. Rows are strings; one character per pixel.
 * Directions: down, up, side (right; flipped for left). Two frames each:
 * standing/step. Staff variants add an apron over the shirt.
 */
export const CHAR_W = 16
export const CHAR_H = 24

const DOWN_A = [
  '................',
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '...KHHHHHHHHK...',
  '...KHhHHHHhHK...',
  '...KHSSSSSSHK...',
  '...KSSSSSSSSK...',
  '...KSEeSSEeSK...',
  '...KSSSSSSSSK...',
  '...KsSSssSSsK...',
  '....KsSSSSsK....',
  '.....KKKKKK.....',
  '....KXXXXXXK....',
  '...KXXXXXXXXK...',
  '..KSKXXXXXXKSK..',
  '..KSKXXXXXXKSK..',
  '...KKXXXXXXKK...',
  '....KQQQQQQK....',
  '....KQQQQQQK....',
  '....KQQKKQQK....',
  '....KQQK.KQQK...',
  '....KqqK.KqqK...',
  '....KZZK.KZZK...',
  '....KKKK.KKKK...',
]
const DOWN_B = [
  '................',
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '...KHHHHHHHHK...',
  '...KHhHHHHhHK...',
  '...KHSSSSSSHK...',
  '...KSSSSSSSSK...',
  '...KSEeSSEeSK...',
  '...KSSSSSSSSK...',
  '...KsSSssSSsK...',
  '....KsSSSSsK....',
  '.....KKKKKK.....',
  '....KXXXXXXK....',
  '...KXXXXXXXXK...',
  '..KSKXXXXXXKSK..',
  '...KKXXXXXXKK...',
  '....KXXXXXXK....',
  '....KQQQQQQK....',
  '....KQQQQQQK....',
  '....KQQKKQQK....',
  '...KQQK..KQQK...',
  '...KqqK..KZZK...',
  '...KZZK..KKKK...',
  '...KKKK.........',
]
const UP_A = [
  '................',
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '...KHHHHHHHHK...',
  '...KHHHHHHHHK...',
  '...KHHHHHHHHK...',
  '...KHHhHHhHHK...',
  '...KHHHHHHHHK...',
  '...KhHHHHHHhK...',
  '....KhHHHHhK....',
  '.....KSSSSK.....',
  '.....KKKKKK.....',
  '....KXXXXXXK....',
  '...KXXXXXXXXK...',
  '..KSKXXXXXXKSK..',
  '..KSKXXXXXXKSK..',
  '...KKXXXXXXKK...',
  '....KQQQQQQK....',
  '....KQQQQQQK....',
  '....KQQKKQQK....',
  '....KQQK.KQQK...',
  '....KqqK.KqqK...',
  '....KZZK.KZZK...',
  '....KKKK.KKKK...',
]
const UP_B = UP_A.map((row, i) => (i >= 19 ? (DOWN_B[i] ?? row) : row))
const SIDE_A = [
  '................',
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '...KHHHHHHHHK...',
  '...KHHHHHHhHK...',
  '...KHHHSSSSHK...',
  '...KHHSSSSSSK...',
  '...KHhSSSEeSK...',
  '...KHHSSSSSSK...',
  '...KhHsSSSsSK...',
  '....KKsSSSsK....',
  '.....KKKKKK.....',
  '.....KXXXXXK....',
  '....KXXXXXXXK...',
  '....KXXKSKXXK...',
  '....KXXKSKXXK...',
  '.....KXKKKXK....',
  '.....KQQQQQK....',
  '.....KQQQQQK....',
  '.....KQQQQQK....',
  '.....KQQKQQK....',
  '.....KqqKqqK....',
  '.....KZZKZZK....',
  '.....KKKKKKK....',
]
const SIDE_B = [
  ...SIDE_A.slice(0, 17),
  '.....KQQQQQK....',
  '.....KQQQQQK....',
  '....KQQKKQQK....',
  '...KQQK..KQQK...',
  '...KqqK..KqqK...',
  '...KZZK..KZZK...',
  '...KKKK..KKKK...',
]

/** Draw an apron over the torso rows (12-18) of a frame. */
function withApron(frame: string[], side = false): string[] {
  return frame.map((row, y) => {
    if (y < 12 || y > 18) return row
    const chars = row.split('')
    const [from, to] = side ? [6, 9] : [5, 10]
    for (let x = from; x <= to; x++) {
      if (chars[x] === 'X') chars[x] = y === 18 ? 'a' : 'A'
      if (chars[x] === 'Q' && y === 18) chars[x] = 'a'
    }
    return chars.join('')
  })
}

export interface CharacterFrames {
  down: [string[], string[]]
  up: [string[], string[]]
  side: [string[], string[]]
}

export const CIVILIAN: CharacterFrames = {
  down: [DOWN_A, DOWN_B],
  up: [UP_A, UP_B],
  side: [SIDE_A, SIDE_B],
}
export const STAFF: CharacterFrames = {
  down: [withApron(DOWN_A), withApron(DOWN_B)],
  up: [UP_A, UP_B],
  side: [withApron(SIDE_A, true), withApron(SIDE_B, true)],
}

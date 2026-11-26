import type { ClientModule, ClientPointerEvent } from 'claude-code'

import type { Piece } from './pill'

// "when i click it seems to select chars and copy them"
// "and not having my mouse click be the expected action as before"
//
// The band of pills, drawn and pressed here. A press is the mouse going down,
// as it always was in ag: the engine's own Button waits for the mouse to come
// up where it went down, and a hand that moved one character between the two
// selected text and copied it instead (seen in Claude Code 2.1.332 on
// 2026-11-27: "copied 2 chars to clipboard", and the pill did not open). A
// Client holds the pointer from the down on, so nothing is selected.
//
// What is pressed is found in the rows that are drawn (./pill.tsx): a row is
// its pieces one after another, and a piece that is a press says its key.
export type Rows = { rows: Piece[][] }

// How many rows of the screen a row takes: what a message says is a row a line.
const tall = (row: Piece[]) => Math.max(1, ...row.filter(p => p.rest).map(p => p.text.split('\n').length))

// The press at column x, row y of the band, if one is drawn there.
export function pressedAt(rows: Piece[][], x: number, y: number): string | undefined {
  let top = 0
  for (const row of rows) {
    const height = tall(row)
    if (y >= top && y < top + height) {
      // A press is on its row's first line.
      if (y !== top) return undefined
      let left = 0
      for (const piece of row) {
        if (piece.rest) return undefined
        if (x >= left && x < left + piece.text.length) return piece.key
        left += piece.text.length
      }
      return undefined
    }
    top += height
  }
  return undefined
}

const Band: ClientModule<Rows> = (props, surface) => {
  const { Box, Text } = surface.elements

  surface.onPointer((e: ClientPointerEvent) => {
    if (e.type !== 'down') return
    const key = pressedAt(props.rows, e.x, e.y)
    if (key !== undefined) surface.post({ press: key })
  })

  const worn = (p: Piece) => ({
    color: p.color,
    backgroundColor: p.backgroundColor,
    bold: p.bold || undefined,
    dimColor: p.dim || undefined,
    inverse: p.inverse || undefined,
  })

  return (
    <Box flexDirection="column">
      {props.rows.map((row, at) => (
        <Box key={`row${at}`} flexDirection="row">
          <Box flexShrink={0} flexDirection="row">
            {row.filter(p => !p.rest).map((p, i) => (
              <Text key={`p${i}`} {...worn(p)}>{p.text}</Text>
            ))}
          </Box>
          {row.filter(p => p.rest).map((p, i) => (
            <Text key={`r${i}`} {...worn(p)} wrap="truncate">{p.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Band

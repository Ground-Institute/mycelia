import type { Fork, Line, View } from '../types'
import { surfaceLines } from './surface'

// "IN ELEMENTS THERE IS THE CHAT"
// "IT HAS PILLS"
// "WHY CANT IT BE LIKE THAT"
//
// What waits is a pill above the prompt, as elements has it above a chat's
// field (teranos/elements content/say.ts `waiting`, forms/pill.ts): at rest it
// says when, which way and who; pressed, what it holds stands under the line
// of pills, as the person knows it:
//   +- +- [now]         [edit]              [delete] [esc]
//     16:25 <-- Shiitake: Some text of Shiitake to us.
// What is drawn and what a press does are said here once, as rows of pieces:
// ./band.tsx draws the pieces and finds the one pressed in the same rows, so
// where a press lands is never written apart from what is drawn there.

// What a press asks of the node: the act, on whom, and what it carries.
// `collection` is the one acted on: without it the node acts on every one it holds for `to`.
export type Press = { act: string; to: string; collection?: string; id?: string; until?: string; says?: string }

// What the pills are given: what to draw, and what a press does.
export type Given = {
  lines: Line[]
  forks: Fork[]
  name: string
  here: boolean
  view: View
  now: number // this clock when drawn, in milliseconds
  clock: () => Promise<number> // this clock when pressed
  set: (view: View) => unknown
  act: (press: Press) => unknown
  // A +- press: the collection, on whom, the time it is moved to, up or down, and which +-.
  move: (collection: string, to: string, until: string, up: boolean, pair: number) => unknown
  named: (act: 'take' | 'give' | 'open', session: string) => unknown
}

// How long an armed press waits for its second (elements ARMED_FOR_MS).
export const ARMED_FOR_MS = 5000
// What an armed press wears: green sends, red cannot be undone.
const YES = 'green'
const NO = 'red'

// "bg red when minus, bg green when plus, for like a sec"
// "decrease the wait to 20s"
// A +- press flashes for FLASH_MS, then waits WAIT_MS more; the time moved to
// is held once both have passed since the last press (register.tsx).
export const FLASH_MS = 1000
export const WAIT_MS = 20000

// "17:35<-[Rowan] 18:32->[Keeper] 11-29.12:24->[Window] 11-29.13:45<-Noah[vfxstreet]"
// "click on a pill to expand, it and then interact with it."
//
// "the fact that we dont do full collections per session anyore"
//
// One pill is one collection: what one agent said to one other, with its own
// time (laye collected.rs, "A collection is its own"). In is what was said to
// this session, out what this session said.
type Pill = { key: string; way: 'in' | 'out'; to: string; who: string; at: string; lines: Line[] }

// The pills, the soonest first.
function pillsOf(lines: Line[]): Pill[] {
  const pills: Pill[] = []
  for (const line of lines) {
    if (line.way === 'approve') continue
    const held = pills.find(p => p.key === line.collection)
    if (held) held.lines.push(line)
    else pills.push({ key: line.collection ?? '', way: line.way, to: line.to, who: line.who, at: line.at ?? '', lines: [line] })
  }
  const time = (at: string) => Date.parse(at) || Number.MAX_SAFE_INTEGER
  return pills.sort((a, b) => time(a.at) - time(b.at))
}

const two = (n: number) => String(n).padStart(2, '0')

// A time as this clock reads it: HH:MM, with its MM-DD before it when that is
// not today, as one word: 11-29.12:24.
export function whenOf(at: string, now: number): string {
  const t = new Date(at)
  if (Number.isNaN(t.getTime()) || t.getTime() <= 0) return ''
  const today = new Date(now)
  const clock = `${two(t.getHours())}:${two(t.getMinutes())}`
  const sameDay = t.getFullYear() === today.getFullYear() && t.getMonth() === today.getMonth() && t.getDate() === today.getDate()
  return sameDay ? clock : `${two(t.getMonth() + 1)}-${two(t.getDate())}.${clock}`
}

// A time moved by minutes, RFC3339 in and out: days on, never around the clock.
export function moved(at: string, minutes: number): string {
  return new Date(Date.parse(at) + minutes * 60000).toISOString().replace('.000Z', 'Z')
}

// What a pill says at rest: when, which way, and who.
function titleOf(pill: Pill, now: number): string {
  return `${whenOf(pill.at, now)}${pill.way === 'in' ? '<-' : '->'}[${pill.who}]`
}

// One piece of a row: what it says, how it is worn, and the press it is.
export type Piece = {
  text: string
  key?: string // pressed, this is what is done: Drawn.does[key]
  color?: string
  backgroundColor?: string
  bold?: boolean
  dim?: boolean
  inverse?: boolean
  rest?: boolean // what a message says: the rest of its row, each line of it a row of the screen
}

// A message being edited, in the engine's own field.
export type Field = { key: string; label: string; value: string; rows: number; save: (says: string) => unknown }

// What is drawn: the rows, what each press does, and the fields under them.
export type Drawn = { rows: Piece[][]; does: Record<string, () => unknown>; fields: Field[] }

export function pills(given: Given): Drawn {
  const { view, now, set, act } = given
  const armed = view.armed !== undefined && now - view.armed.at <= ARMED_FOR_MS ? view.armed.id : undefined
  const rows: Piece[][] = []
  const does: Record<string, () => unknown> = {}
  const fields: Field[] = []

  // One press does it.
  const once = (key: string, text: string, did: () => unknown, worn: Partial<Piece> = {}): Piece => {
    does[key] = did
    return { text, key, ...worn }
  }

  // "[now], this means to me kind fo same thing as [delete] two stage, press once, you get [NOW] green, and press another time, it actually get's released"
  // The first press arms it; the second does it. Armed is asked of the clock
  // at the press, not at the drawing.
  const twice = (key: string, rested: string, armedText: string, means: string, did: () => unknown, bold = true): Piece => {
    does[key] = async () => {
      const at = await given.clock()
      const live = view.armed?.id === key && at - view.armed.at <= ARMED_FOR_MS
      return live ? did() : set({ ...view, armed: { id: key, at } })
    }
    return armed === key ? { text: armedText, key, color: means, bold } : { text: rested, key }
  }

  const gap = (n = 1): Piece => ({ text: ' '.repeat(n) })
  const all = pillsOf(given.lines)

  // "⑂ Mycelia stays with  ● this session   ○ mycelia on k"
  // The name is on the filled one; a press on a hollow one moves it there.
  if (given.forks.length > 0) {
    const holder = given.forks.find(f => f.holds)
    const row: Piece[] = [{ text: `⑂ ${given.name || 'the name'} stays with  ` }]
    const here = `${given.here ? '●' : '○'} this session`
    row.push(given.here || !holder ? { text: here, bold: given.here, dim: !given.here } : once('fork:here', here, () => given.named('take', holder.session), { dim: true }))
    for (const f of given.forks) {
      const label = `${f.holds ? '●' : '○'} ${f.title || f.name || f.session.slice(0, 8)}`
      row.push(gap(3))
      row.push(f.holds || !given.here ? { text: label, bold: f.holds, dim: !f.holds } : once(`fork:${f.session}`, label, () => given.named(f.running ? 'open' : 'give', f.session), { dim: true }))
    }
    rows.push(row)
  }

  // "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
  // An approval is the thing itself, with its two presses beside it:
  //   [approve] [deny]  REACH is 'lines:scene' of TOKEN on kapteyn, for ramen
  for (const line of given.lines.filter(l => l.way === 'approve')) {
    rows.push([
      twice(`approve:${line.id}`, '[approve]', '[APPROVE]', YES, () => act({ act: 'release', to: line.to, collection: line.collection, id: line.id })),
      gap(),
      twice(`deny:${line.id}`, '[deny]', '[DENY]', NO, () => act({ act: 'cancel', to: line.to, collection: line.collection, id: line.id })),
      gap(2),
      { text: line.says, bold: true, rest: true },
    ])
  }

  // The line of pills: pressed, a pill is the one open; pressed again, it rests.
  if (all.length > 0) {
    const row: Piece[] = []
    for (const p of all) {
      const open = view.open === p.key
      row.push(once(`pill:${p.key}`, titleOf(p, now), () => set(open ? {} : { open: p.key }), { bold: open, inverse: open }))
      row.push(gap())
    }
    rows.push(row)
  }

  // What the open pill holds, under the line of pills, as the person knows it.
  for (const p of all.filter(p => p.key === view.open)) {
    const moving = view.moving?.[p.key]
    const flashing = moving !== undefined && now - moving.at < FLASH_MS
    // "its the +- its bg that was supposed to change color"
    const lit = (pair: number): Partial<Piece> => {
      if (!moving || moving.pair !== pair) return {}
      return flashing ? { backgroundColor: moving.up ? YES : NO, color: 'white' } : { backgroundColor: 'white', color: 'black' }
    }
    const at = moving?.until ?? p.at
    const nudge = (pair: number, up: boolean, minutes: number): Piece =>
      once(`${pair === 0 ? 'h' : 'm'}${up ? '+' : '-'}:${p.key}`, up ? '+' : '-', () => at && given.move(p.key, p.to, moved(at, minutes), up, pair), lit(pair))
    rows.push([
      nudge(0, true, 60), nudge(0, false, -60), gap(), nudge(1, true, 5), nudge(1, false, -5), gap(),
      twice(`now:${p.key}`, '[now]', '[NOW]', YES, () => act({ act: 'release', to: p.to, collection: p.key })),
      gap(9),
      once(`edit:${p.key}`, '[edit]', () => set({ ...view, armed: undefined, editing: view.editing === p.key ? undefined : p.key })),
      gap(14),
      twice(`delete:${p.key}`, '[delete]', '[DELETE]', NO, () => act({ act: 'cancel', to: p.to, collection: p.key })),
      gap(),
      // "cancel should get us out of the clicked-in," A time moved and not yet held stays where it was.
      once(`esc:${p.key}`, '[esc]', () => set({ moving: without(view.moving, p.key) })),
    ])
    for (const line of p.lines) {
      // "the arrow you can also click on, one to see thebutton change into XXXX and again to cancel"
      // "but the invert on the time, you may keep"
      rows.push([
        gap(2),
        { text: whenOf(at, now), ...(moving ? { backgroundColor: 'white', color: 'black' } : {}) },
        gap(),
        twice(`arrow:${line.id}`, p.way === 'in' ? '<-- ' : '--> ', 'XXXX', NO, () => act({ act: 'cancel', to: p.to, collection: p.key, id: line.id }), false),
        { text: line.who, bold: true },
        { text: ': ' },
        { text: line.says, dim: true, rest: true },
      ])
      // "Getting A2UI pieces to show up in another session from this one"
      // The surface said beside it stands under it, a row of the screen a line.
      if (line.a2ui?.length) for (const text of surfaceLines(line.a2ui)) rows.push([{ text: `    ${text}` }])
      // "i cant edit a message, i have to backspace a bunch of times and rewrite the message itself."
      // Edited in the engine's own field, holding what it says: Enter saves
      // what this one says, and sends nothing.
      if (view.editing === p.key)
        fields.push({
          key: `says:${line.id}`,
          label: line.who,
          value: line.says,
          rows: Math.min(8, Math.max(2, line.says.split('\n').length)),
          save: (says: string) => act({ act: 'edit', to: p.to, collection: p.key, id: line.id, says }),
        })
    }
  }

  return { rows, does, fields }
}

// What moves, less the one of this collection.
function without(moving: View['moving'], collection: string): View['moving'] {
  const rest = { ...moving }
  delete rest[collection]
  return rest
}

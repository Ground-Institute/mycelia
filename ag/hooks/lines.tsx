import type { ClientModule, ClientPointerEvent, ClientKeyEvent } from 'claude-code'

import type { Fork, Line } from '../types'

// One line a message, drawn and pressed here. At rest a message is its line:
//   16:25 <-- Shiitake: Some text of Shiitake to us.
// Clicked in, its buttons stand on a line above it:
//   +- +- [now]         [edit]              [delete] [esc]
// What a press means is posted to ag's hooks, which ask ground.

// The sessions that branched from this one stand above the messages, a row
// each; a click on one gives it this session's name (ground forks give).
// now, today and tomorrow are this clock's HH:MM, MM-DD and tomorrow's MM-DD:
// what tells a day that is not today.
export type Lines = { lines: Line[]; forks?: Fork[]; name?: string; here?: boolean; now?: string; today?: string; tomorrow?: string }

type State = {
  open?: number // the message clicked in
  armed?: number // the message whose arrow was pressed once: XXXX
  deleting?: boolean // [delete] pressed once on the message clicked in: [DELETE]
  releasing?: boolean // [now] pressed once on the message clicked in: [NOW]
  due?: string // the time it is held to, as moved by +-, before it is asked
  moving?: Moving // the +- presses not yet asked of the node
  approving?: number // the approval whose [approve] was pressed once: [APPROVE]
  denying?: number // the approval whose [deny] was pressed once: [DENY]
  typing?: string // what is typed in place of what is said, while editing
}

// What a press comes to: what to post to ag's hooks, if anything, and the
// state after it.
type Pressed = { post?: Record<string, string>; next: State }

// Which message, and whether this row is its buttons or its line.
type Row = { line: number; buttons: boolean }

// How far the message line stands in under its buttons.
const UNDER = 2
// How wide the arrow is on a message line; it stands after the time drawn.
const ARROW_WIDE = 4

// The time moved by minutes, around the clock.
function moved(due: string, minutes: number): string {
  const [h, m] = due.split(':').map(Number)
  const all = (((h ?? 0) * 60 + (m ?? 0) + minutes) % 1440 + 1440) % 1440
  return `${String(Math.floor(all / 60)).padStart(2, '0')}:${String(all % 60).padStart(2, '0')}`
}

// Each row of the region: the message clicked in has its buttons above it.
function rowsOf(lines: Line[], open?: number): Row[] {
  const rows: Row[] = []
  lines.forEach((_, i) => {
    if (open === i) rows.push({ line: i, buttons: true })
    rows.push({ line: i, buttons: false })
  })
  return rows
}

// "if i put it all the way until the next day, right now, that isnt clearly indicated. with like mm-dd"
// The time drawn on a message's line, with its day when that is not today:
// the node's, or the one moved by +-, held to tomorrow once now is past it.
function shownOf(state: State, at: number, line: Line, props: Lines): string {
  if (state.open === at && state.due) {
    const tomorrow = props.now !== undefined && state.due <= props.now && props.tomorrow
    return tomorrow ? `${props.tomorrow} ${state.due}` : state.due
  }
  return line.day && line.day !== props.today ? `${line.day} ${line.due}` : line.due
}

// A press on a message's own line: on its arrow, or anywhere else on it.
// "the arrow you can also click on, one to see thebutton change into XXXX and again to cancel"
function onLine(state: State, at: number, x: number, line: Line, shown: string): Pressed {
  const left = state.open === at ? UNDER : 0
  const arrow = left + shown.length + 1
  if (x >= arrow && x < arrow + ARROW_WIDE) {
    if (state.armed === at) return { post: { act: 'cancel', to: line.to, id: line.id }, next: {} }
    return { next: { ...state, armed: at } }
  }
  return { next: state.open === at ? state : { open: at } }
}

// Where each button starts on the button line, as drawn:
//   +- +- [now]         [edit]              [delete] [esc]
//     16:25 <-- Shiitake: Some text of Shiitake to us.
// "the word cancel isnt clear"
const AT = { now: 6, edit: 20, delete: 40, esc: 49 }
// "[now], this means to me kind fo same thing as [delete] two stage, press once, you get [NOW] green, and press another time, it actually get's released"
const nowOf = (releasing: boolean) => (releasing ? '[NOW]' : '[now]')
const deleteOf = (deleting: boolean) => (deleting ? '[DELETE]' : '[delete]')

// The +- pairs: hours first, then minutes, each up then down.
const NUDGE: Record<number, number> = { 0: 60, 1: -60, 3: 5, 4: -5 }

// "bg red when minus, bg green when plus, for like a sec, and then for a full 30 sec, it stays bg white with text black"
// "another click resets timer, timer finishes means, you commit to this new time"
// A +- press moves the time here and asks nothing yet: the time flashes for
// a second, then waits thirty, and only then is the hold asked of the node.
// Each press starts the wait over. Counted in ticks of TICK_MS.
// pair is the +- pressed: 0 the hours, 1 the minutes.
type Moving = { to: string; left: number; up: boolean; pair: number }
const TICK_MS = 100
const FLASH = 10
const WAIT = 300

// One tick of the wait: the next state, and the hold to ask once it ran out.
function ticked(state: State): Pressed {
  const moving = state.moving
  if (!moving) return { next: state }
  if (moving.left > 1) return { next: { ...state, moving: { ...moving, left: moving.left - 1 } } }
  const { moving: _, ...rest } = state
  return { post: { act: 'hold', to: moving.to, until: state.due ?? '' }, next: rest }
}

// The Clients whose wait is ticking: one clock each, started once.
const ticking = new WeakSet<object>()

// "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
// "AND WITHOUT CHANCE FOR USER ERROR"
// An approval is the thing itself, with its two presses on its own line,
// each pressed twice as [delete] is:
//   [approve] [deny]  REACH is 'lines:scene' of TOKEN on kapteyn, for ramen
const APPROVE = { approve: 0, deny: 10, says: 18 }
const approveOf = (on: boolean) => (on ? '[APPROVE]' : '[approve]')
const denyOf = (on: boolean) => (on ? '[DENY]' : '[deny]')

function onApproval(state: State, at: number, x: number, line: Line): Pressed {
  if (x >= APPROVE.approve && x < APPROVE.approve + 9) {
    if (state.approving === at) return { post: { act: 'release', to: line.to, id: line.id }, next: {} }
    return { next: { approving: at } }
  }
  if (x >= APPROVE.deny && x < APPROVE.deny + 6) {
    if (state.denying === at) return { post: { act: 'cancel', to: line.to, id: line.id }, next: {} }
    return { next: { denying: at } }
  }
  return { next: {} }
}

// A press on the buttons of the message clicked in.
function onButtons(state: State, x: number, line: Line, lines: Line[]): Pressed {
  const nudge = NUDGE[x]
  if (nudge !== undefined) {
    const until = moved(state.due ?? line.due, nudge)
    return { next: { ...state, due: until, moving: { to: line.to, left: FLASH + WAIT, up: nudge > 0, pair: x < 3 ? 0 : 1 } } }
  }
  if (x >= AT.now && x < AT.now + 5) {
    if (state.releasing) return { post: { act: 'release', to: line.to }, next: {} }
    return { next: { ...state, releasing: true, deleting: false } }
  }
  if (x >= AT.edit && x < AT.edit + 6) {
    const whole = lines.filter(l => l.way === line.way && l.to === line.to).map(l => l.says).join('\n')
    return { next: { ...state, typing: whole } }
  }
  // "and there should be a more explicit abort, that is two stage abort"
  if (x >= AT.delete && x < AT.delete + 8) {
    if (state.deleting) return { post: { act: 'cancel', to: line.to, id: line.id }, next: {} }
    return { next: { ...state, deleting: true, releasing: false } }
  }
  // "cancel should get us out of the clicked-in,"
  if (x >= AT.esc && x < AT.esc + 5) return { next: {} }
  return { next: state }
}

// A key while editing what the message clicked in says.
function onKey(state: State, key: string, line: Line): Pressed {
  const typing = state.typing ?? ''
  if (key === 'return') return { post: { act: 'release', to: line.to, says: typing }, next: {} }
  if (key === 'backspace') return { next: { ...state, typing: typing.slice(0, -1) } }
  if (key.length === 1) return { next: { ...state, typing: typing + key } }
  return { next: state }
}

const Ag: ClientModule<Lines, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state: State = surface.state ?? {}
  const forks = props.forks ?? []
  // An approval opens no buttons: its presses are on its own line.
  const rows = rowsOf(props.lines, state.open !== undefined && props.lines[state.open]?.way === 'approve' ? undefined : state.open)
  // "yes,"
  // ⑂ Mycelia stays with  ● this session   ○ mycelia on k
  // The name is on the filled one; a click on another moves it there.
  const here = props.here !== false
  const lead = `⑂ ${props.name || 'the name'} stays with  `
  const hereLabel = `${here ? '●' : '○'} this session`
  const holder = forks.find(f => f.holds)
  const choices: { session: string; label: string; holds: boolean; from: number; to: number }[] = []
  let x = lead.length + hereLabel.length
  for (const f of forks) {
    const label = `${f.holds ? '●' : '○'} ${f.title || f.name || f.session.slice(0, 8)}`
    choices.push({ session: f.session, label, holds: f.holds, from: x + 3, to: x + 3 + label.length })
    x += 3 + label.length
  }
  const apply = (pressed: Pressed) => {
    if (pressed.post) surface.post(pressed.post)
    surface.setState(pressed.next)
  }
  if (!ticking.has(surface)) {
    ticking.add(surface)
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now?.moving) apply(ticked(now))
    })
  }

  surface.onPointer((e: ClientPointerEvent) => {
    if (e.type !== 'down') return
    if (forks.length > 0 && e.y === 0) {
      // A hollow one is the choice: a branch, to give the name to, or this
      // session, to take it back from the one holding it.
      if (!here && holder && e.x >= lead.length && e.x < lead.length + hereLabel.length) {
        apply({ post: { act: 'take', to: holder.session }, next: state })
        return
      }
      const at = choices.find(c => !c.holds && here && e.x >= c.from && e.x < c.to)
      // A branch alive in another window cannot become this one: the name
      // stays, and how to open it is said.
      const running = at && forks.find(f => f.session === at.session)?.running
      if (at) apply({ post: { act: running ? 'open' : 'give', to: at.session }, next: state })
      return
    }
    const row = rows[e.y - (forks.length > 0 ? 1 : 0)]
    const line = row ? props.lines[row.line] : undefined
    if (!row || !line) return
    if (line.way === 'approve') {
      apply(onApproval(state, row.line, e.x, line))
      return
    }
    apply(row.buttons ? onButtons(state, e.x, line, props.lines) : onLine(state, row.line, e.x, line, shownOf(state, row.line, line, props)))
  })

  surface.onKey((e: ClientKeyEvent) => {
    if (state.open === undefined || state.typing === undefined) return
    const line = props.lines[state.open]
    apply(line ? onKey(state, e.key, line) : { next: {} })
  })

  // "its the +- its bg that was supposed to change color"
  // The +- pressed flashes green up or red down for a second, then stands
  // white for the wait.
  const moving = state.moving
  const pairOf = (pair: number) => {
    if (!moving || moving.pair !== pair) return {}
    if (moving.left > WAIT) return { backgroundColor: moving.up ? 'green' : 'red', color: 'white' }
    return { backgroundColor: 'white', color: 'black' }
  }
  const buttonsOf = (at: number) => (
    <Box key={`b${at}`} flexDirection="row">
      <Text {...pairOf(0)}>{'+-'}</Text>
      <Text>{' '}</Text>
      <Text {...pairOf(1)}>{'+-'}</Text>
      <Text>{' '}</Text>
      <Text color={state.releasing ? 'green' : undefined} bold={!!state.releasing}>{nowOf(!!state.releasing)}</Text>
      <Text>{' '.repeat(AT.edit - AT.now - 5) + '[edit]' + ' '.repeat(AT.delete - AT.edit - 6)}</Text>
      <Text color={state.deleting ? 'red' : undefined} bold={!!state.deleting}>{deleteOf(!!state.deleting)}</Text>
      <Text>{' [esc]'}</Text>
    </Box>
  )

  const approvalOf = (at: number, line: Line) => {
    const approving = state.approving === at
    const denying = state.denying === at
    return (
      <Box key={`a${at}`} flexDirection="row">
        <Box flexShrink={0} flexDirection="row">
          <Text color={approving ? 'green' : undefined} bold={approving}>{approveOf(approving)}</Text>
          <Text>{' '.repeat(APPROVE.deny - 9)}</Text>
          <Text color={denying ? 'red' : undefined} bold={denying}>{denyOf(denying)}</Text>
          <Text>{' '.repeat(APPROVE.says - APPROVE.deny - 6)}</Text>
        </Box>
        <Text bold wrap="truncate">{line.says}</Text>
      </Box>
    )
  }

  const lineOf = (at: number, line: Line) => {
    const open = state.open === at
    const editing = open && state.typing !== undefined
    const armed = state.armed === at
    // "but the invert on the time, you may keep"
    const lit = open && state.moving ? { backgroundColor: 'white', color: 'black' } : {}
    return (
      <Box key={`l${at}`} flexDirection="row">
        <Box flexShrink={0} flexDirection="row">
          {open ? <Text>{' '.repeat(UNDER)}</Text> : null}
          <Text {...lit}>{shownOf(state, at, line, props)}</Text>
          <Text> </Text>
          <Text color={armed ? 'red' : undefined}>{armed ? 'XXXX' : line.way === 'in' ? '<-- ' : '--> '}</Text>
          <Text bold>{line.who}</Text>
          <Text>: </Text>
        </Box>
        <Text dimColor={!editing} wrap="truncate">{editing ? `${state.typing}_` : line.says}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {forks.length > 0 ? (
        <Box key="forks" flexDirection="row">
          <Text>{lead}</Text>
          <Text bold={here} dimColor={!here}>{hereLabel}</Text>
          {choices.map(c => (
            <Text key={c.session} bold={c.holds} dimColor={!c.holds}>{'   ' + c.label}</Text>
          ))}
        </Box>
      ) : null}
      {rows.map(row => {
        const line = props.lines[row.line] as Line
        if (line.way === 'approve') return approvalOf(row.line, line)
        return row.buttons ? buttonsOf(row.line) : lineOf(row.line, line)
      })}
    </Box>
  )
}

export default Ag

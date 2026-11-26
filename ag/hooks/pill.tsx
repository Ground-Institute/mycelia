import type { Fork, Line, View } from '../types'

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
// Drawn with the engine's own Button and Input, so nothing here places a
// character or reads a click.

// The engine's elements this draws with, as `$.ui.resolve(e)` gives them.
type Table = { Box: any; Text: any; Button: any; Input: any }

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

export function pills(table: Table, given: Given) {
  const { Box, Text, Button, Input } = table
  const { view, now, set, act } = given
  const armed = view.armed !== undefined && now - view.armed.at <= ARMED_FOR_MS ? view.armed.id : undefined

  // One press does it.
  const once = (id: string, title: string, does: () => unknown) => (
    <Button key={id} plain onPress={does}>
      <Text>{`[${title}]`}</Text>
    </Button>
  )

  // "[now], this means to me kind fo same thing as [delete] two stage, press once, you get [NOW] green, and press another time, it actually get's released"
  // The first press arms it, in capitals; the second does it.
  const twice = (id: string, title: string, means: string, does: () => unknown) => (
    <Button
      key={id}
      plain
      onPress={async () => {
        // Armed is asked of the clock at the press, not at the drawing.
        const at = await given.clock()
        const live = view.armed?.id === id && at - view.armed.at <= ARMED_FOR_MS
        return live ? does() : set({ ...view, armed: { id, at } })
      }}
    >
      <Text color={armed === id ? means : undefined} bold={armed === id}>
        {armed === id ? `[${title.toUpperCase()}]` : `[${title}]`}
      </Text>
    </Button>
  )

  const gap = <Text> </Text>
  const space = (n: number) => <Text>{' '.repeat(n)}</Text>
  const all = pillsOf(given.lines)

  // "⑂ Mycelia stays with  ● this session   ○ mycelia on k"
  const forksRow = () => {
    const holder = given.forks.find(f => f.holds)
    return (
      <Box key="forks" flexDirection="row">
        <Text>{`⑂ ${given.name || 'the name'} stays with  `}</Text>
        {given.here || !holder ? (
          <Text bold={given.here} dimColor={!given.here}>{`${given.here ? '●' : '○'} this session`}</Text>
        ) : (
          <Button key="fork:here" plain onPress={() => given.named('take', holder.session)}>
            <Text dimColor>○ this session</Text>
          </Button>
        )}
        {given.forks.map(f => {
          const label = `${f.holds ? '●' : '○'} ${f.title || f.name || f.session.slice(0, 8)}`
          return f.holds || !given.here ? (
            <Text key={`fork:${f.session}`} bold={f.holds} dimColor={!f.holds}>{`   ${label}`}</Text>
          ) : (
            <Box key={`forkrow:${f.session}`} flexDirection="row">
              <Text>{'   '}</Text>
              <Button key={`fork:${f.session}`} plain onPress={() => given.named(f.running ? 'open' : 'give', f.session)}>
                <Text dimColor>{label}</Text>
              </Button>
            </Box>
          )
        })}
      </Box>
    )
  }

  // "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
  // An approval is the thing itself, with its two presses beside it:
  //   [approve] [deny]  REACH is 'lines:scene' of TOKEN on kapteyn, for ramen
  const approval = (line: Line) => (
    <Box key={`approve:${line.id}`} flexDirection="row">
      {twice(`approve:${line.id}`, 'approve', YES, () => act({ act: 'release', to: line.to, collection: line.collection, id: line.id }))}
      {gap}
      {twice(`deny:${line.id}`, 'deny', NO, () => act({ act: 'cancel', to: line.to, collection: line.collection, id: line.id }))}
      {space(2)}
      <Text bold wrap="truncate">{line.says}</Text>
    </Box>
  )

  // A pill at rest, in the line of them: pressed, it is the one open.
  const rest = (p: Pill) => (
    <Box key={`rest:${p.key}`} flexShrink={0} flexDirection="row">
      <Button key={`pill:${p.key}`} plain onPress={() => set(view.open === p.key ? {} : { open: p.key })}>
        <Text bold={view.open === p.key} inverse={view.open === p.key}>{titleOf(p, now)}</Text>
      </Button>
      {gap}
    </Box>
  )

  // What the open pill holds, under the line of pills, as the person knows it.
  const held = (p: Pill) => {
    const moving = view.moving?.[p.key]
    const flashing = moving !== undefined && now - moving.at < FLASH_MS
    // "its the +- its bg that was supposed to change color"
    const lit = (pair: number) => {
      if (!moving || moving.pair !== pair) return {}
      return flashing ? { backgroundColor: moving.up ? YES : NO, color: 'white' } : { backgroundColor: 'white', color: 'black' }
    }
    // "but the invert on the time, you may keep"
    const when = moving ? { backgroundColor: 'white', color: 'black' } : {}
    const at = moving?.until ?? p.at
    const nudge = (pair: number, up: boolean, minutes: number) => (
      <Button
        key={`${pair === 0 ? 'h' : 'm'}${up ? '+' : '-'}:${p.key}`}
        plain
        onPress={() => at && given.move(p.key, p.to, moved(at, minutes), up, pair)}
      >
        <Text {...lit(pair)}>{up ? '+' : '-'}</Text>
      </Button>
    )
    return (
      <Box key={`held:${p.key}`} flexDirection="column">
        <Box key="presses" flexDirection="row">
          {nudge(0, true, 60)}{nudge(0, false, -60)}{gap}{nudge(1, true, 5)}{nudge(1, false, -5)}{gap}
          {twice(`now:${p.key}`, 'now', YES, () => act({ act: 'release', to: p.to, collection: p.key }))}
          {space(9)}
          <Button key={`edit:${p.key}`} plain onPress={() => set({ ...view, armed: undefined, editing: view.editing === p.key ? undefined : p.key })}>
            <Text>[edit]</Text>
          </Button>
          {space(14)}
          {twice(`delete:${p.key}`, 'delete', NO, () => act({ act: 'cancel', to: p.to, collection: p.key }))}
          {gap}
          {/* "cancel should get us out of the clicked-in," A time moved and not yet held stays where it was. */}
          <Button key={`esc:${p.key}`} plain onPress={() => set({ moving: without(view.moving, p.key) })}>
            <Text>[esc]</Text>
          </Button>
        </Box>
        {p.lines.map(line => message(p, line, whenOf(at, now), when))}
      </Box>
    )
  }

  // One message of the open pill: when, which way, who, what it says.
  // "the arrow you can also click on, one to see thebutton change into XXXX and again to cancel"
  const message = (p: Pill, line: Line, at: string, when: object) => {
    const id = `arrow:${line.id}`
    const lead = (
      <Box flexShrink={0} flexDirection="row">
        {space(2)}
        <Text {...when}>{at}</Text>
        {gap}
        <Button
          key={id}
          plain
          onPress={async () => {
            const pressedAt = await given.clock()
            const live = view.armed?.id === id && pressedAt - view.armed.at <= ARMED_FOR_MS
            return live ? act({ act: 'cancel', to: p.to, collection: p.key, id: line.id }) : set({ ...view, armed: { id, at: pressedAt } })
          }}
        >
          <Text color={armed === id ? NO : undefined}>{armed === id ? 'XXXX' : p.way === 'in' ? '<-- ' : '--> '}</Text>
        </Button>
        <Text bold>{line.who}</Text>
        <Text>: </Text>
      </Box>
    )
    // "i cant edit a message, i have to backspace a bunch of times and rewrite the message itself."
    // Edited in the engine's own field, holding what it says: Enter saves what
    // this one says, and sends nothing.
    if (view.editing === p.key) {
      return (
        <Box key={`msg:${line.id}`} flexDirection="column">
          {lead}
          <Input
            key={`says:${line.id}`}
            value={line.says}
            rows={Math.min(8, Math.max(2, line.says.split('\n').length))}
            submitLabel="save"
            onSubmit={(says: string) => act({ act: 'edit', to: p.to, collection: p.key, id: line.id, says })}
          />
        </Box>
      )
    }
    return (
      <Box key={`msg:${line.id}`} flexDirection="row">
        {lead}
        <Text dimColor wrap="truncate">{line.says}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {given.forks.length > 0 ? forksRow() : null}
      {given.lines.filter(l => l.way === 'approve').map(approval)}
      {all.length > 0 ? <Box key="pills" flexDirection="row">{all.map(rest)}</Box> : null}
      {all.filter(p => p.key === view.open).map(held)}
    </Box>
  )
}

// What moves, less the one of this collection.
function without(moving: View['moving'], collection: string): View['moving'] {
  const rest = { ...moving }
  delete rest[collection]
  return rest
}

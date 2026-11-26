import type { Fork, Line, View } from '../types'

// "IN ELEMENTS THERE IS THE CHAT"
// "IT HAS PILLS"
// "WHY CANT IT BE LIKE THAT"
//
// What waits is a pill above the prompt, as elements has it above a chat's
// field (teranos/elements content/say.ts `waiting`, forms/pill.ts): at rest it
// says its title; pressed, it is across its row with what it holds; pressed
// again, it rests. Its presses are elements' presses (forms/press.ts): one
// press does it, or the first arms and says what the second does, red where it
// cannot be undone and green where it sends. Drawn with the engine's own
// Button and Input, so nothing here places a character or reads a click.

// The engine's elements this draws with, as `$.ui.resolve(e)` gives them.
type Table = { Box: any; Text: any; Button: any; Input: any }

// What a press asks of the node: the act, on whom, and what it carries.
export type Press = { act: string; to: string; id?: string; ids?: string[]; until?: string; says?: string }

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
  named: (act: 'take' | 'give' | 'open', session: string) => unknown
}

// How long an armed press waits for its second (elements ARMED_FOR_MS).
export const ARMED_FOR_MS = 5000
// What an armed press wears (elements MEANS): yes sends, no cannot be undone.
const YES = 'green'
const NO = 'red'

// "17:35<-[Rowan] 18:32->[Keeper] 11-29.12:24->[Window] 11-29.13:45<-Noah[vfxstreet]"
// "click on a pill to expand, it and then interact with it."
//
// One pill: what one agent said to this session, or what this session said to
// one agent, and when it is due. `whole` is whether it is all its collection
// holds: what comes in from several agents is one collection, a pill each.
type Pill = { key: string; way: 'in' | 'out'; to: string; who: string; at: string; lines: Line[]; whole: boolean }

// The pills, the soonest first.
function pillsOf(lines: Line[]): Pill[] {
  const pills: Pill[] = []
  for (const line of lines) {
    if (line.way === 'approve') continue
    const key = line.way === 'in' ? `in:${line.to}:${line.who}` : `out:${line.to}`
    const held = pills.find(p => p.key === key)
    if (held) held.lines.push(line)
    else pills.push({ key, way: line.way, to: line.to, who: line.who, at: line.at ?? '', lines: [line], whole: true })
  }
  for (const pill of pills)
    pill.whole = lines.filter(l => l.way === pill.way && l.to === pill.to).length === pill.lines.length
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

  // The first press arms and says what the second does; the second does it.
  const twice = (id: string, title: string, again: string, means: string, does: () => unknown) => (
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
        {armed === id ? `[again: ${again}]` : `[${title}]`}
      </Text>
    </Button>
  )

  const gap = <Text> </Text>
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
  // An approval is the thing itself, with its two presses beside it.
  const approval = (line: Line) => (
    <Box key={`approve:${line.id}`} flexDirection="row">
      {twice(`approve:${line.id}`, 'approve', 'approve', YES, () => act({ act: 'release', to: line.to, id: line.id }))}
      {gap}
      {twice(`deny:${line.id}`, 'deny', 'deny', NO, () => act({ act: 'cancel', to: line.to, id: line.id }))}
      {gap}
      <Text bold wrap="truncate">{line.says}</Text>
    </Box>
  )

  // One message in an open pill: who said it and what, to edit or to delete.
  const message = (pill: Pill, line: Line) => {
    if (view.editing === line.id) {
      return (
        <Box key={`msg:${line.id}`} flexDirection="column">
          <Input
            key={`says:${line.id}`}
            label={line.who}
            value={line.says}
            rows={Math.min(8, Math.max(2, line.says.split('\n').length))}
            submitLabel="save"
            onSubmit={(says: string) => act({ act: 'edit', to: pill.to, id: line.id, says })}
          />
          {once(`edit-off:${line.id}`, 'esc', () => set({ ...view, editing: undefined }))}
        </Box>
      )
    }
    return (
      <Box key={`msg:${line.id}`} flexDirection="row">
        <Box flexShrink={0} flexDirection="row">
          {once(`edit:${line.id}`, 'edit', () => set({ ...view, editing: line.id, armed: undefined }))}
          {gap}
          {twice(`delete:${line.id}`, 'delete', 'delete this one', NO, () => act({ act: 'cancel', to: pill.to, id: line.id }))}
          {gap}
          <Text bold>{line.who}</Text>
          <Text>: </Text>
        </Box>
        <Text dimColor wrap="truncate">{line.says}</Text>
      </Box>
    )
  }

  // A pill: its title at rest; pressed, across its row with what it holds.
  // A pill at rest, in the line of them: pressed, it is the one open.
  const rest = (p: Pill) => (
    <Box key={`rest:${p.key}`} flexShrink={0} flexDirection="row">
      <Button key={`pill:${p.key}`} plain onPress={() => set(view.open === p.key ? {} : { open: p.key })}>
        <Text bold={view.open === p.key} inverse={view.open === p.key}>{titleOf(p, now)}</Text>
      </Button>
      {gap}
    </Box>
  )

  // Each of a pill's own, one after the other: what several agents sent is
  // one collection, and a pill that is not the whole of it acts on its own.
  const each = (p: Pill, one: (id: string) => Press) => async () => {
    for (const line of p.lines) await act(one(line.id))
  }

  // What the open pill holds, under the line of pills.
  const held = (p: Pill) => {
    const until = view.until?.[p.to]
    const nudge = (id: string, title: string, minutes: number) =>
      once(`${id}:${p.key}`, title, () => p.at && set({ ...view, armed: undefined, until: { ...view.until, [p.to]: moved(until ?? p.at, minutes) } }))
    return (
      <Box key={`held:${p.key}`} flexDirection="column">
        <Box key="when" flexDirection="row">
          {nudge('h-', '-1h', -60)}{gap}{nudge('h+', '+1h', 60)}{gap}{nudge('m-', '-5m', -5)}{gap}{nudge('m+', '+5m', 5)}
          {gap}
          {until === undefined ? (
            <Text dimColor>{whenOf(p.at, now)}</Text>
          ) : (
            once(`hold:${p.key}`, `hold until ${whenOf(until, now)}`, () => act({ act: 'hold', to: p.to, until }))
          )}
          {gap}
          {twice(`now:${p.key}`, 'now', 'release now', YES, () => act(p.whole ? { act: 'release', to: p.to } : { act: 'release', to: p.to, ids: p.lines.map(l => l.id) }))}
          {gap}
          {once(`later:${p.key}`, 'later', () => act({ act: 'later', to: p.to }))}
          {gap}
          {twice(`delete:${p.key}`, 'delete', 'delete all of it', NO, p.whole ? () => act({ act: 'cancel', to: p.to }) : each(p, id => ({ act: 'cancel', to: p.to, id })))}
        </Box>
        {p.lines.map(line => message(p, line))}
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

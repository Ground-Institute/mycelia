import { expect, mock, test } from 'claude-code/testing'
import { surfaceLines } from '../hooks/surface'
import { failureOf } from '../hooks/register'

// A time on this clock, as laye keeps it: RFC3339.
const at = (h: number, m: number) => new Date(2026, 10, 14, h, m).toISOString()

// What mycelia keeps of laye's collections for a session with one message in
// and one out, and the session's own DID mycelia read from its key.
const ME = 'did:key:z6MkMe'
const KEPT = JSON.stringify({ collected: [
  { id: 'c-in', from: 'Shiitake', from_did: 'did:key:z6MkOther', to: 'Mycelia', did: ME, due: at(15, 40), waiting: [
    { id: '871588189c2ca9c4', from: 'Shiitake', says: 'hello', at: at(9, 40), from_did: 'did:key:z6MkOther' },
  ] },
  { id: 'c-out', from: 'Mycelia', from_did: ME, to: 'Shiitake', did: 'did:key:z6MkOther', due: at(16, 0), waiting: [
    { id: 'a2adff460cd772b0', from: 'Mycelia', says: 'Mycelia here', at: at(10, 0), from_did: ME },
  ] },
] })
const ANSWER = KEPT

const BAND = {
  plugin: 'ag',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// What mycelia was asked over its socket, as [path, secret, body]; a fake
// mycelia that pairs once and does every press.
type Asked = [string, string, string]
// This clock while the tests run: the day of what is kept, at 15:00.
const NOW = new Date(2026, 10, 14, 15, 0).getTime()

// refuses: what mycelia answers a press with, in place of doing it.
function mycelia(on: Parameters<Parameters<typeof test>[1]>[1], asked: Asked[], kept = KEPT, clocked = false, refuses = '') {
  if (!clocked) on('clock.now', () => ({ value: NOW }))
  on('fs.write', () => ({ value: {} }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('http.fetch', (_, e) => {
    const path = e.url.replace('http://mycelia', '')
    const headers = (e.init?.headers ?? {}) as Record<string, string>
    asked.push([path, headers['X-Ag-Secret'] ?? '', String(e.init?.body ?? '')])
    const text = path === '/pair' ? '200\n' + 'a'.repeat(64)
      : path === '/collected' ? `200\n${ME}\n1000\n${kept}`
      : refuses ? `409\n${refuses}` : '200\n{}'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

// clocked: the test answers $.clock itself, with mock.clock.
function engine(on: Parameters<Parameters<typeof test>[1]>[1], ran: string[][], answer = ANSWER, asked: Asked[] = [], clocked = false, refuses = '') {
  mycelia(on, asked, answer, clocked, refuses)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  if (!clocked) on('clock.every', () => ({ value: {} }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'forks' && e.argv[2] === 'json' ? '{}' : e.argv[1] === 'errored' ? 'left for Sentry\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
}

const IN = 'c-in'
const OUT = 'c-out'
const HELLO = '871588189c2ca9c4'
const SECRET = 'a'.repeat(64)

type Ui = Awaited<ReturnType<typeof mounted>>

async function mounted($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ ...BAND, surface: 'terminal' })
}

// The mouse going down on the piece whose press this is.
const press = (ui: Ui, key: string) => ui.post({ press: key }, { in: 'pills' })
// Every piece drawn, in order.
const pieces = async (ui: Ui) => ui.findAll({ in: 'pills', type: 'Text' })
// The pieces from the first saying `from` up to the last saying `upTo`, joined.
async function rowOf(ui: Ui, from: string, upTo: string) {
  const all = (await pieces(ui)).map(t => t.text)
  return all.slice(all.indexOf(from), all.lastIndexOf(upTo) + 1).join('')
}
// Whether a piece saying exactly this is drawn.
const has = async (ui: Ui, text: string) => (await pieces(ui)).some(t => t.text === text)
// What the nth piece saying exactly this wears.
const worn = async (ui: Ui, text: string, nth = 0) => {
  const t = (await pieces(ui)).filter(x => x.text === text)[nth]
  return [t?.props.backgroundColor, t?.props.color]
}

// "IN ELEMENTS THERE IS THE CHAT"
// "IT HAS PILLS"
// "WHY CANT IT BE LIKE THAT"
// "17:35<-[Rowan] 18:32->[Keeper] 11-29.12:24->[Window] 11-29.13:45<-Noah[vfxstreet]"
test('what waits stands as a line of pills above the prompt: when, which way, who', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked)
  const ui = await mounted($)

  expect((await pieces(ui)).map(t => t.text).join('')).toBe('15:40<-[Shiitake] 16:00->[Shiitake] ')
  // Asked of mycelia, by the session's own id; ground is asked only for the forks.
  expect(asked).toContainEqual(['/collected', SECRET, '{"session":"sid"}'])
  expect(ran.every(argv => argv[1] === 'forks')).toBe(true)
  await ui.unmount()
})

// "the fact that we dont do full collections per session anyore"
test('the pills are one line, the soonest first, a day not today before its time; each pair is its own pill with its own time', async ($, on) => {
  const asked: Asked[] = []
  const tomorrow = new Date(2026, 10, 15, 12, 24).toISOString()
  const kept = JSON.stringify({ collected: [
    { id: 'c-window', from: 'Mycelia', from_did: ME, to: 'Window', did: 'did:key:z6MkWindow', due: tomorrow, waiting: [
      { id: 'w1', from: 'Mycelia', says: 'for Window', at: at(10, 0), from_did: ME },
    ] },
    { id: 'c-vfx', from: 'vfxstreet', from_did: 'did:key:z6MkVfx', to: 'Mycelia', did: ME, due: at(18, 10), waiting: [
      { id: 'v1', from: 'vfxstreet', says: 'from outside', at: at(9, 41), from_did: 'did:key:z6MkVfx' },
    ] },
    { id: 'c-rowan', from: 'Rowan', from_did: 'did:key:z6MkRowan', to: 'Mycelia', did: ME, due: at(17, 35), waiting: [
      { id: 'r1', from: 'Rowan', says: 'from Rowan', at: at(9, 40), from_did: 'did:key:z6MkRowan' },
      { id: 'r2', from: 'Rowan', says: 'Rowan again', at: at(9, 42), from_did: 'did:key:z6MkRowan' },
    ] },
  ] })
  engine(on, [], kept, asked)
  const ui = await mounted($)

  expect((await pieces(ui)).map(t => t.text).join('')).toBe('17:35<-[Rowan] 18:10<-[vfxstreet] 11-15.12:24->[Window] ')
  // What Rowan said is released by itself, by its own collection.
  await press(ui, 'pill:c-rowan')
  await press(ui, 'now:c-rowan')
  await press(ui, 'now:c-rowan')
  expect(asked).toContainEqual(['/api/collected/release', SECRET, `{"to":"${ME}","collection":"c-rowan"}`])
  await ui.unmount()
})

// "yeah, because i actually do see myself using it like that as well, a way to schedule something into the future for itself."
// What a session says to its own name comes in: it is one pill, and one row.
test('what a session says to itself is drawn once, as what comes in', async ($, on) => {
  const kept = JSON.stringify({ collected: [
    { id: 'c-self', from: 'Mycelia', from_did: ME, to: 'Mycelia', did: ME, due: at(17, 24), waiting: [
      { id: 's1', from: 'Mycelia', says: 'Which do I do first?', at: at(11, 24), from_did: ME },
      { id: 's2', from: 'Mycelia', says: 'the build on k is red', at: at(11, 24), from_did: ME },
    ] },
  ] })
  engine(on, [], kept)
  const ui = await mounted($)

  expect((await pieces(ui)).map(t => t.text).join('')).toBe('17:24<-[Mycelia] ')
  await press(ui, 'pill:c-self')
  const said = (await pieces(ui)).map(t => t.text).filter(t => t === 'Which do I do first?' || t === 'the build on k is red')
  expect(said).toEqual(['Which do I do first?', 'the build on k is red'])
  expect(await rowOf(ui, '  ', 'Which do I do first?')).toBe('  17:24 <-- Mycelia: Which do I do first?')
  await ui.unmount()
})

// "+- +- [now]         [edit]              [delete] [esc]"
// "  16:25 <-- Shiitake: Some text of Shiitake to us."
// "like i said, you cant just pull thinngs from under me. it cost me energy to learn, and i expect it to hold"
test('an open pill holds what the person knows, to the character; esc and the pill itself put it to rest', async ($, on) => {
  engine(on, [])
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  expect(await rowOf(ui, '+', '[esc]')).toBe('+- +- [now]         [edit]              [delete] [esc]')
  expect(await rowOf(ui, '  ', 'hello')).toBe('  15:40 <-- Shiitake: hello')
  // "cancel should get us out of the clicked-in,"
  await press(ui, `esc:${IN}`)
  expect(await has(ui, '[now]')).toBe(false)
  await press(ui, `pill:${IN}`)
  await press(ui, `pill:${IN}`)
  expect(await has(ui, '[now]')).toBe(false)
  // What this session said goes the other way.
  await press(ui, `pill:${OUT}`)
  expect(await rowOf(ui, '  ', 'Mycelia here')).toBe('  16:00 --> Shiitake: Mycelia here')
  await ui.unmount()
})

// "when i click it seems to select chars and copy them"
// "and not having my mouse click be the expected action as before"
test('a press is the mouse going down, where it always was: + and -, now at 6, edit at 20, delete at 40, esc at 49', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)
  const down = (x: number, y: number) => ui.pointer({ type: 'down', x, y, button: 'left' }, { in: 'pills' })

  // The pill opens as the mouse goes down; moving and letting go do nothing more.
  await down(3, 0)
  await ui.pointer({ type: 'move', x: 5, y: 0, button: 'left' }, { in: 'pills' })
  await ui.pointer({ type: 'up', x: 5, y: 0, button: 'left' }, { in: 'pills' })
  expect(await has(ui, '[now]')).toBe(true)
  // The row under the line of pills, at the columns it always had.
  await down(0, 1)
  expect(await has(ui, '16:40')).toBe(true)
  await down(1, 1)
  expect(await has(ui, '15:40')).toBe(true)
  await down(3, 1)
  expect(await has(ui, '15:45')).toBe(true)
  await down(4, 1)
  expect(await has(ui, '15:40')).toBe(true)
  // Between the two +- nothing is pressed.
  await down(2, 1)
  expect(await has(ui, '15:40')).toBe(true)
  await down(6, 1)
  expect(await has(ui, '[NOW]')).toBe(true)
  await down(20, 1)
  expect(await ui.find({ type: 'Input', key: `says:${HELLO}` })).toBeDefined()
  await down(20, 1)
  expect(await ui.find({ type: 'Input', key: `says:${HELLO}` })).toBeUndefined()
  await down(40, 1)
  expect(await has(ui, '[DELETE]')).toBe(true)
  // The arrow of the message, after its time: once is XXXX.
  await down(8, 2)
  expect(await has(ui, 'XXXX')).toBe(true)
  await down(49, 1)
  expect(await has(ui, '[now]')).toBe(false)
  await clock.advance(60000)
  expect(asked.some(a => a[0].startsWith('/api/collected/'))).toBe(false)
  await ui.unmount()
})

// "i cant edit a message, i have to backspace a bunch of times and rewrite the message itself."
test('edit puts what a message says in the engine\'s own field; Enter saves it and sends nothing', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked)
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `edit:${IN}`)
  const field = await ui.find({ type: 'Input', key: `says:${HELLO}` })
  expect(field?.props.value).toBe('hello')
  await ui.input({ key: `says:${HELLO}`, text: 'hello, edited' })
  expect(asked).toContainEqual(['/api/collected/edit', SECRET, `{"to":"did:key:z6MkMe","collection":"c-in","id":"${HELLO}","says":"hello, edited"}`])
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  // Saved, the field is gone and the pill is still open.
  expect(await ui.find({ type: 'Input', key: `says:${HELLO}` })).toBeUndefined()
  expect(await has(ui, '[now]')).toBe(true)
  await ui.unmount()
})

// "bg red when minus, bg green when plus, for like a sec"
// "and then for a full 30 sec, it stays bg white with text black"
// "another click resets timer, timer finishes means, you commit to this new time"
// "its the +- its bg that was supposed to change color, but the invert on the time, you may keep"
// "decrease the wait to 20s"
test('+- waits for the last press: the +- pressed is green or red a second, white twenty, then the hold is asked once', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)
  const holds = () => asked.filter(a => a[0] === '/api/collected/hold')

  await press(ui, `pill:${IN}`)
  // + on the hours: that +- green, the time inverted, nothing asked.
  await press(ui, `h+:${IN}`)
  expect(await worn(ui, '+', 0)).toEqual(['green', 'white'])
  expect(await worn(ui, '-', 0)).toEqual(['green', 'white'])
  expect(await worn(ui, '+', 1)).toEqual([undefined, undefined])
  expect(await worn(ui, '16:40')).toEqual(['white', 'black'])
  expect(holds().length).toBe(0)
  // A second on, that +- waits white with black text.
  await clock.advance(1000)
  expect(await worn(ui, '+', 0)).toEqual(['white', 'black'])
  // - on the minutes fifteen seconds in: that +- red, and the wait starts over.
  await clock.advance(15000)
  await press(ui, `m-:${IN}`)
  expect(await worn(ui, '+', 1)).toEqual(['red', 'white'])
  expect(await worn(ui, '+', 0)).toEqual([undefined, undefined])
  expect(await worn(ui, '16:35')).toEqual(['white', 'black'])
  await clock.advance(19000)
  expect(holds().length).toBe(0)
  await clock.advance(3000)
  expect(holds().map(a => a[2])).toEqual([`{"to":"did:key:z6MkMe","collection":"c-in","until":"${at(16, 35).replace('.000Z', 'Z')}"}`])
  expect(await worn(ui, '+', 1)).toEqual([undefined, undefined])
  await clock.advance(60000)
  expect(holds().length).toBe(1)
  await ui.unmount()
})

// "or having a collection wait for days"
// "why wont i see 26, when i go two days into the future?"
// "if i put it all the way until the next day, right now, that isnt clearly indicated. with like mm-dd"
test('a time is moved on for days and says its day, and is held where it was moved to', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  for (let i = 0; i < 49; i++) await press(ui, `h+:${IN}`)
  expect(await has(ui, '11-16.16:40')).toBe(true)
  await clock.advance(22000)
  expect(asked.filter(a => a[0] === '/api/collected/hold').map(a => a[2])).toEqual([`{"to":"did:key:z6MkMe","collection":"c-in","until":"${new Date(2026, 10, 16, 16, 40).toISOString().replace('.000Z', 'Z')}"}`])
  await ui.unmount()
})

test('esc leaves a moved time where it was: nothing is held', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `h+:${IN}`)
  await press(ui, `esc:${IN}`)
  await clock.advance(60000)
  expect(asked.some(a => a[0] === '/api/collected/hold')).toBe(false)
  await ui.unmount()
})

// "[now], this means to me kind fo same thing as [delete] two stage, press once, you get [NOW] green, and press another time, it actually get's released"
// "and there should be a more explicit abort, that is two stage abort"
// "the arrow you can also click on, one to see thebutton change into XXXX and again to cancel"
test('now, delete and the arrow take two presses: [NOW] green, [DELETE] red, XXXX red', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked)
  const ui = await mounted($)
  const piece = async (text: string) => (await pieces(ui)).find(t => t.text === text)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  expect([(await piece('[NOW]'))?.props.color, (await piece('[NOW]'))?.props.bold]).toEqual(['green', true])
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  // Arming another lets the first go.
  await press(ui, `delete:${IN}`)
  expect((await piece('[DELETE]'))?.props.color).toBe('red')
  expect(await has(ui, '[now]')).toBe(true)
  expect(asked.some(a => a[0] === '/api/collected/cancel')).toBe(false)
  // The arrow: once is XXXX, twice deletes that one message.
  await press(ui, `arrow:${HELLO}`)
  expect((await piece('XXXX'))?.props.color).toBe('red')
  await press(ui, `arrow:${HELLO}`)
  expect(asked).toContainEqual(['/api/collected/cancel', SECRET, `{"to":"did:key:z6MkMe","collection":"c-in","id":"${HELLO}"}`])
  await press(ui, `now:${IN}`)
  await press(ui, `now:${IN}`)
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await press(ui, `delete:${IN}`)
  await press(ui, `delete:${IN}`)
  expect(asked).toContainEqual(['/api/collected/cancel', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await ui.unmount()
})

test('an armed press waits five seconds for its second: after that, a press arms it again', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  await clock.advance(6000)
  await press(ui, `now:${IN}`)
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await clock.advance(1000)
  await press(ui, `now:${IN}`)
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await ui.unmount()
})

// "yeah, i dont think it want's to move beyond 20:00"
test('what is pressed outlives the drawing: drawn anew, the pill is open, its time still moved, and it is held', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const first = await mounted($)
  await press(first, `pill:${IN}`)
  await press(first, `h+:${IN}`)
  await first.unmount()

  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await worn(again, '16:40')).toEqual(['white', 'black'])
  await clock.advance(22000)
  expect(asked.filter(a => a[0] === '/api/collected/hold').length).toBe(1)
  await again.unmount()
})

// What a node answers a refused press with: sacred-error's Error.
const refusal = (title: string, why: string) =>
  JSON.stringify({ id: 'err-1', severity: 'error', context: { surface: 'collected' }, title, why, at: at(9, 0) })

test('what the node refuses is said in red under the pills, and the pill stays open', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, false, refusal('what waits for it is not yours to act on', ''))
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  await press(ui, `now:${IN}`)
  const why = await ui.find({ type: 'Text', text: 'not yours to act on' })
  expect(why?.props.color).toBe('red')
  expect(why?.text).toBe('what waits for it is not yours to act on')
  expect(await has(ui, '[now]')).toBe(true)
  await ui.unmount()
})

// "pressing approve, the error message i get back makes sense"
// 「[Opus 5.5] The node's own words reach the press whole: what was not done, where, and why.」
test('a refused approve says what the node said, whole: what was not done and why', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked, false, refusal(
    "REACH is 'http:vault:list' of SUPER was not done on kapteyn",
    '403 Forbidden: the vault routes are ROOT\'s in the compiled reach table',
  ))
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  await press(ui, `now:${IN}`)
  const why = await ui.find({ type: 'Text', text: 'was not done on kapteyn' })
  expect(why?.text).toBe("REACH is 'http:vault:list' of SUPER was not done on kapteyn: 403 Forbidden: the vault routes are ROOT's in the compiled reach table")
  expect(why?.props.color).toBe('red')
  expect((await pieces(ui)).some(t => t.text.includes('Sentry'))).toBe(false)
  await ui.unmount()
})

// A 502 laye answered came back as Cloudflare's page, and the whole page stood
// above the prompt of every session that pressed, for hours.
// 「[Opus 5.5] An answer that is not an Error is said to be that, never drawn, and handed to ground whole.」
test('a page answered in place of an Error is said to be one; ground gets it whole, and it is not drawn', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  const page = '<!DOCTYPE html>\n<html class="no-js" lang="en-US">\n<head>\n<title>ground.institute | 502: Bad gateway</title>\n</head>\n<body><div id="cf-wrapper">Bad gateway</div></body>\n</html>'
  engine(on, ran, ANSWER, asked, false, page)
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  await press(ui, `now:${IN}`)
  const why = await ui.find({ type: 'Text', text: 'and not with an Error' })
  expect(why?.text).toContain('/api/collected/release answered 409, and not with an Error')
  expect((await pieces(ui)).some(t => t.text.includes('DOCTYPE'))).toBe(false)
  const told = ran.find(r => r[1] === 'errored')
  expect(told?.[3]).toContain(page)
  await ui.unmount()
})

// "the user shoudl not care about sentry"
test('what became of the report is never drawn', async ($, on) => {
  const asked: Asked[] = []
  mycelia(on, asked, ANSWER, false, refusal('not yours', ''))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('clock.every', () => ({ value: {} }))
  on('process.run', (_, e) => ({
    // A ground without errored: its version, and 0.
    value: e.argv[1] === 'errored' ? { exitCode: 0, stdout: 'ground f4fb194 built 2026-11-28T08:07:50Z — Ground Control for Agentic AI\n', stderr: '' }
      : { exitCode: 0, stdout: e.argv[1] === 'forks' && e.argv[2] === 'json' ? '{}' : '', stderr: '' },
  }))
  const ui = await mounted($)

  await press(ui, `pill:${IN}`)
  await press(ui, `now:${IN}`)
  await press(ui, `now:${IN}`)
  const why = await ui.find({ type: 'Text', text: 'not yours' })
  expect(why?.text).toBe('not yours')
  await ui.unmount()
})

// "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
// "AND WITHOUT CHANCE FOR USER ERROR"
test('an approval is the thing itself: approve twice approves it, deny twice denies it, by its own id', async ($, on) => {
  const asked: Asked[] = []
  const kept = JSON.stringify({ collected: [
    { id: 'c-ramen', from: 'ramen', from_did: 'did:key:z6MkRamen', to: 'ramen', did: 'did:key:z6MkRamen', due: '', waiting: [
      { id: 'r1', from: 'ramen', says: "REACH is 'lines:scene' of TOKEN on kapteyn, for ramen", at: at(9, 40), from_did: 'did:key:z6MkRamen', reach: {} },
      { id: 'k1', from: 'ramen', says: 'admit the key of ramen', at: at(9, 41), from_did: 'did:key:z6MkRamen', admit: {} },
    ] },
  ] })
  engine(on, [], kept, asked)
  const ui = await mounted($)

  expect(await rowOf(ui, '[approve]', "REACH is 'lines:scene' of TOKEN on kapteyn, for ramen")).toBe("[approve] [deny]  REACH is 'lines:scene' of TOKEN on kapteyn, for ramen")
  await press(ui, 'approve:r1')
  expect((await pieces(ui)).find(t => t.text === '[APPROVE]')?.props.color).toBe('green')
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await press(ui, 'approve:r1')
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkRamen","collection":"c-ramen","id":"r1"}'])
  await press(ui, 'deny:k1')
  await press(ui, 'deny:k1')
  expect(asked).toContainEqual(['/api/collected/cancel', SECRET, '{"to":"did:key:z6MkRamen","collection":"c-ramen","id":"k1"}'])
  await ui.unmount()
})

const BRANCH = 'fa8a1589-576c-4ecb-84c8-f7d0f357b448'

// "while its forking, you see it right there, at that moment, who to let keep the name, if you dont do anything, nothing happens, otherwise you click the other session, and it gets the name and is the active session at the same time."
test('a session that branched from this one stands as a row, and a press gives it the name', async ($, on) => {
  const ran: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('clock.every', () => ({ value: {} }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'forks'
      ? `{"name":"Mycelia","here":true,"forks":[{"session":"${BRANCH}","name":"","title":"mycelia on k","holds":false}]}`
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  mycelia(on, [], '{"collected":[]}')
  const resumed: string[] = []
  on('command.run', (_, e) => {
    resumed.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  const ui = await mounted($)

  expect((await pieces(ui)).map(t => t.text).join('')).toBe('⑂ Mycelia stays with  ● this session   ○ mycelia on k')
  expect((await pieces(ui)).find(t => t.text === '● this session')?.props.bold).toBe(true)
  // On the filled one: nothing moves.
  await ui.pointer({ type: 'down', x: 25, y: 0, button: 'left' }, { in: 'pills' })
  expect(ran.some(argv => argv[1] === 'forks' && argv[2] === 'give')).toBe(false)
  await ui.pointer({ type: 'down', x: 42, y: 0, button: 'left' }, { in: 'pills' })
  expect(ran).toContainEqual(['ground', 'forks', 'give', BRANCH])
  // "and it gets the name and is the active session at the same time"
  expect(resumed).toEqual([`resume ${BRANCH}`])
  await ui.unmount()
})

// "i dont thin that ux is good"
test('a branch running in another window is given the name on a press, and how to open it is said', async ($, on) => {
  const ran: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('clock.every', () => ({ value: {} }))
  mycelia(on, [], '{"collected":[]}')
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'forks'
      ? `{"name":"Mycelia","here":true,"forks":[{"session":"${BRANCH}","name":"","title":"mycelia on k","holds":false,"running":true}]}`
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('command.run', () => ({ text: '"Granite name setup ⑂ mycelia on k" is running in the background (fa8a1589). Run `claude attach fa8a1589` to open it.' }))
  const ui = await mounted($)
  await ui.pointer({ type: 'down', x: 42, y: 0, button: 'left' }, { in: 'pills' })
  expect(ran).toContainEqual(['ground', 'forks', 'give', BRANCH])
  expect((await ui.find({ type: 'Text', text: "the name is that session's now" }))?.text).toContain('claude attach fa8a1589')
  await ui.unmount()
})

test('nothing waiting draws nothing', async ($, on) => {
  engine(on, [], '{"collected":[]}')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mounted($)
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await ui.unmount()
})

// "Getting A2UI pieces to show up in another session from this one"
// 「[Opus 5.5] What a message says beside its words, as A2UI, stands under it in the open」
// 「[Opus 5.5] pill: text and layout first, as nothing pressed on it goes back yet.」
test('the surface a message says stands under it in the open pill', async ($, on) => {
  const surface = [{
    version: '1.0',
    createSurface: {
      surfaceId: 'which-first',
      catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      components: [
        { id: 'root', component: 'Column', children: ['asks', 'pair', 'choice'] },
        { id: 'asks', component: 'Text', text: 'Which do I do first?' },
        { id: 'pair', component: 'Row', children: ['one', 'other'] },
        { id: 'one', component: 'Text', text: { '@path': '/first' } },
        { id: 'other', component: 'Text', text: 'or the person' },
        { id: 'choice', component: 'ChoicePicker', options: [], value: { '@path': '/chosen' } },
      ],
      dataModel: { first: 'the split' },
    },
  }]
  const kept = JSON.stringify({ collected: [
    { id: 'c-a2ui', from: 'Cumulus', from_did: 'did:key:z6MkCumulus', to: 'Mycelia', did: ME, due: at(15, 40), waiting: [
      { id: 'u1', from: 'Cumulus', says: 'Which do I do first?', at: at(9, 0), from_did: 'did:key:z6MkCumulus', a2ui: surface },
    ] },
  ] })
  engine(on, [], kept)
  const ui = await mounted($)

  // 「[Opus 5.5] At rest, nothing of the surface is drawn.」
  expect(await has(ui, '    the split  or the person')).toBe(false)
  await press(ui, 'pill:c-a2ui')
  const texts = (await pieces(ui)).map(t => t.text)
  const under = texts.slice(texts.indexOf('Which do I do first?') + 1)
  expect(under).toContain('    Which do I do first?')
  expect(under).toContain('    the split  or the person')
  expect(under).toContain('    [ChoicePicker is not drawn yet]')
  await ui.unmount()
})

// 「[Opus 5.5] The messages are applied in the order said; what cannot be applied is said」
// 「[Opus 5.5] where the surface stands, and the rest still is.」
test('a surface is what its messages leave standing, in the order said', async () => {
  const v = '1.0'
  expect(surfaceLines([
    { version: v, createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: { '@path': '/a/b' } }] } },
    { version: v, updateDataModel: { surfaceId: 's', path: '/a/b', value: 'moved on' } },
    { version: v, updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'List', direction: 'horizontal', children: ['x', 'y'] }, { id: 'x', component: 'Text', text: { '@path': '/a/b' } }, { id: 'y', component: 'Text', text: 'two\nlines' }] } },
    { version: v, createSurface: { surfaceId: 'gone', components: [{ id: 'root', component: 'Text', text: 'not here' }] } },
    { version: v, deleteSurface: { surfaceId: 'gone' } },
    { version: v, updateDataModel: { surfaceId: 'never', value: {} } },
  ])).toEqual([
    '[updateDataModel for never, which was never created]',
    'moved on  two',
    '          lines',
  ])
})

test('an answer is read as sacred-error reads it: an Error whole, anything else by its status', () => {
  expect(failureOf('/api/collected/release', '403', JSON.stringify({ id: 'e', severity: 'warn', context: { surface: 'collected' }, title: 'not done on kapteyn', why: '403 the route is ROOT\'s', at: '2026-11-28T12:00:00Z' })))
    .toBe("not done on kapteyn: 403 the route is ROOT's")
  expect(failureOf('/api/collected/release', '502', '<!DOCTYPE html>')).toContain('/api/collected/release answered 502, and not with an Error')
})

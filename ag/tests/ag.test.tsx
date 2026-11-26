import { expect, mock, test } from 'claude-code/testing'

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
    return { value: { exitCode: 0, stdout: e.argv[1] === 'forks' && e.argv[2] === 'json' ? '{}' : '', stderr: '' } }
  })
}

const IN = 'c-in'
const OUT = 'c-out'
const HELLO = '871588189c2ca9c4'
const SECRET = 'a'.repeat(64)

async function mounted($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ ...BAND, surface: 'terminal' })
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

  expect((await ui.find({ type: 'Button', key: `pill:${IN}` }))?.text).toBe('15:40<-[Shiitake]')
  expect((await ui.find({ type: 'Button', key: `pill:${OUT}` }))?.text).toBe('16:00->[Shiitake]')
  // At rest it holds nothing: no press of what is in it is drawn.
  expect(await ui.find({ type: 'Button', key: `now:${IN}` })).toBeUndefined()
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

  const line = (await ui.findAll({ type: 'Button' })).map(b => b.text)
  expect(line).toEqual(['17:35<-[Rowan]', '18:10<-[vfxstreet]', '11-15.12:24->[Window]'])
  // What Rowan said is released by itself, by its own collection.
  await ui.press({ key: 'pill:c-rowan' })
  await ui.press({ key: 'now:c-rowan' })
  await ui.press({ key: 'now:c-rowan' })
  expect(asked).toContainEqual(['/api/collected/release', SECRET, `{"to":"${ME}","collection":"c-rowan"}`])
  await ui.unmount()
})

// The row of an open pill, drawn: every Text and Button of it, joined.
async function rowOf(ui: Awaited<ReturnType<typeof mounted>>, from: string, upTo: string) {
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  return all.slice(all.indexOf(from), all.lastIndexOf(upTo) + 1).join('')
}

// "+- +- [now]         [edit]              [delete] [esc]"
// "  16:25 <-- Shiitake: Some text of Shiitake to us."
// "like i said, you cant just pull thinngs from under me. it cost me energy to learn, and i expect it to hold"
test('an open pill holds what the person knows, to the character; esc and the pill itself put it to rest', async ($, on) => {
  engine(on, [])
  const ui = await mounted($)

  await ui.press({ key: `pill:${IN}` })
  expect(await rowOf(ui, '+', '[esc]')).toBe('+- +- [now]         [edit]              [delete] [esc]')
  expect(await rowOf(ui, '  ', 'hello')).toBe('  15:40 <-- Shiitake: hello')
  // The other pill stays at rest.
  expect(await ui.find({ type: 'Button', key: `now:${OUT}` })).toBeUndefined()
  // "cancel should get us out of the clicked-in,"
  await ui.press({ key: `esc:${IN}` })
  expect(await ui.find({ type: 'Button', key: `now:${IN}` })).toBeUndefined()
  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `pill:${IN}` })
  expect(await ui.find({ type: 'Button', key: `now:${IN}` })).toBeUndefined()
  // What this session said goes the other way.
  await ui.press({ key: `pill:${OUT}` })
  expect(await rowOf(ui, '  ', 'Mycelia here')).toBe('  16:00 --> Shiitake: Mycelia here')
  await ui.unmount()
})

// "i cant edit a message, i have to backspace a bunch of times and rewrite the message itself."
test('edit puts what a message says in the engine\'s own field; Enter saves it and sends nothing', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked)
  const ui = await mounted($)

  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `edit:${IN}` })
  const field = await ui.find({ type: 'Input', key: `says:${HELLO}` })
  expect(field?.props.value).toBe('hello')
  await ui.input({ key: `says:${HELLO}`, text: 'hello, edited' })
  expect(asked).toContainEqual(['/api/collected/edit', SECRET, `{"to":"did:key:z6MkMe","collection":"c-in","id":"${HELLO}","says":"hello, edited"}`])
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  // Saved, the field is gone and the pill is still open.
  expect(await ui.find({ type: 'Input', key: `says:${HELLO}` })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: `now:${IN}` }))?.text).toBe('[now]')
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
  // What the nth Text saying exactly this wears.
  const worn = async (text: string, nth = 0) => {
    const t = (await ui.findAll({ type: 'Text' })).filter(x => x.text === text)[nth]
    return [t?.props.backgroundColor, t?.props.color]
  }

  await ui.press({ key: `pill:${IN}` })
  // + on the hours: that +- green, the time inverted, nothing asked.
  await ui.press({ key: `h+:${IN}` })
  expect(await worn('+', 0)).toEqual(['green', 'white'])
  expect(await worn('-', 0)).toEqual(['green', 'white'])
  expect(await worn('+', 1)).toEqual([undefined, undefined])
  expect(await worn('16:40')).toEqual(['white', 'black'])
  expect(holds().length).toBe(0)
  // A second on, that +- waits white with black text.
  await clock.advance(1000)
  expect(await worn('+', 0)).toEqual(['white', 'black'])
  // - on the minutes fifteen seconds in: that +- red, and the wait starts over.
  await clock.advance(15000)
  await ui.press({ key: `m-:${IN}` })
  expect(await worn('+', 1)).toEqual(['red', 'white'])
  expect(await worn('+', 0)).toEqual([undefined, undefined])
  expect(await worn('16:35')).toEqual(['white', 'black'])
  await clock.advance(19000)
  expect(holds().length).toBe(0)
  await clock.advance(3000)
  expect(holds().map(a => a[2])).toEqual([`{"to":"did:key:z6MkMe","collection":"c-in","until":"${at(16, 35).replace('.000Z', 'Z')}"}`])
  expect(await worn('+', 1)).toEqual([undefined, undefined])
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

  await ui.press({ key: `pill:${IN}` })
  for (let i = 0; i < 49; i++) await ui.press({ key: `h+:${IN}` })
  expect((await ui.find({ type: 'Text', text: '16:40' }))?.text).toBe('11-16.16:40')
  await clock.advance(22000)
  expect(asked.filter(a => a[0] === '/api/collected/hold').map(a => a[2])).toEqual([`{"to":"did:key:z6MkMe","collection":"c-in","until":"${new Date(2026, 10, 16, 16, 40).toISOString().replace('.000Z', 'Z')}"}`])
  await ui.unmount()
})

test('esc leaves a moved time where it was: nothing is held', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)

  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `h+:${IN}` })
  await ui.press({ key: `esc:${IN}` })
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

  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `now:${IN}` })
  const now = await ui.find({ type: 'Text', text: '[NOW]' })
  expect([now?.props.color, now?.props.bold]).toEqual(['green', true])
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  // Arming another lets the first go.
  await ui.press({ key: `delete:${IN}` })
  expect((await ui.find({ type: 'Text', text: '[DELETE]' }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Button', key: `now:${IN}` }))?.text).toBe('[now]')
  expect(asked.some(a => a[0] === '/api/collected/cancel')).toBe(false)
  // The arrow: once is XXXX, twice deletes that one message.
  await ui.press({ key: `arrow:${HELLO}` })
  expect((await ui.find({ type: 'Text', text: 'XXXX' }))?.props.color).toBe('red')
  await ui.press({ key: `arrow:${HELLO}` })
  expect(asked).toContainEqual(['/api/collected/cancel', SECRET, `{"to":"did:key:z6MkMe","collection":"c-in","id":"${HELLO}"}`])
  await ui.press({ key: `now:${IN}` })
  await ui.press({ key: `now:${IN}` })
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await ui.press({ key: `delete:${IN}` })
  await ui.press({ key: `delete:${IN}` })
  expect(asked).toContainEqual(['/api/collected/cancel', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await ui.unmount()
})

test('an armed press waits five seconds for its second: after that, a press arms it again', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const ui = await mounted($)

  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `now:${IN}` })
  await clock.advance(6000)
  await ui.press({ key: `now:${IN}` })
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await clock.advance(1000)
  await ui.press({ key: `now:${IN}` })
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkMe","collection":"c-in"}'])
  await ui.unmount()
})

// "yeah, i dont think it want's to move beyond 20:00"
test('what is pressed outlives the drawing: drawn anew, the pill is open, its time still moved, and it is held', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  const first = await mounted($)
  await first.press({ key: `pill:${IN}` })
  await first.press({ key: `h+:${IN}` })
  await first.unmount()

  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const shown = await again.find({ type: 'Text', text: '16:40' })
  expect([shown?.props.backgroundColor, shown?.props.color]).toEqual(['white', 'black'])
  await clock.advance(22000)
  expect(asked.filter(a => a[0] === '/api/collected/hold').length).toBe(1)
  await again.unmount()
})

test('what the node refuses is said in red under the pills, and the pill stays open', async ($, on) => {
  const asked: Asked[] = []
  engine(on, [], ANSWER, asked, false, 'what waits for it is not yours to act on')
  const ui = await mounted($)

  await ui.press({ key: `pill:${IN}` })
  await ui.press({ key: `now:${IN}` })
  await ui.press({ key: `now:${IN}` })
  const why = await ui.find({ type: 'Text', text: 'not yours to act on' })
  expect(why?.props.color).toBe('red')
  expect((await ui.find({ type: 'Button', key: `now:${IN}` }))?.text).toBe('[now]')
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

  expect((await ui.find({ type: 'Text', text: 'REACH is' }))?.props.bold).toBe(true)
  await ui.press({ key: 'approve:r1' })
  expect((await ui.find({ type: 'Text', text: '[APPROVE]' }))?.props.color).toBe('green')
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await ui.press({ key: 'approve:r1' })
  expect(asked).toContainEqual(['/api/collected/release', SECRET, '{"to":"did:key:z6MkRamen","collection":"c-ramen","id":"r1"}'])
  await ui.press({ key: 'deny:k1' })
  await ui.press({ key: 'deny:k1' })
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

  expect((await ui.find({ type: 'Text', text: 'stays with' }))?.text).toBe('⑂ Mycelia stays with  ')
  expect((await ui.find({ type: 'Text', text: '● this session' }))?.props.bold).toBe(true)
  // The filled one is no press: nothing moves.
  expect(await ui.find({ type: 'Button', key: 'fork:here' })).toBeUndefined()
  await ui.press({ key: `fork:${BRANCH}` })
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
  await ui.press({ key: `fork:${BRANCH}` })
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

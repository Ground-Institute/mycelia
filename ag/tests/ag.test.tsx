import { expect, mock, test } from 'claude-code/testing'

// A time on this clock, as laye keeps it: RFC3339.
const at = (h: number, m: number) => new Date(2026, 10, 14, h, m).toISOString()

// What mycelia keeps of laye's collections for a session with one message in
// and one out, and the session's own DID mycelia read from its key.
const ME = 'did:key:z6MkMe'
const KEPT = JSON.stringify({ collected: [
  { to: 'Mycelia', did: ME, due: at(15, 40), waiting: [
    { id: '871588189c2ca9c4', from: 'Shiitake', says: 'hello', at: at(9, 40), from_did: 'did:key:z6MkOther' },
  ] },
  { to: 'Shiitake', did: 'did:key:z6MkOther', due: at(16, 0), waiting: [
    { id: 'a2adff460cd772b0', from: 'Mycelia', says: 'Mycelia here', at: at(10, 0), from_did: ME },
  ] },
] })
const ANSWER = KEPT
// This clock while the tests run: the day of what is kept, at 15:00.
const NOW = new Date(2026, 10, 14, 15, 0).getTime()

const BAND = {
  plugin: 'ag',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// What mycelia was asked over its socket, as [path, secret, body]; a fake
// mycelia that pairs once and does every press.
type Asked = [string, string, string]
function mycelia(on: Parameters<Parameters<typeof test>[1]>[1], asked: Asked[], kept = KEPT, clocked = false) {
  if (!clocked) on('clock.now', () => ({ value: NOW }))
  on('fs.write', () => ({ value: {} }))
  on('http.fetch', (_, e) => {
    const path = e.url.replace('http://mycelia', '')
    const headers = (e.init?.headers ?? {}) as Record<string, string>
    asked.push([path, headers['X-Ag-Secret'] ?? '', String(e.init?.body ?? '')])
    const text = path === '/pair' ? '200\n' + 'a'.repeat(64)
      : path === '/collected' ? `200\n${ME}\n1000\n${kept}`
      : '200\n{}'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

// clocked: the test answers $.clock itself, with mock.clock.
function engine(on: Parameters<Parameters<typeof test>[1]>[1], ran: string[][], answer = ANSWER, asked: Asked[] = [], clocked = false) {
  mycelia(on, asked, answer, clocked)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  if (!clocked) on('clock.every', () => ({ value: {} }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[1] === 'forks' && e.argv[2] === 'json' ? '{}' : '', stderr: '' } }
  })
}

test('each message goes to the Client as a line: when, which way, who, what is said', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const lines = await ui.find({ type: 'Client', key: 'lines' })
  expect(lines?.props.props).toEqual({ today: '11-14', moving: {}, lines: [
    { way: 'in', to: 'did:key:z6MkMe', due: '15:40', day: '11-14', at: at(15, 40), who: 'Shiitake', says: 'hello', id: '871588189c2ca9c4' },
    { way: 'out', to: 'did:key:z6MkOther', due: '16:00', day: '11-14', at: at(16, 0), who: 'Shiitake', says: 'Mycelia here', id: 'a2adff460cd772b0' },
  ], forks: [], name: '', here: true })
  // Asked of mycelia, by the session's own id; ground is asked only for the forks.
  expect(asked).toContainEqual(['/collected', 'a'.repeat(64), '{"session":"sid"}'])
  expect(ran.every(argv => argv[1] === 'forks')).toBe(true)
  await ui.unmount()
})

// "yes, build that"
test('a press is asked of mycelia directly, with the secret the first one paired with a finger', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.post({ act: 'cancel', to: 'did:key:z6MkMe', id: '871588189c2ca9c4' }, { in: 'lines' })
  await ui.post({ act: 'release', to: 'did:key:z6MkMe' }, { in: 'lines' })
  await ui.post({ act: 'hold', to: 'did:key:z6MkMe', until: '17:40' }, { in: 'lines' })
  await ui.post({ act: 'release', to: 'did:key:z6MkMe', says: 'hello, edited' }, { in: 'lines' })
  expect(asked[0]).toEqual(['/pair', '', ''])
  expect(asked.filter(a => a[0] === '/pair').length).toBe(1)
  expect(asked).toContainEqual(['/api/collected/cancel', 'a'.repeat(64), '{"to":"did:key:z6MkMe","id":"871588189c2ca9c4"}'])
  expect(asked).toContainEqual(['/api/collected/release', 'a'.repeat(64), '{"to":"did:key:z6MkMe"}'])
  expect(asked.find(a => a[0] === '/api/collected/hold')?.[2]).toMatch(/"until":"\d{4}-\d\d-\d\dT\d\d:40:00Z"/)
  expect(asked).toContainEqual(['/api/collected/release', 'a'.repeat(64), '{"to":"did:key:z6MkMe","says":"hello, edited"}'])
  // No press goes through ground collected, which any agent can run.
  expect(ran.some(argv => argv[1] === 'collected' && argv[2] !== 'json')).toBe(false)
  await ui.unmount()
})

// "+- +- [now]         [edit]              [cancel]"
// "  16:25 <-- Shiitake: Some text of Shiitake to us."
test('a message clicked in shows its buttons; esc closes them, delete twice deletes it, and so does the arrow twice', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ in: 'lines', type: 'Text', text: /^15:40$/ }))?.text).toBe('15:40')
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^Shiitake$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^hello$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ in: 'lines', type: 'Text', text: /\[esc\]/ })).toBeUndefined()

  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[delete\]$/ }))?.text).toBe('[delete]')
  expect((await ui.find({ in: 'lines', type: 'Text', text: /\[esc\]/ }))?.text).toBe(' [esc]')
  // "the word cancel isnt clear"
  await ui.pointer({ type: 'down', x: 50, y: 0, button: 'left' })
  expect(await ui.find({ in: 'lines', type: 'Text', text: /\[esc\]/ })).toBeUndefined()
  expect(asked.some(a => a[0] === '/api/collected/cancel')).toBe(false)
  // "and there should be a more explicit abort, that is two stage abort"
  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 41, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[DELETE\]$/ }))?.props.color).toBe('red')
  expect(asked.some(a => a[0] === '/api/collected/cancel')).toBe(false)
  await ui.pointer({ type: 'down', x: 41, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/cancel', 'a'.repeat(64), '{"to":"did:key:z6MkMe","id":"871588189c2ca9c4"}'])
  asked.length = 0
  // The arrow at rest: once is XXXX, twice dismisses that one message.
  await ui.pointer({ type: 'down', x: 7, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^XXXX$/ }))?.text).toBe('XXXX')
  await ui.pointer({ type: 'down', x: 7, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/cancel', 'a'.repeat(64), '{"to":"did:key:z6MkMe","id":"871588189c2ca9c4"}'])
  await ui.unmount()
})

// "[now], this means to me kind fo same thing as [delete] two stage, press once, you get [NOW] green, and press another time, it actually get's released"
test('now is pressed twice: once it is [NOW] green, and the second releases', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 7, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[NOW\]$/ }))?.props.color).toBe('green')
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await ui.pointer({ type: 'down', x: 7, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/release', 'a'.repeat(64), '{"to":"did:key:z6MkMe"}'])
  await ui.unmount()
})

// "bg red when minus, bg green when plus, for like a sec, and then for a full 30 sec, it stays bg white with text black"
// "another click resets timer, timer finishes means, you commit to this new time"
// "its the +- its bg that was supposed to change color, but the invert on the time, you may keep"
// "if i put it all the way until the next day, right now, that isnt clearly indicated. with like mm-dd"
// "decrease the wait to 20s"
test('+- waits for the last press: the +- pressed is green or red a second, white twenty, then the hold is asked once', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const holds = () => asked.filter(a => a[0] === '/api/collected/hold')
  const lit = async (text: string, nth = 0) => {
    const t = (await ui.findAll({ in: 'lines', type: 'Text', text }))[nth]
    return [t?.props.backgroundColor, t?.props.color]
  }
  const wait = async (ms: number) => {
    await ui.advance(ms)
    await clock.advance(ms)
  }

  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  // + on the hours: that +- green, the time inverted, nothing asked.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  expect(await lit('+-', 0)).toEqual(['green', 'white'])
  expect(await lit('+-', 1)).toEqual([undefined, undefined])
  expect(await lit('16:40')).toEqual(['white', 'black'])
  expect(holds().length).toBe(0)
  // A second on, that +- waits white with black text.
  await wait(1000)
  expect(await lit('+-', 0)).toEqual(['white', 'black'])
  // - on the minutes fifteen seconds in: that +- red, and the wait starts over.
  await wait(15000)
  await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left' })
  expect(await lit('+-', 1)).toEqual(['red', 'white'])
  expect(await lit('+-', 0)).toEqual([undefined, undefined])
  expect(await lit('16:35')).toEqual(['white', 'black'])
  // "why wont i see 26, when i go two days into the future?"
  // + on the hours a day and more on: a day not today says its day.
  for (let i = 0; i < 24; i++) await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: '16:35' }))?.text).toBe('11-15 16:35')
  for (let i = 0; i < 25; i++) await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: '17:35' }))?.text).toBe('11-16 17:35')
  await wait(19000)
  expect(holds().length).toBe(0)
  await wait(3000)
  expect(holds().length).toBe(1)
  expect(holds()[0]?.[2]).toBe(`{"to":"did:key:z6MkMe","until":"${new Date(2026, 10, 16, 17, 35).toISOString().replace('.000Z', 'Z')}"}`)
  expect(await lit('17:35')).toEqual([undefined, undefined])
  expect(await lit('+-', 0)).toEqual([undefined, undefined])
  await wait(60000)
  expect(holds().length).toBe(1)
  await ui.unmount()
})

// "yeah, i dont think it want's to move beyond 20:00"
test('a move outlives its Client: drawn anew, the time still stands moved and is held', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const holds = () => asked.filter(a => a[0] === '/api/collected/hold')

  const first = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await first.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  await first.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  await first.unmount()

  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const shown = await again.find({ in: 'lines', type: 'Text', text: '16:40' })
  expect([shown?.props.backgroundColor, shown?.props.color]).toEqual(['white', 'black'])
  await clock.advance(22000)
  expect(holds().length).toBe(1)
  expect(holds()[0]?.[2]).toBe(`{"to":"did:key:z6MkMe","until":"${at(16, 40).replace('.000Z', 'Z')}"}`)
  await again.unmount()
})

test('esc leaves a moved time where it was: nothing is held', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  engine(on, ran, ANSWER, asked, true)
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 50, y: 0, button: 'left' })
  await clock.advance(60000)
  expect(asked.some(a => a[0] === '/api/collected/hold')).toBe(false)
  expect((await ui.find({ in: 'lines', type: 'Text', text: '15:40' }))?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

// "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
// "AND WITHOUT CHANCE FOR USER ERROR"
test('an approval is the thing itself: approve twice approves it, deny twice denies it, by its own id', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  const answer = JSON.stringify({ collected: [
    { to: 'ramen', did: 'did:key:z6MkRamen', due: '', waiting: [
      { id: 'a1', from: 'kapteyn', says: "REACH is 'lines:scene' of TOKEN on kapteyn, for ramen", at: at(9, 0),
        from_did: 'did:key:z6MkK', reach: { peer: 'did:key:z6MkK', path: 'lines:scene', to: 'TOKEN' } },
    ] },
  ] })
  engine(on, ran, answer, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ in: 'lines', type: 'Text', text: /^REACH is 'lines:scene' of TOKEN on kapteyn, for ramen$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[approve\]$/ }))?.text).toBe('[approve]')
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[APPROVE\]$/ }))?.props.color).toBe('green')
  expect(asked.some(a => a[0] === '/api/collected/release')).toBe(false)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/release', 'a'.repeat(64), '{"to":"did:key:z6MkRamen","id":"a1"}'])
  asked.length = 0
  await ui.pointer({ type: 'down', x: 11, y: 0, button: 'left' })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /^\[DENY\]$/ }))?.props.color).toBe('red')
  await ui.pointer({ type: 'down', x: 11, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/cancel', 'a'.repeat(64), '{"to":"did:key:z6MkRamen","id":"a1"}'])
  await ui.unmount()
})

// "CAN WE PLEASE STOP EXPECTING AN AGENT TO REQUEST IT OWN PERMISSIONS AND ALSO BE PERFECT?"
test('a key a node holds nothing for is an approval: approve twice admits it, by its own id', async ($, on) => {
  const ran: string[][] = []
  const asked: Asked[] = []
  const answer = JSON.stringify({ collected: [
    { to: 'ramen', did: 'did:key:z6MkRamen', due: '', waiting: [
      { id: 'k1', from: 'kapteyn', says: "admit ramen's key did:key:z6MkRamen on kapteyn, for ramen", at: at(9, 0),
        from_did: 'did:key:z6MkK', admit: { peer: 'did:key:z6MkK', did: 'did:key:z6MkRamen', label: 'ramen' } },
    ] },
  ] })
  engine(on, ran, answer, asked)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ in: 'lines', type: 'Text', text: /^admit ramen's key did:key:z6MkRamen on kapteyn, for ramen$/ }))?.props.bold).toBe(true)
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
  expect(asked).toContainEqual(['/api/collected/release', 'a'.repeat(64), '{"to":"did:key:z6MkRamen","id":"k1"}'])
  await ui.unmount()
})

// "while its forking, you see it right there, at that moment, who to let keep the name, if you dont do anything, nothing happens, otherwise you click the other session, and it gets the name and is the active session at the same time."
test('a session that branched from this one stands as a row, and a click gives it the name', async ($, on) => {
  const ran: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('clock.every', () => ({ value: {} }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'forks'
      ? '{"name":"Mycelia","here":true,"forks":[{"session":"fa8a1589-576c-4ecb-84c8-f7d0f357b448","name":"","title":"mycelia on k","holds":false}]}'
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  mycelia(on, [], '{"collected":[]}')
  const resumed: string[] = []
  on('command.run', (_, e) => {
    resumed.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const lines = await ui.find({ type: 'Client', key: 'lines' })
  expect(lines?.props.props).toEqual({ today: '11-14', moving: {}, lines: [], name: 'Mycelia', here: true, forks: [{ session: 'fa8a1589-576c-4ecb-84c8-f7d0f357b448', name: '', title: 'mycelia on k', holds: false }] })
  expect((await ui.find({ in: 'lines', type: 'Text', text: /stays with/ }))?.text).toBe('⑂ Mycelia stays with  ')
  expect((await ui.find({ in: 'lines', type: 'Text', text: /● this session/ }))?.props.bold).toBe(true)
  expect((await ui.find({ in: 'lines', type: 'Text', text: /○ mycelia on k/ }))?.text).toBe('   ○ mycelia on k')
  // On the filled one: nothing moves.
  await ui.pointer({ type: 'down', x: 25, y: 0, button: 'left' })
  expect(ran.some(argv => argv[1] === 'forks' && argv[2] === 'give')).toBe(false)
  await ui.pointer({ type: 'down', x: 42, y: 0, button: 'left' })
  expect(ran).toContainEqual(['ground', 'forks', 'give', 'fa8a1589-576c-4ecb-84c8-f7d0f357b448'])
  // "and it gets the name and is the active session at the same time"
  expect(resumed).toEqual(['resume fa8a1589-576c-4ecb-84c8-f7d0f357b448'])
  await ui.unmount()
})

// "i dont thin that ux is good"
test('a branch running in another window is given the name on a click, and how to open it is said', async ($, on) => {
  const ran: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('clock.every', () => ({ value: {} }))
  mycelia(on, [], '{"collected":[]}')
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'forks'
      ? '{"name":"Mycelia","here":true,"forks":[{"session":"fa8a1589-576c-4ecb-84c8-f7d0f357b448","name":"","title":"mycelia on k","holds":false,"running":true}]}'
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('command.run', () => ({ text: '"Granite name setup ⑂ mycelia on k" is running in the background (fa8a1589). Run `claude attach fa8a1589` to open it.' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.pointer({ type: 'down', x: 42, y: 0, button: 'left' })
  expect(ran).toContainEqual(['ground', 'forks', 'give', 'fa8a1589-576c-4ecb-84c8-f7d0f357b448'])
  expect((await ui.find({ type: 'Text', text: /the name is that session's now/ }))?.text).toContain('claude attach fa8a1589')
  await ui.unmount()
})

test('nothing waiting draws nothing', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, '{"collected":[]}')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

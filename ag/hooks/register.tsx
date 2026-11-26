import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Forks, Line, Said, View } from '../types'
import { pills } from './pill'
import type { Press } from './pill'

// "so its like a mushroom that pop's up, and that is ag in a sense."
// "like, ag is just spores"
//
// ag: above ground, mycelia's. What comes in for this session, what it said
// that goes out, and what waits on the person to approve, as mycelia holds
// them: ag asks mycelia over its socket, paired with the person's finger, and
// sorts them by the DID of the session's own key, which mycelia reads from the
// key ground keeps for it. They stand as pills above the prompt, drawn in
// ./pill.tsx. Nothing waiting draws nothing; what went wrong is drawn as
// it was said. The forks are ground's, for they are a session's identity.
const said = atom({ plugin: 'ag', key: 'said' } as const, null)
// What the last press came to when the node did not do it: drawn red under
// the lines until the next press.
const refused = atom({ plugin: 'ag', key: 'refused' } as const, null)
// "maybe i want that session to inherit the name and not you"
// The sessions that branched from this one, as ground recorded them at the
// fork: each stands as a row, and a click on it gives it this session's name.
const forks = atom({ plugin: 'ag', key: 'forks' } as const, null)
// What of the pills is pressed: kept here, so a redraw forgets none of it.
const view = atom({ plugin: 'ag', key: 'view' } as const, null)

// Every press and what it came to, written where it can be read from outside.
const PRESSES = '/Users/s.b.vanhouten/.local/state/ug/ag-presses'

const EVERY_MS = 5000

// One collection as laye keeps it, and mycelia keeps laye's answer whole.
type Kept = {
  to: string
  did: string
  due: string
  waiting: { id: string; from: string; says: string; at: string; from_did: string; reach?: object; admit?: object }[]
}

// A time laye keeps, in RFC3339, as this clock reads it: HH:MM.
function clockOf(at: string): string {
  const t = new Date(at)
  if (Number.isNaN(t.getTime()) || t.getTime() <= 0) return ''
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

// What is drawn for the session whose DID did is: what comes in for it, what
// it said that waits elsewhere, and every approval, whoever's it is.
// "SESSION CANT REACH, IT NEEDS REACH LINE(S), IT GETS IN FRONT OF MY VIA AG OR LIVE ACTIVITY AS SOMETHING TO APPROVE,"
// "CAN WE PLEASE STOP EXPECTING AN AGENT TO REQUEST IT OWN PERMISSIONS AND ALSO BE PERFECT?"
// A key a node holds nothing for, to admit, is an approval as a reach line is.
export function linesOf(did: string, all: Kept[]): Line[] {
  const approval = (w: Kept['waiting'][number]) => !!(w.reach || w.admit)
  const lines: Line[] = []
  for (const one of all)
    if (one.did === did)
      for (const w of one.waiting)
        if (!approval(w)) lines.push({ way: 'in', to: one.did, due: clockOf(one.due), at: one.due, who: w.from, says: w.says, id: w.id })
  for (const one of all)
    for (const w of one.waiting)
      if (w.from_did === did && !approval(w))
        lines.push({ way: 'out', to: one.did, due: clockOf(one.due), at: one.due, who: one.to, says: w.says, id: w.id })
  for (const one of all)
    for (const w of one.waiting)
      if (approval(w)) lines.push({ way: 'approve', to: one.did, due: clockOf(w.at), at: w.at, who: '', says: w.says, id: w.id })
  return lines
}

// mycelia's answer: "200", the session's DID, and the kept file (its stamp,
// then laye's answer), a line each; else why not.
export function saidOf(answer: string): Said {
  const [status, did, , ...rest] = answer.split('\n')
  if (status !== '200') return { ok: false, text: [did, ...rest].filter(Boolean).join('\n') || answer, lines: [] }
  const body = rest.join('\n').trim()
  if (!body) return { ok: true, text: '', lines: [] }
  try {
    const kept = JSON.parse(body) as { collected?: Kept[]; error?: string }
    if (kept.error !== undefined) return { ok: false, text: kept.error, lines: [] }
    return { ok: true, text: '', lines: linesOf(did ?? '', kept.collected ?? []) }
  } catch {
    // What mycelia kept is the node's refusal, in words.
    return { ok: false, text: `mycelia could not ask the node: ${body}`, lines: [] }
  }
}

// What mycelia holds for the session now, kept for the band.
async function ask($: EngineInterface, sessionId: string) {
  let now: Said
  try {
    if (!secret) {
      const why = await pair($)
      if (why) throw new Error(why)
    }
    let r = await $.http.fetch('http://mycelia/collected', {
      method: 'POST',
      socketPath: SOCKET,
      headers: { 'X-Ag-Secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId }),
    })
    if (r.text.startsWith('401\n')) {
      secret = ''
      const why = await pair($)
      if (why) throw new Error(why)
      r = await $.http.fetch('http://mycelia/collected', {
        method: 'POST',
        socketPath: SOCKET,
        headers: { 'X-Ag-Secret': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId }),
      })
    }
    now = saidOf(r.text)
  } catch (err) {
    now = { ok: false, text: `mycelia was not asked at ${SOCKET}: ${String(err)}`, lines: [] }
  }
  await update($, said, () => now)
  let branched: Forks = { name: '', here: true, forks: [] }
  try {
    const r = await $.process.run(['ground', 'forks', 'json'], { env: { CLAUDE_CODE_SESSION_ID: sessionId }, timeoutMs: 10000 })
    if (r.exitCode === 0) {
      const f = JSON.parse(r.stdout || '{}') as Partial<Forks>
      branched = { name: f.name ?? '', here: f.here ?? true, forks: f.forks ?? [] }
    }
  } catch {
    branched = { name: '', here: true, forks: [] }
  }
  await update($, forks, () => branched)
}

// "BUT AG WOULD KNOW, RIGHT ?"
// A press on what is collected is the person's click, and only ag sees it:
// ag asks mycelia directly over its socket, carrying the secret it was given
// when the person paired it with a finger. That secret lives here, in memory,
// and nowhere an agent reads.
const SOCKET = '/Users/s.b.vanhouten/.local/state/ug/mycelia.sock'
let secret = ''

// The person's finger, once: mycelia asks for it and gives ag its secret.
// Null when paired, else why not.
async function pair($: EngineInterface): Promise<string | null> {
  const r = await $.http.fetch('http://mycelia/pair', { method: 'POST', socketPath: SOCKET, body: '' })
  const [status, ...rest] = r.text.split('\n')
  if (status === '200') {
    secret = rest.join('\n').trim()
    return null
  }
  return rest.join('\n') || r.text
}

// The next time this clock reads HH:MM, as the node takes it: RFC3339 in UTC.
function untilOf(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date()
  at.setHours(h ?? 0, m ?? 0, 0, 0)
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// The node's path and body for a press, as ground collected asked them.
function askOf(d: Press): [string, Record<string, string | string[]>] {
  const body: Record<string, string | string[]> = { to: d.to }
  // What one agent sent, of a collection several sent into.
  if (d.act === 'release' && d.ids) body.ids = d.ids
  // One thing approved or denied by its own id.
  if ((d.act === 'cancel' || d.act === 'release' || d.act === 'edit') && d.id) body.id = d.id
  // A time a pill moved is the whole time; HH:MM is the next time this clock reads it.
  if (d.act === 'hold' && d.until) body.until = d.until.includes('T') ? d.until : untilOf(d.until)
  if ((d.act === 'release' || d.act === 'edit') && d.says !== undefined) body.says = d.says
  return [`/api/collected/${d.act}`, body]
}

// A press at mycelia: null when the node did it, else why not. A secret
// mycelia no longer holds (it restarted) is paired again, once.
async function atMycelia($: EngineInterface, d: Press): Promise<string | null> {
  const [path, body] = askOf(d)
  for (let tries = 0; tries < 2; tries++) {
    if (!secret) {
      const why = await pair($)
      if (why) return why
    }
    const r = await $.http.fetch(`http://mycelia${path}`, {
      method: 'POST',
      socketPath: SOCKET,
      headers: { 'X-Ag-Secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const [status, ...rest] = r.text.split('\n')
    if (status === '401') { secret = ''; continue }
    if (status === '200') return null
    return `${path} ${status === '0' ? 'was not asked' : `answered ${status}`}: ${rest.join('\n')}`
  }
  return `${path}: ag was not paired with your finger`
}

// The ground command a press is: what is pressed, on whom, and what it carries.
function argvOf(d: Press): string[] {
  return ['ground', 'forks', 'give', d.to]
}

// A press, asked of the node by ground as the person: what the node refused
// is kept for the band, and every press is written down.
async function press($: EngineInterface, d: Press, sessionId: string) {
  if (d.act !== 'give') {
    let why: string | null
    try {
      why = await atMycelia($, d)
    } catch (err) {
      why = `mycelia was not reached at ${SOCKET}: ${String(err)}`
    }
    await update($, refused, () => why)
    await $.fs.write(PRESSES, JSON.stringify({ at: await $.clock.now(), press: d, refused: why }) + '\n')
    return why === null
  }
  const argv = argvOf(d)
  const r = await $.process.run(argv, { env: { CLAUDE_CODE_SESSION_ID: sessionId }, timeoutMs: 60000 })
  const why = r.exitCode === 0 ? null : (r.stderr || r.stdout).trim() || `${argv.join(' ')} exited ${r.exitCode}`
  await update($, refused, () => why)
  await $.fs.write(PRESSES, JSON.stringify({ at: await $.clock.now(), argv, exitCode: r.exitCode, stderr: r.stderr }) + '\n')
  return r.exitCode === 0
}

// "and it gets the name and is the active session at the same time"
// A press on the row of sessions that branched from this one. The switch goes
// first, and the name follows only a session the person can be in: one running
// in the background is opened elsewhere, and what Claude Code said of it stands
// under the pills. Taking the name back to this session switches nothing.
async function named($: EngineInterface, act: 'take' | 'give' | 'open', to: string, sessionId: string) {
  if (act === 'open') {
    // "I PRESSED IT, I AM HUMAN, THE INTENT IT FOR IT TO HAVE IT"
    // The click is the decision: the name goes. Only the switch waits, on
    // a session open in another window, and how to get there is said.
    const gave = await press($, { act: 'give', to }, sessionId)
    if (gave) await update($, refused, () => `the name is that session's now; it is open in another window: \`claude attach ${to.slice(0, 8)}\``)
  } else if (act === 'give') {
    let said = ''
    try {
      said = (await $.command.run({ command: 'resume', args: to })).text ?? ''
    } catch (err) {
      said = `/resume ${to} was not run: ${String(err)}`
    }
    if (said.includes('running in the background') || said.includes('was not run')) {
      await update($, refused, () => `the name stays here: ${said}`)
    } else {
      await press($, { act: 'give', to }, sessionId)
    }
  } else {
    await press($, { act: 'give', to }, sessionId)
  }
  await ask($, sessionId)
}

export const register: Register = on => {
  let sessionId = ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    sessionId = await $.session.id()
    await ask($, sessionId)
    $.clock.every(EVERY_MS, () => ask($, sessionId))
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, said)
    const why = await read($, refused)
    const branched = (await read($, forks)) ?? { name: '', here: true, forks: [] }
    const pressed: View = (await read($, view)) ?? {}
    if (now === null || (now.ok && now.lines.length === 0 && branched.forks.length === 0 && why === null)) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    if (!now.ok) return <Box><Text color="red">{now.text}</Text></Box>
    return (
      <Box flexDirection="column">
        {pills({ Box, Text, Button, Input }, {
          lines: now.lines,
          forks: branched.forks,
          name: branched.name,
          here: branched.here,
          view: pressed,
          now: await $.clock.now(),
          clock: () => $.clock.now(),
          set: pressedNow => update($, view, () => pressedNow),
          // What was armed, edited or moved is done with once it is asked.
          act: async press => {
            const until = { ...pressed.until }
            delete until[press.to]
            await update($, view, () => ({ open: pressed.open, until }))
            await ask$(press)
          },
          named: (act, to) => named($, act, to, sessionId),
        })}
        {why === null ? null : <Text color="red">{why}</Text>}
      </Box>
    )
    async function ask$(d: Press) {
      await press($, d, sessionId)
      await ask($, sessionId)
    }
  })
}

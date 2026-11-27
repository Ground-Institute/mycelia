// One message, as ag draws it on a line: which way it goes, the DID of the
// agent it waits for, when it is due on this clock, who said it or is to hear
// it, what it says, and the id the node names it by.
export type Line = {
  // An approval is the thing itself, the person's to approve or deny.
  way: 'in' | 'out' | 'approve'
  to: string
  due: string
  // When it is due, RFC3339: what a pill says, and what -1h and +1h move.
  at?: string
  // The collection it is in, by the id laye names it by: what a press is on.
  collection?: string
  who: string
  says: string
  id: string
}

// A time moved by +- and not yet held: on whom, the time, when it was last
// pressed, up or down, and which +- (0 the hours, 1 the minutes).
export type Moving = { to: string; until: string; at: number; up: boolean; pair: number }

// What of the pills is pressed: the one open, the press armed and when, the
// time each collection is moved to and not yet held at, the pill edited.
export type View = { open?: string; armed?: { id: string; at: number }; moving?: Record<string, Moving>; editing?: string; drawn?: number }

// What `ground collected json` last said for this session: the lines it
// holds, or, when it is no answer of the node's, what went wrong (ok false).
export type Said = { ok: boolean; text: string; lines: Line[] }

// A session that branched from this one, as `ground forks json` says it: its
// id, and the name it holds, empty for none.
export type Fork = { session: string; name: string; title: string; holds: boolean; running?: boolean }

// This session's own name, and the sessions that branched from it.
export type Forks = { name: string; here: boolean; forks: Fork[] }

declare module 'claude-code' {
  interface PluginState {
    ag: { said: Said | null; refused: string | null; forks: Forks | null; view: View | null }
  }
}

// "Getting A2UI pieces to show up in another session from this one"
// "i expect my own workflow to not change"
//
// What an agent said beside its words as A2UI v1.0 (laye keeps it as the
// message's a2ui), drawn as lines of text under the message in the open pill.
// The messages are applied in the order said, as A2UI over A2A has a renderer
// do (Ground-Institute/laye parity/a2ui_v1.0_36725ee): createSurface,
// updateComponents, updateDataModel, deleteSurface. Each surface is drawn from
// its root. Text and layout are drawn: Text, Row, Column, List. Anything else
// is said not to be drawn yet, as nothing pressed on a surface goes back yet.

type Component = { id: string; component: string; [key: string]: unknown }
type Surface = { id: string; components: Map<string, Component>; data: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// A JSON Pointer's keys, each unescaped: ~1 is /, then ~0 is ~.
const keysOf = (pointer: string): string[] =>
  pointer.split('/').filter(Boolean).map(k => k.split('~1').join('/').split('~0').join('~'))

// A value in the data model, by its JSON Pointer.
function at(data: unknown, pointer: string): unknown {
  let here = data
  for (const key of keysOf(pointer)) {
    if (Array.isArray(here)) here = here[Number(key)]
    else if (isObject(here)) here = here[key]
    else return undefined
  }
  return here
}

// The data model with value put at the pointer; the whole of it at none.
function put(data: unknown, pointer: string | undefined, value: unknown): unknown {
  const keys = keysOf(pointer ?? '')
  if (keys.length === 0) return value
  const root: Record<string, unknown> = isObject(data) ? { ...data } : {}
  let here = root
  for (const key of keys.slice(0, -1)) {
    const next = isObject(here[key]) ? { ...(here[key] as Record<string, unknown>) } : {}
    here[key] = next
    here = next
  }
  here[keys[keys.length - 1]] = value
  return root
}

// What a string a component holds says: itself, or what the data model holds
// where it points.
function said(v: unknown, data: unknown): string {
  if (typeof v === 'string') return v
  if (isObject(v) && typeof v['@path'] === 'string') {
    const found = at(data, v['@path'])
    return found === undefined || found === null ? '' : typeof found === 'string' ? found : JSON.stringify(found)
  }
  if (isObject(v) && 'call' in v) return '[a function call is not drawn yet]'
  return ''
}

// Lines side by side, each column as wide as its widest line.
function beside(columns: string[][]): string[] {
  const height = Math.max(0, ...columns.map(c => c.length))
  const widths = columns.map(c => Math.max(0, ...c.map(l => l.length)))
  const lines: string[] = []
  for (let i = 0; i < height; i++)
    lines.push(columns.map((c, j) => (j === columns.length - 1 ? c[i] ?? '' : (c[i] ?? '').padEnd(widths[j]))).join('  ').trimEnd())
  return lines
}

// One component and what it holds, as lines.
function drawn(surface: Surface, id: string, seen: Set<string>): string[] {
  const c = surface.components.get(id)
  if (!c) return [`[no component ${id} on ${surface.id}]`]
  if (seen.has(id)) return [`[${id} holds itself]`]
  const inner = new Set(seen).add(id)
  const children = (): string[][] | string => {
    const list = c.children
    if (Array.isArray(list)) return list.map(child => drawn(surface, String(child), inner))
    return `[${c.component} children from the data model are not drawn yet]`
  }
  switch (c.component) {
    case 'Text':
      return said(c.text, surface.data).split('\n')
    case 'Column': {
      const all = children()
      return typeof all === 'string' ? [all] : all.flat()
    }
    case 'Row': {
      const all = children()
      return typeof all === 'string' ? [all] : beside(all)
    }
    case 'List': {
      const all = children()
      if (typeof all === 'string') return [all]
      return c.direction === 'horizontal' ? beside(all) : all.flat()
    }
    default:
      return [`[${c.component} is not drawn yet]`]
  }
}

// Every surface the messages leave standing, drawn from its root, as lines;
// and what of the messages could not be applied, said where it stands.
export function surfaceLines(messages: unknown[]): string[] {
  const surfaces = new Map<string, Surface>()
  const lines: string[] = []
  const components = (surface: Surface, list: unknown) => {
    if (!Array.isArray(list)) return
    for (const c of list) if (isObject(c) && typeof c.id === 'string' && typeof c.component === 'string') surface.components.set(c.id, c as Component)
  }
  messages.forEach((m, i) => {
    if (!isObject(m)) return void lines.push(`[A2UI message ${i} is no object]`)
    if (isObject(m.createSurface) && typeof m.createSurface.surfaceId === 'string') {
      const s: Surface = { id: m.createSurface.surfaceId, components: new Map(), data: m.createSurface.dataModel ?? {} }
      components(s, m.createSurface.components)
      surfaces.set(s.id, s)
      return
    }
    for (const kind of ['updateComponents', 'updateDataModel', 'deleteSurface']) {
      const body = m[kind]
      if (!isObject(body) || typeof body.surfaceId !== 'string') continue
      const s = surfaces.get(body.surfaceId)
      if (!s) return void lines.push(`[${kind} for ${body.surfaceId}, which was never created]`)
      if (kind === 'updateComponents') components(s, body.components)
      else if (kind === 'updateDataModel') s.data = put(s.data, typeof body.path === 'string' ? body.path : undefined, body.value)
      else surfaces.delete(s.id)
      return
    }
    lines.push(`[A2UI message ${i} is ${Object.keys(m).filter(k => k !== 'version').join(', ') || 'empty'}, which ag does not draw]`)
  })
  for (const s of surfaces.values()) lines.push(...drawn(s, 'root', new Set()))
  return lines
}

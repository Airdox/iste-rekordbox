export type Track = {
  id: string
  title: string
  artist: string
  genre: string
  bpm: number | null
  key: string | null
  rating: number
  seconds: number | null
  year: number | null
  album?: string
  comment?: string
  label?: string
  bitrate?: number | null
  path?: string
  added?: string
  plays?: number | null
  created?: string
  sample_rate?: number | null
  bytes?: number | null
}

export type Detail = Track & {
  album: string
  label: string
  added: string
  created: string
  path: string
  comment: string
  key_raw: string
  plays: number | null
  bitrate: number | null
  sample_rate: number | null
  bytes: number | null
  waveform: number[]
}

export type Source = {
  path: string | null
  kind: 'Master' | 'OneLibrary' | 'Device Library' | 'Demo'
  total: number
  genres: number
  bpmBounds: [number, number]
  withKey: number
}

export type Facet = { value: string; count: number }
export type Results = {
  rows: Track[]
  counts: [number, number, number, number]
  genres: Facet[]
  keys: Facet[]
  histogram: { bpm: number; count: number }[]
  ms: number
}

export type Deck = {
  deck: number
  name: string
  source: number
  slot: number
  slotName: string
  trackId: string
  bpm: number | null
  key: string | null
  genre?: string | null
  seconds?: number | null
  title: string | null
  artist: string | null
  libraryId: string | null
  playing: boolean
  master: boolean
}
export type Match = Track & { delta: number; relation: string }
export type Media = Source & { source: number; slot: number }
export type LiveStatus = {
  state: 'off' | 'discovering' | 'listening' | 'error' | 'demo' | 'rekordbox'
  error: string | null
  decks: Deck[]
  anchor: number | null
  matches: Match[]
  media: Media[]
}
export type NetworkInterface = { name: string; ip: string }

declare global {
  interface Window {
    cuepoint: {
      request<T>(method: string, params?: object): Promise<T>
      choose(directory: boolean): Promise<string | null>
      window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
    }
  }
}

export const request = <T,>(method: string, params?: object) => window.cuepoint.request<T>(method, params)
export const message = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/^Error invoking remote method '[^']+': Error: /, '')
const germanNumber = new Intl.NumberFormat('de-DE')
export const count = (value: number) => germanNumber.format(value)
export const bpmText = (value: number | null) => value?.toFixed(2) ?? '—'
export const duration = (seconds: number | null) =>
  seconds === null ? '—' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
export const basename = (value: string | null) => value?.split(/[\\/]/).pop() ?? ''

const camelotPalette = ['#84dfd1', '#9be1b0', '#b9df98', '#d7e491', '#e8d6a0', '#e8bcab',
  '#e1afd0', '#c9ace8', '#aeb5ed', '#98b9ed', '#83cfec', '#76dce4']
export const camelotColor = (key: string) => camelotPalette[Number(key.slice(0, -1)) - 1] ?? '#a2a6ba'

export function relatedKeys(key: string): string[] {
  const match = /^(\d+)([AB])$/i.exec(key.trim())
  if (!match) return []
  const number = Number(match[1])
  const mode = match[2].toUpperCase()
  return [
    `${(number + 10) % 12 + 1}${mode}`,
    `${number}${mode}`,
    `${number % 12 + 1}${mode}`,
    `${number}${mode === 'A' ? 'B' : 'A'}`,
  ]
}

export function harmonicTransition(keyA: string | null, keyB: string | null): { label: string; kind: 'good' | 'warning' } {
  if (!keyA || !keyB) return { label: 'Tonart fehlt', kind: 'warning' }
  if (keyA === keyB) return { label: 'Gleicher Key', kind: 'good' }
  if (relatedKeys(keyA).includes(keyB)) return { label: 'Harmonisch benachbart', kind: 'good' }
  return { label: 'Key-Wechsel prüfen', kind: 'warning' }
}

export function exportSetCsv(items: Track[], filename = 'airdox-setliste.csv'): string {
  const cols = ['Nr', 'Titel', 'Interpret', 'BPM', 'Camelot', 'Genre', 'Rating', 'Jahr', 'Dauer (s)']
  const rows = items.map((t, i) => [
    i + 1,
    t.title,
    t.artist,
    t.bpm != null ? t.bpm.toFixed(2) : '',
    t.key ?? '',
    t.genre,
    t.rating,
    t.year ?? '',
    t.seconds ?? '',
  ].map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(';'))
  const content = '\uFEFF' + [cols.join(';'), ...rows].join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return content
}

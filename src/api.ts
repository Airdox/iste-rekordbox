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

export type Filters = {
  search: string
  genres: string[]
  keys: string[]
  harmonicKeys?: boolean
  bpmMin?: number
  bpmMax?: number
  rating?: number
  yearMin?: number
  yearMax?: number
  plays?: number
}

export const emptyFilters: Filters = { search: '', genres: [], keys: [] }
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
  seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
export const basename = (value: string | null) => value?.split(/[\\/]/).pop() ?? ''
// Segmentfarben des offiziellen Camelot Wheel von Mixed In Key.
const camelotPalette = ['#84dfd1', '#9be1b0', '#b9df98', '#d7e491', '#e8d6a0', '#e8bcab',
  '#e1afd0', '#c9ace8', '#aeb5ed', '#98b9ed', '#83cfec', '#76dce4']
export const camelotColor = (key: string) => camelotPalette[Number(key.slice(0, -1)) - 1] ?? '#a2a6ba'

export function relatedKeys(key: string) {
  const number = Number(key.slice(0, -1))
  const mode = key.slice(-1)
  return [key, `${number}${mode === 'A' ? 'B' : 'A'}`, `${(number + 10) % 12 + 1}${mode}`, `${number % 12 + 1}${mode}`]
}

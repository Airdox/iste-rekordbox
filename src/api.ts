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
  fader?: number | null
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

export type TransportResult = {
  ok: boolean
  reason: string
  action: 'reveal' | 'deck1' | 'deck2'
  deck: number | null
  query: string
  path: string
  copied: boolean
  message: string
}

declare global {
  interface Window {
    cuepoint: {
      request<T>(method: string, params?: object): Promise<T>
      choose(directory: boolean): Promise<string | null>
      window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
      revealFile?(path: string): Promise<boolean>
    }
  }
}

export const request = <T,>(method: string, params?: object) => window.cuepoint.request<T>(method, params)
export const rekordboxTransport = (params: {
  id?: string
  action: 'reveal' | 'deck1' | 'deck2'
  query?: string
  path?: string
}) => request<TransportResult>('rekordboxTransport', params)
export const revealFile = (path: string) =>
  window.cuepoint.revealFile?.(path) ?? Promise.resolve(false)
export const message = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/^Error invoking remote method '[^']+': Error: /, '')
let germanNumber: Intl.NumberFormat | undefined
export const count = (value: number) => (germanNumber ??= new Intl.NumberFormat('de-DE')).format(value)
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

function triggerDownload(content: string, mime: string, filename: string): string {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return content
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
  return triggerDownload('\uFEFF' + [cols.join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8', filename)
}

export function exportM3u8Playlist(items: Track[], filename = 'airdox-setliste.m3u8'): string {
  const lines = ['#EXTM3U']
  for (const t of items) {
    const artist = t.artist || 'Unbekannt'
    const title = t.title || 'Ohne Titel'
    lines.push(`#EXTINF:${t.seconds ?? -1},${artist} - ${title}`)
    lines.push(t.path || `${artist} - ${title}`)
  }
  return triggerDownload(lines.join('\r\n'), 'audio/x-mpegurl;charset=utf-8', filename)
}

const xmlEscape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const toFileUri = (path: string) => {
  const norm = path.replaceAll('\\', '/')
  return encodeURI(norm.startsWith('/') ? `file://localhost${norm}` : `file://localhost/${norm}`)
}

export function exportRekordboxXml(
  items: Track[],
  playlistName = 'airdox Set',
  filename = 'rekordbox-import.xml',
): string {
  const trackNodes = items.map((t, i) => {
    const loc = t.path ? ` Location="${xmlEscape(toFileUri(t.path))}"` : ''
    const bpm = t.bpm != null ? t.bpm.toFixed(2) : ''
    return `    <TRACK TrackID="${i + 1}" Name="${xmlEscape(t.title)}" Artist="${xmlEscape(t.artist)}" Genre="${xmlEscape(t.genre)}" TotalTime="${t.seconds ?? 0}" Year="${t.year ?? ''}" AverageBpm="${bpm}" Tonality="${xmlEscape(t.key ?? '')}"${loc}/>`
  })
  const keys = items.map((_, i) => `        <TRACK Key="${i + 1}"/>`)
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="airdox Library" Version="1.1.0" Company="airdox"/>',
    `  <COLLECTION Entries="${items.length}">`,
    ...trackNodes,
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    '    <NODE Type="0" Name="ROOT" Count="1">',
    `      <NODE Name="${xmlEscape(playlistName)}" Type="1" KeyType="0" Entries="${items.length}">`,
    ...keys,
    '      </NODE>',
    '    </NODE>',
    '  </PLAYLISTS>',
    '</DJ_PLAYLISTS>',
  ].join('\n')
  return triggerDownload(xml, 'application/xml;charset=utf-8', filename)
}

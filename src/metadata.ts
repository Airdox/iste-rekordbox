export const fields = [
  { id: 'title', label: 'Titel', width: 120, flex: 1.4, type: 'text' },
  { id: 'artist', label: 'Interpret', width: 95, flex: 1.05, type: 'text' },
  { id: 'bpm', label: 'BPM', width: 60, type: 'number' },
  { id: 'key', label: 'Camelot-Key', shortLabel: 'Key', width: 50, type: 'key' },
  { id: 'genre', label: 'Genre', width: 82, flex: 0.85, type: 'text' },
  { id: 'rating', label: 'Bewertung', shortLabel: '★', width: 70, type: 'number' },
  { id: 'year', label: 'Jahr', width: 62, type: 'number' },
  { id: 'album', label: 'Album', width: 120, flex: 1, type: 'text' },
  { id: 'label', label: 'Label', width: 110, flex: 0.85, type: 'text' },
  { id: 'comment', label: 'Kommentar', width: 140, flex: 1.1, type: 'text' },
  { id: 'plays', label: 'Playcount', shortLabel: 'Plays', width: 68, type: 'number' },
  { id: 'seconds', label: 'Dauer (Sek.)', shortLabel: 'Dauer', width: 64, type: 'number' },
  { id: 'bitrate', label: 'Bitrate', width: 74, type: 'number' },
  { id: 'path', label: 'Dateipfad', width: 150, flex: 1.2, type: 'text' },
  { id: 'added', label: 'Hinzugefügt', width: 100, type: 'date' },
  { id: 'created', label: 'Erstellt', width: 100, type: 'date' },
  { id: 'sample_rate', label: 'Samplerate', width: 96, type: 'number' },
  { id: 'bytes', label: 'Dateigröße', width: 94, type: 'number' },
] as const

export type Field = typeof fields[number]
export type MetadataId = Field['id']
export type Operator = 'contains' | 'eq' | 'neq' | 'gte' | 'lte' | 'range' | 'empty'

export type Rule = { uid: number; id: MetadataId; op: Operator; value: string }
export type RuleGroup = { uid: number; mode: 'AND' | 'OR'; rules: Rule[] }
export type SortStage = { id: MetadataId; desc: boolean }

export type FilterPreset = {
  id: string
  name: string
  logic: 'AND' | 'OR'
  groups: { mode: 'AND' | 'OR'; rules: { id: MetadataId; op: Operator; value: string }[] }[]
  custom?: boolean
}

export const metadata = new Map<MetadataId, Field>(fields.map((field) => [field.id, field]))
export const defaultColumns: MetadataId[] = ['title', 'artist', 'bpm', 'key', 'genre', 'rating']
export const opsText: Record<Operator, string> = {
  contains: 'enthält',
  eq: 'ist gleich',
  neq: 'ist nicht',
  gte: 'mindestens',
  lte: 'höchstens',
  range: 'zwischen',
  empty: 'ist leer',
}
export const keys = ['A', 'B'].flatMap((mode) => Array.from({ length: 12 }, (_, index) => `${index + 1}${mode}`))

export const builtInPresets: FilterPreset[] = [
  {
    id: 'techno',
    name: 'Techno / Peak',
    logic: 'AND',
    groups: [
      { mode: 'OR', rules: [{ id: 'genre', op: 'eq', value: 'Techno' }, { id: 'genre', op: 'eq', value: 'Hardgroove' }] },
      { mode: 'AND', rules: [{ id: 'bpm', op: 'range', value: '134..142' }, { id: 'rating', op: 'gte', value: '4' }] },
    ],
  },
  {
    id: 'warmup',
    name: 'Melodic Warmup',
    logic: 'AND',
    groups: [
      { mode: 'OR', rules: [{ id: 'genre', op: 'eq', value: 'Melodic House' }, { id: 'genre', op: 'eq', value: 'Deep House' }] },
      { mode: 'AND', rules: [{ id: 'bpm', op: 'range', value: '118..130' }] },
    ],
  },
  {
    id: 'unplayed',
    name: 'Selten gespielt',
    logic: 'AND',
    groups: [
      { mode: 'AND', rules: [{ id: 'plays', op: 'lte', value: '2' }, { id: 'rating', op: 'gte', value: '3' }] },
    ],
  },
]

const PRESETS_STORAGE_KEY = 'airdox.customPresets'

export function loadCustomPresets(): FilterPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is FilterPreset =>
      item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.groups),
    ).map((item) => ({ ...item, custom: true }))
  } catch {
    return []
  }
}

export function saveCustomPresets(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets))
  } catch { /* ignore storage quota errors */ }
}

export function move<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const reordered = [...items]
  reordered.splice(to, 0, ...reordered.splice(from, 1))
  return reordered
}

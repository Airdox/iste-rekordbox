export const fields = [
  { id: 'key', label: 'Tonart', width: 68, type: 'key' },
  { id: 'bpm', label: 'BPM', width: 76, type: 'number' },
  { id: 'artist', label: 'Interpret', width: 116, flex: 1.05, type: 'text' },
  { id: 'title', label: 'Titel', width: 165, flex: 1.65, type: 'text' },
  { id: 'year', label: 'Jahr', width: 66, type: 'number' },
  { id: 'genre', label: 'Genre', width: 95, flex: 0.75, type: 'text' },
  { id: 'rating', label: 'Rating', width: 84, type: 'number' },
  { id: 'seconds', label: 'Dauer', width: 62, type: 'number' },
  { id: 'album', label: 'Album', width: 120, flex: 1.05, type: 'text' },
  { id: 'label', label: 'Label', width: 110, flex: 0.85, type: 'text' },
  { id: 'comment', label: 'Kommentar', width: 140, flex: 1.3, type: 'text' },
  { id: 'bitrate', label: 'Bitrate', width: 76, type: 'number' },
  { id: 'path', label: 'Dateipfad', width: 140, flex: 1.2, type: 'text' },
  { id: 'added', label: 'Hinzugefügt', width: 105, type: 'date' },
  { id: 'plays', label: 'Plays', width: 62, type: 'number' },
  { id: 'created', label: 'Erstellt', width: 105, type: 'date' },
  { id: 'sample_rate', label: 'Samplerate', width: 105, type: 'number' },
  { id: 'bytes', label: 'Dateigröße', width: 98, type: 'number' },
] as const

export type Field = typeof fields[number]
export type MetadataId = Field['id']
export type Operator = 'contains' | 'eq' | 'gte' | 'lte' | 'empty'
export type Rule = { uid: number; id: MetadataId; op: Operator; value: string | number }
export const metadata = new Map<MetadataId, Field>(fields.map((field) => [field.id, field]))
export const defaultColumns = fields.slice(0, 8).map((field) => field.id)
export const ops: Record<Operator, string> = { contains: 'enthält', eq: '=', gte: '≥', lte: '≤', empty: 'ist leer' }
export const keys = ['A', 'B'].flatMap((mode) => Array.from({ length: 12 }, (_, index) => `${index + 1}${mode}`))

export function move<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const reordered = [...items]
  reordered.splice(to, 0, ...reordered.splice(from, 1))
  return reordered
}

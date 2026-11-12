import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowDownUp, Filter, Plus, X } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import { keys, fields, metadata, move, ops, type MetadataId, type Operator, type Rule } from './metadata'

type FilterChip = { uid: string; label: string; remove: () => void }
type ChipProps = {
  children: ReactNode; index: number; onMove: (from: number, to: number) => void; type: 'filter' | 'sort'
}

function Chip({ children, index, type, onMove }: ChipProps) {
  return <span className={`pipeline-chip ${type}-chip`} draggable
    title="Priorität durch Ziehen oder Alt + Pfeiltaste ändern"
    onDragStart={(event) => event.dataTransfer.setData(`cuepoint/${type}`, String(index))}
    onDragOver={(event) => {
      if (event.dataTransfer.types.includes(`cuepoint/${type}`)) event.preventDefault()
    }}
    onDrop={(event) => {
      event.preventDefault()
      const from = event.dataTransfer.getData(`cuepoint/${type}`)
      if (from !== '') onMove(Number(from), index)
    }}
    onKeyDown={(event) => {
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        onMove(index, index + (event.key === 'ArrowLeft' ? -1 : 1))
      }
    }}>
    <span className="chip-index mono">{index + 1}</span>{children}
  </span>
}

export function Pipeline({ filters, sorts, addRule, orderFilters, setSorts }: {
  filters: FilterChip[]; sorts: SortingState; addRule: (rule: Rule) => void
  orderFilters: (filters: string[]) => void; setSorts: (sorts: SortingState) => void
}) {
  const [open, setOpen] = useState<'filter' | 'sort' | null>(null)
  const [filterId, setFilterId] = useState<MetadataId>('artist')
  const [op, setOp] = useState<Operator>('contains')
  const [value, setValue] = useState('')
  const [sortId, setSortId] = useState<MetadataId>('year')
  const [descending, setDescending] = useState(false)
  const uid = useRef(0)
  const field = metadata.get(filterId)!
  const options: Operator[] = field.type === 'text' ? ['contains', 'eq', 'empty']
    : field.type === 'key' ? ['eq', 'empty'] : ['eq', 'gte', 'lte', 'empty']

  function addFilter(event: FormEvent) {
    event.preventDefault()
    if (op !== 'empty' && !value.trim()) return
    addRule({ uid: ++uid.current, id: filterId, op, value: field.type === 'number' && op !== 'empty' ? Number(value) : value.trim() })
    setValue('')
    setOpen(null)
  }

  return <section className="pipeline panel" aria-label="Aktive Pipeline" onKeyDown={(event) => {
    if (event.key === 'Escape') setOpen(null)
  }}>
    <div className="pipeline-line">
      <span className="pipeline-label"><Filter size={14} /> Filter</span>
      <div className="pipeline-items">
        {filters.length === 0 && <span className="pipeline-empty">Keine aktiven Filter</span>}
        {filters.map((filter, index) => <Chip key={filter.uid} index={index} type="filter"
          onMove={(from, to) => orderFilters(move(filters, from, to).map(({ uid }) => uid))}>
          <span className="chip-label" title={filter.label}>{filter.label}</span>
          <button className="chip-button" aria-label={`${filter.label} entfernen`} onClick={filter.remove}><X size={12} /></button>
        </Chip>)}
      </div>
      <button className="text-button pipeline-add" aria-label="Filter hinzufügen" aria-expanded={open === 'filter'}
        onClick={() => setOpen(open === 'filter' ? null : 'filter')}><Plus size={14} /> Filter</button>
    </div>
    {open === 'filter' && <form className="pipeline-form" onSubmit={addFilter}>
      <label>Feld<select aria-label="Filterfeld" value={filterId} onChange={(event) => {
        const id = event.target.value as MetadataId
        setFilterId(id)
        setOp(metadata.get(id)?.type === 'text' ? 'contains' : 'eq')
        setValue('')
      }}>{fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      <label>Bedingung<select value={op} onChange={(event) => setOp(event.target.value as Operator)}>
        {options.map((option) => <option key={option} value={option}>{ops[option]}</option>)}
      </select></label>
      {op !== 'empty' && <label>Wert{field.type === 'key'
        ? <select aria-label="Filterwert" value={value} onChange={(event) => setValue(event.target.value)} required>
          <option value="">Tonart wählen</option>{keys.map((key) => <option key={key}>{key}</option>)}
        </select>
        : <input aria-label="Filterwert" type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          step={field.id === 'bpm' ? '0.01' : '1'} min={field.type === 'number' ? '0' : undefined}
          placeholder={field.id === 'seconds' ? 'Sekunden' : undefined}
          value={value} onChange={(event) => setValue(event.target.value)} required />}</label>}
      <button className="button primary-button" type="submit">Filter übernehmen</button>
    </form>}
    <div className="pipeline-line sort-line">
      <span className="pipeline-label"><ArrowDownUp size={14} /> Sortierung</span>
      <div className="pipeline-items">
        {sorts.length === 0 && <span className="pipeline-empty">Datenbank-ID</span>}
        {sorts.map((sort, index) => {
          const label = metadata.get(sort.id as MetadataId)?.label ?? sort.id
          const Direction = sort.desc ? ArrowDown : ArrowUp
          return <Chip key={sort.id} index={index} type="sort" onMove={(from, to) => setSorts(move(sorts, from, to))}>
            <button className="chip-button direction-button" aria-label={`${label}: Sortierrichtung umkehren`}
              onClick={() => setSorts(sorts.map((item) => item === sort ? { ...item, desc: !item.desc } : item))}>
              {label}<Direction size={12} />
            </button>
            <button className="chip-button" aria-label={`Sortierung ${label} entfernen`}
              onClick={() => setSorts(sorts.filter((item) => item !== sort))}><X size={12} /></button>
          </Chip>
        })}
      </div>
      <button className="text-button pipeline-add" aria-label="Sortierung hinzufügen" aria-expanded={open === 'sort'}
        onClick={() => setOpen(open === 'sort' ? null : 'sort')}><Plus size={14} /> Sortierung</button>
    </div>
    {open === 'sort' && <form className="pipeline-form" onSubmit={(event) => {
      event.preventDefault()
      setSorts([...sorts.filter((sort) => sort.id !== sortId), { id: sortId, desc: descending }])
      setOpen(null)
    }}>
      <label>Feld<select aria-label="Sortierfeld" value={sortId} onChange={(event) => setSortId(event.target.value as MetadataId)}>
        {fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
      </select></label>
      <label>Richtung<select value={descending ? 'desc' : 'asc'} onChange={(event) => setDescending(event.target.value === 'desc')}>
        <option value="asc">Aufsteigend</option><option value="desc">Absteigend</option>
      </select></label>
      <button className="button primary-button" type="submit">Sortierstufe übernehmen</button>
    </form>}
  </section>
}

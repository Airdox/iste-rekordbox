import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ListFilter, RotateCcw, Search } from 'lucide-react'
import { camelotColor, count, type Filters, type Results, type Source } from './api'
import { Stars } from './components'

function Stage({ label, total, step, children }: { label: string; total?: number; step: number; children: ReactNode }) {
  return <section className="filter-stage">
    <div className="stage-heading">
      <span className="stage-index mono">0{step}</span>
      <h3>{label}</h3>
      {total !== undefined && <span className="stage-count mono" title="Tracks nach dieser Filterstufe">{count(total)}</span>}
    </div>
    {children}
  </section>
}

export function Numeric({ label, value, placeholder, onChange, step = 1, min = 0, max }: {
  label: string; value?: number; placeholder?: string; onChange: (value?: number) => void
  step?: number; min?: number; max?: number
}) {
  return <label className="numeric">
    <span>{label}</span>
    <input type="number" step={step} min={min} max={max} value={value ?? ''} placeholder={placeholder}
      onChange={(event) => onChange(event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber)} />
  </label>
}

export function FilterPanel({ filters, results, source, onChange, onReset }: {
  filters: Filters; results: Results | null; source: Source | null
  onChange: (changes: Partial<Filters>) => void; onReset: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [genreSearch, setGenreSearch] = useState('')
  const [more, setMore] = useState(false)
  const available = results?.genres ?? []
  const listed = available.filter(({ value }) => value.toLocaleLowerCase('de').includes(genreSearch.toLocaleLowerCase('de')))
  const shown = [...listed].sort((a, b) => Number(filters.genres.includes(b.value)) - Number(filters.genres.includes(a.value)))
  const activeGenres = filters.genres.filter((value) => !shown.some((facet) => facet.value === value))
  const genreOptions = [...activeGenres.map((value) => ({ value, count: 0 })), ...(expanded ? shown : shown.slice(0, 5))]
  const keys = new Map(results?.keys.map(({ value, count }) => [value, count]))
  const bins = results?.histogram ?? []
  const peak = Math.max(1, ...bins.map((bin) => bin.count))
  const min = source?.bpmBounds[0] ?? 0
  const max = source?.bpmBounds[1] ?? 200
  const toggle = (name: 'genres' | 'keys', value: string) => onChange({
    [name]: filters[name].includes(value) ? filters[name].filter((item) => item !== value) : [...filters[name], value],
  })
  return <aside className="panel filters-panel" aria-label="Filter">
    <div className="panel-heading">
      <div className="heading-icon"><ListFilter size={16} /><h2>Filter</h2></div>
      <button className="icon-button" title="Filter zurücksetzen" aria-label="Filter zurücksetzen" onClick={onReset}><RotateCcw size={15} /></button>
    </div>
    <div className="filter-scroll">
      <Stage label="Genre" step={1} total={results?.counts[0]}>
        {expanded && <div className="genre-search"><Search size={13} /><input aria-label="Genre suchen"
          placeholder="Genre suchen" value={genreSearch} onChange={(event) => setGenreSearch(event.target.value)} /></div>}
        <div className={`genres ${expanded ? 'genres-expanded' : ''}`}>
          {genreOptions.map(({ value, count: total }) => <label className="genre" key={value}>
            <input type="checkbox" checked={filters.genres.includes(value)} onChange={() => toggle('genres', value)} />
            <span title={value}>{value || 'Ohne Genre'}</span><small className="mono">{count(total)}</small>
          </label>)}
          {!genreOptions.length && <span className="muted small">Keine Genres</span>}
        </div>
        {available.length > 5 && <button className="text-button more-button" onClick={() => { setExpanded(!expanded); setGenreSearch('') }}>
          {expanded ? 'Weniger anzeigen' : 'Alle Genres'} {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>}
      </Stage>
      <Stage label="Tempo" step={2} total={results?.counts[1]}>
        <div className="histogram" aria-hidden="true">
          {bins.map(({ bpm, count }) => <span key={bpm} title={`${bpm}–${bpm + 4.99} BPM`}
            className={bpm + 4.99 >= (filters.bpmMin ?? min) && bpm <= (filters.bpmMax ?? max) ? 'in-range' : ''}
            style={{ height: `${6 + 94 * Math.sqrt(count / peak)}%` }} />)}
        </div>
        <div className="range-fields">
          <Numeric label="Min. BPM" step={0.01} placeholder={String(min)} value={filters.bpmMin} onChange={(bpmMin) => onChange({ bpmMin })} />
          <Numeric label="Max. BPM" step={0.01} placeholder={String(max)} value={filters.bpmMax} onChange={(bpmMax) => onChange({ bpmMax })} />
        </div>
        {filters.bpmMin !== undefined && filters.bpmMax !== undefined && filters.bpmMin > filters.bpmMax
          && <div className="field-error">Minimum liegt über Maximum.</div>}
      </Stage>
      <Stage label="Tonart" step={3} total={results?.counts[2]}>
        <div className="key-grid">
          {['A', 'B'].flatMap((mode) => Array.from({ length: 12 }, (_, index) => {
            const value = `${index + 1}${mode}`
            return <button key={value} title={`${count(keys.get(value) ?? 0)} Tracks`} aria-label={`Tonart ${value}`}
              aria-pressed={filters.keys.includes(value)} data-available={keys.has(value)}
              style={{ '--key': camelotColor(value) } as CSSProperties} onClick={() => toggle('keys', value)}>{value}</button>
          }))}
        </div>
        <label className="harmonic-option"><input type="checkbox" checked={filters.harmonicKeys ?? false}
          onChange={(event) => onChange({ harmonicKeys: event.target.checked })} /> Harmonische Nachbarn</label>
      </Stage>
      <Stage label="Bewertung" step={4} total={results?.counts[3]}>
        <div className="rating-filter"><Stars value={filters.rating ?? 0} onChange={(rating) => onChange({ rating })} />
          <span className="muted small">{filters.rating ? `ab ${filters.rating}` : 'Alle'}</span></div>
        <button className="text-button more-button" aria-expanded={more} onClick={() => setMore(!more)}>
          Jahr & Plays {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {more && <div className="extra-filters">
          <div className="range-fields">
            <Numeric label="Jahr ab" value={filters.yearMin} onChange={(yearMin) => onChange({ yearMin })} />
            <Numeric label="Jahr bis" value={filters.yearMax} onChange={(yearMax) => onChange({ yearMax })} />
          </div>
          <Numeric label="Plays ab" value={filters.plays} onChange={(plays) => onChange({ plays })} />
        </div>}
      </Stage>
    </div>
  </aside>
}

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AudioLines, ChevronDown, Crosshair, Database, Disc3, Folder, FolderOpen, LibraryBig,
  LockKeyhole, Minus, Plus, Radio, RefreshCw, Square, X,
} from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import { basename, bpmText, count, emptyFilters, message, relatedKeys, request,
  type Detail, type Filters, type LiveStatus, type Results, type Source, type Track } from './api'
import { Empty, KeyBadge } from './components'
import { FilterPanel } from './filters'
import { LivePanel, type LiveOptions } from './live'
import { defaultColumns, metadata, ops, type MetadataId, type Rule } from './metadata'
import { Pipeline } from './pipeline'
import { TrackDetail } from './track-detail'
import { TrackTable } from './track-table'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './style.css'

const defaultSort: SortingState = [{ id: 'title', desc: false }]
const noTracks: Track[] = []
type Reference = { id: string | null; title: string; artist: string; key: string | null; bpm: number | null; manual: boolean }

function loadLayout(): MetadataId[] {
  try {
    const saved = JSON.parse(localStorage.getItem('cuepoint.columns') ?? 'null')
    const valid = Array.isArray(saved) ? [...new Set<MetadataId>(saved.filter((id) => metadata.has(id)))] : []
    if (valid.length) return valid
  } catch { /* use default layout */ }
  return defaultColumns
}

function App() {
  const [view, setView] = useState<'library' | 'live'>('library')
  const [source, setSource] = useState<Source | null>(null)
  const [sourceBusy, setSourceBusy] = useState(true)
  const [sourceMenu, setSourceMenu] = useState(false)
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [rules, setRules] = useState<Rule[]>([])
  const [filterOrder, setFilterOrder] = useState<string[]>([])
  const [sorts, setSorts] = useState<SortingState>(defaultSort)
  const [visible, setVisible] = useState<MetadataId[]>(loadLayout)
  const [results, setResults] = useState<Results | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [queryBusy, setQueryBusy] = useState(false)
  const [quickMore, setQuickMore] = useState(false)
  const [live, setLive] = useState<LiveStatus | null>(null)
  const [liveRevision, setLiveRevision] = useState(0)
  const [liveOptions, setLiveOptions] = useState<LiveOptions>({ harmonic: true, tolerance: 3 })
  const [reference, setReference] = useState<Reference | null>(null)
  const [matching, setMatching] = useState(false)
  const [auto, setAuto] = useState(false)
  const [matchError, setMatchError] = useState('')

  const anchor = live?.decks.find((deck) => deck.deck === live.anchor)
  const hardware: Reference | null = anchor && anchor.trackId !== '0' ? {
    id: anchor.libraryId, title: anchor.title || `Track ${anchor.trackId}`, artist: anchor.artist || anchor.name,
    key: anchor.key, bpm: anchor.bpm, manual: false,
  } : null
  const active = auto ? hardware : reference
  const usable = active?.bpm != null && (!liveOptions.harmonic || active.key != null || active.manual)
  const follow = Boolean((matching || auto) && usable)
  const effectiveSorts = follow && !sorts.some((sort) => sort.id === 'bpm') ? [{ id: 'bpm', desc: false }, ...sorts] : sorts
  const orderedRules = [...rules].sort((a, b) => filterOrder.indexOf(`rule${a.uid}`) - filterOrder.indexOf(`rule${b.uid}`))
  const radius = (active?.bpm ?? 0) * liveOptions.tolerance / 100
  const filterKeys = filters.harmonicKeys ? [...new Set(filters.keys.flatMap(relatedKeys))] : filters.keys
  const payload = JSON.stringify({
    ...filters,
    keys: filterKeys,
    ...(follow && active?.bpm != null ? {
      bpmMin: Number((active.bpm - radius).toFixed(8)), bpmMax: Number((active.bpm + radius).toFixed(8)),
      keys: liveOptions.harmonic && active.key ? relatedKeys(active.key) : filterKeys,
      excludeId: active.id,
    } : {}),
    rules: orderedRules.map(({ id, op, value }) => ({ id, op, value })),
    sorts: effectiveSorts,
    fields: visible,
  })

  function reset() {
    setFilters(emptyFilters)
    setRules([])
    setFilterOrder([])
    setMatching(false)
    setAuto(false)
  }

  async function open(path?: string, initial = false, demo = false) {
    setSourceBusy(true)
    setSourceMenu(false)
    setNotice('')
    try {
      const next = await request<Source>(demo ? 'demoLibrary' : 'open', { path })
      setSource(next)
      setResults(null)
      setSelected(null)
      setDetail(null)
      setReference(null)
      setLiveOptions((options) => ({ ...options, masterSource: undefined }))
      reset()
    } catch (error) {
      const reason = message(error)
      if (initial) {
        try {
          setSource(await request<Source>('demoLibrary'))
          setNotice(`${reason} Die synthetische Testbibliothek ist aktiv.`)
        } catch (demoError) {
          setNotice(`${reason} ${message(demoError)}`)
        }
      } else setNotice(reason)
    } finally {
      setSourceBusy(false)
    }
  }

  async function choose(directory: boolean) {
    setSourceMenu(false)
    const path = await window.cuepoint.choose(directory)
    if (path) await open(path)
  }

  useEffect(() => { void open(undefined, true) }, [])
  useEffect(() => { localStorage.setItem('cuepoint.columns', JSON.stringify(visible)) }, [visible])
  useEffect(() => {
    if (!source || sourceBusy) return
    let ignore = false
    setQueryBusy(true)
    const timer = setTimeout(() => {
      request<Results>('query', JSON.parse(payload)).then((next) => {
        if (ignore) return
        setResults(next)
        setSelected((current) => current && next.rows.some((row) => row.id === current) ? current : next.rows[0]?.id ?? null)
      }).catch((error: unknown) => { if (!ignore) setNotice(message(error)) })
        .finally(() => { if (!ignore) setQueryBusy(false) })
    }, 75)
    return () => { ignore = true; clearTimeout(timer) }
  }, [source, sourceBusy, payload])

  useEffect(() => {
    if (!selected || !source || sourceBusy) {
      setDetail(null)
      return
    }
    let ignore = false
    setDetail(null)
    request<Detail | null>('detail', { id: selected })
      .then((next) => { if (!ignore) setDetail(next) })
      .catch((error: unknown) => { if (!ignore) setNotice(message(error)) })
    return () => { ignore = true }
  }, [source, sourceBusy, selected])

  useEffect(() => {
    let ignore = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await request<LiveStatus>('live', liveOptions)
        if (!ignore) setLive((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      } catch { /* source startup can briefly delay status */ }
      if (!ignore) timer = setTimeout(poll, 400)
    }
    void poll()
    return () => { ignore = true; clearTimeout(timer) }
  }, [liveRevision, liveOptions, source])

  const changeFilters = (change: Partial<Filters>) => setFilters((current) => ({ ...current, ...change }))
  const chips = [
    ...rules.map((rule) => ({
      uid: `rule${rule.uid}`,
      label: `${metadata.get(rule.id)?.label} ${ops[rule.op]} ${rule.op === 'empty' ? '' : rule.value}`.trim(),
      remove: () => setRules((current) => current.filter(({ uid }) => uid !== rule.uid)),
    })),
    ...filters.genres.map((genre) => ({
      uid: `genre:${genre}`, label: genre || 'Ohne Genre', remove: () => changeFilters({ genres: filters.genres.filter((item) => item !== genre) }),
    })),
    ...(!follow ? filters.keys.map((key) => ({
      uid: `key:${key}`, label: filters.harmonicKeys ? `${key} + Nachbarn` : key,
      remove: () => changeFilters({ keys: filters.keys.filter((item) => item !== key) }),
    })) : []),
    ...((filters.bpmMin != null || filters.bpmMax != null) && !follow ? [{
      uid: 'tempo', label: `BPM ${filters.bpmMin ?? '…'}–${filters.bpmMax ?? '…'}`,
      remove: () => changeFilters({ bpmMin: undefined, bpmMax: undefined }),
    }] : []),
    ...(filters.rating ? [{ uid: 'rating', label: `Rating ≥ ${filters.rating}`, remove: () => changeFilters({ rating: undefined }) }] : []),
    ...(filters.yearMin != null || filters.yearMax != null ? [{
      uid: 'year', label: `Jahr ${filters.yearMin ?? '…'}–${filters.yearMax ?? '…'}`,
      remove: () => changeFilters({ yearMin: undefined, yearMax: undefined }),
    }] : []),
    ...(filters.plays != null ? [{ uid: 'plays', label: `Plays ≥ ${filters.plays}`, remove: () => changeFilters({ plays: undefined }) }] : []),
    ...(filters.search ? [{ uid: 'search', label: `Suche: ${filters.search}`, remove: () => changeFilters({ search: '' }) }] : []),
    ...(follow ? [{
      uid: 'match', label: `${active?.key && liveOptions.harmonic ? `${active.key} · ` : ''}±${liveOptions.tolerance}% BPM`,
      remove: () => { setAuto(false); setMatching(false) },
    }] : []),
  ].sort((a, b) => (filterOrder.indexOf(a.uid) + 1 || Infinity) - (filterOrder.indexOf(b.uid) + 1 || Infinity))

  const setTrackReference = (track: Track, apply = false) => {
    setAuto(false)
    setMatching(apply)
    setMatchError('')
    setReference({ id: track.id, title: track.title, artist: track.artist, key: track.key, bpm: track.bpm, manual: true })
  }

  function startMatch() {
    if (!hardware && !reference) {
      setView('live')
      return
    }
    const next = hardware ?? reference!
    if (next.bpm == null || (liveOptions.harmonic && !next.key && !next.manual)) {
      setMatchError('Für diesen Match fehlen BPM oder Tonart.')
      if (hardware) setView('live')
      return
    }
    setAuto(false)
    setReference(next)
    setMatching(true)
    setMatchError('')
    setView('library')
  }

  const genres = results?.genres.filter(({ value }) => value) ?? []
  const displayed = active ?? hardware
  return <div className="app-shell">
    <header className="app-bar">
      <div className="brand"><span className="brand-mark"><AudioLines size={19} /></span><strong>Cuepoint</strong></div>
      <nav className="navigation" aria-label="Hauptnavigation">
        <button aria-current={view === 'library' ? 'page' : undefined} onClick={() => setView('library')}><LibraryBig size={15} /> Bibliothek</button>
        <button aria-current={view === 'live' ? 'page' : undefined} onClick={() => setView('live')}><Radio size={16} /> Live Match</button>
      </nav>
      <div className="window-drag" />
      <span className="read-only" title="Die App liest eine lokale Momentaufnahme der Rekordbox-Datenbank."><LockKeyhole size={13} /> Schreibgeschützt</span>
      <div className="window-controls">
        <button aria-label="Minimieren" onClick={() => void window.cuepoint.window('minimize')}><Minus size={14} /></button>
        <button aria-label="Fenster maximieren oder wiederherstellen" onClick={() => void window.cuepoint.window('maximize')}><Square size={12} /></button>
        <button className="close-window" aria-label="Schließen" onClick={() => void window.cuepoint.window('close')}><X size={15} /></button>
      </div>
    </header>
    <main className="workspace">
      <div className="workspace-heading">
        <div>
          <h1>{view === 'library' ? 'Bibliothek' : 'Live Match'}</h1>
          <div className="source-line" title={source?.path ?? ''}><Database size={13} />
            <span>{source ? source.kind === 'Demo' ? 'Synthetische Testbibliothek' : `${source.kind} · ${source.path}`
              : sourceBusy ? 'Rekordbox-Bibliothek wird gelesen…' : 'Keine Bibliothek geöffnet'}</span>
          </div>
        </div>
        <div className="workspace-actions">
          <button className="icon-button reload-button" disabled={sourceBusy} aria-label="Bibliothek neu laden" title="Bibliothek neu laden"
            onClick={() => void open(source?.kind !== 'Demo' ? source?.path ?? undefined : undefined)}><RefreshCw size={16} className={sourceBusy ? 'spin' : ''} /></button>
          <div className="source-picker">
            <button className="button source-button" disabled={sourceBusy} aria-expanded={sourceMenu}
              onClick={() => setSourceMenu(!sourceMenu)}><FolderOpen size={15} /> Datenquelle <ChevronDown size={13} /></button>
            {sourceMenu && <div className="source-menu" onKeyDown={(event) => { if (event.key === 'Escape') setSourceMenu(false) }}>
              <button onClick={() => void choose(false)}><Database size={15} /> Datenbankdatei öffnen</button>
              <button onClick={() => void choose(true)}><Folder size={15} /> Ordner öffnen</button>
              <button onClick={() => void open(undefined, false, true)}><Disc3 size={15} /> Testbibliothek öffnen</button>
            </div>}
          </div>
        </div>
      </div>
      {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="Hinweis schließen" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {view === 'library' ? <>
        <div className="radar panel">
          <div className="radar-icon"><AudioLines size={22} /></div>
          <div className="radar-title"><div><span className={`signal-dot ${hardware ? 'online' : ''}`} />
            {auto ? 'Auto-Follow' : reference ? 'Referenz' : live?.state === 'rekordbox' && anchor ? `Rekordbox · Deck ${anchor.deck}` : 'Deck-Radar'}</div>
            <strong title={displayed ? `${displayed.artist} · ${displayed.title}` : ''}>{displayed ? displayed.title : 'Kein Deck verbunden'}</strong>
            {displayed?.artist && <span className="radar-artist">{displayed.artist}</span>}
          </div>
          <div className="radar-metrics">
            <span><small>TONART</small><KeyBadge value={displayed?.key ?? null} /></span>
            <span><small>BPM</small><strong className="mono">{bpmText(displayed?.bpm ?? null)}</strong></span>
          </div>
          <div className="radar-actions">
            <label className="tolerance mono" title="BPM-Toleranz in Prozent">± <input type="number" aria-label="BPM-Toleranz in Prozent"
              min="0.1" max="30" step="0.1" value={liveOptions.tolerance}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                if (Number.isFinite(value) && value >= 0.1 && value <= 30) setLiveOptions({ ...liveOptions, tolerance: value })
              }} />%</label>
            <button className="button auto-button" aria-pressed={auto} onClick={() => { setAuto(!auto); setMatching(false); setMatchError('') }}>
              <span className="switch-dot" /> Auto-Follow
            </button>
            <button className="button primary-button live-match-button" onClick={startMatch}><Crosshair size={16} /> Live Match</button>
          </div>
        </div>
        {matchError && <div className="notice">{matchError}<button className="icon-button" aria-label="Hinweis schließen" onClick={() => setMatchError('')}><X size={14} /></button></div>}
        <div className="genre-bar" aria-label="Häufigste Genres">
          <span className="genre-bar-label">Genres</span>
          {genres.slice(0, quickMore ? 13 : 5).map(({ value, count: total }) => <button className="quick-genre" key={value}
            aria-pressed={filters.genres.includes(value)} onClick={() => changeFilters({
              genres: filters.genres.includes(value) ? filters.genres.filter((item) => item !== value) : [...filters.genres, value],
            })}><span>{value}</span><small className="mono">{count(total)}</small></button>)}
          {genres.length > 5 && <button className="text-button genre-more" onClick={() => setQuickMore(!quickMore)}>
            {quickMore ? <Minus size={13} /> : <Plus size={13} />} {quickMore ? 'Weniger' : 'Mehr'}
          </button>}
        </div>
        <Pipeline filters={chips} sorts={effectiveSorts}
          addRule={(rule) => setRules((current) => [...current, rule])} orderFilters={setFilterOrder} setSorts={setSorts} />
        {source ? <div className="library-grid">
          <FilterPanel filters={filters} results={results} source={source} onChange={changeFilters} onReset={reset} />
          <TrackTable data={results?.rows ?? noTracks} sorting={effectiveSorts} onSort={setSorts}
            selected={selected} onSelect={setSelected} search={filters.search} onSearch={(search) => changeFilters({ search })}
            busy={sourceBusy || queryBusy} onReset={reset} revision={payload} visible={visible} onVisible={setVisible}
            reference={active?.key ?? null} onReference={setTrackReference} />
          <TrackDetail track={detail} pending={!!selected} onMatch={(track) => {
            setTrackReference(track, true)
            setFilters(emptyFilters)
            setRules([])
          }} />
        </div> : <div className="panel no-source">
          <Empty title={sourceBusy ? 'Rekordbox-Bibliothek wird gelesen' : 'Rekordbox-Bibliothek öffnen'}>
            {!sourceBusy && <button className="button primary-button" onClick={() => void choose(true)}><FolderOpen size={16} /> Ordner wählen</button>}
          </Empty>
        </div>}
      </> : <LivePanel source={source} status={live} refresh={() => setLiveRevision((value) => value + 1)}
        onSelectTrack={(id) => { reset(); setView('library'); setSelected(id) }}
        options={liveOptions} onOptions={(changes) => setLiveOptions((options) => ({ ...options, ...changes }))} />}
      <footer className="status-bar">
        <span><span className={`signal-dot ${source ? 'online' : ''}`} />
          {source ? `${source.kind === 'Demo' ? 'Testbibliothek' : basename(source.path)} · ${count(source.total)} Tracks` : 'Rekordbox'}</span>
        <span>{view === 'library' && results ? <><span className="mono">{count(results.rows.length)} Treffer</span><i /> <span className="mono">{results.ms.toFixed(1)} ms SQL</span></> : null}</span>
      </footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)

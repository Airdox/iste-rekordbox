import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Crosshair, Disc3, Search, X } from 'lucide-react'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type Cell, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { bpmText, count, duration, relatedKeys, type Track } from './api'
import { Empty, KeyBadge, Stars } from './components'
import { defaultColumns, fields, type Field, type MetadataId } from './metadata'

const column = createColumnHelper<Track>()
const rowHeight = 40
const headerHeight = 37
const statusLabels = { exact: 'Gleiche Tonart', compatible: 'Harmonisch kompatibel', distant: 'Andere Tonart', none: '' }
type MatchState = keyof typeof statusLabels
function heat(bpm: number) {
  const value = Math.max(0, Math.min(1, (bpm - 60) / 120))
  const hue = value < 0.55 ? 218 - value * 192 : value < 0.8 ? 112 - (value - 0.55) * 302 : 37 + (value - 0.8) * 1185
  return `hsl(${hue} 79% 72%)`
}
function renderField(field: Field, track: Track) {
  const value = track[field.id]
  if (field.id === 'key') return <KeyBadge value={track.key} />
  if (field.id === 'bpm') return <span className="mono bpm-cell" style={{ color: track.bpm ? heat(track.bpm) : undefined }}>{bpmText(track.bpm)}</span>
  if (field.id === 'rating') return <Stars value={track.rating} />
  if (field.id === 'seconds') return <span className="mono muted">{duration(track.seconds)}</span>
  if (field.id === 'year') return <span className="mono muted">{track.year || '—'}</span>
  if (field.id === 'genre') return <span className="genre-tag" title={track.genre}>{track.genre || '—'}</span>
  if (field.type === 'number') return <span className="mono muted">{value == null ? '—' : count(Number(value))}</span>
  return <span className={field.id === 'title' ? 'title-cell' : 'text-cell'} title={String(value ?? '')}>{value || (field.id === 'title' ? 'Ohne Titel' : '—')}</span>
}

const columns = [
  column.display({ id: 'index', header: '#', cell: ({ row }) => <span className="mono muted">{row.index + 1}</span> }),
  column.display({ id: 'status', header: 'Match' }),
  ...fields.map((field) => column.accessor(field.id, {
    header: field.label, cell: ({ row }) => renderField(field, row.original),
  })),
]

const TrackRow = memo(function TrackRow({ track, cells, index, start, selected, match, select, context }: {
  track: Track; cells: Cell<Track, unknown>[]; index: number; start: number; selected: boolean; match: MatchState
  select: (id: string) => void; context: (event: MouseEvent, track: Track) => void
}) {
  return <div role="row" aria-rowindex={index + 2} aria-selected={selected}
    className="track-row track-grid" data-track-id={track.id} data-match={match}
    style={{ transform: `translateY(${start}px)` }}
    onClick={() => select(track.id)} onContextMenu={(event) => context(event, track)}>
    {cells.map((cell) => <div role="gridcell" className={`table-cell cell-${cell.column.id}`} key={cell.id}>
      {cell.column.id === 'status'
        ? <span className="match-dot" title={statusLabels[match]} aria-label={statusLabels[match]} />
        : flexRender(cell.column.columnDef.cell, cell.getContext())}
    </div>)}
  </div>
})

export function TrackTable({ data, sorting, onSort, selected, onSelect, search, onSearch, busy, onReset, revision, visible, onVisible, reference, onReference }: {
  data: Track[]; sorting: SortingState; onSort: (value: SortingState) => void
  selected: string | null; onSelect: (value: string) => void
  search: string; onSearch: (value: string) => void; busy: boolean; onReset: () => void; revision: string
  visible: MetadataId[]; onVisible: (value: MetadataId[]) => void
  reference: string | null; onReference: (track: Track) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; track?: Track } | null>(null)
  const shown = fields.filter((field) => visible.includes(field.id))
  const widths = shown.map((field) => 'flex' in field ? `minmax(${field.width}px,${field.flex}fr)` : `${field.width}px`)
  if (!shown.some((field) => 'flex' in field) && shown.length) {
    widths[widths.length - 1] = `minmax(${shown[shown.length - 1].width}px, 1fr)`
  }
  const gridStyle = {
    '--track-columns': ['45px', '49px', ...widths].join(' '),
    '--track-min-width': `${94 + shown.reduce((total, field) => total + field.width, 0)}px`,
  } as CSSProperties
  const related = reference ? relatedKeys(reference) : []
  const table = useReactTable({
    data, columns, state: { sorting, columnVisibility: Object.fromEntries(fields.map(({ id }) => [id, visible.includes(id)])) },
    manualSorting: true, enableSortingRemoval: false, isMultiSortEvent: () => true,
    getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id,
    onSortingChange: (change) => onSort(typeof change === 'function' ? change(sorting) : change),
  })
  const { rows } = table.getRowModel()
  const virtual = useVirtualizer({
    count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => rowHeight,
    overscan: 8, scrollMargin: headerHeight, useFlushSync: false,
  })
  const selectRow = useCallback((id: string) => {
    onSelect(id)
    scroll.current?.focus({ preventScroll: true })
  }, [onSelect])
  const openRowMenu = useCallback((event: MouseEvent, track: Track) => {
    event.preventDefault()
    onSelect(track.id)
    setMenu({ x: event.clientX, y: event.clientY, track })
  }, [onSelect])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 }, [revision])
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = rows.findIndex((row) => row.id === selected)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    onSelect(rows[next].id)
    virtual.scrollToIndex(next, { align: 'auto' })
  }
  return <section className="panel table-panel" aria-label="Trackliste" aria-busy={busy}>
    <div className="table-toolbar">
      <div className="heading-icon"><Disc3 size={16} /><h2>Tracks</h2><span className="counter-pill mono">{count(data.length)}</span></div>
      <div className="table-actions"><div className="search-box">
        <Search size={15} /><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)}
          aria-label="Tracks suchen" placeholder="Tracks suchen…" />
        {search
          ? <button className="icon-button" aria-label="Suche leeren" onClick={() => onSearch('')}><X size={14} /></button>
          : <kbd>Strg F</kbd>}
      </div><button className="icon-button column-button" aria-label="Spalten" title="Spalten ein- und ausblenden"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.right - 213, y: rect.bottom + 5 })
        }}><Columns3 size={16} /></button></div>
    </div>
    <div className="table-scroll" ref={scroll} tabIndex={0} onKeyDown={navigate} aria-label="Virtualisierte Trackliste">
      <div className="tracks" role="grid" style={gridStyle} aria-rowcount={rows.length + 1} aria-colcount={shown.length + 2}>
        <div className="track-header track-grid" role="row" onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}>
          {table.getFlatHeaders().map(({ id, column, getContext }) => {
            const sort = column.getIsSorted()
            const Icon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ArrowUpDown
            return <div className={`table-cell cell-${id}`} key={id} role="columnheader"
              aria-sort={sorting[0]?.id === id ? sort === 'asc' ? 'ascending' : 'descending' : undefined} data-sorted={!!sort}>
              {column.getCanSort()
                ? <button className={sort ? 'sorted' : ''} onClick={column.getToggleSortingHandler()}>
                  {flexRender(column.columnDef.header, getContext())}<Icon size={11} />
                </button>
                : flexRender(column.columnDef.header, getContext())}
            </div>
          })}
        </div>
        {!!rows.length && <div className="track-body" role="rowgroup" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]
            const key = row.original.key
            const match = !reference ? 'none' : key === reference ? 'exact' : key && related.includes(key) ? 'compatible' : 'distant'
            return <TrackRow key={row.id} track={row.original} cells={row.getVisibleCells()}
              index={item.index} start={item.start - headerHeight} selected={row.id === selected}
              match={match} select={selectRow} context={openRowMenu} />
          })}
        </div>}
      </div>
      {!rows.length && <Empty icon={<Search size={25} />} title={busy ? 'Tracks werden geladen' : 'Keine Treffer'}>
        {!busy && <button className="button" onClick={onReset}>Filter zurücksetzen</button>}
      </Empty>}
    </div>
    {menu && <div className="context-backdrop" onPointerDown={() => setMenu(null)}>
      <div className="context-menu" style={{ left: Math.max(10, Math.min(menu.x, window.innerWidth - 230)),
        top: Math.max(10, Math.min(menu.y, window.innerHeight - (menu.track ? 69 : 450))) }}
        onPointerDown={(event) => event.stopPropagation()}>
        {menu.track ? <button className="context-action" onClick={() => {
          if (menu.track) onReference(menu.track)
          setMenu(null)
        }}><Crosshair size={15} /> Als Referenz setzen</button> : <>
          <strong>Sichtbare Spalten</strong>
          <div className="context-columns">
            {fields.map((field) => <label key={field.id}>
              <input type="checkbox" checked={visible.includes(field.id)}
                disabled={visible.length === 1 && visible.includes(field.id)}
                onChange={() => onVisible(visible.includes(field.id)
                  ? visible.filter((id) => id !== field.id) : [...visible, field.id])} />
              {field.label}
            </label>)}
          </div>
          <button className="context-action" onClick={() => onVisible(defaultColumns)}>Standardlayout</button>
        </>}
      </div>
    </div>}
  </section>
}

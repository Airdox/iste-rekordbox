import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type Cell, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { bpmText, count, duration, relatedKeys, type Track } from './api'
import { Empty, KeyBadge, MiniWave, Stars } from './components'
import { defaultColumns, fields, type Field, type MetadataId } from './metadata'

const columnHelper = createColumnHelper<Track>()
const rowHeight = 40
const headerHeight = 33

type MatchState = 'exact' | 'compatible' | 'distant' | 'none'

function renderField(field: Field, track: Track, reference: string | null) {
  const value = track[field.id]
  if (field.id === 'key') return <KeyBadge value={track.key} reference={reference} />
  if (field.id === 'bpm') return <span className="num">{bpmText(track.bpm)}</span>
  if (field.id === 'rating') return <Stars value={track.rating} />
  if (field.id === 'seconds') return <span className="num">{duration(track.seconds)}</span>
  if (field.id === 'year') return <span className="num">{track.year || '—'}</span>
  if (field.id === 'title') return <span className="title-ellipsis" title={track.title}>{track.title || 'Ohne Titel'}</span>
  if (field.id === 'artist') return <span className="tartist title-ellipsis" title={track.artist}>{track.artist || '—'}</span>
  if (field.type === 'number') return <span className="num">{value == null ? '—' : count(Number(value))}</span>
  return <span className="title-ellipsis" title={String(value ?? '')}>{value || '—'}</span>
}

const TrackRow = memo(function TrackRow({
  track,
  cells,
  index,
  start,
  selected,
  match,
  inSet,
  onSelect,
  onContext,
  onAdd,
}: {
  track: Track
  cells: Cell<Track, unknown>[]
  index: number
  start: number
  selected: boolean
  match: MatchState
  inSet: boolean
  onSelect: (track: Track) => void
  onContext: (event: MouseEvent, track: Track) => void
  onAdd: (track: Track) => void
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={`track-row track-grid ${index % 2 === 1 ? 'even' : ''} ${selected ? 'selected' : ''}`}
      data-track-id={track.id}
      data-match={match}
      style={{ transform: `translateY(${start}px)` }}
      onClick={() => onSelect(track)}
      onContextMenu={(event) => onContext(event, track)}
    >
      {cells.map((cell) => {
        const colId = cell.column.id
        return (
          <div role="gridcell" className={`td-cell cell-${colId}`} key={cell.id}>
            {colId === 'index' ? <span className="num">{index + 1}</span>
              : colId === 'wave' ? <MiniWave trackId={track.id} />
              : colId === 'action' ? (
                <button
                  type="button"
                  className={`sm in-set-btn ${inSet ? 'is-in-set' : ''}`}
                  title={inSet ? 'Bereits im Set' : 'Zum Set hinzufügen'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAdd(track)
                  }}
                >
                  {inSet ? '✓ Set' : '+ Set'}
                </button>
              )
              : flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        )
      })}
    </div>
  )
})

export function TrackTable({
  data,
  sorting,
  onSort,
  selected,
  onSelect,
  busy,
  revision,
  visible,
  onVisible,
  reference,
  onPinReference,
  onAddToSet,
  onFindRekordbox,
  setIds,
  emptyTitle,
  emptyActionLabel,
  onEmptyAction,
}: {
  data: Track[]
  sorting: SortingState
  onSort?: (value: SortingState) => void
  selected: string | null
  onSelect: (track: Track) => void
  busy: boolean
  revision: string
  visible: MetadataId[]
  onVisible: (value: MetadataId[]) => void
  reference: string | null
  onPinReference: (track: Track) => void
  onAddToSet: (track: Track) => void
  onFindRekordbox: (track: Track) => void
  setIds: Set<string>
  emptyTitle: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; track?: Track } | null>(null)
  const related = useMemo(() => (reference ? relatedKeys(reference) : []), [reference])

  const columns = useMemo(() => {
    const beforeWave: MetadataId[] = ['title', 'artist']
    const firstCols = fields.filter((f) => beforeWave.includes(f.id))
    const restCols = fields.filter((f) => !beforeWave.includes(f.id))
    const mkCol = (field: Field) => columnHelper.accessor(field.id, {
      header: 'shortLabel' in field ? field.shortLabel : field.label,
      cell: ({ row }) => renderField(field, row.original, reference),
      enableSorting: Boolean(onSort),
    })
    return [
      columnHelper.display({ id: 'index', header: 'Nr.' }),
      ...firstCols.map(mkCol),
      columnHelper.display({ id: 'wave', header: 'Wave' }),
      ...restCols.map(mkCol),
      columnHelper.display({ id: 'action', header: '' }),
    ]
  }, [reference, onSort])

  const columnVisibility = useMemo(
    () => Object.fromEntries(fields.map(({ id }) => [id, visible.includes(id)])),
    [visible],
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    manualSorting: true,
    enableSortingRemoval: false,
    isMultiSortEvent: () => true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onSortingChange: (change) => onSort?.(typeof change === 'function' ? change(sorting) : change),
  })

  const { rows } = table.getRowModel()
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    scrollMargin: headerHeight,
    useFlushSync: false,
  })

  const shownFields = useMemo(() => fields.filter((field) => visible.includes(field.id)), [visible])
  const gridStyle = useMemo(() => {
    const before = shownFields.filter((f) => f.id === 'title' || f.id === 'artist')
    const after = shownFields.filter((f) => f.id !== 'title' && f.id !== 'artist')
    const fmt = (f: Field) => ('flex' in f ? `minmax(${f.width}px,${f.flex}fr)` : `${f.width}px`)
    const widths = ['36px', ...before.map(fmt), '74px', ...after.map(fmt), '58px']
    const minW = 36 + 74 + 58 + shownFields.reduce((sum, f) => sum + f.width, 0)
    return {
      '--track-columns': widths.join(' '),
      '--track-min-width': `${minW}px`,
    } as CSSProperties
  }, [shownFields])

  const selectRow = useCallback((track: Track) => {
    onSelect(track)
    scroll.current?.focus({ preventScroll: true })
  }, [onSelect])

  const openRowMenu = useCallback((event: MouseEvent, track: Track) => {
    event.preventDefault()
    onSelect(track)
    setMenu({ x: event.clientX, y: event.clientY, track })
  }, [onSelect])

  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 }, [revision])
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = rows.findIndex((row) => row.id === selected)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    onSelect(rows[next].original)
    virtual.scrollToIndex(next, { align: 'auto' })
  }

  return (
    <div className="tablebox" ref={scroll} tabIndex={0} onKeyDown={navigate}
      aria-label="Virtualisierte Trackliste" aria-busy={busy}>
      <div className="tracks" role="grid" style={gridStyle}
        aria-rowcount={rows.length + 1} aria-colcount={shownFields.length + 3}>
        <div className="track-header track-grid" role="row" onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}>
          {table.getFlatHeaders().map(({ id, column, getContext }) => {
            const sort = column.getIsSorted()
            const Icon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : null
            return (
              <div className={`th-cell cell-${id}`} key={id} role="columnheader"
                aria-sort={sorting[0]?.id === id ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}
                data-sorted={!!sort}>
                {column.getCanSort() ? (
                  <button type="button" className={`th-sort ${sort ? 'sorted' : ''}`}
                    title={`Nach ${flexRender(column.columnDef.header, getContext())} sortieren (Klick: Richtung wechseln · Rechtsklick auf Kopfzeile: Spalten konfigurieren)`}
                    onClick={column.getToggleSortingHandler()}>
                    <span>{flexRender(column.columnDef.header, getContext())}</span>
                    {Icon && <Icon size={11} />}
                  </button>
                ) : flexRender(column.columnDef.header, getContext())}
              </div>
            )
          })}
        </div>
        {rows.length > 0 && (
          <div className="track-body" role="rowgroup" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]
              const key = row.original.key
              const match: MatchState = !reference ? 'none' : key === reference ? 'exact'
                : key && related.includes(key) ? 'compatible' : 'distant'
              return (
                <TrackRow
                  key={row.id}
                  track={row.original}
                  cells={row.getVisibleCells()}
                  index={item.index}
                  start={item.start - headerHeight}
                  selected={row.id === selected}
                  match={match}
                  inSet={setIds.has(row.id)}
                  onSelect={selectRow}
                  onContext={openRowMenu}
                  onAdd={onAddToSet}
                />
              )
            })}
          </div>
        )}
      </div>
      {!rows.length && (
        <Empty title={busy ? 'Tracks werden geladen…' : emptyTitle}>
          {!busy && onEmptyAction && emptyActionLabel && (
            <button type="button" className="primary sm" style={{ marginTop: 10 }} onClick={onEmptyAction}>
              {emptyActionLabel}
            </button>
          )}
        </Empty>
      )}
      {menu && (
        <div className="context-backdrop" onPointerDown={() => setMenu(null)}>
          <div className="context-menu" style={{
            left: Math.max(10, Math.min(menu.x, window.innerWidth - 236)),
            top: Math.max(10, Math.min(menu.y, window.innerHeight - (menu.track ? 140 : 450))),
          }} onPointerDown={(event) => event.stopPropagation()}>
            {menu.track ? (
              <>
                <button type="button" className="context-action" onClick={() => {
                  if (menu.track) onPinReference(menu.track)
                  setMenu(null)
                }}>⌖ Als Referenz setzen</button>
                <button type="button" className="context-action" onClick={() => {
                  if (menu.track) onAddToSet(menu.track)
                  setMenu(null)
                }}>+ Zum Set hinzufügen</button>
                <button type="button" className="context-action" onClick={() => {
                  if (menu.track) onFindRekordbox(menu.track)
                  setMenu(null)
                }}>↗ In Rekordbox finden</button>
              </>
            ) : (
              <>
                <strong>Sichtbare Spalten</strong>
                <div className="context-columns">
                  {fields.map((field) => (
                    <label key={field.id}>
                      <input type="checkbox" checked={visible.includes(field.id)}
                        disabled={visible.length === 1 && visible.includes(field.id)}
                        onChange={() => onVisible(visible.includes(field.id)
                          ? visible.filter((id) => id !== field.id)
                          : [...visible, field.id])} />
                      {field.label}
                    </label>
                  ))}
                </div>
                <button type="button" className="context-action" onClick={() => { onVisible(defaultColumns); setMenu(null) }}>
                  Standardlayout
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

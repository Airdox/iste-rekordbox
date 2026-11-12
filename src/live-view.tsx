import { SortingState } from '@tanstack/react-table'
import { Deck, Results, Track, bpmText, count, duration, relatedKeys } from './api'
import { CamelotWheel } from './camelot-wheel'
import { KeyBadge } from './components'
import { MetadataId } from './metadata'
import { TrackTable } from './track-table'

export type LiveSortCode =
  | 'bpmasc'
  | 'bpmdesc'
  | 'rating'
  | 'yearnew'
  | 'yearold'
  | 'artist'
  | 'key'
  | 'playcount'

const liveSortOptions: { value: LiveSortCode; label: string }[] = [
  { value: 'bpmasc', label: 'BPM ↑' },
  { value: 'bpmdesc', label: 'BPM ↓' },
  { value: 'rating', label: 'Bewertung ↓' },
  { value: 'yearnew', label: 'Jahr ↓' },
  { value: 'yearold', label: 'Jahr ↑' },
  { value: 'artist', label: 'Interpret A–Z' },
  { value: 'key', label: 'Camelot A–Z' },
  { value: 'playcount', label: 'Playcount ↑' },
]

export function liveSortToCascade(code: LiveSortCode) {
  switch (code) {
    case 'bpmdesc':
      return [{ field: 'bpm' as const, dir: 'desc' as const }]
    case 'rating':
      return [{ field: 'rating' as const, dir: 'desc' as const }]
    case 'yearnew':
      return [{ field: 'year' as const, dir: 'desc' as const }]
    case 'yearold':
      return [{ field: 'year' as const, dir: 'asc' as const }]
    case 'artist':
      return [{ field: 'artist' as const, dir: 'asc' as const }]
    case 'key':
      return [{ field: 'key' as const, dir: 'asc' as const }]
    case 'playcount':
      return [{ field: 'plays' as const, dir: 'asc' as const }]
    case 'bpmasc':
    default:
      return [{ field: 'bpm' as const, dir: 'asc' as const }]
  }
}

type LiveViewProps = {
  active: boolean
  liveTrack: Deck | null
  referenceKey: string
  pinned: boolean
  selectedKeys: string[]
  autoFollow: boolean
  includeCurrent: boolean
  onToggleKey: (key: string, additive: boolean) => void
  onSelectAllHarmonic: () => void
  onAutoFollowChange: (checked: boolean) => void
  onIncludeCurrentChange: (checked: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  sortCode: LiveSortCode
  onSortCodeChange: (code: LiveSortCode) => void
  useBpm: boolean
  onUseBpmChange: (checked: boolean) => void
  tolerance: number
  onToleranceChange: (value: number) => void
  sameGenre: boolean
  onSameGenreChange: (checked: boolean) => void
  unplayedOnly: boolean
  onUnplayedOnlyChange: (checked: boolean) => void
  minRating: number
  onMinRatingChange: (value: number) => void
  results: Results | null
  busy: boolean
  revision: number
  visibleColumns: MetadataId[]
  onVisibleColumnsChange: (columns: MetadataId[]) => void
  selectedTrack: Track | null
  onSelectTrack: (track: Track) => void
  onAddToSet: (track: Track) => void
  onPinAsReference: (track: Track) => void
  onFindRekordbox: (track: Track) => void
  setIds: Set<string>
  setCount: number
  onGoFilterStudio: () => void
  onGoSetBuilder: () => void
  onOpenHardware: () => void
  liveStateText: string
}

export function LiveView({
  active,
  liveTrack,
  referenceKey,
  pinned,
  selectedKeys,
  autoFollow,
  includeCurrent,
  onToggleKey,
  onSelectAllHarmonic,
  onAutoFollowChange,
  onIncludeCurrentChange,
  search,
  onSearchChange,
  sortCode,
  onSortCodeChange,
  useBpm,
  onUseBpmChange,
  tolerance,
  onToleranceChange,
  sameGenre,
  onSameGenreChange,
  unplayedOnly,
  onUnplayedOnlyChange,
  minRating,
  onMinRatingChange,
  results,
  busy,
  revision,
  visibleColumns,
  onVisibleColumnsChange,
  selectedTrack,
  onSelectTrack,
  onAddToSet,
  onPinAsReference,
  onFindRekordbox,
  setIds,
  setCount,
  onGoFilterStudio,
  onGoSetBuilder,
  onOpenHardware,
  liveStateText,
}: LiveViewProps) {
  const rows = results?.rows ?? []
  const effectiveKeys = includeCurrent
    ? selectedKeys
    : selectedKeys.filter((k) => k !== referenceKey)
  const neighbors = relatedKeys(referenceKey)
  const isAllHarmonic =
    neighbors.every((k) => selectedKeys.includes(k)) && selectedKeys.length === neighbors.length

  const tableSorting: SortingState = (() => {
    const first = liveSortToCascade(sortCode)[0]
    return first ? [{ id: first.field, desc: first.dir === 'desc' }] : []
  })()

  const handleHeaderSort = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof updater === 'function' ? updater(tableSorting) : updater
    if (!next.length) return
    const { id, desc } = next[0]
    if (id === 'bpm') onSortCodeChange(desc ? 'bpmdesc' : 'bpmasc')
    else if (id === 'rating') onSortCodeChange('rating')
    else if (id === 'year') onSortCodeChange(desc ? 'yearnew' : 'yearold')
    else if (id === 'artist') onSortCodeChange('artist')
    else if (id === 'key') onSortCodeChange('key')
    else if (id === 'plays') onSortCodeChange('playcount')
  }

  return (
    <section
      className={`view liveview ${active ? 'active' : ''}`}
      id="view-live"
      aria-label="Live-Match"
    >
      <div className="pane">
        <div className="panehead">
          <h2>Harmonischer Kompass</h2>
          <span className="aside">Camelot 24 Keys</span>
        </div>
        <div className="panebody">
          <CamelotWheel
            referenceKey={referenceKey}
            pinned={pinned}
            selectedKeys={selectedKeys}
            autoFollow={autoFollow}
            includeCurrent={includeCurrent}
            onToggleKey={onToggleKey}
            onSelectAllHarmonic={onSelectAllHarmonic}
            onAutoFollowChange={onAutoFollowChange}
            onIncludeCurrentChange={onIncludeCurrentChange}
          />
        </div>
      </div>

      <div className="pane resultpane">
        <div className="panehead">
          <h2>Passende Tracks zum laufenden Titel</h2>
          <span className="aside" id="liveHeadingCount">
            {results
              ? `${count(results.counts[0])} Treffer · ${results.ms.toFixed(1)} ms`
              : 'Lade …'}
          </span>
        </div>

        <div className="resultsbar">
          <div className="searchbox">
            <span className="magnify">⌕</span>
            <input
              id="liveSearch"
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="In Treffern suchen: Titel, Interpret, Album, Kommentar ..."
              aria-label="Live-Treffer durchsuchen"
            />
          </div>
          <select
            id="liveSort"
            aria-label="Sortierung Live-Match"
            value={sortCode}
            onChange={(e) => onSortCodeChange(e.target.value as LiveSortCode)}
          >
            {liveSortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="results-sub" id="liveFilterSummary">
          <span className="filterbadge">♬ Referenz: {referenceKey || '–'}</span>
          <span className="filterbadge">
            Key:{' '}
            {isAllHarmonic
              ? `Alle harmonischen Keys (${effectiveKeys.join(', ')})`
              : effectiveKeys.length
                ? effectiveKeys.join(', ')
                : 'keine'}
          </span>
          {useBpm && <span className="filterbadge">BPM: ±{tolerance} %</span>}
          {sameGenre && liveTrack?.genre && (
            <span className="filterbadge">Genre: {liveTrack.genre}</span>
          )}
          {unplayedOnly && <span className="filterbadge">Selten gespielt ≤ 2</span>}
          {minRating > 0 && <span className="filterbadge">Rating ≥ {minRating} ★</span>}
          {search.trim() && <span className="filterbadge">Suche: „{search.trim()}“</span>}
          {!useBpm && !sameGenre && !unplayedOnly && !minRating && !search.trim() && (
            <span className="muted" style={{ fontSize: 11 }}>
              Ohne zusätzliche Einschränkung
            </span>
          )}
        </div>

        <TrackTable
          data={rows}
          sorting={tableSorting}
          onSort={handleHeaderSort}
          selected={selectedTrack?.id ?? null}
          onSelect={onSelectTrack}
          busy={busy}
          revision={String(revision)}
          visible={visibleColumns}
          onVisible={onVisibleColumnsChange}
          reference={referenceKey}
          onPinReference={onPinAsReference}
          onAddToSet={onAddToSet}
          onFindRekordbox={onFindRekordbox}
          setIds={setIds}
          emptyTitle="Keine passenden Tracks für diese Kombination."
          emptyActionLabel={
            effectiveKeys.length === 0 ? 'Alle harmonischen Keys wählen' : undefined
          }
          onEmptyAction={effectiveKeys.length === 0 ? onSelectAllHarmonic : undefined}
        />

        <div className="tablefooter">
          <span id="liveStatus">
            Treffer nach {pinned ? 'fixierter Referenz' : 'Live-Referenz'}
          </span>
          <span>Zeile wählen → Details · „+ Set“ → Setliste</span>
        </div>
      </div>

      <div className="pane">
        <div className="panehead">
          <h2>Live-Filter &amp; Auswahl</h2>
          <button
            className="sm ghost"
            id="openHardwarePaneBtn"
            onClick={onOpenHardware}
            title="Pro DJ Link, Decks & USB konfigurieren"
          >
            Link
          </button>
        </div>

        <div className="panebody live-quick">
          <div className="kicker">Zusätzliche Einschränkungen</div>

          <label className="checkrow">
            <input
              type="checkbox"
              id="useBpm"
              checked={useBpm}
              onChange={(e) => onUseBpmChange(e.target.checked)}
            />
            BPM-Toleranz aktivieren
          </label>

          <div className="control-line range-line">
            <div className="flex">
              <label htmlFor="bpmTolerance">BPM-Toleranz</label>
              <strong id="bpmToleranceText">±{tolerance} %</strong>
            </div>
            <input
              type="range"
              id="bpmTolerance"
              min={0}
              max={12}
              step={1}
              value={tolerance}
              onChange={(e) => onToleranceChange(Number(e.target.value))}
            />
            <div className="hint">BPM-Werte relativ zum laufenden Track</div>
          </div>

          <label className="checkrow">
            <input
              type="checkbox"
              id="sameGenre"
              checked={sameGenre}
              onChange={(e) => onSameGenreChange(e.target.checked)}
            />
            Nur identisches Genre
          </label>

          <label className="checkrow">
            <input
              type="checkbox"
              id="unplayedLive"
              checked={unplayedOnly}
              onChange={(e) => onUnplayedOnlyChange(e.target.checked)}
            />
            Selten gespielt (≤ 2)
          </label>

          <div className="control-line">
            <div className="flex">
              <label htmlFor="liveRating">Mindestbewertung</label>
              <select
                id="liveRating"
                value={minRating}
                onChange={(e) => onMinRatingChange(Number(e.target.value))}
              >
                <option value={0}>Alle</option>
                <option value={3}>3 ★</option>
                <option value={4}>4 ★</option>
                <option value={5}>5 ★</option>
              </select>
            </div>
          </div>

          <div className="sep" />
          <div className="kicker">Ausgewählter Titel</div>
          <div id="liveInspector">
            {selectedTrack ? (
              <div className="trackinspect">
                <div className="title">{selectedTrack.title}</div>
                <div className="meta">
                  {selectedTrack.artist || 'Unbekannt'} · {selectedTrack.year ?? '–'}
                </div>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{bpmText(selectedTrack.bpm)} BPM</span>
                  <KeyBadge value={selectedTrack.key} reference={referenceKey} />
                  <span>
                    {selectedTrack.genre || '–'} · {duration(selectedTrack.seconds)}
                  </span>
                </div>
                <div className="btnrow">
                  <button
                    className="primary sm"
                    onClick={() => onAddToSet(selectedTrack)}
                  >
                    + Set
                  </button>
                  <button
                    className="sm"
                    onClick={() => onFindRekordbox(selectedTrack)}
                  >
                    In Rekordbox
                  </button>
                </div>
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 8 }}>
                Klicke einen Track in der Tabelle.
              </div>
            )}
          </div>
        </div>

        <div className="panefoot">
          <button
            className="w100 sm"
            style={{ marginBottom: 7 }}
            id="hardwareConfigBtn"
            onClick={onOpenHardware}
          >
            ◈ &nbsp; {liveStateText}
          </button>
          <button className="w100" id="toFilterStudio" onClick={onGoFilterStudio}>
            ☷ &nbsp; Eigene Filter unabhängig verwenden
          </button>
          <button className="w100 queueaction" id="toSetBuilder" onClick={onGoSetBuilder}>
            ▤ &nbsp; Setliste öffnen <span id="queueMiniCount">({setCount})</span>
          </button>
        </div>
      </div>
    </section>
  )
}

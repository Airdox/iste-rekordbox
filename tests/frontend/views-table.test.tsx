import { fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type LiveStatus, type Results, type Track } from '../../src/api'
import { FilterView } from '../../src/filter-view'
import { HardwareModal } from '../../src/hardware-modal'
import { LiveView, liveSortToCascade } from '../../src/live-view'
import { builtInPresets, defaultColumns, type MetadataId, type RuleGroup } from '../../src/metadata'
import { SetView } from '../../src/set-view'
import { TrackTable } from '../../src/track-table'

const sampleTracks: Track[] = [
  {
    id: 't1',
    title: 'Midnight Pulse',
    artist: 'Klangwerk',
    genre: 'Techno',
    bpm: 138,
    key: '8A',
    rating: 5,
    seconds: 340,
    year: 2024,
    album: 'Vault 1',
    label: 'Rhythm',
    comment: 'Peak hour',
    plays: 1,
    bitrate: 320,
    path: 'E:/Music/midnight.mp3',
    added: '2025-01-10',
    created: '2024-05-01',
    sample_rate: 44100,
    bytes: 12000000,
  },
  {
    id: 't2',
    title: 'Solar Drift',
    artist: 'Noire',
    genre: 'Hardgroove',
    bpm: 139,
    key: '9A',
    rating: 4,
    seconds: 310,
    year: 2023,
    plays: 0,
  },
  {
    id: 't3',
    title: '',
    artist: '',
    genre: '',
    bpm: null,
    key: null,
    rating: 0,
    seconds: null,
    year: null,
  },
]

const sampleResults: Results = {
  rows: sampleTracks,
  counts: [1, 1, 1, 0],
  genres: [
    { value: 'Techno', count: 10 },
    { value: 'Hardgroove', count: 5 },
  ],
  keys: [{ value: '8A', count: 8 }],
  histogram: [{ bpm: 138, count: 12 }],
  ms: 4.2,
}

describe('TrackTable', () => {
  it('renders rows, handles sorting, selection, header & row context menus, column picker and keyboard navigation', () => {
    const onSort = vi.fn()
    const onSelect = vi.fn()
    const onVisible = vi.fn()
    const onAddToSet = vi.fn()
    const onPinReference = vi.fn()
    const onFindRekordbox = vi.fn()
    const onRekordboxAction = vi.fn()
    const onEmptyAction = vi.fn()

    const { container, rerender } = render(
      <TrackTable
        data={sampleTracks}
        sorting={[{ id: 'bpm', desc: false }]}
        onSort={onSort}
        selected="t1"
        onSelect={onSelect}
        busy={false}
        revision="1"
        visible={defaultColumns}
        onVisible={onVisible}
        reference="8A"
        setIds={new Set(['t1'])}
        onAddToSet={onAddToSet}
        onPinReference={onPinReference}
        onFindRekordbox={onFindRekordbox}
        onRekordboxAction={onRekordboxAction}
      />,
    )

    expect(screen.getByText('Midnight Pulse')).toBeInTheDocument()
    expect(screen.getByText('Ohne Titel')).toBeInTheDocument()

    // Click row selects track
    fireEvent.click(container.querySelector('.track-row[data-track-id="t2"]')!)
    expect(onSelect).toHaveBeenCalledWith(sampleTracks[1])

    // Click + Set stops propagation & adds
    fireEvent.click(screen.getAllByRole('button', { name: '+ Set' })[0])
    expect(onAddToSet).toHaveBeenCalledWith(sampleTracks[1])

    // Sort header toggle
    fireEvent.click(screen.getByText('BPM'))
    expect(onSort).toHaveBeenCalled()

    // Header right-click -> column picker context menu
    const headerRow = container.querySelector('.track-header')!
    fireEvent.contextMenu(headerRow, { clientX: 40, clientY: 50 })
    const albumCheckbox = screen.getByLabelText('Album')
    fireEvent.click(albumCheckbox)
    expect(onVisible).toHaveBeenCalledWith([...defaultColumns, 'album'])
    const genreCheckbox = screen.getByLabelText('Genre')
    fireEvent.click(genreCheckbox)
    expect(onVisible).toHaveBeenCalledWith(defaultColumns.filter((c) => c !== 'genre'))
    fireEvent.click(screen.getByRole('button', { name: 'Standardlayout' }))
    expect(onVisible).toHaveBeenCalledWith(defaultColumns)
    fireEvent.keyDown(window, { key: 'Escape' })

    // Row right-click context menu: pin, rekordbox transport actions, add, details, and backdrop close
    const row2 = container.querySelector('.track-row[data-track-id="t2"]')!
    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /Als Referenz setzen/i }))
    expect(onPinReference).toHaveBeenCalledWith(sampleTracks[1])

    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /In Rekordbox anzeigen/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[1], 'reveal')

    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /In Deck A laden/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[1], 'deck1')

    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /In Deck B laden/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[1], 'deck2')

    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /Zum Set hinzufügen/i }))
    expect(onAddToSet).toHaveBeenCalledWith(sampleTracks[1])

    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /Details \/ Explorer/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[1])

    // Close context menu via backdrop
    fireEvent.contextMenu(row2, { clientX: 50, clientY: 60 })
    fireEvent.pointerDown(container.querySelector('.context-menu')!)
    fireEvent.pointerDown(container.querySelector('.context-backdrop')!)
    expect(container.querySelector('.context-menu')).toBeNull()

    // Keyboard navigation on table
    const grid = container.querySelector('.tablebox')!
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    fireEvent.keyDown(grid, { key: 'Home' })
    fireEvent.keyDown(grid, { key: 'End' })

    // Without onRekordboxAction, "In Rekordbox anzeigen" falls back to onFindRekordbox
    rerender(
      <TrackTable
        data={sampleTracks}
        sorting={[]}
        onSort={onSort}
        selected={null}
        onSelect={onSelect}
        busy={false}
        revision="1b"
        visible={defaultColumns}
        onVisible={onVisible}
        reference={null}
        setIds={new Set()}
        onAddToSet={onAddToSet}
        onPinReference={onPinReference}
        onFindRekordbox={onFindRekordbox}
      />,
    )
    fireEvent.contextMenu(container.querySelector('.track-row[data-track-id="t1"]')!, { clientX: 50, clientY: 60 })
    fireEvent.click(screen.getByRole('button', { name: /In Rekordbox anzeigen/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[0])

    // Empty state + empty action button
    rerender(
      <TrackTable
        data={[]}
        sorting={[]}
        onSort={onSort}
        selected={null}
        onSelect={onSelect}
        busy={false}
        revision="2"
        visible={defaultColumns}
        onVisible={onVisible}
        reference={null}
        setIds={new Set()}
        onAddToSet={onAddToSet}
        onPinReference={onPinReference}
        onFindRekordbox={onFindRekordbox}
        emptyTitle="Nichts gefunden"
        emptyActionLabel="Alle Keys zeigen"
        onEmptyAction={onEmptyAction}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Alle Keys zeigen' }))
    expect(onEmptyAction).toHaveBeenCalledTimes(1)
  })
})

describe('live-view.tsx', () => {
  it('maps liveSortToCascade and exercises all LiveView controls, filters, sort headers and inspector', () => {
    expect(liveSortToCascade('bpmasc')[0]).toEqual({ id: 'bpm', desc: false })
    expect(liveSortToCascade('bpmdesc')[0]).toEqual({ id: 'bpm', desc: true })
    expect(liveSortToCascade('rating')[0]).toEqual({ id: 'rating', desc: true })
    expect(liveSortToCascade('yearnew')[0]).toEqual({ id: 'year', desc: true })
    expect(liveSortToCascade('yearold')[0]).toEqual({ id: 'year', desc: false })
    expect(liveSortToCascade('artist')[0]).toEqual({ id: 'artist', desc: false })
    expect(liveSortToCascade('key')[0]).toEqual({ id: 'key', desc: false })
    expect(liveSortToCascade('playcount')[0]).toEqual({ id: 'plays', desc: false })
    expect(liveSortToCascade('title')[0]).toEqual({ id: 'title', desc: false })
    expect(liveSortToCascade('genre')[0]).toEqual({ id: 'genre', desc: false })

    const onSearchChange = vi.fn()
    const onSortCodeChange = vi.fn()
    const onUseBpmChange = vi.fn()
    const onToleranceChange = vi.fn()
    const onSameGenreChange = vi.fn()
    const onUnplayedOnlyChange = vi.fn()
    const onMinRatingChange = vi.fn()
    const onOpenHardware = vi.fn()
    const onGoFilterStudio = vi.fn()
    const onGoSetBuilder = vi.fn()
    const onAddToSet = vi.fn()
    const onFindRekordbox = vi.fn()
    const onRekordboxAction = vi.fn()

    const { container, rerender } = render(
      <LiveView
        active
        liveTrack={{
          deck: 2,
          name: 'rekordbox',
          source: 0,
          slot: 0,
          slotName: 'Rekordbox lokal',
          trackId: 't1',
          bpm: 138,
          key: '8A',
          genre: 'Techno',
          seconds: 340,
          title: 'Midnight Pulse',
          artist: 'Klangwerk',
          libraryId: 't1',
          playing: true,
          master: true,
          fader: 1,
        }}
        referenceKey="8A"
        pinned={false}
        selectedKeys={['8A', '9A']}
        autoFollow
        includeCurrent
        onToggleKey={vi.fn()}
        onSelectAllHarmonic={vi.fn()}
        onAutoFollowChange={vi.fn()}
        onIncludeCurrentChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
        sortCode="bpmasc"
        onSortCodeChange={onSortCodeChange}
        useBpm
        onUseBpmChange={onUseBpmChange}
        tolerance={4}
        onToleranceChange={onToleranceChange}
        sameGenre
        onSameGenreChange={onSameGenreChange}
        unplayedOnly
        onUnplayedOnlyChange={onUnplayedOnlyChange}
        minRating={4}
        onMinRatingChange={onMinRatingChange}
        results={sampleResults}
        busy={false}
        revision={1}
        visibleColumns={['title', 'artist', 'bpm', 'key', 'genre', 'rating', 'year', 'plays'] as MetadataId[]}
        onVisibleColumnsChange={vi.fn()}
        selectedTrack={sampleTracks[0]}
        onSelectTrack={vi.fn()}
        onAddToSet={onAddToSet}
        onPinAsReference={vi.fn()}
        onFindRekordbox={onFindRekordbox}
        onRekordboxAction={onRekordboxAction}
        setIds={new Set(['t1'])}
        setCount={1}
        onGoFilterStudio={onGoFilterStudio}
        onGoSetBuilder={onGoSetBuilder}
        onOpenHardware={onOpenHardware}
        liveStateText="Rekordbox Deck 2"
      />,
    )

    fireEvent.change(container.querySelector('#liveSearch')!, { target: { value: 'Pulse' } })
    expect(onSearchChange).toHaveBeenCalledWith('Pulse')

    fireEvent.change(container.querySelector('#liveSort')!, { target: { value: 'rating' } })
    expect(onSortCodeChange).toHaveBeenCalledWith('rating')

    // Click sortable table headers inside LiveView to exercise handleHeaderSort mapping
    fireEvent.click(screen.getByText('BPM'))
    expect(onSortCodeChange).toHaveBeenCalledWith('bpmdesc')
    fireEvent.click(screen.getByText('★'))
    expect(onSortCodeChange).toHaveBeenCalledWith('rating')
    fireEvent.click(screen.getByText('Jahr'))
    expect(onSortCodeChange).toHaveBeenCalledWith('yearnew')
    fireEvent.click(screen.getByText('Interpret'))
    expect(onSortCodeChange).toHaveBeenCalledWith('artist')
    fireEvent.click(screen.getByText('Key'))
    expect(onSortCodeChange).toHaveBeenCalledWith('key')
    fireEvent.click(screen.getByText('Plays'))
    expect(onSortCodeChange).toHaveBeenCalledWith('playcount')
    fireEvent.click(screen.getByText('Titel'))
    expect(onSortCodeChange).toHaveBeenCalledWith('title')
    fireEvent.click(screen.getByText('Genre'))
    expect(onSortCodeChange).toHaveBeenCalledWith('genre')

    fireEvent.click(container.querySelector('#useBpm')!)
    expect(onUseBpmChange).toHaveBeenCalledWith(false)
    fireEvent.change(container.querySelector('#bpmTolerance')!, { target: { value: '8' } })
    expect(onToleranceChange).toHaveBeenCalledWith(8)
    fireEvent.click(container.querySelector('#sameGenre')!)
    expect(onSameGenreChange).toHaveBeenCalledWith(false)
    fireEvent.click(container.querySelector('#unplayedLive')!)
    expect(onUnplayedOnlyChange).toHaveBeenCalledWith(false)
    fireEvent.change(container.querySelector('#liveRating')!, { target: { value: '5' } })
    expect(onMinRatingChange).toHaveBeenCalledWith(5)

    const inspector = container.querySelector('#liveInspector')!
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: '+ Set' }))
    expect(onAddToSet).toHaveBeenCalledWith(sampleTracks[0])
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: /In Rekordbox/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'reveal')
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: /Deck A/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'deck1')
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: /Deck B/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'deck2')
    fireEvent.click(within(inspector as HTMLElement).getByRole('button', { name: /Details/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[0])

    fireEvent.click(container.querySelector('#hardwareConfigBtn')!)
    expect(onOpenHardware).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('#toFilterStudio')!)
    expect(onGoFilterStudio).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('#toSetBuilder')!)
    expect(onGoSetBuilder).toHaveBeenCalledTimes(1)

    // Rerender with pinned=true, empty selectedTrack, empty selectedKeys, all filters off, no results
    rerender(
      <LiveView
        active={false}
        liveTrack={null}
        referenceKey="8A"
        pinned
        selectedKeys={['8A', '9A']}
        autoFollow={false}
        includeCurrent={false}
        onToggleKey={vi.fn()}
        onSelectAllHarmonic={vi.fn()}
        onAutoFollowChange={vi.fn()}
        onIncludeCurrentChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
        sortCode="bpmdesc"
        onSortCodeChange={onSortCodeChange}
        useBpm={false}
        onUseBpmChange={onUseBpmChange}
        tolerance={4}
        onToleranceChange={onToleranceChange}
        sameGenre={false}
        onSameGenreChange={onSameGenreChange}
        unplayedOnly={false}
        onUnplayedOnlyChange={onUnplayedOnlyChange}
        minRating={0}
        onMinRatingChange={onMinRatingChange}
        results={null}
        busy={false}
        revision={2}
        visibleColumns={defaultColumns}
        onVisibleColumnsChange={vi.fn()}
        selectedTrack={null}
        onSelectTrack={vi.fn()}
        onAddToSet={onAddToSet}
        onPinAsReference={vi.fn()}
        onFindRekordbox={onFindRekordbox}
        setIds={new Set()}
        setCount={0}
        onGoFilterStudio={onGoFilterStudio}
        onGoSetBuilder={onGoSetBuilder}
        onOpenHardware={onOpenHardware}
        liveStateText="Offline"
      />,
    )
    expect(screen.getByText('Ohne zusätzliche Einschränkung')).toBeInTheDocument()
    expect(screen.getByText('Klicke einen Track in der Tabelle.')).toBeInTheDocument()

    // Third rerender with yearnew -> clicking Jahr exercises 'yearold' branch + fallback without onRekordboxAction
    rerender(
      <LiveView
        active
        liveTrack={null}
        referenceKey="8A"
        pinned={false}
        selectedKeys={[]}
        autoFollow
        includeCurrent
        onToggleKey={vi.fn()}
        onSelectAllHarmonic={vi.fn()}
        onAutoFollowChange={vi.fn()}
        onIncludeCurrentChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
        sortCode="yearnew"
        onSortCodeChange={onSortCodeChange}
        useBpm={false}
        onUseBpmChange={onUseBpmChange}
        tolerance={4}
        onToleranceChange={onToleranceChange}
        sameGenre={false}
        onSameGenreChange={onSameGenreChange}
        unplayedOnly={false}
        onUnplayedOnlyChange={onUnplayedOnlyChange}
        minRating={0}
        onMinRatingChange={onMinRatingChange}
        results={{ rows: sampleTracks, counts: [2, 2, 2, 0], genres: [], keys: [], histogram: [], ms: 1 }}
        busy={false}
        revision={3}
        visibleColumns={['title', 'artist', 'bpm', 'key', 'genre', 'rating', 'year', 'plays'] as MetadataId[]}
        onVisibleColumnsChange={vi.fn()}
        selectedTrack={sampleTracks[0]}
        onSelectTrack={vi.fn()}
        onAddToSet={onAddToSet}
        onPinAsReference={vi.fn()}
        onFindRekordbox={onFindRekordbox}
        setIds={new Set(['t1'])}
        setCount={1}
        onGoFilterStudio={onGoFilterStudio}
        onGoSetBuilder={onGoSetBuilder}
        onOpenHardware={onOpenHardware}
        liveStateText="Offline"
      />,
    )
    fireEvent.click(screen.getByText('Jahr'))
    expect(onSortCodeChange).toHaveBeenCalledWith('yearold')
    fireEvent.click(within(container.querySelector('#liveInspector')! as HTMLElement).getByRole('button', { name: /In Rekordbox/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[0])

    // Empty referenceKey + track with empty artist/genre/null year + resetting sort to [] via sorting reset
    rerender(
      <LiveView
        active
        liveTrack={null}
        referenceKey=""
        pinned={false}
        selectedKeys={['8A']}
        autoFollow
        includeCurrent
        onToggleKey={vi.fn()}
        onSelectAllHarmonic={vi.fn()}
        onAutoFollowChange={vi.fn()}
        onIncludeCurrentChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
        sortCode="title"
        onSortCodeChange={onSortCodeChange}
        useBpm={false}
        onUseBpmChange={onUseBpmChange}
        tolerance={4}
        onToleranceChange={onToleranceChange}
        sameGenre
        onSameGenreChange={onSameGenreChange}
        unplayedOnly={false}
        onUnplayedOnlyChange={onUnplayedOnlyChange}
        minRating={0}
        onMinRatingChange={onMinRatingChange}
        results={{ rows: sampleTracks, counts: [1, 1, 1, 0], genres: [], keys: [], histogram: [], ms: 1 }}
        busy={false}
        revision={4}
        visibleColumns={['title', 'artist', 'bpm', 'key', 'genre', 'rating', 'year', 'plays'] as MetadataId[]}
        onVisibleColumnsChange={vi.fn()}
        selectedTrack={sampleTracks[2]}
        onSelectTrack={vi.fn()}
        onAddToSet={onAddToSet}
        onPinAsReference={vi.fn()}
        onFindRekordbox={onFindRekordbox}
        setIds={new Set()}
        setCount={0}
        onGoFilterStudio={onGoFilterStudio}
        onGoSetBuilder={onGoSetBuilder}
        onOpenHardware={onOpenHardware}
        liveStateText="Offline"
      />,
    )
    expect(screen.getByText(/Referenz: –/)).toBeInTheDocument()
  })
})

describe('filter-view.tsx', () => {
  it('exercises presets, rule groups, search, sort designer stages, queue pane and inspector', () => {
    const groups: RuleGroup[] = [
      { uid: 1, mode: 'AND', rules: [{ uid: 2, id: 'genre', op: 'eq', value: 'Techno' }] },
      { uid: 3, mode: 'OR', rules: [{ uid: 4, id: 'bpm', op: 'empty', value: '' }] },
    ]
    const fiveSetTracks: Track[] = [
      ...sampleTracks,
      { id: 't4', title: 'Four', artist: 'A', genre: 'Techno', bpm: 136, key: '7A', rating: 4, seconds: 200, year: 2021 },
      { id: 't5', title: 'Five', artist: 'B', genre: 'Techno', bpm: 137, key: '8A', rating: 5, seconds: 210, year: 2022 },
    ]

    const onSelectPreset = vi.fn()
    const onOpenSavePreset = vi.fn()
    const onResetFilters = vi.fn()
    const onGroupLogicChange = vi.fn()
    const onAddGroup = vi.fn()
    const onRemoveGroup = vi.fn()
    const onGroupModeChange = vi.fn()
    const onAddRule = vi.fn()
    const onRemoveRule = vi.fn()
    const onRuleChange = vi.fn()
    const onApplyFilter = vi.fn()
    const onSearchChange = vi.fn()
    const onSortStagesChange = vi.fn()
    const onAddToSet = vi.fn()
    const onRemoveFromSet = vi.fn()
    const onOpenSetBuilder = vi.fn()
    const onFindRekordbox = vi.fn()
    const onRekordboxAction = vi.fn()
    const onExportFilteredM3u8 = vi.fn()

    const filter = (
      <FilterView
        active
        presets={builtInPresets}
        selectedPresetId=""
        onSelectPreset={onSelectPreset}
        onOpenSavePreset={onOpenSavePreset}
        onResetFilters={onResetFilters}
        groupLogic="AND"
        onGroupLogicChange={onGroupLogicChange}
        groups={groups}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onGroupModeChange={onGroupModeChange}
        onAddRule={onAddRule}
        onRemoveRule={onRemoveRule}
        onRuleChange={onRuleChange}
        onApplyFilter={onApplyFilter}
        search="Peak"
        onSearchChange={onSearchChange}
        sortStages={[
          { id: 'bpm', desc: false },
          { id: 'year', desc: true },
        ]}
        onSortStagesChange={onSortStagesChange}
        results={sampleResults}
        totalLibraryCount={15500}
        busy={false}
        revision={1}
        visibleColumns={defaultColumns}
        onVisibleColumnsChange={vi.fn()}
        referenceKey="8A"
        selectedTrack={sampleTracks[0]}
        onSelectTrack={vi.fn()}
        onPinReference={vi.fn()}
        onAddToSet={onAddToSet}
        onRemoveFromSet={onRemoveFromSet}
        onFindRekordbox={onFindRekordbox}
        onRekordboxAction={onRekordboxAction}
        onExportFilteredM3u8={onExportFilteredM3u8}
        setTracks={fiveSetTracks}
        setIds={new Set(['t1'])}
        onOpenSetBuilder={onOpenSetBuilder}
      />
    )
    const { container, rerender } = render(filter)

    fireEvent.change(container.querySelector('#presetSelect')!, { target: { value: 'techno' } })
    expect(onSelectPreset).toHaveBeenCalledWith('techno')
    fireEvent.click(container.querySelector('#savePreset')!)
    expect(onOpenSavePreset).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('#resetFilters')!)
    expect(onResetFilters).toHaveBeenCalledTimes(1)

    fireEvent.change(container.querySelector('#groupLogic')!, { target: { value: 'OR' } })
    expect(onGroupLogicChange).toHaveBeenCalledWith('OR')

    fireEvent.change(screen.getByLabelText('Verknüpfung Regelgruppe 1'), { target: { value: 'OR' } })
    expect(onGroupModeChange).toHaveBeenCalledWith(1, 'OR')
    fireEvent.click(screen.getByLabelText('Regelgruppe 1 entfernen'))
    expect(onRemoveGroup).toHaveBeenCalledWith(1)

    fireEvent.change(screen.getAllByLabelText('Metadaten-Feld')[0], { target: { value: 'artist' } })
    expect(onRuleChange).toHaveBeenCalledWith(1, 2, { id: 'artist' })
    fireEvent.change(screen.getAllByLabelText('Vergleichsoperator')[0], { target: { value: 'contains' } })
    expect(onRuleChange).toHaveBeenCalledWith(1, 2, { op: 'contains' })
    fireEvent.change(screen.getAllByLabelText('Filterwert')[0], { target: { value: 'Dark' } })
    expect(onRuleChange).toHaveBeenCalledWith(1, 2, { value: 'Dark' })
    fireEvent.click(screen.getAllByLabelText('Regel entfernen')[0])
    expect(onRemoveRule).toHaveBeenCalledWith(1, 2)
    fireEvent.click(screen.getAllByRole('button', { name: /Regel in Gruppe/i })[0])
    expect(onAddRule).toHaveBeenCalledWith(1)
    fireEvent.click(container.querySelector('#addGroup')!)
    expect(onAddGroup).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('#applyFilter')!)
    expect(onApplyFilter).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('#sendSelectionToSet')!)
    expect(onAddToSet).toHaveBeenCalledWith(sampleTracks[0])

    fireEvent.change(container.querySelector('#filterSearch')!, { target: { value: 'Solar' } })
    expect(onSearchChange).toHaveBeenCalledWith('Solar')

    fireEvent.click(container.querySelector('#exportFilterM3u8')!)
    expect(onExportFilteredM3u8).toHaveBeenCalledWith(sampleTracks)

    // Sort designer open, edit, move up/down, toggle direction, add/remove stage, close
    fireEvent.click(container.querySelector('#toggleSortDesigner')!)
    fireEvent.change(screen.getByLabelText('Sortierfeld Stufe 1'), { target: { value: 'artist' } })
    expect(onSortStagesChange).toHaveBeenCalled()
    fireEvent.click(screen.getAllByTitle('Richtung umschalten')[0])
    fireEvent.click(screen.getAllByTitle('Stufe höher')[0]) // boundary at index 0
    fireEvent.click(screen.getAllByTitle('Stufe tiefer')[0])
    fireEvent.click(screen.getAllByTitle('Stufe höher')[1])
    fireEvent.click(screen.getAllByTitle('Stufe entfernen')[0])
    fireEvent.click(container.querySelector('#addSortStage')!)
    fireEvent.click(container.querySelector('#closeSortDesigner')!)

    // Header sort inside FilterView table
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Titel' })).getByRole('button'))
    expect(onSortStagesChange).toHaveBeenLastCalledWith([
      { id: 'bpm', desc: false },
      { id: 'year', desc: true },
      { id: 'title', desc: false },
    ])
    rerender(cloneElement(filter, { sortStages: [{ id: 'title', desc: true }] }))
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Titel' })).getByRole('button'))
    expect(onSortStagesChange).toHaveBeenLastCalledWith([])
    rerender(filter)

    // Queue pane remove & open SetBuilder + overflow badge
    expect(screen.getByText('+ 1 weitere im Set-Builder')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Midnight Pulse entfernen'))
    expect(onRemoveFromSet).toHaveBeenCalledWith('t1')
    fireEvent.click(container.querySelector('#queueOpen')!)
    expect(onOpenSetBuilder).toHaveBeenCalledTimes(1)

    const filterInspector = container.querySelector('#filterInspector')!
    fireEvent.click(within(filterInspector as HTMLElement).getByRole('button', { name: '+ Set' }))
    fireEvent.click(within(filterInspector as HTMLElement).getByRole('button', { name: /In Rekordbox/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'reveal')
    fireEvent.click(within(filterInspector as HTMLElement).getByRole('button', { name: /Deck A/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'deck1')
    fireEvent.click(within(filterInspector as HTMLElement).getByRole('button', { name: /Deck B/i }))
    expect(onRekordboxAction).toHaveBeenCalledWith(sampleTracks[0], 'deck2')
    fireEvent.click(within(filterInspector as HTMLElement).getByRole('button', { name: /Details/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[0])

    // Empty search / no sort stages / 1-track set / empty selection / fallback without onRekordboxAction
    rerender(
      <FilterView
        active={false}
        presets={[]}
        selectedPresetId=""
        onSelectPreset={onSelectPreset}
        onOpenSavePreset={onOpenSavePreset}
        onResetFilters={onResetFilters}
        groupLogic="OR"
        onGroupLogicChange={onGroupLogicChange}
        groups={[{ uid: 9, mode: 'AND', rules: [{ uid: 10, id: 'title', op: 'contains', value: '' }] }]}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onGroupModeChange={onGroupModeChange}
        onAddRule={onAddRule}
        onRemoveRule={onRemoveRule}
        onRuleChange={onRuleChange}
        onApplyFilter={onApplyFilter}
        search=""
        onSearchChange={onSearchChange}
        sortStages={[]}
        onSortStagesChange={onSortStagesChange}
        results={null}
        totalLibraryCount={0}
        busy={false}
        revision={2}
        visibleColumns={defaultColumns}
        onVisibleColumnsChange={vi.fn()}
        referenceKey="8A"
        selectedTrack={sampleTracks[2]}
        onSelectTrack={vi.fn()}
        onPinReference={vi.fn()}
        onAddToSet={onAddToSet}
        onRemoveFromSet={onRemoveFromSet}
        onFindRekordbox={onFindRekordbox}
        setTracks={[sampleTracks[0]]}
        setIds={new Set(['t1'])}
        onOpenSetBuilder={onOpenSetBuilder}
      />,
    )
    expect(screen.getByText(/Keine Sortierstufe/)).toBeInTheDocument()
    expect(screen.getByText('1 Track')).toBeInTheDocument()
    fireEvent.click(within(container.querySelector('#filterInspector')! as HTMLElement).getByRole('button', { name: /In Rekordbox/i }))
    expect(onFindRekordbox).toHaveBeenCalledWith(sampleTracks[2])

    // Final rerender with selectedTrack=null and empty setTracks
    rerender(
      <FilterView
        active={false}
        presets={[]}
        selectedPresetId=""
        onSelectPreset={onSelectPreset}
        onOpenSavePreset={onOpenSavePreset}
        onResetFilters={onResetFilters}
        groupLogic="OR"
        onGroupLogicChange={onGroupLogicChange}
        groups={[{ uid: 9, mode: 'AND', rules: [{ uid: 10, id: 'title', op: 'contains', value: '' }] }]}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onGroupModeChange={onGroupModeChange}
        onAddRule={onAddRule}
        onRemoveRule={onRemoveRule}
        onRuleChange={onRuleChange}
        onApplyFilter={onApplyFilter}
        search=""
        onSearchChange={onSearchChange}
        sortStages={[{ id: 'bpm', desc: true }]}
        onSortStagesChange={onSortStagesChange}
        results={sampleResults}
        totalLibraryCount={3}
        busy={false}
        revision={3}
        visibleColumns={defaultColumns}
        onVisibleColumnsChange={vi.fn()}
        referenceKey="8A"
        selectedTrack={null}
        onSelectTrack={vi.fn()}
        onPinReference={vi.fn()}
        onAddToSet={onAddToSet}
        onRemoveFromSet={onRemoveFromSet}
        onFindRekordbox={onFindRekordbox}
        setTracks={[]}
        setIds={new Set()}
        onOpenSetBuilder={onOpenSetBuilder}
      />,
    )
    expect(screen.getByText('Klicke einen Track in der Tabelle.')).toBeInTheDocument()
  })
})

describe('set-view.tsx & hardware-modal.tsx', () => {
  it('renders SetView transitions, reordering buttons, drag-and-drop and empty state', () => {
    const onMoveTrack = vi.fn()
    const onRemoveTrack = vi.fn()
    const onSelectTrack = vi.fn()
    const onExportCsv = vi.fn()
    const onExportM3u8 = vi.fn()
    const onExportXml = vi.fn()
    const onClearSet = vi.fn()

    const { rerender } = render(
      <SetView
        active
        tracks={sampleTracks}
        referenceKey="8A"
        onMoveTrack={onMoveTrack}
        onRemoveTrack={onRemoveTrack}
        onSelectTrack={onSelectTrack}
        onFindTracks={vi.fn()}
        onExportCsv={onExportCsv}
        onExportM3u8={onExportM3u8}
        onExportXml={onExportXml}
        onClearSet={onClearSet}
        onExplainImport={vi.fn()}
      />,
    )

    expect(screen.getByText(/Harmonisch benachbart/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Midnight Pulse').closest('.setrow')!)
    expect(onSelectTrack).toHaveBeenCalledWith(sampleTracks[0])
    fireEvent.click(screen.getByLabelText('Midnight Pulse nach unten'))
    expect(onMoveTrack).toHaveBeenCalledWith(0, 1)

    fireEvent.click(screen.getByLabelText('Solar Drift nach oben'))
    expect(onMoveTrack).toHaveBeenCalledWith(1, 0)

    fireEvent.click(screen.getByLabelText('Solar Drift aus Set entfernen'))
    expect(onRemoveTrack).toHaveBeenCalledWith('t2')

    fireEvent.click(screen.getByRole('button', { name: /M3U8-Playlist/i }))
    expect(onExportM3u8).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Rekordbox XML/i }))
    expect(onExportXml).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /CSV/i }))
    expect(onExportCsv).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Set leeren' }))
    expect(onClearSet).toHaveBeenCalledTimes(1)

    const row0 = screen.getByText('Midnight Pulse').closest('.setrow')!
    const row1 = screen.getByText('Solar Drift').closest('.setrow')!
    onMoveTrack.mockClear()
    fireEvent.drop(row1)
    expect(onMoveTrack).not.toHaveBeenCalled()
    fireEvent.dragStart(row0)
    fireEvent.drop(row0)
    expect(onMoveTrack).not.toHaveBeenCalled()
    fireEvent.dragStart(row0)
    fireEvent.dragOver(row1)
    fireEvent.dragLeave(row1)
    fireEvent.drop(row1)
    expect(onMoveTrack).toHaveBeenCalledExactlyOnceWith(0, 1)
    fireEvent.dragEnd(row0)

    rerender(
      <SetView
        active={false}
        tracks={[]}
        referenceKey="8A"
        onMoveTrack={onMoveTrack}
        onRemoveTrack={onRemoveTrack}
        onSelectTrack={onSelectTrack}
        onFindTracks={vi.fn()}
        onExportCsv={onExportCsv}
        onClearSet={onClearSet}
        onExplainImport={vi.fn()}
      />,
    )
    expect(screen.getByText(/Noch keine Tracks im Set/)).toBeInTheDocument()
  })

  it('renders HardwareModal decks, network controls, USB binding and status variants', () => {
    const live: LiveStatus = {
      state: 'rekordbox',
      error: 'Test Warnung',
      anchor: 2,
      matches: [],
      media: [{
        source: 1,
        slot: 3,
        path: 'E:/USB/exportLibrary.db',
        kind: 'OneLibrary',
        total: 100,
        genres: 5,
        bpmBounds: [120, 140],
        withKey: 90,
      }],
      decks: [
        {
          deck: 1,
          name: 'rekordbox',
          source: 0,
          slot: 0,
          slotName: 'Rekordbox lokal',
          trackId: 't1',
          bpm: 128,
          key: '8A',
          title: 'Track 1',
          artist: 'Artist 1',
          libraryId: null,
          playing: true,
          master: false,
          fader: 0,
        },
        {
          deck: 2,
          name: 'rekordbox',
          source: 0,
          slot: 0,
          slotName: 'Rekordbox lokal',
          trackId: 't2',
          bpm: 135,
          key: '9A',
          title: 'Track 2',
          artist: 'Artist 2',
          libraryId: 't2',
          playing: true,
          master: true,
          fader: 1,
        },
      ],
    }

    const onDeckChange = vi.fn()
    const onInspectTrack = vi.fn()
    const onUnbindMedia = vi.fn()
    const onBindMedia = vi.fn()
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    const onDemo = vi.fn()
    const onRefresh = vi.fn()
    const onSelectInterface = vi.fn()
    const onAnnounceChange = vi.fn()
    const onMasterSourceChange = vi.fn()

    const { rerender } = render(
      <HardwareModal
        open
        onClose={vi.fn()}
        live={live}
        interfaces={[{ name: 'Ethernet', ip: '192.168.1.50' }]}
        usbSources={['F:\\PIONEER\\exportLibrary.db']}
        selectedInterface="192.168.1.50"
        announce
        masterSource={null}
        deckNumber={null}
        busy={false}
        onSelectInterface={onSelectInterface}
        onAnnounceChange={onAnnounceChange}
        onMasterSourceChange={onMasterSourceChange}
        onDeckChange={onDeckChange}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onDemo={onDemo}
        onRefresh={onRefresh}
        onBindMedia={onBindMedia}
        onUnbindMedia={onUnbindMedia}
        onInspectTrack={onInspectTrack}
      />,
    )

    expect(screen.getByText('Rekordbox lokal verbunden')).toBeInTheDocument()
    expect(screen.getByText('Fader 0 %')).toBeInTheDocument()
    expect(screen.getByText('Fader 100 %')).toBeInTheDocument()

    const deck1El = screen.getByText('Deck 1 · rekordbox').closest('.hw-deck')!
    fireEvent.click(deck1El)
    fireEvent.keyDown(deck1El, { key: 'Enter' })
    fireEvent.keyDown(deck1El, { key: ' ' })
    expect(onDeckChange).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('button', { name: 'In Bibliothek wählen' }))
    expect(onInspectTrack).toHaveBeenCalledWith('t2')

    fireEvent.change(screen.getByLabelText('Netzwerk-Interface'), { target: { value: '192.168.1.50' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('Master-Quelle / Deck-Fokus'), { target: { value: '2' } })
    expect(onMasterSourceChange).toHaveBeenCalledWith(2)
    fireEvent.change(screen.getByLabelText('Master-Quelle / Deck-Fokus'), { target: { value: '' } })
    expect(onMasterSourceChange).toHaveBeenCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: 'Pro DJ Link verbinden' }))
    expect(onConnect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Demo-Link' }))
    expect(onDemo).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Trennen' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Netze & USB prüfen/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Player für USB-Binding'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Slot für USB-Binding'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /USB-Datenbank wählen/ }))
    expect(onBindMedia).toHaveBeenCalledWith(2, 7)
    fireEvent.click(screen.getByRole('button', { name: /An Player 2 \(USB 2\) binden/ }))
    expect(onBindMedia).toHaveBeenCalledWith(2, 7, 'F:\\PIONEER\\exportLibrary.db')
    fireEvent.click(screen.getByRole('button', { name: 'Lösen' }))
    expect(onUnbindMedia).toHaveBeenCalledWith(1, 3)

    // Check remaining state label branches
    for (const [state, text] of [
      ['listening', 'Pro DJ Link aktiv'],
      ['discovering', 'Suche Player im Netzwerk …'],
      ['demo', 'Demo-Modus aktiv'],
      ['error', 'Verbindungsfehler'],
      ['off', 'Getrennt'],
    ] as const) {
      rerender(
        <HardwareModal
          open
          onClose={vi.fn()}
          live={{
            state,
            error: null,
            decks: state === 'listening'
              ? [{
                  deck: 3,
                  name: 'CDJ',
                  source: 1,
                  slot: 1,
                  slotName: 'CD',
                  trackId: 'x',
                  bpm: null,
                  key: null,
                  title: null,
                  artist: null,
                  libraryId: null,
                  playing: false,
                  master: false,
                  fader: null,
                }]
              : [],
            anchor: null,
            matches: [],
            media: state === 'listening'
              ? [
                  { source: 1, slot: 7, path: 'G:/export.db', kind: 'USB', total: 5, genres: 1, bpmBounds: [120, 130], withKey: 5 },
                  { source: 2, slot: 2, path: 'H:/sd.db', kind: 'SD', total: 3, genres: 1, bpmBounds: [120, 130], withKey: 3 },
                ]
              : [],
          }}
          interfaces={[]}
          usbSources={[]}
          selectedInterface=""
          announce={false}
          masterSource={1}
          deckNumber={1}
          busy={false}
          onSelectInterface={onSelectInterface}
          onAnnounceChange={onAnnounceChange}
          onMasterSourceChange={onMasterSourceChange}
          onDeckChange={onDeckChange}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onDemo={onDemo}
          onRefresh={onRefresh}
          onBindMedia={onBindMedia}
          onUnbindMedia={onUnbindMedia}
          onInspectTrack={onInspectTrack}
        />,
      )
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })
})

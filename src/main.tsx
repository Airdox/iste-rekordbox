import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './style.css'
import {
  Deck,
  Detail,
  LiveStatus,
  NetworkInterface,
  Results,
  Source,
  Track,
  bpmText,
  count,
  duration,
  exportSetCsv,
  message,
  relatedKeys,
  request,
} from './api'
import { KeyBadge, LiveWaveform, Modal } from './components'
import { FilterView } from './filter-view'
import { HardwareModal } from './hardware-modal'
import { LiveSortCode, LiveView, liveSortToCascade } from './live-view'
import {
  FilterPreset,
  MetadataId,
  Operator,
  RuleGroup,
  SortStage,
  builtInPresets,
  defaultColumns,
  loadCustomPresets,
  metadata,
  saveCustomPresets,
} from './metadata'
import { SetView } from './set-view'

type Tab = 'live' | 'filter' | 'set'
type ActiveModal =
  | null
  | { type: 'help' }
  | { type: 'savePreset' }
  | { type: 'clearSet' }
  | { type: 'handover' }
  | { type: 'hardware' }
  | { type: 'find'; track: Track }

const COLUMNS_KEY = 'airdox.columns'
const SET_KEY = 'airdox.setTracks'

let uidCounter = 100
const nextUid = () => ++uidCounter

function presetToGroups(preset: FilterPreset): RuleGroup[] {
  return preset.groups.map((g) => ({
    uid: nextUid(),
    mode: g.mode,
    rules: g.rules.map((r) => ({ uid: nextUid(), id: r.id, op: r.op, value: r.value })),
  }))
}

function defaultEmptyGroup(): RuleGroup[] {
  return [
    {
      uid: nextUid(),
      mode: 'AND',
      rules: [{ uid: nextUid(), id: 'genre', op: 'contains', value: '' }],
    },
  ]
}

function loadColumns(): MetadataId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null')
    if (Array.isArray(raw)) {
      const valid = [...new Set<MetadataId>(raw.filter((id) => metadata.has(id)))]
      if (valid.length) return valid
    }
  } catch { /* ignore */ }
  return defaultColumns
}

function loadSetTracks(): Track[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SET_KEY) ?? '[]')
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Track => Boolean(item && typeof item.id === 'string' && typeof item.title === 'string'))
    }
  } catch { /* ignore */ }
  return []
}

function App() {
  const [tab, setTab] = useState<Tab>('live')
  const [source, setSource] = useState<Source | null>(null)
  const [sourceBusy, setSourceBusy] = useState(true)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [toastText, setToastText] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [visibleColumns, setVisibleColumns] = useState<MetadataId[]>(loadColumns)
  const [setTracks, setSetTracks] = useState<Track[]>(loadSetTracks)
  const setIds = useMemo(() => new Set(setTracks.map((t) => t.id)), [setTracks])

  // Hardware / Live Deck status
  const [live, setLive] = useState<LiveStatus>({
    state: 'off',
    error: null,
    decks: [],
    anchor: null,
    matches: [],
    media: [],
  })
  const [liveRevision, setLiveRevision] = useState(0)
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [usbSources, setUsbSources] = useState<string[]>([])
  const [selectedInterface, setSelectedInterface] = useState('')
  const [announce, setAnnounce] = useState(false)
  const [masterSource, setMasterSource] = useState<number | null>(null)
  const [deckNumber, setDeckNumber] = useState<number | null>(null)
  const [hwBusy, setHwBusy] = useState(false)

  // Live Header / Reference state
  const [referenceKey, setReferenceKey] = useState('8A')
  const [pinnedTrack, setPinnedTrack] = useState<Track | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => relatedKeys('8A'))
  const [includeCurrent, setIncludeCurrent] = useState(true)
  const [liveDetail, setLiveDetail] = useState<Detail | null>(null)
  const [inspectedDetail, setInspectedDetail] = useState<Detail | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)

  // Live-Match controls
  const [liveSearch, setLiveSearch] = useState('')
  const [liveSort, setLiveSort] = useState<LiveSortCode>('bpmasc')
  const [useBpm, setUseBpm] = useState(false)
  const [bpmTolerance, setBpmTolerance] = useState(4)
  const [sameGenre, setSameGenre] = useState(false)
  const [unplayedLive, setUnplayedLive] = useState(false)
  const [liveRating, setLiveRating] = useState(0)
  const [liveResults, setLiveResults] = useState<Results | null>(null)
  const [liveQueryBusy, setLiveQueryBusy] = useState(false)
  const [liveQuerySeq, setLiveQuerySeq] = useState(0)

  // Filter-Studio controls
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(loadCustomPresets)
  const allPresets = useMemo(() => [...builtInPresets, ...customPresets], [customPresets])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [groupLogic, setGroupLogic] = useState<'AND' | 'OR'>('AND')
  const [groups, setGroups] = useState<RuleGroup[]>(defaultEmptyGroup)
  const [filterSearch, setFilterSearch] = useState('')
  const [sortStages, setSortStages] = useState<SortStage[]>([
    { id: 'genre', desc: false },
    { id: 'year', desc: true },
    { id: 'bpm', desc: false },
  ])
  const [filterResults, setFilterResults] = useState<Results | null>(null)
  const [filterQueryBusy, setFilterQueryBusy] = useState(false)
  const [filterQuerySeq, setFilterQuerySeq] = useState(0)

  // Modals
  const [modal, setModal] = useState<ActiveModal>(null)
  const [presetNameInput, setPresetNameInput] = useState('')
  const [activeSideNav, setActiveSideNav] = useState('all')

  const showToast = useCallback((text: string) => {
    setToastText(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastText(''), 2800)
  }, [])

  // Persist columns & set
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(visibleColumns))
    } catch { /* ignore */ }
  }, [visibleColumns])

  useEffect(() => {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(setTracks))
    } catch { /* ignore */ }
  }, [setTracks])

  const refreshHardwareLists = useCallback(async () => {
    try {
      const [ifaces, usbs] = await Promise.all([
        request<NetworkInterface[]>('interfaces'),
        request<string[]>('usb'),
      ])
      setInterfaces(ifaces)
      setUsbSources(usbs)
      setSelectedInterface((prev) =>
        prev && ifaces.some((i) => i.ip === prev) ? prev : ifaces[0]?.ip ?? '',
      )
    } catch { /* ignore on initial boot */ }
  }, [])

  const openLibrary = useCallback(
    async (path?: string, initial = false, demo = false) => {
      setSourceBusy(true)
      setSourceMenuOpen(false)
      try {
        const next = await request<Source>(demo ? 'demoLibrary' : 'open', { path })
        setSource(next)
        setPinnedTrack(null)
        setSelectedTrack(null)
        setLiveResults(null)
        setFilterResults(null)
        if (!initial) {
          showToast(
            `${next.kind} geladen: ${count(next.total)} Tracks (Read-Only)`,
          )
        }
      } catch (err) {
        const msg = message(err)
        if (initial) {
          try {
            const fallback = await request<Source>('demoLibrary')
            setSource(fallback)
            showToast(`${msg} – Testbibliothek (${count(fallback.total)} Tracks) aktiv.`)
          } catch (demoErr) {
            showToast(`${msg} · ${message(demoErr)}`)
          }
        } else {
          showToast(msg)
        }
      } finally {
        setSourceBusy(false)
      }
    },
    [showToast],
  )

  useEffect(() => {
    void openLibrary(undefined, true)
    void refreshHardwareLists()
  }, [openLibrary, refreshHardwareLists])

  // Hardware & Live Status polling
  useEffect(() => {
    let ignore = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await request<LiveStatus>('live', {
          deck: deckNumber ?? undefined,
          masterSource: masterSource ?? undefined,
          tolerance: bpmTolerance,
          harmonic: true,
        })
        if (!ignore) {
          setLive((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        }
      } catch { /* ignore transient polling errors */ }
      if (!ignore) timer = setTimeout(poll, 400)
    }
    void poll()
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [liveRevision, deckNumber, masterSource, bpmTolerance, source])

  const activeDeck: Deck | null = useMemo(() => {
    if (!live.decks.length) return null
    if (deckNumber !== null) {
      const exact = live.decks.find((d) => d.deck === deckNumber)
      if (exact) return exact
    }
    return live.decks.find((d) => d.deck === live.anchor) ?? live.decks.find((d) => d.master) ?? live.decks[0] ?? null
  }, [live, deckNumber])

  // Effective Live Track displayed in Top Livebar (either fixed reference, active hardware/demo deck, or first result preview)
  const displayLiveTrack = useMemo(() => {
    if (pinnedTrack) {
      return {
        deck: 0,
        name: 'Fixiert',
        source: 0,
        slot: 0,
        slotName: 'Fixierte Referenz',
        trackId: pinnedTrack.id,
        bpm: pinnedTrack.bpm,
        key: pinnedTrack.key,
        genre: pinnedTrack.genre,
        seconds: pinnedTrack.seconds ?? null,
        title: pinnedTrack.title,
        artist: pinnedTrack.artist,
        libraryId: pinnedTrack.id,
        playing: false,
        master: false,
      } satisfies Deck
    }
    if (activeDeck && (activeDeck.title || activeDeck.key || activeDeck.bpm)) {
      return activeDeck
    }
    const preview = filterResults?.rows[0] ?? liveResults?.rows[0] ?? null
    if (preview) {
      return {
        deck: 0,
        name: 'Bibliothek',
        source: 0,
        slot: 0,
        slotName: 'Vorschau',
        trackId: preview.id,
        bpm: preview.bpm,
        key: preview.key,
        genre: preview.genre,
        seconds: preview.seconds ?? null,
        title: preview.title,
        artist: preview.artist,
        libraryId: preview.id,
        playing: false,
        master: false,
      } satisfies Deck
    }
    return null
  }, [pinnedTrack, activeDeck, filterResults, liveResults])

  // Auto-follow live deck key when not pinned
  const hardwareDeckKey = !pinnedTrack ? activeDeck?.key ?? null : null
  useEffect(() => {
    if (!autoFollow || pinnedTrack || !hardwareDeckKey) return
    setReferenceKey(hardwareDeckKey)
    setSelectedKeys(relatedKeys(hardwareDeckKey))
  }, [autoFollow, pinnedTrack, hardwareDeckKey])

  // Fetch ANLZ waveform detail for active displayLiveTrack
  const liveTrackLibraryId = displayLiveTrack?.libraryId ?? null
  useEffect(() => {
    if (!liveTrackLibraryId || !source || sourceBusy) {
      setLiveDetail(null)
      return
    }
    let ignore = false
    request<Detail | null>('detail', { id: liveTrackLibraryId })
      .then((next) => {
        if (!ignore) setLiveDetail(next)
      })
      .catch(() => { /* fallback waveform renders */ })
    return () => {
      ignore = true
    }
  }, [liveTrackLibraryId, source, sourceBusy])

  // Fetch Detail for selected track (for Rekordbox path / Find modal)
  const selectedTrackId = selectedTrack?.id ?? null
  useEffect(() => {
    if (!selectedTrackId || !source || sourceBusy) {
      setInspectedDetail(null)
      return
    }
    let ignore = false
    request<Detail | null>('detail', { id: selectedTrackId })
      .then((next) => {
        if (!ignore) setInspectedDetail(next)
      })
      .catch(() => { /* ignore */ })
    return () => {
      ignore = true
    }
  }, [selectedTrackId, source, sourceBusy])

  // Live-Match Backend Query
  const liveEffectiveKeys = useMemo(
    () => (includeCurrent ? selectedKeys : selectedKeys.filter((k) => k !== referenceKey)),
    [includeCurrent, selectedKeys, referenceKey],
  )

  const livePayload = useMemo(() => {
    const extraRules: { id: string; op: string; value: string }[] = []
    if (unplayedLive) extraRules.push({ id: 'plays', op: 'lte', value: '2' })
    if (liveEffectiveKeys.length === 0) {
      extraRules.push({ id: 'title', op: 'eq', value: '__NO_CAMELOT_KEYS__' })
    }

    const bpm = displayLiveTrack?.bpm ?? null
    const radius = bpm != null ? bpm * (bpmTolerance / 100) : 0

    return JSON.stringify({
      search: liveSearch,
      keys: liveEffectiveKeys.length ? liveEffectiveKeys : [],
      genres: sameGenre && displayLiveTrack?.genre ? [displayLiveTrack.genre] : [],
      rating: liveRating || undefined,
      bpmMin: useBpm && bpm != null ? Number((bpm - radius).toFixed(6)) : undefined,
      bpmMax: useBpm && bpm != null ? Number((bpm + radius).toFixed(6)) : undefined,
      rules: extraRules,
      sorts: liveSortToCascade(liveSort),
      fields: visibleColumns,
      facets: false,
    })
  }, [
    liveSearch,
    liveEffectiveKeys,
    sameGenre,
    displayLiveTrack?.genre,
    displayLiveTrack?.bpm,
    liveRating,
    useBpm,
    bpmTolerance,
    unplayedLive,
    liveSort,
    visibleColumns,
  ])

  useEffect(() => {
    if (!source || sourceBusy) return
    let ignore = false
    setLiveQueryBusy(true)
    const timer = setTimeout(() => {
      request<Results>('query', JSON.parse(livePayload))
        .then((next) => {
          if (ignore) return
          setLiveResults(next)
          if (tab === 'live') {
            setSelectedTrack((cur) =>
              cur && next.rows.some((r) => r.id === cur.id) ? cur : next.rows[0] ?? null,
            )
          }
        })
        .catch((err) => {
          if (!ignore) showToast(message(err))
        })
        .finally(() => {
          if (!ignore) setLiveQueryBusy(false)
        })
    }, 55)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [source, sourceBusy, livePayload, liveQuerySeq, tab, showToast])

  // Filter-Studio Backend Query
  const filterPayload = useMemo(
    () =>
      JSON.stringify({
        search: filterSearch,
        groupLogic,
        groups: groups.map((g) => ({
          mode: g.mode,
          rules: g.rules.map(({ id, op, value }) => ({ id, op, value })),
        })),
        sorts: sortStages,
        fields: visibleColumns,
        facets: false,
      }),
    [filterSearch, groupLogic, groups, sortStages, visibleColumns],
  )

  useEffect(() => {
    if (!source || sourceBusy) return
    let ignore = false
    setFilterQueryBusy(true)
    const timer = setTimeout(() => {
      request<Results>('query', JSON.parse(filterPayload))
        .then((next) => {
          if (ignore) return
          setFilterResults(next)
          if (tab === 'filter') {
            setSelectedTrack((cur) =>
              cur && next.rows.some((r) => r.id === cur.id) ? cur : next.rows[0] ?? null,
            )
          }
        })
        .catch((err) => {
          if (!ignore) showToast(message(err))
        })
        .finally(() => {
          if (!ignore) setFilterQueryBusy(false)
        })
    }, 65)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [source, sourceBusy, filterPayload, filterQuerySeq, tab, showToast])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault()
        setTab('live')
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault()
        setTab('filter')
      } else if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault()
        setTab('set')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (tab === 'live') {
          document.getElementById('liveSearch')?.focus()
        } else {
          setTab('filter')
          setTimeout(() => document.getElementById('filterSearch')?.focus(), 20)
        }
      } else if (e.key === 'Escape') {
        setModal(null)
        setSourceMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tab])

  // Handlers
  const toggleWheelKey = (key: string, additive: boolean) => {
    setSelectedKeys((prev) => {
      if (!additive) return [key]
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    })
  }

  const selectAllHarmonic = () => {
    setSelectedKeys(relatedKeys(referenceKey))
  }

  const pinTrackAsReference = (track: Track) => {
    setPinnedTrack(track)
    if (track.key) {
      setReferenceKey(track.key)
      if (autoFollow) setSelectedKeys(relatedKeys(track.key))
    }
    showToast(`Referenz fixiert: ${track.title} (${track.key ?? '–'})`)
  }

  const handleToggleHeaderPin = () => {
    if (pinnedTrack) {
      setPinnedTrack(null)
      if (activeDeck?.key) {
        setReferenceKey(activeDeck.key)
        if (autoFollow) setSelectedKeys(relatedKeys(activeDeck.key))
      }
      showToast('Live-Referenz wieder freigegeben.')
    } else if (displayLiveTrack) {
      const asTrack: Track = {
        id: displayLiveTrack.libraryId ?? displayLiveTrack.trackId,
        title: displayLiveTrack.title ?? 'Unbekannter Track',
        artist: displayLiveTrack.artist ?? '',
        genre: displayLiveTrack.genre ?? '',
        bpm: displayLiveTrack.bpm,
        key: displayLiveTrack.key ?? referenceKey,
        rating: 0,
        seconds: displayLiveTrack.seconds ?? null,
        year: null,
      }
      setPinnedTrack(asTrack)
      if (asTrack.key) {
        setReferenceKey(asTrack.key)
        if (autoFollow) setSelectedKeys(relatedKeys(asTrack.key))
      }
      showToast(`Referenz fixiert: ${asTrack.title}`)
    }
  }

  const handleNextDemoTrack = async () => {
    setPinnedTrack(null)
    try {
      await request('demoLink', { next: true })
      const next = await request<LiveStatus>('live', {
        deck: deckNumber ?? undefined,
        masterSource: masterSource ?? undefined,
        tolerance: bpmTolerance,
        harmonic: true,
      })
      setLive(next)
      const deck = next.decks.find((d) => d.deck === next.anchor) ?? next.decks[0]
      if (deck?.key && autoFollow) {
        setReferenceKey(deck.key)
        setSelectedKeys(relatedKeys(deck.key))
      }
      if (deck?.title) showToast(`Demo-Track: ${deck.title} (${deck.key ?? '–'})`)
      setLiveRevision((r) => r + 1)
    } catch (err) {
      showToast(message(err))
    }
  }

  const addToSet = (track: Track) => {
    setSetTracks((prev) => {
      if (prev.some((t) => t.id === track.id)) {
        showToast(`${track.title} ist bereits in der Setliste.`)
        return prev
      }
      showToast(`Zu Set hinzugefügt: ${track.title}`)
      return [...prev, track]
    })
  }

  const removeFromSet = (trackId: string) => {
    setSetTracks((prev) => prev.filter((t) => t.id !== trackId))
    showToast('Track aus der Setliste entfernt.')
  }

  const moveSetTrack = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= setTracks.length) return
    setSetTracks((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }

  const applyPreset = (presetId: string) => {
    const found = allPresets.find((p) => p.id === presetId)
    if (!found) return
    setSelectedPresetId(found.id)
    setGroupLogic(found.logic)
    setGroups(presetToGroups(found))
    setFilterSearch('')
    setTab('filter')
    setActiveSideNav(`preset:${found.id}`)
    setFilterQuerySeq((n) => n + 1)
    showToast(`Vorlage „${found.name}“ angewendet.`)
  }

  const resetFilters = () => {
    setSelectedPresetId('')
    setGroupLogic('AND')
    setGroups(defaultEmptyGroup())
    setFilterSearch('')
    setActiveSideNav('all')
    setFilterQuerySeq((n) => n + 1)
  }

  const handleSavePreset = () => {
    const cleanName = presetNameInput.trim()
    if (!cleanName) return
    const id = `custom-${Date.now()}`
    const created: FilterPreset = {
      id,
      name: cleanName,
      logic: groupLogic,
      groups: groups.map((g) => ({
        mode: g.mode,
        rules: g.rules.map(({ id: fid, op, value }) => ({ id: fid, op, value })),
      })),
      custom: true,
    }
    const updated = [...customPresets, created]
    setCustomPresets(updated)
    saveCustomPresets(updated)
    setSelectedPresetId(id)
    setModal(null)
    setPresetNameInput('')
    showToast(`Vorlage „${cleanName}“ gespeichert.`)
  }

  const handleHardwareConnect = async () => {
    if (!selectedInterface) return
    setHwBusy(true)
    try {
      await request('linkStart', { ip: selectedInterface, announce })
      setLiveRevision((r) => r + 1)
      showToast('Pro DJ Link gestartet.')
    } catch (err) {
      showToast(message(err))
    } finally {
      setHwBusy(false)
    }
  }

  const handleHardwareDisconnect = async () => {
    setHwBusy(true)
    try {
      await request('linkStop')
      setLiveRevision((r) => r + 1)
      showToast('Live-Link getrennt.')
    } catch (err) {
      showToast(message(err))
    } finally {
      setHwBusy(false)
    }
  }

  const handleHardwareDemo = async () => {
    setHwBusy(true)
    try {
      await request('demoLink', {})
      setLiveRevision((r) => r + 1)
      showToast('Demo-Link aktiviert.')
    } catch (err) {
      showToast(message(err))
    } finally {
      setHwBusy(false)
    }
  }

  const handleBindMedia = async (player: number, slot: number, path?: string) => {
    const targetPath = path ?? (await window.cuepoint.choose(false))
    if (!targetPath) return
    setHwBusy(true)
    try {
      await request('bindMedia', { source: player, slot, path: targetPath })
      setLiveRevision((r) => r + 1)
      showToast(`USB-Medium an Player ${player} gebunden (Read-Only).`)
    } catch (err) {
      showToast(message(err))
    } finally {
      setHwBusy(false)
    }
  }

  const handleUnbindMedia = async (player: number, slot: number) => {
    setHwBusy(true)
    try {
      await request('unbindMedia', { source: player, slot })
      setLiveRevision((r) => r + 1)
      showToast(`USB-Bindung von Player ${player} gelöst.`)
    } catch (err) {
      showToast(message(err))
    } finally {
      setHwBusy(false)
    }
  }

  // Computed labels
  const liveConnected = live.state === 'listening' || live.state === 'rekordbox'
  const liveStateDot = liveConnected ? 'good' : live.state === 'error' ? 'bad' : 'orange'
  const liveStateLabel =
    live.state === 'listening'
      ? 'Pro DJ Link verbunden'
      : live.state === 'rekordbox'
        ? 'Rekordbox lokal verbunden'
        : live.state === 'demo'
          ? 'Demo-Modus aktiv'
          : live.state === 'discovering'
            ? 'Suche Player …'
            : live.state === 'error'
              ? 'Link-Fehler'
              : 'Rekordbox nicht verbunden'

  const liveSourceText = pinnedTrack
    ? `Fixiert: ${pinnedTrack.title}`
    : live.state === 'listening'
      ? `Pro DJ Link · ${activeDeck?.name || 'CDJ/XDJ'}`
      : live.state === 'rekordbox'
        ? 'Quelle: Rekordbox lokal (Read-Only)'
        : live.state === 'demo'
          ? 'Quelle: Demo-Track aktiv'
          : 'Quelle: Vorschau / Kein laufender Player'

  const isRealDb = source && source.kind !== 'Demo'

  return (
    <div id="app">
      {/* Window Titlebar */}
      <div className="windowbar">
        <strong>
          ◈ airdox Library{' '}
          <span className="windowbar-sub">/ Rekordbox Pro-Assistant</span>
        </strong>
        <span>
          {source
            ? `${source.kind} · ${count(source.total)} Tracks · Read-Only Schutz aktiv`
            : 'Lade Rekordbox-Datenbank …'}
        </span>
        <div className="window-controls">
          <button
            className="win-btn"
            aria-label="Minimieren"
            onClick={() => void window.cuepoint.window('minimize')}
          >
            –
          </button>
          <button
            className="win-btn"
            aria-label="Maximieren"
            onClick={() => void window.cuepoint.window('maximize')}
          >
            □
          </button>
          <button
            className="win-btn close"
            aria-label="Schließen"
            onClick={() => void window.cuepoint.window('close')}
          >
            ×
          </button>
        </div>
      </div>

      {/* Top Navigation */}
      <header className="topnav">
        <div className="brand">
          airdox <span style={{ color: '#8eaed0' }}>Library</span>
          <small>TRACK ANALYSIS &amp; SET PREPARATION</small>
        </div>

        <nav className="tabstrip" aria-label="Hauptnavigation">
          <button
            className={`navtab ${tab === 'live' ? 'active' : ''}`}
            id="tab-live"
            data-tab="live"
            onClick={() => setTab('live')}
          >
            ◉ &nbsp; Live-Match
          </button>
          <button
            className={`navtab ${tab === 'filter' ? 'active' : ''}`}
            id="tab-filter"
            data-tab="filter"
            onClick={() => setTab('filter')}
          >
            ☷ &nbsp; Filter-Studio
          </button>
          <button
            className={`navtab ${tab === 'set' ? 'active' : ''}`}
            id="tab-set"
            data-tab="set"
            onClick={() => setTab('set')}
          >
            ▤ &nbsp; Set-Builder{' '}
            <span id="setCountTab" className="number">
              {setTracks.length}
            </span>
          </button>
        </nav>

        <div className="top-tools">
          <div className="source-wrap">
            <button
              className={`demo-tag ${isRealDb ? 'real' : ''}`}
              id="sourceButton"
              onClick={() => setSourceMenuOpen((prev) => !prev)}
            >
              {source
                ? `${source.kind} · ${count(source.total)} Tracks ▾`
                : 'Datenbank wählen ▾'}
            </button>
            {sourceMenuOpen && (
              <div className="source-menu" role="menu">
                <button
                  onClick={async () => {
                    setSourceMenuOpen(false)
                    const chosen = await window.cuepoint.choose(false)
                    if (chosen) void openLibrary(chosen)
                  }}
                >
                  Datenbankdatei öffnen (master.db) …
                </button>
                <button
                  onClick={async () => {
                    setSourceMenuOpen(false)
                    const chosen = await window.cuepoint.choose(true)
                    if (chosen) void openLibrary(chosen)
                  }}
                >
                  Rekordbox-Ordner öffnen …
                </button>
                <button onClick={() => void openLibrary(undefined, false, true)}>
                  Synthetische Testbibliothek (Demo)
                </button>
                {source?.path && (
                  <button onClick={() => void openLibrary(source.path ?? undefined)}>
                    Aktuelle Quelle neu laden
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            className={`status-head ${liveConnected ? 'online' : ''}`}
            id="liveStatusBtn"
            onClick={() => {
              void refreshHardwareLists()
              setModal({ type: 'hardware' })
            }}
          >
            <span className={`dot ${liveStateDot}`} />
            {liveStateLabel}
          </button>

          <button className="sm ghost" id="helpBtn" onClick={() => setModal({ type: 'help' })}>
            ? &nbsp; Bedienung
          </button>
        </div>
      </header>

      {/* Permanent Live-Analyse Bar */}
      <section className="livebar" aria-label="Permanente Live-Analyse">
        <div className="playing">
          <div className="albumart" />
          <div style={{ minWidth: 0 }}>
            <div className="kicker">
              Aktueller Track{' '}
              {pinnedTrack ? (
                <span style={{ color: '#8ac0f4' }}>(Fixiert)</span>
              ) : live.state === 'demo' ? (
                <span style={{ color: '#dfc38c' }}>(Demo-Link)</span>
              ) : liveConnected ? (
                <span style={{ color: '#9ed7b6' }}>(Live)</span>
              ) : (
                <span style={{ color: '#9ca7b5' }}>(Vorschau)</span>
              )}
            </div>
            <div className="playing-title" id="playingName">
              {displayLiveTrack?.title || 'Keine Bibliothek geladen'}
            </div>
            <div className="muted" id="playingArtist">
              {displayLiveTrack?.artist || 'Bitte Bibliothek öffnen'}
            </div>
            <div className="playing-tags">
              <span className="pill" id="playingBpm">
                {displayLiveTrack?.bpm != null ? `${displayLiveTrack.bpm.toFixed(2)} BPM` : '– BPM'}
              </span>
              <span className="pill blue" id="playingKey">
                {displayLiveTrack?.key || referenceKey}
              </span>
              <span className="pill" id="playingGenre">
                {displayLiveTrack?.genre || '–'}
              </span>
            </div>
          </div>
        </div>

        <div className="wavecard">
          <div className="wavehead">
            <span>TRACK-ANALYSE / WAVEFORM-VORSCHAU</span>
            <span id="playingTime">
              00:00 / {duration(displayLiveTrack?.seconds ?? liveDetail?.seconds ?? null)}
            </span>
          </div>
          <div className="waveform" id="wave">
            <LiveWaveform
              samples={liveDetail?.waveform ?? []}
              seedId={displayLiveTrack?.libraryId ?? displayLiveTrack?.title ?? 'wave'}
            />
          </div>
        </div>

        <div className="livestatus">
          <div className="source">
            <span className={`dot ${liveStateDot}`} />
            {liveSourceText}
          </div>
          <div className="sub">Live-Analyse oben in allen Reitern sichtbar</div>
          <div className="live-actions">
            <button className="sm" id="changeTrack" onClick={() => void handleNextDemoTrack()}>
              ↻ &nbsp; Nächster Demo-Track
            </button>
            <button
              className={`sm ${pinnedTrack ? 'primary' : 'ghost'}`}
              id="pinTrack"
              onClick={handleToggleHeaderPin}
            >
              {pinnedTrack ? '⌖ Referenz lösen' : '⌖ Referenz fixieren'}
            </button>
          </div>
        </div>
      </section>

      {/* Main Sidenav + Workspace */}
      <div className="area">
        <aside className="sidenav" aria-label="Sammlungsnavigation">
          <div className="nav-section">Sammlung</div>
          <button
            className={`navitem ${activeSideNav === 'all' ? 'active' : ''}`}
            onClick={() => {
              resetFilters()
              setTab('filter')
              setActiveSideNav('all')
            }}
          >
            <span>▤</span> Alle Tracks{' '}
            <span className="count" id="sidebarTotal">
              {source ? count(source.total) : '0'}
            </span>
          </button>
          <button
            className={`navitem ${activeSideNav === 'match' ? 'active' : ''}`}
            onClick={() => {
              setTab('live')
              selectAllHarmonic()
              setActiveSideNav('match')
            }}
          >
            <span>◈</span> Harmonisch passend
          </button>
          <button
            className={`navitem ${activeSideNav === 'search' ? 'active' : ''}`}
            onClick={() => {
              setTab('filter')
              setActiveSideNav('search')
              setTimeout(() => document.getElementById('filterSearch')?.focus(), 20)
            }}
          >
            <span>☷</span> Erweiterte Suche
          </button>

          <div className="nav-section">Arbeitsschritte</div>
          <button
            className={`navitem ${tab === 'live' && activeSideNav === 'live' ? 'active' : ''}`}
            onClick={() => {
              setTab('live')
              setActiveSideNav('live')
            }}
          >
            <span>◉</span> Live-Match
          </button>
          <button
            className={`navitem ${tab === 'filter' && activeSideNav === 'filter' ? 'active' : ''}`}
            onClick={() => {
              setTab('filter')
              setActiveSideNav('filter')
            }}
          >
            <span>▥</span> Filter-Studio
          </button>
          <button
            className={`navitem ${tab === 'set' ? 'active' : ''}`}
            onClick={() => {
              setTab('set')
              setActiveSideNav('set')
            }}
          >
            <span>▤</span> Meine Setliste{' '}
            <span className="count" id="setCountSide">
              {setTracks.length}
            </span>
          </button>

          <div className="nav-section">Gespeicherte Filter</div>
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              className={`navitem ${activeSideNav === `preset:${preset.id}` ? 'active' : ''}`}
              onClick={() => applyPreset(preset.id)}
            >
              ↳ &nbsp; {preset.name}
            </button>
          ))}

          <div className="sideinfo">
            <strong>Produktionsprinzip</strong>
            <div className="sidebar-note">
              Rekordbox-Masterdatenbank wird ausschließlich lesend angebunden. Sets und Presets
              liegen separat.
            </div>
            <div className="sep" />
            <span className={`dot ${isRealDb ? 'good' : 'orange'}`} /> Datenquelle:{' '}
            {source ? source.kind : 'Lädt …'}
            <br />
            <span className="dot good" /> Read-Only &amp; Filter: aktiv
          </div>
        </aside>

        <main className="workspace">
          <LiveView
            active={tab === 'live'}
            liveTrack={displayLiveTrack}
            referenceKey={referenceKey}
            pinned={Boolean(pinnedTrack)}
            selectedKeys={selectedKeys}
            autoFollow={autoFollow}
            includeCurrent={includeCurrent}
            onToggleKey={toggleWheelKey}
            onSelectAllHarmonic={selectAllHarmonic}
            onAutoFollowChange={(checked) => {
              setAutoFollow(checked)
              if (checked && !pinnedTrack && activeDeck?.key) {
                setReferenceKey(activeDeck.key)
                setSelectedKeys(relatedKeys(activeDeck.key))
              }
            }}
            onIncludeCurrentChange={setIncludeCurrent}
            search={liveSearch}
            onSearchChange={setLiveSearch}
            sortCode={liveSort}
            onSortCodeChange={setLiveSort}
            useBpm={useBpm}
            onUseBpmChange={setUseBpm}
            tolerance={bpmTolerance}
            onToleranceChange={setBpmTolerance}
            sameGenre={sameGenre}
            onSameGenreChange={setSameGenre}
            unplayedOnly={unplayedLive}
            onUnplayedOnlyChange={setUnplayedLive}
            minRating={liveRating}
            onMinRatingChange={setLiveRating}
            results={liveResults}
            busy={sourceBusy || liveQueryBusy}
            revision={liveQuerySeq}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={setVisibleColumns}
            selectedTrack={selectedTrack}
            onSelectTrack={setSelectedTrack}
            onAddToSet={addToSet}
            onPinAsReference={pinTrackAsReference}
            onFindRekordbox={(track) => setModal({ type: 'find', track })}
            setIds={setIds}
            setCount={setTracks.length}
            onGoFilterStudio={() => setTab('filter')}
            onGoSetBuilder={() => setTab('set')}
            onOpenHardware={() => {
              void refreshHardwareLists()
              setModal({ type: 'hardware' })
            }}
            liveStateText={liveStateLabel}
          />

          <FilterView
            active={tab === 'filter'}
            presets={allPresets}
            selectedPresetId={selectedPresetId}
            onSelectPreset={applyPreset}
            onOpenSavePreset={() => {
              setPresetNameInput('')
              setModal({ type: 'savePreset' })
            }}
            onResetFilters={resetFilters}
            groupLogic={groupLogic}
            onGroupLogicChange={setGroupLogic}
            groups={groups}
            onAddGroup={() =>
              setGroups((prev) => [
                ...prev,
                {
                  uid: nextUid(),
                  mode: 'AND',
                  rules: [{ uid: nextUid(), id: 'bpm', op: 'range', value: '124..136' }],
                },
              ])
            }
            onRemoveGroup={(guid) =>
              setGroups((prev) => (prev.length > 1 ? prev.filter((g) => g.uid !== guid) : prev))
            }
            onGroupModeChange={(guid, mode) =>
              setGroups((prev) => prev.map((g) => (g.uid === guid ? { ...g, mode } : g)))
            }
            onAddRule={(guid) =>
              setGroups((prev) =>
                prev.map((g) =>
                  g.uid === guid
                    ? {
                        ...g,
                        rules: [
                          ...g.rules,
                          { uid: nextUid(), id: 'title', op: 'contains', value: '' },
                        ],
                      }
                    : g,
                ),
              )
            }
            onRemoveRule={(guid, ruid) =>
              setGroups((prev) =>
                prev
                  .map((g) =>
                    g.uid === guid
                      ? { ...g, rules: g.rules.filter((r) => r.uid !== ruid) }
                      : g,
                  )
                  .filter((g) => g.rules.length > 0),
              )
            }
            onRuleChange={(guid, ruid, patch) =>
              setGroups((prev) =>
                prev.map((g) =>
                  g.uid === guid
                    ? {
                        ...g,
                        rules: g.rules.map((r) => (r.uid === ruid ? { ...r, ...patch } : r)),
                      }
                    : g,
                ),
              )
            }
            onApplyFilter={() => setFilterQuerySeq((n) => n + 1)}
            search={filterSearch}
            onSearchChange={setFilterSearch}
            sortStages={sortStages}
            onSortStagesChange={setSortStages}
            results={filterResults}
            totalLibraryCount={source?.total ?? 0}
            busy={sourceBusy || filterQueryBusy}
            revision={filterQuerySeq}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={setVisibleColumns}
            referenceKey={referenceKey}
            selectedTrack={selectedTrack}
            onSelectTrack={setSelectedTrack}
            onPinReference={pinTrackAsReference}
            onAddToSet={addToSet}
            onRemoveFromSet={removeFromSet}
            onFindRekordbox={(track) => setModal({ type: 'find', track })}
            setTracks={setTracks}
            setIds={setIds}
            onOpenSetBuilder={() => setTab('set')}
          />

          <SetView
            active={tab === 'set'}
            tracks={setTracks}
            referenceKey={referenceKey}
            onMoveTrack={moveSetTrack}
            onRemoveTrack={removeFromSet}
            onSelectTrack={(t) => {
              setSelectedTrack(t)
              setPinnedTrack(t)
              if (t.key) setReferenceKey(t.key)
            }}
            onFindTracks={() => setTab('filter')}
            onExportCsv={() => {
              if (!setTracks.length) return
              exportSetCsv(setTracks)
              showToast('Setliste als CSV exportiert.')
            }}
            onClearSet={() => setModal({ type: 'clearSet' })}
            onExplainImport={() => setModal({ type: 'handover' })}
          />
        </main>
      </div>

      {/* Footer */}
      <footer className="footer">
        <span>
          <strong>{source?.kind ?? 'Bibliothek'}:</strong>{' '}
          {source?.path ? source.path : 'Synthetische / In-Memory Bibliothek'} · Filter &amp;
          Sortierung aktiv · Set lokal gespeichert
        </span>
        <div className="footright">
          <span id="footerCurrent">
            {tab === 'live' ? 'Live-Match' : tab === 'filter' ? 'Filter-Studio' : 'Set-Builder'}
          </span>
          <span>
            <span className={`dot ${liveStateDot}`} /> {liveStateLabel}
          </span>
          <span>Originaldaten: unverändert</span>
        </div>
      </footer>

      {/* Modals */}
      <Modal
        open={modal?.type === 'help'}
        title="Bedienung & Tastenkürzel"
        onClose={() => setModal(null)}
        actions={[{ label: 'Schließen', primary: true, onClick: () => setModal(null) }]}
      >
        <p>
          <strong>Live-Match:</strong> Nutze den Camelot-Kompass links. Einfacher Klick wählt
          einen Key, <span className="kbd">Strg</span>+Klick kombiniert mehrere Keys. Rechts
          filterst du nach BPM-Toleranz, Genre, Selten gespielt (≤ 2) und Bewertung.
        </p>
        <p>
          <strong>Filter-Studio:</strong> Bilde komplexe <strong>UND/ODER-Regelgruppen</strong>{' '}
          (inkl. Bereich <code>134..142</code>) und mehrstufige Sortierkaskaden (#1, #2, #3 …).
          Rechtsklick auf Spaltenköpfe konfiguriert sichtbare Metadaten-Spalten.
        </p>
        <p>
          <strong>Set-Builder:</strong> Ziehe Tracks per Drag-and-drop oder nutze ↑/↓, prüfe
          Camelot- und BPM-Übergänge und exportiere dein Set als CSV.
        </p>
        <div className="info">
          <strong>Tastenkürzel:</strong> <span className="kbd">Strg+1/2/3</span> Reiter wechseln ·{' '}
          <span className="kbd">Strg+F</span> Suchen · <span className="kbd">↑/↓</span> Zeile wählen
          · <span className="kbd">Esc</span> Schließen
        </div>
      </Modal>

      <Modal
        open={modal?.type === 'savePreset'}
        title="Filter-Vorlage speichern"
        onClose={() => setModal(null)}
        actions={[
          { label: 'Abbrechen', onClick: () => setModal(null) },
          {
            label: 'Speichern',
            primary: true,
            disabled: !presetNameInput.trim(),
            onClick: handleSavePreset,
          },
        ]}
      >
        <p>Gib einen Namen für deine aktuelle UND/ODER-Filterkaskade ein:</p>
        <input
          id="presetNameInput"
          type="text"
          className="w100"
          autoFocus
          placeholder="z. B. Deep Peak 136"
          value={presetNameInput}
          onChange={(e) => setPresetNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && presetNameInput.trim()) handleSavePreset()
          }}
        />
      </Modal>

      <Modal
        open={modal?.type === 'find'}
        title="Track in Rekordbox finden"
        onClose={() => setModal(null)}
        actions={[
          {
            label: 'Suchtext kopieren',
            primary: true,
            onClick: () => {
              if (modal?.type !== 'find') return
              const q = `${modal.track.title} ${modal.track.artist}`.trim()
              void navigator.clipboard?.writeText(q).catch(() => {})
              showToast(`In Zwischenablage: ${q}`)
              setModal(null)
            },
          },
          { label: 'Schließen', onClick: () => setModal(null) },
        ]}
      >
        {modal?.type === 'find' && (
          <>
            <p>
              <strong>{modal.track.title}</strong> – {modal.track.artist || 'Unbekannt'}
            </p>
            <div className="info">
              BPM: <strong>{bpmText(modal.track.bpm)}</strong> · Key:{' '}
              <KeyBadge value={modal.track.key} reference={referenceKey} /> · Genre:{' '}
              <strong>{modal.track.genre || '–'}</strong>
              <br />
              Datei:{' '}
              <code>
                {inspectedDetail?.id === modal.track.id && inspectedDetail.path
                  ? inspectedDetail.path
                  : modal.track.path || 'Lokaler Datenbankeintrag'}
              </code>
            </div>
            <p className="hint">
              Rekordbox wird ausschließlich lesend eingebunden; es erfolgen keine direkten
              Schreibzugriffe auf <code>master.db</code>.
            </p>
          </>
        )}
      </Modal>

      <Modal
        open={modal?.type === 'clearSet'}
        title="Setliste leeren?"
        onClose={() => setModal(null)}
        actions={[
          { label: 'Abbrechen', onClick: () => setModal(null) },
          {
            label: 'Set leeren',
            primary: true,
            onClick: () => {
              setSetTracks([])
              setModal(null)
              showToast('Setliste geleert.')
            },
          },
        ]}
      >
        <p>Möchtest du alle vorgemerkten Titel aus deiner aktuellen Setliste entfernen?</p>
      </Modal>

      <Modal
        open={modal?.type === 'handover'}
        title="Übergabe an Rekordbox"
        onClose={() => setModal(null)}
        actions={[
          {
            label: 'CSV jetzt exportieren',
            primary: true,
            onClick: () => {
              if (setTracks.length) exportSetCsv(setTracks)
              setModal(null)
              showToast('CSV-Export gestartet.')
            },
          },
          { label: 'Schließen', onClick: () => setModal(null) },
        ]}
      >
        <p>
          Deine vorbereitete Setliste kann sauber als CSV exportiert oder direkt beim Mixen über
          die Setliste als Vorbereitungshilfe genutzt werden.
        </p>
        <div className="info">
          <strong>Sicherheitsgarantie:</strong> Die aktive Rekordbox-Datenbank wird ausschließlich
          über eine Read-Only / Shadow-Copy gelesen, um Datenkorruption zu 100 % auszuschließen.
        </div>
      </Modal>

      <HardwareModal
        open={modal?.type === 'hardware'}
        onClose={() => setModal(null)}
        live={live}
        interfaces={interfaces}
        usbSources={usbSources}
        selectedInterface={selectedInterface}
        announce={announce}
        masterSource={masterSource}
        deckNumber={deckNumber}
        busy={hwBusy}
        onSelectInterface={setSelectedInterface}
        onAnnounceChange={setAnnounce}
        onMasterSourceChange={setMasterSource}
        onDeckChange={(deck) => {
          setDeckNumber(deck)
          setPinnedTrack(null)
        }}
        onConnect={() => void handleHardwareConnect()}
        onDisconnect={() => void handleHardwareDisconnect()}
        onDemo={() => void handleHardwareDemo()}
        onRefresh={() => void refreshHardwareLists()}
        onBindMedia={(player, slot, path) => void handleBindMedia(player, slot, path)}
        onUnbindMedia={(player, slot) => void handleUnbindMedia(player, slot)}
        onInspectTrack={(trackId) => {
          request<Detail | null>('detail', { id: trackId })
            .then((d) => {
              if (d) {
                setSelectedTrack(d)
                setModal(null)
                setTab('live')
              }
            })
            .catch(() => {})
        }}
      />

      {toastText && (
        <div className="toast" id="toast" role="status">
          {toastText}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

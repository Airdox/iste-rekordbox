import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUpRight, AudioLines, CircleStop, FolderOpen, Link2, LocateFixed, Play, Radio, RefreshCw, Usb, X } from 'lucide-react'
import {
  basename, bpmText, count, message, request,
  type Deck, type LiveStatus, type NetworkInterface, type Source,
} from './api'
import { Empty, KeyBadge } from './components'
import './live.css'

export type LiveOptions = {
  deck?: number
  masterSource?: number
  tolerance: number
  harmonic: boolean
}

type Props = {
  source: Source | null
  status: LiveStatus | null
  refresh: () => void
  onSelectTrack: (id: string) => void
  options: LiveOptions
  onOptions: (changes: Partial<LiveOptions>) => void
}

const slots = [
  { value: 2, label: 'SD / USB 1' },
  { value: 3, label: 'USB' },
  { value: 7, label: 'USB 2' },
]
const players = Array.from({ length: 15 }, (_, index) => index + 1)
const deckLabel = (deck: number) => String(deck).padStart(2, '0')
const statusLabels = {
  off: 'Offline',
  discovering: 'Player-Suche',
  listening: 'Empfang aktiv',
  error: 'Verbindungsfehler',
  demo: 'Demo aktiv',
  rekordbox: 'Rekordbox lokal',
}

function DeckCard({ deck, active, onReference, onOpen, onAssign }: {
  deck: Deck
  active: boolean
  onReference: () => void
  onOpen: (id: string) => void
  onAssign: () => void
}) {
  const loaded = deck.trackId !== '0'
  const hasMediaSlot = players.includes(deck.source) && slots.some(({ value }) => value === deck.slot)
  const playback = deck.playing ? 'Läuft' : loaded ? 'Geladen' : 'Leer'
  return <article className="live-deck" data-active={active}>
    <div className="live-deck-header">
      <span className="live-deck-index mono">DECK {deckLabel(deck.deck)}</span>
      <span className="live-deck-state" data-playing={deck.playing}>
        {deck.playing ? <Play size={11} fill="currentColor" /> : <CircleStop size={11} />}{playback}
      </span>
    </div>
    <div className="live-deck-title" title={deck.title ?? ''}>
      {deck.title || (loaded ? `Track-ID ${deck.trackId}` : 'Kein Track geladen')}
    </div>
    <div className="live-deck-artist muted" title={deck.artist ?? deck.name}>
      {deck.artist || deck.name || '—'}
    </div>
    <div className="live-deck-stats">
      <span className="mono">{bpmText(deck.bpm)} <small>BPM</small></span>
      <KeyBadge value={deck.key} />
      {deck.master && <span className="live-chip">Master</span>}
    </div>
    <div className="live-deck-foot">
      <span className="muted small">{loaded ? `Player ${deck.source} · ${deck.slotName}` : '—'}</span>
      <div className="live-deck-actions">
        {deck.libraryId && <button className="icon-button" type="button" aria-label={`Track von Deck ${deck.deck} öffnen`}
          title="In Bibliothek öffnen" onClick={() => onOpen(deck.libraryId!)}><ArrowUpRight size={15} /></button>}
        {loaded && !deck.title && hasMediaSlot && <button className="icon-button" type="button"
          aria-label={`USB-Quelle von Deck ${deck.deck} zuordnen`} title="USB-Quelle zuordnen" onClick={onAssign}><Usb size={15} /></button>}
        <button className="icon-button live-reference" type="button" aria-label={`Deck ${deck.deck} als Referenz`}
          title="Als Referenz wählen" aria-pressed={active} disabled={!loaded} onClick={onReference}><LocateFixed size={15} /></button>
      </div>
    </div>
  </article>
}

export function LivePanel({ source, status, refresh, onSelectTrack, options, onOptions }: Props) {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [usb, setUsb] = useState<string[]>([])
  const [interfaceIp, setInterfaceIp] = useState('')
  const [mode, setMode] = useState('passive')
  const [usbPath, setUsbPath] = useState('')
  const [player, setPlayer] = useState(1)
  const [slot, setSlot] = useState(3)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const sourcePicker = useRef<HTMLSelectElement>(null)
  const decks = status?.decks ?? []
  const anchor = decks.find((deck) => deck.deck === status?.anchor)
  const state = status?.state ?? 'off'
  const connected = state === 'listening' || state === 'discovering'
  const media = status?.media ?? []
  const matches = status?.matches ?? []

  function updateDevices(networks: NetworkInterface[], exports: string[]) {
    setInterfaces(networks)
    setUsb(exports)
    setInterfaceIp((value) => networks.some((network) => network.ip === value) ? value : (networks.length === 1 ? networks[0].ip : ''))
  }

  useEffect(() => {
    let mounted = true
    Promise.all([request<NetworkInterface[]>('interfaces'), request<string[]>('usb')]).then(([networks, exports]) => {
      if (mounted) updateDevices(networks, exports)
    }, (failure: unknown) => {
      if (mounted) setError(message(failure))
    })
    return () => { mounted = false }
  }, [])

  async function run(action: string, execute: () => Promise<unknown>) {
    setError('')
    setBusy(action)
    try {
      await execute()
      refresh()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(null)
    }
  }

  const invoke = (method: string, params?: object) => run(method, () => request(method, params))
  const refreshDevices = () => run('devices', async () => {
    const [networks, exports] = await Promise.all([request<NetworkInterface[]>('interfaces'), request<string[]>('usb')])
    updateDevices(networks, exports)
  })

  const assignDeck = (deck: Deck) => {
    setPlayer(deck.source)
    setSlot(deck.slot)
    sourcePicker.current?.focus()
  }

  const emptyMatchTitle = !source ? 'Öffne eine Bibliothek' : !anchor ? 'Keine Live-Referenz' :
    anchor.bpm === null ? 'Kein Live-Tempo empfangen' : options.harmonic && !anchor.key ?
      'Tonart der Referenz fehlt' : 'Keine passenden Tracks'

  return <main className="live-workspace" aria-label="Live Match">
    <div className="live-toolbar">
      <div>
        <h1>Live Match</h1>
        <p className="muted">Anschlusstracks zum Tempo und zur Tonart des laufenden Decks.</p>
      </div>
      <span className="live-connection-pill mono" data-state={state}><i />{statusLabels[state]}</span>
    </div>
    {(error || status?.error) && <div className="live-error" role="alert">{error || status?.error}</div>}
    <div className="live-columns">
      <div className="live-primary">
        <section className="panel live-radar">
          <div className="panel-heading">
            <div className="heading-icon"><Radio size={16} /><h2>Deck-Radar</h2></div>
            <span className="mono muted">{count(decks.length)} Player</span>
          </div>
          {decks.length > 0 ? <div className="live-decks">
            {decks.map((deck) => <DeckCard key={deck.deck} deck={deck} active={deck.deck === status?.anchor}
              onReference={() => onOptions({ deck: deck.deck })} onOpen={onSelectTrack} onAssign={() => assignDeck(deck)} />)}
          </div> : <Empty icon={<Radio size={25} />} title={state === 'rekordbox' ? 'Rekordbox ist geöffnet' : connected ? 'Warte auf Player-Status' : 'Keine Player verbunden'}>
            <span className="muted small">{state === 'rekordbox' ? 'Starte einen Track auf einem Rekordbox-Deck.'
              : connected ? 'Der Radar aktualisiert sich mit eingehenden Statuspaketen.' : 'Pro DJ Link verbinden oder Demo starten.'}</span>
          </Empty>}
        </section>
        <section className="panel live-matches">
          <div className="panel-heading">
            <div className="heading-icon"><AudioLines size={16} /><h2>Anschlusstracks</h2></div>
            <span className="mono muted">{count(matches.length)}{matches.length === 50 ? ' · max.' : ''}</span>
          </div>
          <div className="live-match-scroll">
            {matches.length ? <table className="live-match-table">
              <thead><tr><th>Titel / Interpret</th><th>Key</th><th>BPM</th><th>Δ BPM</th><th>Übergang</th></tr></thead>
              <tbody>{matches.map((track) => <tr key={track.id}>
                <td><button type="button" className="live-track-button" onClick={() => onSelectTrack(track.id)}
                  title={track.title}><strong>{track.title || 'Ohne Titel'}</strong><span>{track.artist || '—'}</span></button></td>
                <td><KeyBadge value={track.key} /></td>
                <td className="mono">{bpmText(track.bpm)}</td>
                <td className="mono muted">{track.delta > 0 ? '+' : ''}{bpmText(track.delta)}</td>
                <td><span className="live-relation" data-relation={track.relation === 'Gleiche Tonart' ? 'exact' : track.relation === 'Tempo' ? 'tempo' : 'harmonic'}>
                  <i />{track.relation}</span></td>
              </tr>)}</tbody>
            </table> : <Empty icon={<Activity size={25} />} title={emptyMatchTitle}>
              {anchor && !anchor.key && options.harmonic && <span className="muted small">USB-Quelle zuordnen oder Tonartfilter ausschalten.</span>}
            </Empty>}
          </div>
        </section>
      </div>
      <aside className="live-settings" aria-label="Live-Einstellungen">
        <section className="panel live-settings-panel">
          <div className="panel-heading"><div className="heading-icon"><Link2 size={16} /><h2>Pro DJ Link</h2></div>
            <button className="icon-button" type="button" aria-label="Geräte aktualisieren" title="Geräte aktualisieren"
              disabled={busy !== null} onClick={refreshDevices}><RefreshCw size={14} /></button>
          </div>
          <div className="live-fields">
            <label className="live-field">Netzwerkschnittstelle
              <select value={interfaceIp} disabled={connected || busy !== null} onChange={(event) => setInterfaceIp(event.target.value)}>
                <option value="">{interfaces.length ? 'Schnittstelle wählen' : 'Keine Schnittstelle verfügbar'}</option>
                {interfaces.map(({ ip, name }) => <option key={ip} value={ip}>{name} · {ip}</option>)}
              </select>
            </label>
            <label className="live-field">Verbindungsmodus
              <select value={mode} disabled={connected || busy !== null} onChange={(event) => setMode(event.target.value)}>
                <option value="passive">Passiv · Status empfangen</option>
                <option value="announce">Aktiv · Als Empfänger ankündigen</option>
              </select>
            </label>
            <div className="live-buttons">
              {connected || state === 'demo'
                ? <button className="button" type="button" disabled={busy !== null} onClick={() => invoke('linkStop')}>
                  {state === 'demo' ? 'Demo beenden' : 'Trennen'}</button>
                : <>
                  <button className="button primary-button" type="button" disabled={!interfaceIp || busy !== null}
                    onClick={() => invoke('linkStart', { ip: interfaceIp, announce: mode === 'announce' })}>Verbinden</button>
                  <button className="button" type="button" disabled={!source || busy !== null} onClick={() => invoke('demoLink')}>Demo starten</button>
                </>}
            </div>
          </div>
        </section>
        <section className="panel live-settings-panel">
          <div className="panel-heading"><div className="heading-icon"><LocateFixed size={16} /><h2>Referenz & Toleranz</h2></div></div>
          <div className="live-fields">
            <label className="live-field">Referenzdeck
              <select value={options.deck ?? ''} onChange={(event) => onOptions({ deck: event.target.value ? Number(event.target.value) : undefined })}>
                <option value="">Automatisch · Laufendes Deck</option>
                {options.deck && !decks.some((deck) => deck.deck === options.deck) &&
                  <option value={options.deck}>Deck {deckLabel(options.deck)} · Offline</option>}
                {decks.map((deck) => <option key={deck.deck} value={deck.deck}>Deck {deckLabel(deck.deck)} · {deck.name}</option>)}
              </select>
            </label>
            <div className="live-range">
              <label className="live-field">BPM-Toleranz (%)
                <input type="number" min="0" max="30" step="0.1" value={options.tolerance}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber
                    if (Number.isFinite(value)) onOptions({ tolerance: Math.max(0, Math.min(30, value)) })
                  }} />
              </label>
              <label className="live-check"><input type="checkbox" checked={options.harmonic}
                onChange={(event) => onOptions({ harmonic: event.target.checked })} />Tonart kompatibel</label>
            </div>
          </div>
        </section>
        <section className="panel live-settings-panel">
          <div className="panel-heading"><div className="heading-icon"><Usb size={16} /><h2>Quellmedien</h2></div>
            <span className="muted mono">{media.length}</span>
          </div>
          <div className="live-fields">
            <label className="live-field">Rekordbox als Quelle
              <select value={options.masterSource ?? ''} disabled={source?.kind !== 'Master'}
                onChange={(event) => onOptions({ masterSource: event.target.value ? Number(event.target.value) : undefined })}>
                <option value="">Master-Sammlung nicht zugeordnet</option>
                {players.map((value) => <option key={value} value={value}>Quellplayer {value}</option>)}
              </select>
            </label>
            <div className="live-media-picker">
              <label className="live-field">USB-/SD-Bibliothek
                <select ref={sourcePicker} value={usbPath} onChange={(event) => setUsbPath(event.target.value)}>
                  <option value="">{usb.length ? 'Exportdatei wählen' : 'Keine Exportdatei gefunden'}</option>
                  {usbPath && !usb.includes(usbPath) && <option value={usbPath}>{usbPath}</option>}
                  {usb.map((path) => <option key={path} value={path}>{path}</option>)}
                </select>
              </label>
              <button className="icon-button" type="button" aria-label="Exportdatei öffnen" title="Exportdatei öffnen"
                disabled={busy !== null} onClick={() => run('pick', async () => {
                  const path = await window.cuepoint.choose(false)
                  if (path) setUsbPath(path)
                })}><FolderOpen size={16} /></button>
            </div>
            <div className="live-media-location">
              <label className="live-field">Quellplayer
                <select value={player} onChange={(event) => setPlayer(Number(event.target.value))}>
                  {players.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="live-field">Slot
                <select value={slot} onChange={(event) => setSlot(Number(event.target.value))}>
                  {slots.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <button className="button" type="button" disabled={!usbPath || busy !== null}
              onClick={() => invoke('bindMedia', { source: player, slot, path: usbPath })}><Usb size={14} />Medium zuordnen</button>
            {media.length > 0 && <ul className="live-media-list">
              {media.map((item) => <li key={`${item.source}-${item.slot}`}>
                <div title={item.path ?? ''}><strong>Player {item.source} · {slots.find(({ value }) => value === item.slot)?.label}</strong>
                  <span>{basename(item.path)} · {count(item.total)} Tracks</span></div>
                <button className="icon-button" type="button" aria-label={`Medium von Player ${item.source} entfernen`}
                  title="Zuordnung entfernen" disabled={busy !== null}
                  onClick={() => invoke('unbindMedia', { source: item.source, slot: item.slot })}><X size={14} /></button>
              </li>)}
            </ul>}
            <p className="muted small live-media-tip">Die App speichert die Zuordnung für diese Sitzung. Bei einem Stickwechsel das Medium neu zuordnen.</p>
          </div>
        </section>
      </aside>
    </div>
  </main>
}

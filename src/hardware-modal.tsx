import { useState } from 'react'
import { Deck, LiveStatus, NetworkInterface, count } from './api'
import { KeyBadge, Modal } from './components'

const slotLabels: Record<number, string> = {
  2: 'SD-Slot',
  3: 'USB 1',
  7: 'USB 2',
}

type HardwareModalProps = {
  open: boolean
  onClose: () => void
  live: LiveStatus
  interfaces: NetworkInterface[]
  usbSources: string[]
  selectedInterface: string
  announce: boolean
  masterSource: number | null
  deckNumber: number | null
  busy: boolean
  onSelectInterface: (ip: string) => void
  onAnnounceChange: (announce: boolean) => void
  onMasterSourceChange: (source: number | null) => void
  onDeckChange: (deck: number) => void
  onConnect: () => void
  onDisconnect: () => void
  onDemo: () => void
  onRefresh: () => void
  onBindMedia: (source: number, slot: number, path?: string) => void
  onUnbindMedia: (source: number, slot: number) => void
  onInspectTrack: (trackId: string) => void
}

export function HardwareModal({
  open,
  onClose,
  live,
  interfaces,
  usbSources,
  selectedInterface,
  announce,
  masterSource,
  deckNumber,
  busy,
  onSelectInterface,
  onAnnounceChange,
  onMasterSourceChange,
  onDeckChange,
  onConnect,
  onDisconnect,
  onDemo,
  onRefresh,
  onBindMedia,
  onUnbindMedia,
  onInspectTrack,
}: HardwareModalProps) {
  const [bindSource, setBindSource] = useState(1)
  const [bindSlot, setBindSlot] = useState(3)

  const stateLabel =
    live.state === 'listening'
      ? 'Pro DJ Link aktiv'
      : live.state === 'discovering'
        ? 'Suche Player im Netzwerk …'
        : live.state === 'rekordbox'
          ? 'Rekordbox lokal verbunden'
          : live.state === 'demo'
            ? 'Demo-Modus aktiv'
            : live.state === 'error'
              ? 'Verbindungsfehler'
              : 'Getrennt'

  const stateDot =
    live.state === 'listening' || live.state === 'rekordbox'
      ? 'good'
      : live.state === 'error'
        ? 'bad'
        : 'orange'

  const activeDeck = (d: Deck) => (deckNumber !== null ? d.deck === deckNumber : d.master || d.deck === live.anchor)

  return (
    <Modal
      open={open}
      title="Hardware, Pro DJ Link & Quellmedien"
      onClose={onClose}
      wide
      actions={[
        { label: 'Schließen', primary: true, onClick: onClose },
      ]}
    >
      <div className="hw-modal">
        <div className="hw-status-row">
          <div className="flex">
            <span className={`dot ${stateDot}`} />
            <strong>{stateLabel}</strong>
          </div>
          <button
            className="sm"
            disabled={busy}
            title="Aktualisiert verfügbare Netzwerk-Adapter sowie angeschlossene Rekordbox-USB/SD-Exporte"
            onClick={onRefresh}
          >
            ↻ Netze &amp; USB prüfen
          </button>
        </div>

        {live.error && (
          <div className="hw-error" role="alert">
            {live.error}
          </div>
        )}

        <div className="hw-grid">
          <div className="hw-card">
            <div className="kicker">Netzwerk &amp; Pro DJ Link</div>
            <label className="hw-label" htmlFor="hwInterface">
              Netzwerk-Interface
            </label>
            <select
              id="hwInterface"
              title="Wählt die Netzwerkkarte aus, über die Pioneer CDJ/XDJ-Player per Pro DJ Link gefunden werden"
              value={selectedInterface}
              onChange={(e) => onSelectInterface(e.target.value)}
            >
              {!interfaces.length && <option value="">Kein Interface gefunden</option>}
              {interfaces.map((item) => (
                <option key={item.ip} value={item.ip}>
                  {item.name} ({item.ip})
                </option>
              ))}
            </select>

            <label
              className="checkrow"
              title="Meldet airdox als passives virtuelles CDJ im Pro-DJ-Link-Netzwerk an (hilft, wenn Player sonst keine Statuspakete senden)"
            >
              <input
                type="checkbox"
                checked={announce}
                onChange={(e) => onAnnounceChange(e.target.checked)}
              />
              Als virtuelles CDJ im Netzwerk anmelden (Announce)
            </label>

            <label className="hw-label" htmlFor="hwMasterSource">
              Master-Quelle / Deck-Fokus
            </label>
            <select
              id="hwMasterSource"
              title="Legt fest, ob die Live-Referenz automatisch dem Master-Deck folgt oder fest auf einen bestimmten Player fixiert wird"
              value={masterSource ?? ''}
              onChange={(e) => onMasterSourceChange(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Automatisch (Master-Deck folgen)</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  Immer Player {n}
                </option>
              ))}
            </select>

            <div className="hw-actions">
              <button
                className="primary sm"
                disabled={busy || !selectedInterface}
                title="Startet den passiven Pro-DJ-Link-Empfänger auf dem gewählten Netzwerk-Interface"
                onClick={onConnect}
              >
                Pro DJ Link verbinden
              </button>
              <button
                className="sm"
                disabled={busy}
                title="Aktiviert simulierte Live-Decks zum Testen ohne echte CDJ/XDJ-Hardware"
                onClick={onDemo}
              >
                Demo-Link
              </button>
              <button
                className="sm ghost"
                disabled={busy || live.state === 'off'}
                title="Beendet die aktive Pro-DJ-Link- oder Demo-Verbindung"
                onClick={onDisconnect}
              >
                Trennen
              </button>
            </div>
          </div>

          <div className="hw-card">
            <div className="flex space">
              <span className="kicker">Erkannte Decks ({live.decks.length})</span>
              <span className="minor" style={{ fontSize: 11 }}>
                Klick wählt Referenz-Deck
              </span>
            </div>
            {live.decks.length ? (
              <div className="hw-decklist">
                {live.decks.map((d) => {
                  const isActive = activeDeck(d)
                  return (
                    <div
                      key={d.deck}
                      className={`hw-deck ${isActive ? 'active' : ''}`}
                      title={`Klicken, um Deck ${d.deck} fest als Live-Referenz für harmonische Vorschläge auszuwählen`}
                      onClick={() => onDeckChange(d.deck)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onDeckChange(d.deck)
                        }
                      }}
                    >
                      <div className="flex space">
                        <strong>
                          Deck {d.deck} · {d.name}
                        </strong>
                        <div className="flex" style={{ gap: 4 }}>
                          {d.master && (
                            <span className="pill green" title="Aktives Tempo-Master-Deck">
                              MASTER
                            </span>
                          )}
                          {d.playing && (
                            <span className="pill blue" title="Deck spielt gerade aktiv ab">
                              PLAY
                            </span>
                          )}
                          {d.fader != null && (
                            <span className="pill" title="Aktuelle Kanalfader-Stellung (0–100 %)">
                              Fader {Math.round(d.fader * 100)} %
                            </span>
                          )}
                          {d.key && <KeyBadge value={d.key} />}
                        </div>
                      </div>
                      <div className="hw-deck-title">
                        {d.title || 'Kein Titel geladen'}
                        {d.artist ? ` – ${d.artist}` : ''}
                      </div>
                      <div className="flex space minor" style={{ fontSize: 11 }}>
                        <span>
                          {d.bpm ? `${d.bpm.toFixed(2)} BPM` : '– BPM'} ·{' '}
                          {d.slotName || slotLabels[d.slot] || 'Lokal'}
                        </span>
                        {d.libraryId && (
                          <button
                            className="sm ghost"
                            title="Springt direkt zu diesem Track in der Live-Match-Tabelle"
                            onClick={(e) => {
                              e.stopPropagation()
                              onInspectTrack(d.libraryId!)
                            }}
                          >
                            In Bibliothek wählen
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                Noch kein CDJ/XDJ oder laufender Rekordbox-Track aktiv. Starte Pro DJ Link oder
                nutze den Demo-Modus.
              </div>
            )}
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: 12 }}>
          <div className="flex space">
            <span className="kicker">USB- / SD-Quellmedien an Player binden (Read-Only)</span>
            <span className="minor" style={{ fontSize: 11 }}>
              Erkannt: {usbSources.length} Export(e)
            </span>
          </div>

          <div className="hw-bind-row">
            <select
              aria-label="Player für USB-Binding"
              title="Ziel-Player-Nummer auswählen (1–15), dem das USB/SD-Medium zugeordnet wird"
              value={bindSource}
              onChange={(e) => setBindSource(Number(e.target.value))}
            >
              {Array.from({ length: 15 }, (_, idx) => idx + 1).map((p) => (
                <option key={p} value={p}>
                  Player {p}
                </option>
              ))}
            </select>
            <select
              aria-label="Slot für USB-Binding"
              title="Medien-Slot am Player auswählen (USB 1, USB 2 oder SD-Card)"
              value={bindSlot}
              onChange={(e) => setBindSlot(Number(e.target.value))}
            >
              <option value={3}>USB 1 (Slot 3)</option>
              <option value={7}>USB 2 (Slot 7)</option>
              <option value={2}>SD-Card (Slot 2)</option>
            </select>
            <button
              className="sm"
              disabled={busy}
              title="Wählt eine exportLibrary.db oder export.pdb Datei vom USB/SD-Stick aus (Read-Only)"
              onClick={() => onBindMedia(bindSource, bindSlot)}
            >
              USB-Datenbank wählen …
            </button>
          </div>

          {usbSources.length > 0 && (
            <div className="hw-usb-list">
              {usbSources.map((path) => (
                <div key={path} className="hw-usb-item">
                  <span className="hw-path" title={path}>
                    {path}
                  </span>
                  <button
                    className="sm"
                    disabled={busy}
                    title={`Bindet diese Rekordbox-Export-Datenbank schreibgeschützt an Player ${bindSource}`}
                    onClick={() => onBindMedia(bindSource, bindSlot, path)}
                  >
                    An Player {bindSource} ({slotLabels[bindSlot]}) binden
                  </button>
                </div>
              ))}
            </div>
          )}

          {live.media.length > 0 && (
            <div className="hw-usb-list" style={{ marginTop: 8 }}>
              {live.media.map((m) => (
                <div key={`${m.source}-${m.slot}`} className="hw-usb-item bound">
                  <div>
                    <strong>
                      Player {m.source} · {slotLabels[m.slot] || `Slot ${m.slot}`}
                    </strong>
                    <div className="minor" style={{ fontSize: 11 }}>
                      {m.kind} · {count(m.total)} Tracks · {m.path}
                    </div>
                  </div>
                  <button
                    className="sm ghost"
                    disabled={busy}
                    title="Hebt die Read-Only-Zuordnung dieses Mediums vom Player wieder auf"
                    onClick={() => onUnbindMedia(m.source, m.slot)}
                  >
                    Lösen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}


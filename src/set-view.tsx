import { useState } from 'react'
import { Track, bpmText, duration, harmonicTransition } from './api'
import { KeyBadge } from './components'

type SetViewProps = {
  active: boolean
  tracks: Track[]
  referenceKey: string
  onMoveTrack: (fromIndex: number, toIndex: number) => void
  onRemoveTrack: (trackId: string) => void
  onSelectTrack: (track: Track) => void
  onFindTracks: () => void
  onExportCsv: () => void
  onExportM3u8?: () => void
  onExportXml?: () => void
  onClearSet: () => void
  onExplainImport: () => void
}

export function SetView({
  active,
  tracks,
  referenceKey,
  onMoveTrack,
  onRemoveTrack,
  onSelectTrack,
  onFindTracks,
  onExportCsv,
  onExportM3u8,
  onExportXml,
  onClearSet,
  onExplainImport,
}: SetViewProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const totalSeconds = tracks.reduce((acc, t) => acc + (t.seconds ?? 0), 0)
  const totalMinutes = Math.round(totalSeconds / 60)
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => b !== null)
  const bpmSpan = bpms.length
    ? `${Math.min(...bpms).toFixed(1)}–${Math.max(...bpms).toFixed(1)}`
    : '–'

  let goodTransitions = 0
  for (let i = 0; i < tracks.length - 1; i++) {
    if (harmonicTransition(tracks[i].key, tracks[i + 1].key).kind === 'good') {
      goodTransitions++
    }
  }
  const matchStat =
    tracks.length > 1 ? `${goodTransitions} / ${tracks.length - 1}` : '–'

  return (
    <section
      className={`view setview ${active ? 'active' : ''}`}
      id="view-set"
      aria-label="Set-Builder"
    >
      <div className="pane">
        <div className="setarea">
          <div className="settoolbar">
            <div>
              <div className="kicker">Wiedergabeliste / Vorbereitung</div>
              <h2>Mein nächstes Set</h2>
              <div className="hint">
                Reihenfolge ändern, Übergänge prüfen, als Datei exportieren
              </div>
            </div>
            <div className="flex">
              <button
                id="addFromBrowse"
                title="Öffnet das Filter-Studio, um weitere Tracks nach Regeln zu suchen und ins Set zu übernehmen"
                onClick={onFindTracks}
              >
                + Tracks suchen
              </button>
              <button
                className="primary"
                id="exportSetM3u8"
                disabled={tracks.length === 0}
                title="Exportiert deine Setliste als M3U8-Playlist – direkt per Drag-and-drop oder Import in Rekordbox öffnen"
                onClick={onExportM3u8}
              >
                ↓ &nbsp; M3U8-Playlist
              </button>
              <button
                id="exportSetXml"
                disabled={tracks.length === 0}
                title="Exportiert deine Setliste als Rekordbox-XML-Datei (Import in Rekordbox über rekordbox.xml)"
                onClick={onExportXml}
              >
                ↓ &nbsp; Rekordbox XML
              </button>
              <button
                id="exportSet"
                disabled={tracks.length === 0}
                title="Speichert deine Setliste als UTF-8-CSV-Datei inklusive BPM, Tonart, Übergangsbewertung und Dateipfad"
                onClick={onExportCsv}
              >
                ↓ &nbsp; CSV
              </button>
            </div>
          </div>

          <div className="setlist" id="setList">
            {!tracks.length ? (
              <div className="empty">
                Noch keine Tracks im Set. Gehe in <strong>Live-Match</strong> oder{' '}
                <strong>Filter-Studio</strong> und klicke dort auf <strong>+ Set</strong>.
              </div>
            ) : (
              tracks.map((t, i) => {
                const next = tracks[i + 1]
                const transition = next ? { ...harmonicTransition(t.key, next.key), key: next.key } : null
                const bpmDiff =
                  next && t.bpm !== null && next.bpm !== null
                    ? (next.bpm - t.bpm >= 0 ? '+' : '') + (next.bpm - t.bpm).toFixed(1) + ' BPM'
                    : '–'
                return (
                  <div key={t.id}>
                    <div
                      className={`setrow ${dragOverIndex === i ? 'dragover' : ''}`}
                      draggable
                      onClick={() => onSelectTrack(t)}
                      onDragStart={() => setDragIndex(i)}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverIndex(i)
                      }}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={() => {
                        setDragOverIndex(null)
                        if (dragIndex !== null && dragIndex !== i) {
                          onMoveTrack(dragIndex, i)
                        }
                        setDragIndex(null)
                      }}
                      onDragEnd={() => {
                        setDragIndex(null)
                        setDragOverIndex(null)
                      }}
                    >
                      <span className="handle" title="Per Drag-and-drop sortieren">
                        ⋮⋮
                      </span>
                      <span className="index">#{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="title title-ellipsis">{t.title}</div>
                        <div className="meta">
                          {t.artist || 'Unbekannt'} · {t.genre || '–'} · {t.year ?? '–'} ·{' '}
                          {duration(t.seconds)}
                        </div>
                      </div>
                      <span className="num">{bpmText(t.bpm)} BPM</span>
                      <div>
                        <KeyBadge value={t.key} reference={referenceKey} />
                      </div>
                      <div className="controls" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onMoveTrack(i, i - 1)}
                          disabled={i === 0}
                          title="Nach oben"
                          aria-label={`${t.title} nach oben`}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => onMoveTrack(i, i + 1)}
                          disabled={i === tracks.length - 1}
                          title="Nach unten"
                          aria-label={`${t.title} nach unten`}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => onRemoveTrack(t.id)}
                          title="Entfernen"
                          aria-label={`${t.title} aus Set entfernen`}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {transition && (
                      <div className="transition">
                        Übergang #{i + 1} → #{i + 2}:{' '}
                        <strong className={transition.kind === 'warning' ? 'warning' : ''}>
                          {transition.label}
                        </strong>{' '}
                        ({t.key ?? '–'} → {transition.key ?? '–'}) · {bpmDiff}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="setfoot">
            <span id="setFooterText">
              {tracks.length
                ? `${tracks.length} ${tracks.length === 1 ? 'Titel' : 'Titel'} · Gesamtdauer ${duration(totalSeconds)} (${totalMinutes} Min.)`
                : 'Noch keine Titel im Set'}
            </span>
            <div className="flex">
              <button
                id="clearSet"
                disabled={tracks.length === 0}
                title="Entfernt alle Tracks aus dieser lokalen Setliste (Rekordbox-Datenbank bleibt unberührt)"
                onClick={onClearSet}
              >
                Set leeren
              </button>
              <button
                id="explainImport"
                title="Erklärt, wie du die vorbereiteten Tracks sicher und nicht-destruktiv nach Rekordbox übernimmst"
                onClick={onExplainImport}
              >
                ↗ &nbsp; Rekordbox-Übergabe
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pane">
        <div className="panehead">
          <h2>Set-Check</h2>
          <span
            className="aside"
            title="Analysiert BPM-Sprünge und Camelot-Übergänge rein lokal ohne Schreibzugriff auf Rekordbox"
          >
            nicht-destruktiv ⓘ
          </span>
        </div>
        <div className="panebody">
          <div className="setstats">
            <div className="statbox" title="Anzahl der Tracks in deiner aktuellen Setliste">
              <span className="muted">Tracks</span>
              <strong id="statTracks">{tracks.length}</strong>
            </div>
            <div className="statbox" title="Summierte Gesamtlaufzeit aller Tracks im Set">
              <span className="muted">Dauer</span>
              <strong id="statDuration">{duration(totalSeconds)}</strong>
            </div>
            <div className="statbox" title="Niedrigste bis höchste BPM im Set">
              <span className="muted">BPM-Spanne</span>
              <strong id="statBpm">{bpmSpan}</strong>
            </div>
            <div className="statbox" title="Anzahl harmonisch kompatibler Übergänge (gleicher Key oder Camelot ±1 / Parallelwechsel) von Track zu Track">
              <span className="muted">Harmonische Übergänge</span>
              <strong id="statMatches">{matchStat}</strong>
            </div>
          </div>

          <div className="sectiontitle">Empfohlener Ablauf</div>
          <ol className="prepnotes">
            <li>Tracks über Live-Match oder freie Filter finden.</li>
            <li>
              Treffer mit <strong>+ Set</strong> übernehmen.
            </li>
            <li>Tracks hier per Drag-and-drop oder Pfeile sortieren.</li>
            <li>BPM- und Key-Übergänge kontrollieren.</li>
            <li>Set lokal exportieren; Rekordbox-Import separat integrieren.</li>
          </ol>

          <div className="readonly-banner">
            <strong>Rekordbox-Schutz:</strong> Keine Schreibzugriffe auf <code>master.db</code>.
            Der Button „In Rekordbox finden“ bietet eine kopierbare Suche und Dateipfad-Vorschau,
            damit Originale jederzeit unverändert bleiben.
          </div>

          <div className="sep" />
          <button className="w100" id="goFilterFromSet" onClick={onFindTracks}>
            ☷ &nbsp; Weitere Tracks suchen
          </button>
        </div>
      </div>
    </section>
  )
}


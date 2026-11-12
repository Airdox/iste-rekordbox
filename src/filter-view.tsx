import { useState } from 'react'
import { SortingState } from '@tanstack/react-table'
import { Results, Track, bpmText, count, duration } from './api'
import { KeyBadge } from './components'
import {
  FilterPreset,
  MetadataId,
  Operator,
  RuleGroup,
  SortStage,
  fields,
  metadata,
  opsText,
} from './metadata'
import { TrackTable } from './track-table'

type FilterViewProps = {
  active: boolean
  presets: FilterPreset[]
  selectedPresetId: string
  onSelectPreset: (presetId: string) => void
  onOpenSavePreset: () => void
  onResetFilters: () => void
  groupLogic: 'AND' | 'OR'
  onGroupLogicChange: (logic: 'AND' | 'OR') => void
  groups: RuleGroup[]
  onAddGroup: () => void
  onRemoveGroup: (groupUid: number) => void
  onGroupModeChange: (groupUid: number, mode: 'AND' | 'OR') => void
  onAddRule: (groupUid: number) => void
  onRemoveRule: (groupUid: number, ruleUid: number) => void
  onRuleChange: (
    groupUid: number,
    ruleUid: number,
    patch: Partial<{ id: MetadataId; op: Operator; value: string }>,
  ) => void
  onApplyFilter: () => void
  search: string
  onSearchChange: (value: string) => void
  sortStages: SortStage[]
  onSortStagesChange: (stages: SortStage[]) => void
  results: Results | null
  totalLibraryCount: number
  busy: boolean
  revision: number
  visibleColumns: MetadataId[]
  onVisibleColumnsChange: (columns: MetadataId[]) => void
  referenceKey: string
  selectedTrack: Track | null
  onSelectTrack: (track: Track) => void
  onPinReference: (track: Track) => void
  onAddToSet: (track: Track) => void
  onRemoveFromSet: (trackId: string) => void
  onFindRekordbox: (track: Track) => void
  onRekordboxAction?: (track: Track, action: 'reveal' | 'deck1' | 'deck2') => void
  onExportFilteredM3u8?: (tracks: Track[]) => void
  setTracks: Track[]
  setIds: Set<string>
  onOpenSetBuilder: () => void
}

export function FilterView({
  active,
  presets,
  selectedPresetId,
  onSelectPreset,
  onOpenSavePreset,
  onResetFilters,
  groupLogic,
  onGroupLogicChange,
  groups,
  onAddGroup,
  onRemoveGroup,
  onGroupModeChange,
  onAddRule,
  onRemoveRule,
  onRuleChange,
  onApplyFilter,
  search,
  onSearchChange,
  sortStages,
  onSortStagesChange,
  results,
  totalLibraryCount,
  busy,
  revision,
  visibleColumns,
  onVisibleColumnsChange,
  referenceKey,
  selectedTrack,
  onSelectTrack,
  onPinReference,
  onAddToSet,
  onRemoveFromSet,
  onFindRekordbox,
  onRekordboxAction,
  onExportFilteredM3u8,
  setTracks,
  setIds,
  onOpenSetBuilder,
}: FilterViewProps) {
  const [designerOpen, setDesignerOpen] = useState(false)
  const rows = results?.rows ?? []

  const activeRuleLabels = groups.flatMap((g) =>
    g.rules
      .filter((r) => r.op === 'empty' || r.value.trim())
      .map((r) => {
        const f = metadata.get(r.id)
        const label = (f && 'shortLabel' in f ? f.shortLabel : f?.label) ?? r.id
        return r.op === 'empty'
          ? `${label} ${opsText[r.op]}`
          : `${label} ${opsText[r.op]} ${r.value.trim()}`
      }),
  )

  const tableSorting: SortingState = sortStages.map((st) => ({ id: st.id, desc: st.desc }))

  const handleHeaderSort = (next: SortingState) => {
    if (!next.length) {
      onSortStagesChange([])
      return
    }
    onSortStagesChange(
      next.map((item) => ({
        id: item.id as MetadataId,
        desc: Boolean(item.desc),
      })),
    )
  }

  const updateStage = (idx: number, patch: Partial<SortStage>) => {
    onSortStagesChange(
      sortStages.map((st, i) => (i === idx ? { ...st, ...patch } : st)),
    )
  }

  const moveStage = (idx: number, delta: -1 | 1) => {
    const target = idx + delta
    if (target < 0 || target >= sortStages.length) return
    const copy = [...sortStages]
    const [picked] = copy.splice(idx, 1)
    copy.splice(target, 0, picked)
    onSortStagesChange(copy)
  }

  const removeStage = (idx: number) => {
    onSortStagesChange(sortStages.filter((_, i) => i !== idx))
  }

  const addStage = () => {
    const used = new Set(sortStages.map((s) => s.id))
    const nextField = fields.find((f) => !used.has(f.id))?.id ?? 'title'
    onSortStagesChange([...sortStages, { id: nextField, desc: false }])
  }

  return (
    <section
      className={`view filterview ${active ? 'active' : ''}`}
      id="view-filter"
      aria-label="Freies Filter-Studio"
    >
      <div className="pane">
        <div className="panehead">
          <h2>
            Freie Filter-Kaskade{' '}
            <span
              className="infotip"
              title="Kombiniere beliebig viele UND-/ODER-Regelgruppen über alle 18 Rekordbox-Metadatenfelder – unabhängig vom Live-Deck."
            >
              ⓘ
            </span>
          </h2>
          <button
            className="sm"
            id="resetFilters"
            title="Setzt alle Regelgruppen, Vorlagen und die Freitextsuche auf den Ausgangszustand zurück"
            onClick={onResetFilters}
          >
            Zurücksetzen
          </button>
        </div>

        <div className="filter-scroll">
          <div className="filterintro">
            Unabhängig vom Live-Track. Bilde frei kombinierbare{' '}
            <strong>UND-/ODER-Regelgruppen</strong>, durchsuche alle Metadaten und speichere
            Filter-Vorlagen.
          </div>

          <div style={{ marginTop: 11, display: 'flex', gap: 6 }}>
            <select
              id="presetSelect"
              aria-label="Filter-Vorlage wählen"
              title="Lädt eine vordefinierte oder selbst gespeicherte Filter-Kaskade"
              style={{ flex: 1 }}
              value={selectedPresetId}
              onChange={(e) => {
                if (e.target.value) onSelectPreset(e.target.value)
              }}
            >
              <option value="">Filter-Vorlage wählen ...</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="sm"
              id="savePreset"
              title="Speichert die aktuelle UND/ODER-Filterkaskade als eigene Vorlage in der Seitenleiste"
              onClick={onOpenSavePreset}
            >
              Speichern
            </button>
          </div>

          <div className="sep" />

          <div className="flex space">
            <span className="kicker">
              Regelgruppen verknüpfen mit{' '}
              <span
                className="infotip"
                title="UND = alle Gruppen müssen zutreffen; ODER = es reicht, wenn mindestens eine Gruppe zutrifft."
              >
                ⓘ
              </span>
            </span>
            <select
              id="groupLogic"
              aria-label="Regelgruppen verknüpfen"
              title="Verknüpfungslogik zwischen mehreren Regelgruppen wählen (UND / ODER)"
              value={groupLogic}
              onChange={(e) => onGroupLogicChange(e.target.value as 'AND' | 'OR')}
            >
              <option value="AND">UND</option>
              <option value="OR">ODER</option>
            </select>
          </div>

          <div id="ruleGroups">
            {groups.map((g, gi) => (
              <div key={g.uid}>
                {gi > 0 && (
                  <div className="dividertext">
                    {groupLogic === 'AND' ? 'UND' : 'ODER'}
                  </div>
                )}
                <div className="groupbox" data-group={g.uid}>
                  <div className="grouphead">
                    <span className="smalllabel">Regelgruppe #{gi + 1}</span>
                    <div className="flex">
                      <select
                        aria-label={`Verknüpfung Regelgruppe ${gi + 1}`}
                        title="Bestimmt, ob innerhalb dieser Gruppe alle Regeln (UND) oder mindestens eine (ODER) erfüllt sein müssen"
                        value={g.mode}
                        onChange={(e) =>
                          onGroupModeChange(g.uid, e.target.value as 'AND' | 'OR')
                        }
                      >
                        <option value="AND">Alle (UND)</option>
                        <option value="OR">Eine (ODER)</option>
                      </select>
                      {groups.length > 1 && (
                        <button
                          className="sm"
                          onClick={() => onRemoveGroup(g.uid)}
                          title="Diese Regelgruppe komplett entfernen"
                          aria-label={`Regelgruppe ${gi + 1} entfernen`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {g.rules.map((r) => (
                    <div className="rule" key={r.uid}>
                      <select
                        aria-label="Metadaten-Feld"
                        title="Metadaten-Feld für diese Filterregel wählen (z. B. BPM, Genre, Camelot-Key, Bewertung)"
                        value={r.id}
                        onChange={(e) =>
                          onRuleChange(g.uid, r.uid, { id: e.target.value as MetadataId })
                        }
                      >
                        {fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Vergleichsoperator"
                        title="Vergleichsoperator wählen – ‚zwischen‘ akzeptiert Zahlenbereiche wie 134..142"
                        value={r.op}
                        onChange={(e) =>
                          onRuleChange(g.uid, r.uid, { op: e.target.value as Operator })
                        }
                      >
                        {(Object.keys(opsText) as Operator[]).map((op) => (
                          <option key={op} value={op}>
                            {opsText[op]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        aria-label="Filterwert"
                        title="Suchwert eingeben (bei ‚zwischen‘ als Bereich wie 134..142)"
                        disabled={r.op === 'empty'}
                        value={r.value}
                        placeholder={r.op === 'range' ? '134..142' : r.op === 'empty' ? '—' : 'Wert'}
                        onChange={(e) =>
                          onRuleChange(g.uid, r.uid, { value: e.target.value })
                        }
                      />
                      <button
                        className="sm"
                        onClick={() => onRemoveRule(g.uid, r.uid)}
                        title="Diese Filterregel entfernen"
                        aria-label="Regel entfernen"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <button
                    className="sm ghost"
                    title="Fügt dieser Gruppe eine weitere Filterbedingung hinzu"
                    onClick={() => onAddRule(g.uid)}
                    style={{ marginTop: 4 }}
                  >
                    + &nbsp; Regel in Gruppe
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            className="groupplus"
            id="addGroup"
            title="Erstellt eine neue Regelgruppe, die mit den bestehenden Gruppen per UND/ODER verknüpft wird"
            onClick={onAddGroup}
          >
            + &nbsp; Neue Regelgruppe
          </button>

          <div className="sep" />
          <div className="hint">
            Beispiel: (Genre = Techno ODER Hardgroove) <strong>UND</strong> (BPM 134–142){' '}
            <strong>UND</strong> (Rating ≥ 4). Leere Regeln werden ignoriert.
          </div>
        </div>

        <div className="panefoot">
          <div className="filteractions">
            <button
              className="primary"
              id="applyFilter"
              title="Wendet alle aktiven Filterregeln und Sortierstufen auf die Bibliothek an"
              onClick={onApplyFilter}
            >
              Filter aktualisieren
            </button>
            <button
              id="sendSelectionToSet"
              disabled={!selectedTrack}
              title="Fügt den aktuell markierten Track direkt zum Set-Korb hinzu"
              onClick={() => selectedTrack && onAddToSet(selectedTrack)}
            >
              + &nbsp; Auswahl zum Set
            </button>
          </div>
        </div>
      </div>

      <div className="pane resultpane">
        <div className="panehead">
          <h2>Bibliothek durchsuchen</h2>
          <span className="aside" id="filterHeadingCount">
            {results
              ? `${count(results.rows.length)} Treffer · ${results.ms.toFixed(1)} ms`
              : 'Lade …'}
          </span>
        </div>

        <div className="resultsbar">
          <div className="searchbox">
            <span className="magnify">⌕</span>
            <input
              id="filterSearch"
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Freitext: Titel, Interpret, Album, Label, Kommentar ..."
              aria-label="Freitextsuche"
              title="Durchsucht Titel, Interpret, Album, Label und Kommentar unabhängig von den Regelgruppen (Tastenkürzel: Strg+F)"
            />
          </div>
          <button
            id="toggleSortDesigner"
            title="Mehrstufige Sortierkaskade (#1, #2, #3 ...) öffnen oder schließen"
            onClick={() => setDesignerOpen((prev) => !prev)}
          >
            ⇅ Sortierkaskade <span id="sortCount">({sortStages.length})</span>
          </button>
          <button
            id="exportFilterM3u8"
            disabled={rows.length === 0}
            title="Exportiert alle aktuell gefilterten Treffer als M3U8-Playlist für den direkten Import in Rekordbox"
            onClick={() => onExportFilteredM3u8?.(rows)}
          >
            ↓ M3U8
          </button>
        </div>

        <div className="results-sub" id="filterSummary">
          {activeRuleLabels.map((txt, i) => (
            <span className="filterbadge" key={`r-${i}`}>
              {txt}
            </span>
          ))}
          {search.trim() && (
            <span className="filterbadge">Suche: „{search.trim()}“</span>
          )}
          {!activeRuleLabels.length && !search.trim() && (
            <span className="muted" style={{ fontSize: 11 }}>
              Alle {count(totalLibraryCount)} Tracks ohne Filter
            </span>
          )}
        </div>

        <div className="sortcascade" id="sortCascadeBar">
          <span
            className="leader"
            title="Aktive mehrstufige Sortierprioritäten von links (#1) nach rechts"
          >
            SORT
            <span
              className="infotip"
              title="Sortiert zuerst nach Stufe 1; bei identischen Werten entscheidet Stufe 2 usw. Klick auf Spaltenköpfe oder ‚Sortierkaskade‘ zum Anpassen."
            >
              ⓘ
            </span>
            :
          </span>
          {sortStages.length ? (
            sortStages.map((st, idx) => {
              const f = metadata.get(st.id)
              const label = (f && 'shortLabel' in f ? f.shortLabel : f?.label) ?? st.id
              return (
                <span key={`${st.id}-${idx}`} className="sort-stage-wrap">
                  {idx > 0 && <span style={{ color: '#7d95ac', marginRight: 5 }}>›</span>}
                  <span className="stages" title={`Sortierstufe ${idx + 1}: ${label} (${st.desc ? 'absteigend' : 'aufsteigend'})`}>
                    {idx + 1}. {label} {st.desc ? '↓' : '↑'}
                  </span>
                </span>
              )
            })
          ) : (
            <span className="muted">Keine Sortierstufe (Titel A–Z)</span>
          )}
        </div>

        <div className="sortdesigner" id="sortDesigner" hidden={!designerOpen}>
          <div className="flex space" style={{ marginBottom: 9 }}>
            <strong style={{ fontSize: 12 }}>Sortierprioritäten festlegen</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              von oben nach unten
            </span>
          </div>
          {sortStages.map((st, idx) => (
            <div className="sortrow" key={`stage-${idx}`}>
              <span className="ord">#{idx + 1}</span>
              <select
                aria-label={`Sortierfeld Stufe ${idx + 1}`}
                title="Metadaten-Feld für diese Sortierstufe wählen"
                value={st.id}
                onChange={(e) => updateStage(idx, { id: e.target.value as MetadataId })}
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {'shortLabel' in f ? f.shortLabel : f.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => updateStage(idx, { desc: !st.desc })}
                title="Richtung umschalten"
              >
                {st.desc ? '↓ DESC' : '↑ ASC'}
              </button>
              <button
                onClick={() => moveStage(idx, -1)}
                title="Stufe höher"
                disabled={idx === 0}
              >
                ↑
              </button>
              <button
                onClick={() => moveStage(idx, 1)}
                title="Stufe tiefer"
                disabled={idx === sortStages.length - 1}
              >
                ↓
              </button>
              <button onClick={() => removeStage(idx)} title="Stufe entfernen">
                ×
              </button>
            </div>
          ))}
          <div className="flex space">
            <button
              className="sm"
              id="addSortStage"
              title="Fügt eine weitere nachrangige Sortierstufe zur Kaskade hinzu"
              onClick={addStage}
            >
              + Sortierstufe hinzufügen
            </button>
            <button
              className="sm"
              id="closeSortDesigner"
              title="Schließt den Sortierkaskaden-Editor"
              onClick={() => setDesignerOpen(false)}
            >
              Schließen
            </button>
          </div>
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
          onPinReference={onPinReference}
          onAddToSet={onAddToSet}
          onFindRekordbox={onFindRekordbox}
          onRekordboxAction={onRekordboxAction}
          setIds={setIds}
          emptyTitle="Keine Tracks entsprechen diesen Regeln."
          emptyActionLabel="Filter zurücksetzen"
          onEmptyAction={onResetFilters}
        />

        <div className="tablefooter">
          <span id="filterStatus">
            {count(rows.length)} von {count(totalLibraryCount)} Tracks sichtbar
          </span>
          <span>Filter wechseln, Setliste bleibt unverändert</span>
        </div>
      </div>

      <div className="pane queue-pane">
        <div className="panehead">
          <h2>
            Set-Korb{' '}
            <span
              className="infotip"
              title="Schnellzugriff auf dein vorbereitetes Set – synchron mit Live-Match und Set-Builder."
            >
              ⓘ
            </span>
          </h2>
          <span className="aside" id="queueCount">
            {setTracks.length} {setTracks.length === 1 ? 'Track' : 'Tracks'}
          </span>
        </div>

        <div className="panebody">
          <div className="smallsettitle">Mein nächstes Set</div>
          <div className="smallsetdesc">
            Track auswählen, „+ Set“ klicken. Der Korb bleibt in Live-Match und Filter-Studio
            identisch.
          </div>
          <div className="sep" />

          <div id="queuePreview">
            {setTracks.length ? (
              <>
                {setTracks.slice(0, 4).map((t, i) => (
                  <div className="queueitem" key={t.id}>
                    <span className="queueindex">{i + 1}.</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong className="title-ellipsis">{t.title}</strong>
                      <small>
                        {t.artist} · {bpmText(t.bpm)} BPM · {t.key ?? '–'}
                      </small>
                    </div>
                    <button
                      className="sm ghost"
                      title="Track aus dem Set-Korb entfernen"
                      onClick={() => onRemoveFromSet(t.id)}
                      aria-label={`${t.title} entfernen`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {setTracks.length > 4 && (
                  <div className="hint" style={{ marginTop: 7 }}>
                    + {setTracks.length - 4} weitere im Set-Builder
                  </div>
                )}
              </>
            ) : (
              <div className="queueempty">
                Noch leer. Klicke bei einem Track auf <strong>+ Set</strong>, um ihn vorzumerken.
              </div>
            )}
          </div>

          <div className="sep" />
          <div className="kicker">Ausgewählter Track</div>
          <div id="filterInspector">
            {selectedTrack ? (
              <div className="trackinspect">
                <div className="title">{selectedTrack.title}</div>
                <div className="meta">
                  {selectedTrack.artist || 'Unbekannt'} · {selectedTrack.year ?? '–'}
                </div>
                <div
                  className="meta"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                >
                  <span>{bpmText(selectedTrack.bpm)} BPM</span>
                  <KeyBadge value={selectedTrack.key} reference={referenceKey} />
                  <span>
                    {selectedTrack.genre || '–'} · {duration(selectedTrack.seconds)}
                  </span>
                </div>
                <div className="btnrow">
                  <button
                    className="primary sm"
                    title="Fügt diesen Track zum Set-Korb hinzu"
                    onClick={() => onAddToSet(selectedTrack)}
                  >
                    + Set
                  </button>
                  <button
                    className="sm"
                    title="Markiert und sucht den Track direkt in der offenen Rekordbox-App (oder öffnet Suchhilfe)"
                    onClick={() =>
                      onRekordboxAction
                        ? onRekordboxAction(selectedTrack, 'reveal')
                        : onFindRekordbox(selectedTrack)
                    }
                  >
                    ↗ In Rekordbox
                  </button>
                  <button
                    className="sm"
                    title="Sucht den Track in Rekordbox und lädt ihn direkt in Deck A (Deck 1)"
                    onClick={() => onRekordboxAction?.(selectedTrack, 'deck1')}
                  >
                    ▶ Deck A
                  </button>
                  <button
                    className="sm"
                    title="Sucht den Track in Rekordbox und lädt ihn direkt in Deck B (Deck 2)"
                    onClick={() => onRekordboxAction?.(selectedTrack, 'deck2')}
                  >
                    ▶ Deck B
                  </button>
                  <button
                    className="sm ghost"
                    title="Öffnet Track-Details, Dateipfad im Explorer und kopierbaren Suchtext"
                    onClick={() => onFindRekordbox(selectedTrack)}
                  >
                    ⌕ Details
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
            className="primary w100"
            id="queueOpen"
            title="Öffnet den Set-Builder mit Reihenfolge-Check, Übergangsanalyse und Export (M3U8 / XML / CSV)"
            onClick={onOpenSetBuilder}
          >
            Set-Builder öffnen
          </button>
          <div className="hint" style={{ marginTop: 9 }}>
            Das Set wird lokal gespeichert, nicht in die Rekordbox-Datenbank geschrieben.
          </div>
        </div>
      </div>
    </section>
  )
}

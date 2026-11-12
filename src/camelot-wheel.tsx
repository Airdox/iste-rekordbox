import { relatedKeys } from './api'

function pt(x: number, y: number, r: number, angle: number): [number, number] {
  return [x + r * Math.cos(angle * Math.PI / 180), y + r * Math.sin(angle * Math.PI / 180)]
}

function pathWedge(r1: number, r2: number, start: number, end: number) {
  const p1 = pt(160, 160, r2, start)
  const p2 = pt(160, 160, r2, end)
  const p3 = pt(160, 160, r1, end)
  const p4 = pt(160, 160, r1, start)
  return `M${p1[0]} ${p1[1]} A${r2} ${r2} 0 0 1 ${p2[0]} ${p2[1]} L${p3[0]} ${p3[1]} A${r1} ${r1} 0 0 0 ${p4[0]} ${p4[1]}Z`
}

export function CamelotWheel({
  referenceKey,
  pinned,
  selectedKeys,
  autoFollow,
  includeCurrent,
  onToggleKey,
  onSelectAllHarmonic,
  onAutoFollowChange,
  onIncludeCurrentChange,
}: {
  referenceKey: string
  pinned: boolean
  selectedKeys: string[]
  autoFollow: boolean
  includeCurrent: boolean
  onToggleKey: (key: string, additive: boolean) => void
  onSelectAllHarmonic: () => void
  onAutoFollowChange: (value: boolean) => void
  onIncludeCurrentChange: (value: boolean) => void
}) {
  const compatible = relatedKeys(referenceKey)
  const segments: { key: string; ring: 'A' | 'B'; start: number; end: number }[] = []
  for (let i = 1; i <= 12; i++) {
    const start = -90 + (i - 1) * 30
    const end = start + 30
    segments.push({ key: `${i}B`, ring: 'B', start, end })
    segments.push({ key: `${i}A`, ring: 'A', start, end })
  }

  return <>
    <div className="hint">
      Der laufende Track ist <strong>blau</strong>, harmonisch kompatible Nachbarn sind <strong>hell markiert</strong>. Klick = genau dieser Key. Strg-Klick = mehrere Keys.
    </div>
    <div className="wheelwrap">
      <svg className="wheel" viewBox="0 0 320 320" role="group" aria-label="Interaktives Camelot Wheel">
        {segments.map(({ key, ring, start, end }) => {
          const isSelected = selectedKeys.includes(key)
          const isCurrent = key === referenceKey
          const isCompat = compatible.includes(key)
          const r1 = ring === 'A' ? 70 : 114
          const r2 = ring === 'A' ? 113 : 151
          const [cx, cy] = pt(160, 160, ring === 'A' ? 91 : 132, start + 15)
          const fill = isCurrent ? '#276eb8' : isSelected ? '#315d83' : isCompat ? '#344b60' : (ring === 'A' ? '#272e37' : '#222831')
          const stroke = isCurrent ? '#99c7ff' : isSelected ? '#618cb5' : '#4a535d'
          return <g key={key} role="button" tabIndex={0} className="region" data-wheel-key={key}
            aria-label={`${key}${isCurrent ? ', aktuell' : ''}${isCompat ? ', harmonisch kompatibel' : ''}${isSelected ? ', als Filter gewählt' : ''}`}
            onClick={(event) => onToggleKey(key, event.ctrlKey || event.shiftKey || event.metaKey)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleKey(key, event.ctrlKey || event.shiftKey || event.metaKey)
              }
            }}>
            <title>
              {`${key}${isCurrent ? ' · Aktuelle Referenz' : isCompat ? ' · Harmonisch kompatibel' : ''}${isSelected ? ' · Aktiv im Filter' : ''} – Klick: nur diesen Key · Strg+Klick: mehrfach wählen`}
            </title>
            <path d={pathWedge(r1, r2, start + 0.35, end - 0.35)} stroke={stroke} strokeWidth={isCurrent ? 2 : 1} fill={fill} />
            <text x={cx} y={cy} className={isCurrent ? 'activekey' : undefined}>{key}</text>
          </g>
        })}
        <circle cx={160} cy={160} r={67} className="wheelcenter" />
        <text x={160} y={155} textAnchor="middle" className="wheelcentertext">{referenceKey}</text>
        <text x={160} y={174} textAnchor="middle" className="wheeldesc">{pinned ? 'Fixierte Referenz' : 'Live-Referenz'}</text>
      </svg>
    </div>
    <div className="kicker">Schnellwahl für aktuellen Track</div>
    <div className="keychooser">
      {compatible.map((key) => (
        <button key={key} type="button"
          className={`keychip ${selectedKeys.includes(key) ? 'active' : ''} ${key === referenceKey ? 'current' : ''}`}
          data-key={key}
          title={`${key} ${key === referenceKey ? '(aktuelle Tonart)' : '(harmonischer Nachbar)'} – Klick: einzeln · Strg+Klick: hinzufügen/abwählen`}
          onClick={(event) => onToggleKey(key, event.ctrlKey || event.shiftKey || event.metaKey)}>
          {key}
        </button>
      ))}
    </div>
    <button type="button" id="allHarmonic" className="w100 sm" style={{ marginTop: 7 }}
      title="Wählt alle 4 harmonisch passenden Camelot-Keys (-1, Referenz, +1 sowie A/B-Wechsel)"
      onClick={onSelectAllHarmonic}>
      Alle harmonisch passenden Keys wählen
    </button>
    <div className="note" id="wheelNotice">
      {selectedKeys.length ? `Aktive Keys: ${selectedKeys.join(', ')}` : 'Keine Keys gewählt – klicke ein Segment'}
    </div>
    <div className="sep" />
    <label className="checkrow" title="Passt die gewählten kompatiblen Keys automatisch an, sobald ein neuer Track auf dem aktiven Deck läuft">
      <input type="checkbox" id="autoFollow" checked={autoFollow} onChange={(event) => onAutoFollowChange(event.target.checked)} />
      Bei Trackwechsel automatisch folgen
    </label>
    <label className="checkrow" title="Bezieht die exakt gleiche Tonart des Referenztracks zusätzlich zu den Nachbar-Keys ein">
      <input type="checkbox" id="includeCurrent" checked={includeCurrent} onChange={(event) => onIncludeCurrentChange(event.target.checked)} />
      Aktuellen Key einschließen
    </label>
    <div className="navhint">
      Klick auf ein Wheel-Segment = nur dieser Key. Mit Strg-Klick mehrere Keys kombinieren. „Alle harmonischen Keys“ setzt die ganze Auswahl. Der Live-Modus nutzt zusätzlich deine BPM- und Genre-Vorgaben.
    </div>
  </>
}


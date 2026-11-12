import { Disc3, Fingerprint, Sparkles } from 'lucide-react'
import { basename, bpmText, count, duration, type Detail } from './api'
import { Empty, KeyBadge, Stars, Waveform } from './components'

const date = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : value

export function TrackDetail({ track, pending, onMatch }: {
  track: Detail | null; pending: boolean; onMatch: (track: Detail) => void
}) {
  const fields = track ? [
    ['Genre', track.genre],
    ['Album', track.album],
    ['Label', track.label],
    ['Jahr', track.year || ''],
    ['Hinzugefügt', date(track.added)],
    ['Erstellt', date(track.created)],
    ['Plays', track.plays === null ? '' : count(track.plays)],
    ['Audio', [track.bitrate && `${track.bitrate} kb/s`, track.sample_rate && `${track.sample_rate / 1000} kHz`].filter(Boolean).join(' · ')],
    ['Dateigröße', track.bytes ? `${(track.bytes / 1_000_000).toFixed(1)} MB` : ''],
  ].filter(([, value]) => value !== '') : []
  return <aside className="panel details-panel">
    <div className="panel-heading">
      <div className="heading-icon"><Fingerprint size={16} /><h2>Track-Details</h2></div>
    </div>
    {track ? <div className="details-scroll">
      <div className="track-preview">
        <Waveform samples={track.waveform} />
        <div className="wave-time mono"><span>0:00</span><span>{duration(track.seconds)}</span></div>
      </div>
      <div className="track-identity">
        <h3>{track.title || 'Ohne Titel'}</h3>
        <p>{track.artist || 'Unbekannter Interpret'}</p>
        <Stars value={track.rating} />
      </div>
      <div className="track-stats">
        <div><span>BPM</span><strong className="mono tempo">{bpmText(track.bpm)}</strong></div>
        <div title={track.key_raw}><span>Tonart</span><KeyBadge value={track.key} /></div>
        <div><span>Dauer</span><strong className="mono">{duration(track.seconds)}</strong></div>
      </div>
      <button className="button match-button" disabled={track.bpm === null} onClick={() => onMatch(track)}>
        <Sparkles size={15} /> Ähnliche Tracks finden
      </button>
      {fields.length > 0 && <dl className="metadata">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></div>)}
      </dl>}
      {track.comment && <div className="track-note"><span>Kommentar</span><p>{track.comment}</p></div>}
      {track.path && <div className="track-note" title={track.path}><span>Datei</span><p>{basename(track.path)}</p></div>}
    </div> : <Empty icon={<Disc3 size={25} />} title={pending ? 'Track wird geladen' : 'Kein Track ausgewählt'} />}
  </aside>
}

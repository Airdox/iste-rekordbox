import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { relatedKeys } from './api'

export function KeyBadge({ value, reference }: { value: string | null; reference?: string | null }) {
  if (!value) return <span className="muted">—</span>
  const isMatch = Boolean(reference && relatedKeys(reference).includes(value))
  return <span className={`keybadge ${isMatch ? 'match' : ''}`}>{value}</span>
}

export function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)))
  return <span className="stars" aria-label={`${filled} von 5 Sternen`}>
    {'★'.repeat(filled)}
    <span className="stars-empty">{'☆'.repeat(5 - filled)}</span>
  </span>
}

function hashSeed(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash) % 10000
}

export function MiniWave({ trackId }: { trackId: string }) {
  const bars = useMemo(() => {
    const seed = hashSeed(trackId)
    const out: { x: number; y: number; h: number }[] = []
    for (let i = 0; i < 32; i++) {
      const h = 2 + Math.round(Math.abs(Math.sin(i * 2.12 + seed * 0.7) * Math.cos(i * 0.9 + seed * 0.3)) * 15)
      out.push({ x: i * 2.5, y: 11 - h / 2, h })
    }
    return out
  }, [trackId])
  return <svg className="wfmini" viewBox="0 0 80 22" aria-hidden="true">
    {bars.map((bar, idx) => <rect key={idx} x={bar.x} y={bar.y} width="1.6" height={bar.h} fill="#679bc8" />)}
  </svg>
}

export function LiveWaveform({ samples = [], seedId }: { samples?: number[]; seedId: string }) {
  const bars = useMemo(() => {
    if (samples.length > 0) {
      const count = 225
      return Array.from({ length: count }, (_, i) => {
        const start = Math.floor(i * samples.length / count)
        const end = Math.max(start + 1, Math.floor((i + 1) * samples.length / count))
        const peak = Math.max(...samples.slice(start, end))
        const h = Math.max(4, Math.min(39, 4 + (peak / 31) * 35))
        return { x: i * 3.8 + 2, y: 24 - h / 2, h, bright: i > 140, op: 0.6 + (0.4 * (i % 7) / 7) }
      })
    }
    const seed = hashSeed(seedId || '0')
    return Array.from({ length: 225 }, (_, i) => {
      const amp = Math.abs(Math.sin(i * 2.65 + seed * 0.03) * Math.cos(i * 0.19 + seed * 0.07) + Math.sin(i * 0.77) * 0.5) + 0.2
      const h = Math.min(39, 4 + amp * 19)
      return { x: i * 3.8 + 2, y: 24 - h / 2, h, bright: i > 140, op: 0.6 + (0.4 * (i % 7) / 7) }
    })
  }, [samples, seedId])

  return <div className="waveform" aria-label="Track-Analyse Waveform">
    <svg viewBox="0 0 866 48" preserveAspectRatio="none">
      <line x1="0" y1="24" x2="866" y2="24" stroke="#667788" opacity="0.4" />
      {bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={bar.y} width="2.3" height={bar.h} rx="0.5"
          fill={bar.bright ? '#6499c8' : '#457ca9'} opacity={bar.op} />
      ))}
      <line x1="400" y1="0" x2="400" y2="48" stroke="#e1eaf4" strokeWidth="1.5" />
      <rect x="395" y="0" width="10" height="3" fill="#e1eaf4" />
    </svg>
  </div>
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">
    <div className="empty-icon">{icon ?? <FolderOpen size={25} />}</div>
    <strong>{title}</strong>
    {children}
  </div>
}

export type ModalAction = { label: string; primary?: boolean; disabled?: boolean; onClick?: () => void }

export function Modal({ open, title, onClose, children, actions, wide = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; actions: ModalAction[]; wide?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return <div className="modal-backdrop show" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={box} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h2 id="modalTitle">{title}</h2>
      <div className="modal-body">{children}</div>
      <div className="actions">
        {actions.map((action) => (
          <button key={action.label} type="button" className={action.primary ? 'primary' : ''}
            disabled={action.disabled}
            onClick={() => { action.onClick?.(); if (!action.onClick) onClose() }}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  </div>
}

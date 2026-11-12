import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Disc3, FolderOpen, Star } from 'lucide-react'
import { camelotColor } from './api'

export function KeyBadge({ value }: { value: string | null }) {
  return value
    ? <span className="key-badge" style={{ '--key': camelotColor(value) } as CSSProperties}>{value}</span>
    : <span className="muted mono">—</span>
}

export function Stars({ value, onChange }: { value: number; onChange?: (value?: number) => void }) {
  return <span className={`stars ${onChange ? 'interactive-stars' : ''}`} aria-label={`${value} von 5 Sternen`}>
    {[1, 2, 3, 4, 5].map((star) => {
      const icon = <Star size={onChange ? 15 : 11} className={star <= value ? 'filled' : ''} />
      return onChange
        ? <button key={star} aria-label={`Mindestens ${star} Sterne`} aria-pressed={star === value}
          onClick={() => onChange(star === value ? undefined : star)}>{icon}</button>
        : <span key={star}>{icon}</span>
    })}
  </span>
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">
    <div className="empty-icon">{icon ?? <FolderOpen size={25} />}</div>
    <strong>{title}</strong>
    {children}
  </div>
}

export function Waveform({ samples }: { samples: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    const paint = () => {
      const ratio = window.devicePixelRatio
      const width = node.clientWidth
      const height = node.clientHeight
      node.width = width * ratio
      node.height = height * ratio
      const ctx = node.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      ctx.strokeStyle = '#292a3c'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      const bars = Math.min(samples.length, Math.floor(width / 3))
      for (let index = 0; index < bars; index++) {
        const start = Math.floor(index * samples.length / bars)
        const end = Math.floor((index + 1) * samples.length / bars)
        const value = Math.max(...samples.slice(start, end))
        const amplitude = 1 + (value / 31) * (height * 0.43)
        ctx.fillStyle = `hsl(${258 - index / bars * 38} 83% ${49 + value * 0.59}%)`
        ctx.fillRect(index * width / bars, height / 2 - amplitude, 1.7, 2 * amplitude)
      }
    }
    const observer = new ResizeObserver(paint)
    observer.observe(node)
    return () => observer.disconnect()
  }, [samples])
  return <div className="wave-box">
    {samples.length
      ? <canvas ref={canvas} role="img" aria-label="Rekordbox-Wellenform" />
      : <div className="wave-empty"><Disc3 size={38} strokeWidth={1} /><span>Keine Wellenform verfügbar</span></div>}
  </div>
}

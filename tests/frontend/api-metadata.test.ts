import { describe, expect, it, vi } from 'vitest'
import {
  basename,
  bpmText,
  camelotColor,
  count,
  duration,
  exportSetCsv,
  harmonicTransition,
  message,
  relatedKeys,
  request,
  type Track,
} from '../../src/api'
import {
  builtInPresets,
  defaultColumns,
  fields,
  keys,
  loadCustomPresets,
  metadata,
  move,
  opsText,
  saveCustomPresets,
} from '../../src/metadata'

describe('metadata.ts', () => {
  it('exposes complete field definitions, operators, camelot keys and presets', () => {
    expect(fields.length).toBe(18)
    expect(metadata.get('bpm')?.type).toBe('number')
    expect(metadata.get('key')?.type).toBe('key')
    expect(defaultColumns).toEqual(['title', 'artist', 'bpm', 'key', 'genre', 'rating'])
    expect(Object.keys(opsText)).toEqual(['contains', 'eq', 'neq', 'gte', 'lte', 'range', 'empty'])
    expect(keys).toHaveLength(24)
    expect(keys[0]).toBe('1A')
    expect(keys[23]).toBe('12B')
    expect(builtInPresets.map((p) => p.id)).toEqual(['techno', 'warmup', 'unplayed'])
  })

  it('loads and saves custom presets safely across valid, invalid and throwing storage', () => {
    expect(loadCustomPresets()).toEqual([])

    localStorage.setItem('airdox.customPresets', JSON.stringify({ not: 'an-array' }))
    expect(loadCustomPresets()).toEqual([])

    localStorage.setItem(
      'airdox.customPresets',
      JSON.stringify([
        { id: 'c1', name: 'My Peak', logic: 'AND', groups: [] },
        { id: 123, name: 'Bad', groups: [] },
        null,
      ]),
    )
    expect(loadCustomPresets()).toEqual([
      { id: 'c1', name: 'My Peak', logic: 'AND', groups: [], custom: true },
    ])

    localStorage.setItem('airdox.customPresets', '{broken-json')
    expect(loadCustomPresets()).toEqual([])

    saveCustomPresets([{ id: 'c2', name: 'Saved', logic: 'OR', groups: [] }])
    expect(loadCustomPresets()).toHaveLength(1)

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => saveCustomPresets([])).not.toThrow()
    spy.mockRestore()
  })

  it('moves array items cleanly and ignores out-of-bounds or no-op moves', () => {
    const src = ['a', 'b', 'c']
    expect(move(src, -1, 1)).toBe(src)
    expect(move(src, 0, -1)).toBe(src)
    expect(move(src, 5, 1)).toBe(src)
    expect(move(src, 0, 5)).toBe(src)
    expect(move(src, 1, 1)).toBe(src)
    expect(move(src, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(move(src, 2, 0)).toEqual(['c', 'a', 'b'])
  })
})

describe('api.ts', () => {
  it('delegates request() to window.cuepoint.request and formats error messages', async () => {
    const reqMock = vi.fn().mockResolvedValue({ ok: true })
    window.cuepoint = {
      request: reqMock,
      choose: vi.fn(),
      window: vi.fn(),
    }

    await expect(request('query', { limit: 10 })).resolves.toEqual({ ok: true })
    expect(reqMock).toHaveBeenCalledWith('query', { limit: 10 })

    expect(message(new Error("Error invoking remote method 'cuepoint:request': Error: DB gesperrt"))).toBe('DB gesperrt')
    expect(message('Plain error')).toBe('Plain error')
  })

  it('formats counters, bpm, durations, filenames and camelot colors', () => {
    expect(count(15500)).toBe('15.500')
    expect(bpmText(138.5)).toBe('138.50')
    expect(bpmText(null)).toBe('—')
    expect(duration(null)).toBe('—')
    expect(duration(65)).toBe('01:05')
    expect(basename('E:\\Music\\Set\\Track.mp3')).toBe('Track.mp3')
    expect(basename('/Users/dj/track.wav')).toBe('track.wav')
    expect(basename(null)).toBe('')
    expect(camelotColor('8A')).toBe('#c9ace8')
    expect(camelotColor('invalid')).toBe('#a2a6ba')
  })

  it('computes relatedKeys and harmonicTransition accurately including wrap-around 1/12', () => {
    expect(relatedKeys('bad')).toEqual([])
    expect(relatedKeys(' 12a ')).toEqual(['11A', '12A', '1A', '12B'])
    expect(relatedKeys('1B')).toEqual(['12B', '1B', '2B', '1A'])

    expect(harmonicTransition(null, '8A')).toEqual({ label: 'Tonart fehlt', kind: 'warning' })
    expect(harmonicTransition('8A', null)).toEqual({ label: 'Tonart fehlt', kind: 'warning' })
    expect(harmonicTransition('8A', '8A')).toEqual({ label: 'Gleicher Key', kind: 'good' })
    expect(harmonicTransition('8A', '9A')).toEqual({ label: 'Harmonisch benachbart', kind: 'good' })
    expect(harmonicTransition('8A', '8B')).toEqual({ label: 'Harmonisch benachbart', kind: 'good' })
    expect(harmonicTransition('8A', '3B')).toEqual({ label: 'Key-Wechsel prüfen', kind: 'warning' })
  })

  it('exports CSV with BOM, proper quoting, optional nulls and revokes blob URL', () => {
    vi.useFakeTimers()
    const clickSpy = vi.fn()
    const createEl = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createEl(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    })
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-csv')
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const tracks: Track[] = [
      {
        id: '1',
        title: 'Dark "Pulse"',
        artist: 'Klang',
        genre: 'Techno',
        bpm: 138,
        key: '8A',
        rating: 5,
        seconds: 320,
        year: 2024,
      },
      {
        id: '2',
        title: 'Ambient Intro',
        artist: 'Nova',
        genre: 'Ambient',
        bpm: null,
        key: null,
        rating: 0,
        seconds: null,
        year: null,
      },
    ]

    const csv = exportSetCsv(tracks)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Dark ""Pulse"""')
    expect(csv).toContain('"138.00";"8A"')
    expect(csv).toContain('"";"";"Ambient";"0";"";""')
    expect(createUrlSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2000)
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:test-csv')
    vi.useRealTimers()
  })
})

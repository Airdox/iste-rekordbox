import { describe, expect, it, vi } from 'vitest'
import {
  basename,
  bpmText,
  camelotColor,
  count,
  duration,
  exportM3u8Playlist,
  exportRekordboxXml,
  exportSetCsv,
  harmonicTransition,
  message,
  rekordboxTransport,
  relatedKeys,
  request,
  revealFile,
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
    const createdLinks: HTMLAnchorElement[] = []
    const createEl = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createEl(tag)
      if (tag === 'a') {
        el.click = clickSpy
        createdLinks.push(el as HTMLAnchorElement)
      }
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
    expect(csv).toBe(
      '\uFEFF' +
        [
          'Nr;Titel;Interpret;BPM;Camelot;Genre;Rating;Jahr;Dauer (s)',
          '"1";"Dark ""Pulse""";"Klang";"138.00";"8A";"Techno";"5";"2024";"320"',
          '"2";"Ambient Intro";"Nova";"";"";"Ambient";"0";"";""',
        ].join('\r\n'),
    )
    expect((createUrlSpy.mock.calls[0][0] as Blob).type).toBe('text/csv;charset=utf-8')
    expect(createdLinks[0].download).toBe('airdox-setliste.csv')
    expect(createdLinks[0].href).toBe('blob:test-csv')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1999)
    expect(revokeUrlSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:test-csv')
    createSpy.mockRestore()
    createUrlSpy.mockRestore()
    revokeUrlSpy.mockRestore()
    vi.useRealTimers()
  })

  it('covers rekordboxTransport, revealFile, exportM3u8Playlist and exportRekordboxXml strictly', async () => {
    const reqMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: 'sent',
      action: 'deck1',
      deck: 1,
      query: 'Pulse Klang',
      path: 'E:/Music/pulse.mp3',
      copied: true,
      message: 'An Deck 1 gesendet',
    })
    const revealMock = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    window.cuepoint = {
      request: reqMock,
      choose: vi.fn(),
      window: vi.fn(),
      revealFile: revealMock,
    }

    await expect(
      rekordboxTransport({ id: '1', action: 'deck1', query: 'Pulse Klang', path: 'E:/Music/pulse.mp3' }),
    ).resolves.toEqual({
      ok: true,
      reason: 'sent',
      action: 'deck1',
      deck: 1,
      query: 'Pulse Klang',
      path: 'E:/Music/pulse.mp3',
      copied: true,
      message: 'An Deck 1 gesendet',
    })
    expect(reqMock).toHaveBeenCalledWith('rekordboxTransport', {
      id: '1',
      action: 'deck1',
      query: 'Pulse Klang',
      path: 'E:/Music/pulse.mp3',
    })

    await expect(revealFile('E:/Music/pulse.mp3')).resolves.toBe(true)
    expect(revealMock).toHaveBeenCalledWith('E:/Music/pulse.mp3')
    await expect(revealFile('E:/Music/missing.mp3')).resolves.toBe(false)
    expect(revealMock).toHaveBeenCalledWith('E:/Music/missing.mp3')

    // Missing revealFile fallback
    window.cuepoint = {
      request: reqMock,
      choose: vi.fn(),
      window: vi.fn(),
    }
    await expect(revealFile('E:/Music/pulse.mp3')).resolves.toBe(false)

    // M3U8 & Rekordbox XML exports with strict exact assertions
    vi.useFakeTimers()
    const clickSpy = vi.fn()
    const createdLinks: HTMLAnchorElement[] = []
    const createEl = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createEl(tag)
      if (tag === 'a') {
        el.click = clickSpy
        createdLinks.push(el as HTMLAnchorElement)
      }
      return el
    })
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-export')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const tracks: Track[] = [
      {
        id: '1',
        title: "Dark & <Pulse> 'Mix'",
        artist: 'Klang "A"',
        genre: 'Techno & Acid',
        bpm: 138,
        key: '8A',
        rating: 5,
        seconds: 320,
        year: 2024,
        path: 'E:\\Music\\set & mix.mp3',
      },
      {
        id: '2',
        title: '',
        artist: '',
        genre: 'Ambient',
        bpm: null,
        key: null,
        rating: 0,
        seconds: null,
        year: null,
        path: '/Users/dj/ambient track.wav',
      },
      {
        id: '3',
        title: 'Zero Seconds',
        artist: 'Nova',
        genre: 'House',
        bpm: 124.5,
        key: '6A',
        rating: 3,
        seconds: 0,
        year: 2022,
      },
    ]

    const m3uDefault = exportM3u8Playlist(tracks)
    expect(m3uDefault).toBe(
      [
        '#EXTM3U',
        '#EXTINF:320,Klang "A" - Dark & <Pulse> \'Mix\'',
        'E:\\Music\\set & mix.mp3',
        '#EXTINF:-1,Unbekannt - Ohne Titel',
        '/Users/dj/ambient track.wav',
        '#EXTINF:0,Nova - Zero Seconds',
        'Nova - Zero Seconds',
      ].join('\r\n'),
    )
    expect((createUrlSpy.mock.calls[0][0] as Blob).type).toBe('audio/x-mpegurl;charset=utf-8')
    expect(createdLinks[0].download).toBe('airdox-setliste.m3u8')
    expect(createdLinks[0].href).toBe('blob:test-export')

    const m3uCustom = exportM3u8Playlist(tracks, 'custom.m3u8')
    expect(m3uCustom).toBe(m3uDefault)
    expect(createdLinks[1].download).toBe('custom.m3u8')

    const xmlDefault = exportRekordboxXml(tracks)
    expect(xmlDefault).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<DJ_PLAYLISTS Version="1.0.0">',
        '  <PRODUCT Name="airdox Library" Version="1.1.0" Company="airdox"/>',
        '  <COLLECTION Entries="3">',
        '    <TRACK TrackID="1" Name="Dark &amp; &lt;Pulse&gt; &apos;Mix&apos;" Artist="Klang &quot;A&quot;" Genre="Techno &amp; Acid" TotalTime="320" Year="2024" AverageBpm="138.00" Tonality="8A" Location="file://localhost/E:/Music/set%20&amp;%20mix.mp3"/>',
        '    <TRACK TrackID="2" Name="" Artist="" Genre="Ambient" TotalTime="0" Year="" AverageBpm="" Tonality="" Location="file://localhost/Users/dj/ambient%20track.wav"/>',
        '    <TRACK TrackID="3" Name="Zero Seconds" Artist="Nova" Genre="House" TotalTime="0" Year="2022" AverageBpm="124.50" Tonality="6A"/>',
        '  </COLLECTION>',
        '  <PLAYLISTS>',
        '    <NODE Type="0" Name="ROOT" Count="1">',
        '      <NODE Name="airdox Set" Type="1" KeyType="0" Entries="3">',
        '        <TRACK Key="1"/>',
        '        <TRACK Key="2"/>',
        '        <TRACK Key="3"/>',
        '      </NODE>',
        '    </NODE>',
        '  </PLAYLISTS>',
        '</DJ_PLAYLISTS>',
      ].join('\n'),
    )
    expect((createUrlSpy.mock.calls[2][0] as Blob).type).toBe('application/xml;charset=utf-8')
    expect(createdLinks[2].download).toBe('rekordbox-import.xml')
    expect(createdLinks[2].href).toBe('blob:test-export')

    const xmlCustom = exportRekordboxXml(tracks, "Peak & 'Set'", 'peak.xml')
    expect(xmlCustom).toContain('      <NODE Name="Peak &amp; &apos;Set&apos;" Type="1" KeyType="0" Entries="3">')
    expect(createdLinks[3].download).toBe('peak.xml')
    expect(clickSpy).toHaveBeenCalledTimes(4)

    vi.advanceTimersByTime(1999)
    expect(revokeSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:test-export')
    createSpy.mockRestore()
    createUrlSpy.mockRestore()
    revokeSpy.mockRestore()
    vi.useRealTimers()
  })
})

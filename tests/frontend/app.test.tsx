import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/main'

function makeMockBridge(overrides?: {
  liveResponses?: unknown[]
  openFailsOnce?: boolean
  transportOk?: boolean
  revealOk?: boolean
  omitReveal?: boolean
}) {
  const tracks = [
    {
      id: 't1',
      title: 'Acid Horizon',
      artist: 'Klara',
      genre: 'Techno',
      bpm: 138,
      key: '8A',
      rating: 5,
      seconds: 320,
      year: 2024,
      path: 'E:/Music/acid.mp3',
    },
    {
      id: 't2',
      title: 'Velvet Bass',
      artist: 'Mika',
      genre: 'Hardgroove',
      bpm: 139,
      key: '9A',
      rating: 4,
      seconds: 300,
      year: 2023,
    },
  ]

  let liveCall = 0
  let openFailed = false
  const liveQueue = overrides?.liveResponses ?? [
    {
      state: 'rekordbox',
      error: null,
      anchor: 2,
      matches: [],
      media: [{
        source: 1,
        slot: 3,
        path: 'E:/USB/exportLibrary.db',
        kind: 'OneLibrary',
        total: 10,
        genres: 2,
        bpmBounds: [125, 140],
        withKey: 9,
      }],
      decks: [
        {
          deck: 1,
          name: 'rekordbox',
          source: 0,
          slot: 0,
          slotName: 'Rekordbox lokal',
          trackId: 't1',
          bpm: 128,
          key: '7A',
          title: 'Deck One Silent',
          artist: 'Silent DJ',
          libraryId: null,
          playing: true,
          master: false,
          fader: 0,
        },
        {
          deck: 2,
          name: 'rekordbox',
          source: 0,
          slot: 0,
          slotName: 'Rekordbox lokal',
          trackId: 't2',
          bpm: 138,
          key: '9A',
          title: 'Deck Two Live',
          artist: 'Live DJ',
          libraryId: 't2',
          playing: true,
          master: true,
          fader: 1,
        },
      ],
    },
  ]

  const reqSpy = vi.fn(async (method: string, _params?: object) => {
    if (method === 'open' || method === 'openPath') {
      if (overrides?.openFailsOnce && !openFailed) {
        openFailed = true
        throw new Error("Error invoking remote method 'cuepoint:request': Error: Laufwerk E nicht gefunden")
      }
      return {
        path: (_params as { path?: string } | undefined)?.path ?? 'E:/PIONEER/Master/master.db',
        kind: 'Master',
        total: 15500,
        genres: 12,
        bpmBounds: [115, 145],
        withKey: 15000,
      }
    }
    if (method === 'bindMedia') {
      return {
        source: 1,
        slot: 3,
        path: 'E:/USB/exportLibrary.db',
        kind: 'OneLibrary',
        total: 10,
        genres: 2,
        bpmBounds: [125, 140],
        withKey: 9,
      }
    }
    if (method === 'demoLibrary') {
      return {
        path: null,
        kind: 'Demo',
        total: 2,
        genres: 2,
        bpmBounds: [120, 140],
        withKey: 2,
      }
    }
    if (method === 'interfaces') return [{ name: 'LAN', ip: '192.168.1.2' }]
    if (method === 'usb') return ['F:/PIONEER/exportLibrary.db']
    if (method === 'live') {
      const idx = Math.min(liveCall, liveQueue.length - 1)
      liveCall += 1
      return liveQueue[idx]
    }
    if (method === 'query') {
      return {
        rows: tracks,
        counts: [1, 1, 1, 0],
        genres: [{ value: 'Techno', count: 1 }],
        keys: [{ value: '8A', count: 1 }],
        histogram: [{ bpm: 138, count: 1 }],
        ms: 3.1,
      }
    }
    if (method === 'detail') {
      return {
        ...tracks[1],
        album: 'VA',
        label: 'Test',
        added: '2025-01-01',
        created: '2024-01-01',
        path: 'E:/Music/velvet.mp3',
        comment: '',
        key_raw: '9A',
        plays: 1,
        bitrate: 320,
        sample_rate: 44100,
        bytes: 9000000,
        waveform: [4, 12, 24, 18],
      }
    }
    if (method === 'rekordboxTransport') {
      const p = (_params ?? {}) as { action?: 'reveal' | 'deck1' | 'deck2'; query?: string; path?: string }
      const ok = overrides?.transportOk ?? true
      return {
        ok,
        reason: ok ? 'sent' : 'no_window',
        action: p.action ?? 'reveal',
        deck: p.action === 'deck1' ? 1 : p.action === 'deck2' ? 2 : null,
        query: p.query ?? '',
        path: p.path ?? '',
        copied: true,
        message: ok
          ? `In Rekordbox ausgeführt: ${p.query ?? ''}`
          : 'Rekordbox ist nicht geöffnet. Suchtext wurde in die Zwischenablage kopiert.',
      }
    }
    return true
  })

  window.cuepoint = {
    request: reqSpy,
    choose: vi.fn().mockResolvedValue('E:/Backup/Master'),
    window: vi.fn().mockResolvedValue(undefined),
    ...(overrides?.omitReveal ? {} : { revealFile: vi.fn().mockResolvedValue(overrides?.revealOk ?? true) }),
  }
  return reqSpy
}

describe('App (main.tsx)', () => {
  it('keeps sticky live deck in rekordbox mode instead of jumping to Deck 1 when anchor temporarily drops', async () => {
    const reqSpy = makeMockBridge({
      liveResponses: [
        {
          state: 'rekordbox',
          error: null,
          anchor: 2,
          matches: [],
          media: [],
          decks: [
            {
              deck: 1,
              name: 'rekordbox',
              source: 0,
              slot: 0,
              slotName: 'Rekordbox lokal',
              trackId: 'd1',
              bpm: 124,
              key: '5A',
              title: 'Deck One Silent',
              artist: 'Artist 1',
              libraryId: null,
              playing: true,
              master: false,
              fader: 0,
            },
            {
              deck: 2,
              name: 'rekordbox',
              source: 0,
              slot: 0,
              slotName: 'Rekordbox lokal',
              trackId: 'd2',
              bpm: 138,
              key: '9A',
              title: 'Deck Two Live',
              artist: 'Artist 2',
              libraryId: 't2',
              playing: true,
              master: true,
              fader: 1,
            },
          ],
        },
        {
          state: 'rekordbox',
          error: null,
          anchor: null,
          matches: [],
          media: [],
          decks: [
            {
              deck: 1,
              name: 'rekordbox',
              source: 0,
              slot: 0,
              slotName: 'Rekordbox lokal',
              trackId: 'd1',
              bpm: 124,
              key: '5A',
              title: 'Deck One Silent',
              artist: 'Artist 1',
              libraryId: null,
              playing: false,
              master: false,
              fader: 0,
            },
            {
              deck: 2,
              name: 'rekordbox',
              source: 0,
              slot: 0,
              slotName: 'Rekordbox lokal',
              trackId: 'd2',
              bpm: 138,
              key: '9A',
              title: 'Deck Two Live',
              artist: 'Artist 2',
              libraryId: 't2',
              playing: false,
              master: true,
              fader: 1,
            },
          ],
        },
      ],
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText(/Deck Two Live/).length).toBeGreaterThan(0)
    })

    // Wait for the real second 400ms poll (with anchor: null!) to arrive
    await waitFor(() => {
      const liveCalls = reqSpy.mock.calls.filter(([m]) => m === 'live')
      expect(liveCalls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 2500 })

    // Deck 2 MUST remain sticky; Deck One Silent must NOT hijack the display!
    expect(screen.getAllByText(/Deck Two Live/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Deck One Silent/)).toBeNull()
  })

  it('handles navigation, sidebar actions, live controls, find modal and set operations', async () => {
    localStorage.clear()
    localStorage.setItem('cuepoint.columns', '{broken-cols')
    localStorage.setItem('cuepoint.customPresets', '{broken-json')
    localStorage.setItem('cuepoint.setTracks', '{broken-json')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const reqSpy = makeMockBridge({ openFailsOnce: true })
    render(<App />)

    await waitFor(() => {
      expect(reqSpy).toHaveBeenCalledWith('demoLibrary', undefined)
    })

    // Direct top-nav tab clicks + Ctrl shortcuts + Ctrl+F in both modes
    fireEvent.click(document.querySelector('#tab-filter')!)
    expect(document.querySelector('#view-filter')).toHaveClass('active')
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    fireEvent.click(document.querySelector('#tab-set')!)
    expect(document.querySelector('#view-set')).toHaveClass('active')
    fireEvent.click(document.querySelector('#tab-live')!)
    expect(document.querySelector('#view-live')).toHaveClass('active')
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })

    // LiveBar: Nächster Demo-Track & Referenz fixieren / lösen
    fireEvent.click(document.querySelector('#changeTrack')!)
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('demoLink', { next: true }))
    fireEvent.click(document.querySelector('#pinTrack')!)
    expect(document.querySelector('#pinTrack')).toHaveTextContent(/Referenz lösen/i)
    fireEvent.click(document.querySelector('#pinTrack')!)
    expect(document.querySelector('#pinTrack')).toHaveTextContent(/Referenz fixieren/i)

    // Sidebar actions (scoped inside sidenav, fast text lookup)
    const sidenav = within(document.querySelector('aside.sidenav')! as HTMLElement)
    fireEvent.click(sidenav.getByText(/Alle Tracks/i))
    fireEvent.click(sidenav.getByText(/Harmonisch passend/i))
    fireEvent.click(sidenav.getByText(/Erweiterte Suche/i))
    fireEvent.click(sidenav.getByText(/Filter-Studio/i))
    fireEvent.click(sidenav.getByText(/Techno \/ Peak/i))
    fireEvent.click(sidenav.getByText(/Live-Match/i))

    // Add both tracks to set + duplicate click branch + LiveView wheel & autoFollow
    await waitFor(() => {
      expect(document.querySelectorAll('#view-live .track-row button').length).toBeGreaterThan(0)
    }, { timeout: 6000 })
    const addButtons = Array.from(document.querySelectorAll('#view-live .track-row button'))
      .filter((b) => b.textContent?.trim() === '+ Set')
    expect(addButtons.length).toBeGreaterThan(0)
    fireEvent.click(addButtons[0])
    fireEvent.click(addButtons[0])
    if (addButtons[1]) fireEvent.click(addButtons[1])

    const wheelSeg = document.querySelector('#view-live [data-key="9A"]')
    if (wheelSeg) {
      fireEvent.click(wheelSeg)
      fireEvent.click(wheelSeg, { shiftKey: true })
    }
    const autoFollowEl = document.querySelector('#autoFollow') as HTMLInputElement | null
    if (autoFollowEl) {
      fireEvent.click(autoFollowEl)
      fireEvent.click(autoFollowEl)
    }
    fireEvent.click(document.querySelector('#includeCurrent')!)
    fireEvent.click(document.querySelector('#useBpm')!)
    fireEvent.change(document.querySelector('#bpmTolerance')!, { target: { value: '6' } })
    fireEvent.click(document.querySelector('#sameGenre')!)
    fireEvent.click(document.querySelector('#unplayedLive')!)
    fireEvent.change(document.querySelector('#liveRating')!, { target: { value: '4' } })

    // Sidebar Meine Setliste
    fireEvent.click(sidenav.getByText(/Meine Setliste/i))
    fireEvent.click(sidenav.getByText(/Live-Match/i))

    // LiveView inspector transport & find modal (reveal, deck A, deck B, explorer, copy, close)
    const liveInspector = within(document.querySelector('#liveInspector')! as HTMLElement)
    fireEvent.click(liveInspector.getByText(/In Rekordbox/i))
    await waitFor(() =>
      expect(reqSpy).toHaveBeenCalledWith('rekordboxTransport', expect.objectContaining({ action: 'reveal' })),
    )
    fireEvent.click(liveInspector.getByText(/Deck A/i))
    await waitFor(() =>
      expect(reqSpy).toHaveBeenCalledWith('rekordboxTransport', expect.objectContaining({ action: 'deck1' })),
    )
    fireEvent.click(liveInspector.getByText(/Deck B/i))
    await waitFor(() =>
      expect(reqSpy).toHaveBeenCalledWith('rekordboxTransport', expect.objectContaining({ action: 'deck2' })),
    )

    fireEvent.click(liveInspector.getByText(/Details/i))
    const findModal = within(document.querySelector('.modal')! as HTMLElement)
    fireEvent.click(findModal.getByText('Im Explorer zeigen'))
    await waitFor(() => expect(window.cuepoint.revealFile).toHaveBeenCalledWith('E:/Music/acid.mp3'))
    fireEvent.click(findModal.getByText('In Rekordbox anzeigen'))
    fireEvent.click(liveInspector.getByText(/Details/i))
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Deck A laden'))
    fireEvent.click(liveInspector.getByText(/Details/i))
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Deck B laden'))
    fireEvent.click(liveInspector.getByText(/Details/i))
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText(/Suchtext kopieren/i))
    expect(writeText).toHaveBeenCalled()

    // Pin track via TrackTable row context menu
    const firstRow = document.querySelector('#view-live .track-row')
    if (firstRow) {
      fireEvent.contextMenu(firstRow, { clientX: 40, clientY: 40 })
      const pinMenuBtn = document.querySelector('.context-menu button')
      if (pinMenuBtn) fireEvent.click(pinMenuBtn)
    }
  }, 60000)

  it('handles filter presets, rule groups, custom preset saving and SetView export/clear', async () => {
    localStorage.clear()
    const reqSpy = makeMockBridge()
    render(<App />)
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('open', { path: undefined }))

    // Add tracks to set first via fast CSS selector
    await waitFor(() => {
      expect(document.querySelectorAll('#view-live .track-row button').length).toBeGreaterThan(0)
    }, { timeout: 6000 })
    const addButtons = Array.from(document.querySelectorAll('#view-live .track-row button'))
      .filter((b) => b.textContent?.trim() === '+ Set')
    fireEvent.click(addButtons[0])
    if (addButtons[1]) fireEvent.click(addButtons[1])

    // Filter-Studio wiring
    const sidenav = within(document.querySelector('aside.sidenav')! as HTMLElement)
    const viewFilter = within(document.querySelector('#view-filter')! as HTMLElement)
    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    fireEvent.change(document.querySelector('#presetSelect')!, { target: { value: 'warmup' } })
    fireEvent.change(document.querySelector('#groupLogic')!, { target: { value: 'OR' } })
    fireEvent.click(document.querySelector('#addGroup')!)
    fireEvent.change(viewFilter.getAllByLabelText(/Verknüpfung Regelgruppe/i)[0], { target: { value: 'OR' } })
    fireEvent.click(viewFilter.getAllByText(/Regel in Gruppe/i)[0])
    fireEvent.change(viewFilter.getAllByLabelText('Metadaten-Feld')[0], { target: { value: 'artist' } })
    fireEvent.change(viewFilter.getAllByLabelText('Filterwert')[0], { target: { value: 'Klara' } })
    fireEvent.click(viewFilter.getAllByLabelText('Regel entfernen')[0])
    const rmGroups = viewFilter.queryAllByLabelText(/Regelgruppe .* entfernen/i)
    if (rmGroups.length) fireEvent.click(rmGroups[0])
    fireEvent.click(document.querySelector('#applyFilter')!)

    await waitFor(() => {
      expect(document.querySelectorAll('#view-filter .track-row').length).toBeGreaterThan(0)
    }, { timeout: 4000 })
    fireEvent.click(document.querySelector('#exportFilterM3u8')!)

    // Save & cancel preset modal via backdrop/Abbrechen, then save via Enter & click saved preset
    fireEvent.click(document.querySelector('#savePreset')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Abbrechen'))
    fireEvent.click(document.querySelector('#savePreset')!)
    fireEvent.change(document.querySelector('#presetNameInput')!, { target: { value: 'Mein Peak Set' } })
    fireEvent.keyDown(document.querySelector('#presetNameInput')!, { key: 'Enter' })
    fireEvent.click(sidenav.getByText(/Mein Peak Set/i))

    // Trigger FilterView Inspector transport + Details modal
    const fInspector = within(document.querySelector('#filterInspector')! as HTMLElement)
    fireEvent.click(fInspector.getByText(/In Rekordbox/i))
    fireEvent.click(fInspector.getByText(/Details/i))
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Schließen'))

    fireEvent.click(document.querySelector('#resetFilters')!)
    const queueOpen = document.querySelector('#queueOpen')
    if (queueOpen) fireEvent.click(queueOpen)

    // SetView actions: move, select track title, remove single item, M3U8/XML/CSV exports, handover modal, clearSet
    fireEvent.click(document.querySelector('#tab-set')!)
    const viewSet = within(document.querySelector('#view-set')! as HTMLElement)
    const moveDown = viewSet.queryAllByLabelText(/Nach unten/i)
    if (moveDown.length) fireEvent.click(moveDown[0])
    const trackSelectBtn = document.querySelector('#setList .setrow')
    if (trackSelectBtn) fireEvent.click(trackSelectBtn)
    fireEvent.click(document.querySelector('#exportSetM3u8')!)
    fireEvent.click(document.querySelector('#exportSetXml')!)
    fireEvent.click(document.querySelector('#exportSet')!)

    fireEvent.click(document.querySelector('#explainImport')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('M3U8-Playlist exportieren'))
    fireEvent.click(document.querySelector('#explainImport')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Rekordbox XML exportieren'))
    fireEvent.click(document.querySelector('#explainImport')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('CSV exportieren'))
    fireEvent.click(document.querySelector('#explainImport')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Schließen'))

    const removeBtns = Array.from(document.querySelectorAll('#setList button'))
      .filter((b) => /entfernen/i.test(b.getAttribute('aria-label') || b.textContent || ''))
    if (removeBtns.length) fireEvent.click(removeBtns[0])
    fireEvent.click(document.querySelector('#clearSet')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Abbrechen'))
    fireEvent.click(document.querySelector('#clearSet')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Set leeren'))
    fireEvent.click(document.querySelector('#addFromBrowse')!)
  }, 60000)

  it('handles source menu switching, help modal, hardware modal actions and window controls', async () => {
    localStorage.clear()
    const reqSpy = makeMockBridge()
    render(<App />)
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('open', { path: undefined }))

    // Source menu actions (scoped to .source-menu!)
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Datenbankdatei öffnen/i))
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('open', expect.any(Object)))
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Rekordbox-Ordner öffnen/i))
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Synthetische Testbibliothek/i))
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Aktuelle Quelle neu laden/i))

    // Help modal (scoped to .modal!)
    fireEvent.click(document.querySelector('#helpBtn')!)
    expect(screen.getByText('Bedienung & Tastenkürzel')).toBeInTheDocument()
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Schließen'))

    // HardwareModal full actions (scoped to .modal!)
    fireEvent.click(document.querySelector('#liveStatusBtn')!)
    expect(screen.getByText(/Hardware, Pro DJ Link/i)).toBeInTheDocument()
    const hwModal = within(document.querySelector('.modal')! as HTMLElement)
    fireEvent.change(hwModal.getByLabelText('Netzwerk-Interface'), { target: { value: '192.168.1.2' } })
    fireEvent.click(hwModal.getByRole('checkbox'))
    fireEvent.change(hwModal.getByLabelText('Master-Quelle / Deck-Fokus'), { target: { value: '2' } })
    fireEvent.click(hwModal.getByText('Pro DJ Link verbinden'))
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('linkStart', expect.any(Object)))
    fireEvent.click(hwModal.getByText('Demo-Link'))
    fireEvent.click(hwModal.getByText(/Netze & USB prüfen/))
    fireEvent.click(hwModal.getByText(/USB-Datenbank wählen/))
    fireEvent.click(hwModal.getByText('Lösen'))
    const deckCard = hwModal.getByText(/Deck 1 · rekordbox/).closest('.hw-deck')
    if (deckCard) {
      fireEvent.click(deckCard)
      await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('live', expect.objectContaining({ deck: 1 })), { timeout: 2000 })
    }
    const inspectBtn = hwModal.queryByText('In Bibliothek wählen')
    if (inspectBtn) {
      fireEvent.click(inspectBtn)
      await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('detail', expect.any(Object)))
    }
    fireEvent.click(document.querySelector('#liveStatusBtn')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Trennen'))
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Schließen'))

    // Windowbar controls
    fireEvent.click(screen.getByLabelText('Minimieren'))
    fireEvent.click(screen.getByLabelText('Maximieren'))
    fireEvent.click(screen.getByLabelText('Schließen'))
    expect(window.cuepoint!.window).toHaveBeenCalledWith('close')
  }, 30000)

  it('handles Rekordbox transport ok:false, transport error and missing/failing revealFile with clipboard fallback', async () => {
    localStorage.clear()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const reqSpy = makeMockBridge({ transportOk: false, omitReveal: true })
    render(<App />)

    await waitFor(() => {
      expect(document.querySelectorAll('#view-live .track-row').length).toBeGreaterThan(0)
    }, { timeout: 6000 })

    // ok: false branch copies query to clipboard and displays toast
    const liveInspector = within(document.querySelector('#liveInspector')! as HTMLElement)
    fireEvent.click(liveInspector.getByRole('button', { name: /In Rekordbox/i }))
    await waitFor(() => {
      expect(document.querySelector('#toast')?.textContent).toMatch(/Rekordbox ist nicht geöffnet/i)
    })
    expect(writeText).toHaveBeenCalledWith('Acid Horizon Klara')

    // revealFile omitted/false branch from find modal
    fireEvent.click(liveInspector.getByRole('button', { name: /Details/i }))
    const findModal = within(document.querySelector('.modal')! as HTMLElement)
    fireEvent.click(findModal.getByText('Im Explorer zeigen'))
    await waitFor(() => {
      expect(document.querySelector('#toast')?.textContent).toMatch(/Explorer nicht verfügbar/i)
    })
    fireEvent.click(findModal.getByText('Schließen'))

    // Transport throws -> catch branch copies query and displays error toast
    const baseImpl = reqSpy.getMockImplementation()!
    reqSpy.mockImplementation(async (method: string, params?: object) => {
      if (method === 'rekordboxTransport') throw new Error('Transport fehlgeschlagen')
      return baseImpl(method, params)
    })
    fireEvent.click(liveInspector.getByText(/Deck A/i))
    await waitFor(() => {
      expect(document.querySelector('#toast')?.textContent).toMatch(/Transport fehlgeschlagen/i)
    })
  }, 30000)

  it('covers error branches, canceled pickers, live status variants, localStorage and null track fields', async () => {
    localStorage.clear()
    localStorage.setItem('airdox.columns', JSON.stringify(['title', 'bpm']))
    localStorage.setItem('airdox.setTracks', JSON.stringify([{
      id: 'pre1',
      title: 'Preloaded Set Track',
      artist: 'Pre',
      genre: 'Techno',
      bpm: 136,
      key: '8A',
      rating: 4,
      seconds: 310,
      year: 2024,
    }]))
    localStorage.setItem('airdox.customPresets', JSON.stringify([
      { id: 'c1', name: 'Saved', logic: 'AND', groups: [] },
    ]))

    const reqSpy = makeMockBridge({
      liveResponses: [
        {
          state: 'demo',
          error: null,
          anchor: 1,
          matches: [],
          media: [],
          decks: [{
            deck: 1,
            name: 'Demo',
            source: 0,
            slot: 0,
            slotName: 'Demo',
            trackId: 'd0',
            bpm: null,
            key: null,
            title: null,
            artist: null,
            libraryId: null,
            playing: false,
            master: false,
            fader: null,
          }],
        },
        { state: 'listening', error: null, anchor: null, matches: [], media: [], decks: [] },
        { state: 'discovering', error: null, anchor: null, matches: [], media: [], decks: [] },
        { state: 'error', error: 'Socket Fehler', anchor: null, matches: [], media: [], decks: [] },
        { state: 'off', error: null, anchor: null, matches: [], media: [], decks: [] },
        {
          state: 'rekordbox',
          error: null,
          anchor: null,
          matches: [],
          media: [{
            source: 1,
            slot: 3,
            path: 'E:/USB/exportLibrary.db',
            kind: 'OneLibrary',
            total: 10,
            genres: 2,
            bpmBounds: [125, 140],
            withKey: 9,
          }],
          decks: [],
        },
      ],
    })
    const baseImpl = reqSpy.getMockImplementation()!
    let failMode = false
    reqSpy.mockImplementation(async (method: string, params?: object) => {
      if (method === 'open') return baseImpl(method, params)
      if (method === 'query' && !failMode) {
        return {
          rows: [{
            id: 'tnull',
            title: '',
            artist: '',
            genre: '',
            bpm: null,
            key: null,
            rating: 0,
            seconds: null,
            year: null,
          }],
          counts: [1, 1, 1, 0],
          genres: [],
          keys: [],
          histogram: [],
          ms: 1.0,
        }
      }
      if (failMode && ['linkStart', 'linkStop', 'demoLink', 'bindMedia', 'unbindMedia', 'detail', 'query'].includes(method)) {
        throw new Error(`Boom ${method}`)
      }
      return baseImpl(method, params)
    })
    ;(window.cuepoint!.choose as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    render(<App />)
    await waitFor(() => expect(document.querySelector('#playingName')).toBeInTheDocument())

    await waitFor(() => {
      expect(document.querySelectorAll('#view-live .track-row').length).toBeGreaterThan(0)
    }, { timeout: 6000 })

    // LiveView footer buttons (toFilterStudio, toSetBuilder, hardwareConfigBtn)
    fireEvent.click(document.querySelector('#toFilterStudio')!)
    expect(document.querySelector('#view-filter')).toHaveClass('active')
    fireEvent.click(document.querySelector('#toSetBuilder')!)
    expect(document.querySelector('#view-set')).toHaveClass('active')
    fireEvent.click(document.querySelector('#tab-live')!)
    fireEvent.click(document.querySelector('#hardwareConfigBtn')!)
    fireEvent.click(within(document.querySelector('.modal')! as HTMLElement).getByText('Schließen'))

    // Pin & unpin with null activeDeck key
    fireEvent.click(document.querySelector('#pinTrack')!)
    fireEvent.click(document.querySelector('#pinTrack')!)

    // Find modal with track having null key/bpm/artist/path (no "Im Explorer zeigen" button)
    fireEvent.click(within(document.querySelector('#liveInspector')! as HTMLElement).getByText(/Details/i))
    const findModal = within(document.querySelector('.modal')! as HTMLElement)
    expect(findModal.queryByText('Im Explorer zeigen')).toBeNull()
    fireEvent.click(findModal.getByText('Schließen'))

    // Source menu canceled pickers (choose returns null)
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Datenbankdatei öffnen/i))
    fireEvent.click(document.querySelector('#sourceButton')!)
    fireEvent.click(within(document.querySelector('.source-menu')! as HTMLElement).getByText(/Rekordbox-Ordner öffnen/i))

    // Failure mode for hardware actions & query/detail catch branches
    failMode = true
    fireEvent.click(document.querySelector('#changeTrack')!)
    fireEvent.click(document.querySelector('#tab-filter')!)
    fireEvent.click(document.querySelector('#applyFilter')!)
    await waitFor(() => {
      expect(document.querySelector('#toast')?.textContent).toMatch(/Boom query/i)
    }, { timeout: 3000 })

    // Close modals via Escape to exercise onClose handlers
    fireEvent.click(document.querySelector('#helpBtn')!)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('#savePreset')!)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('#tab-set')!)
    fireEvent.click(document.querySelector('#explainImport')!)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('#clearSet')!)
    fireEvent.keyDown(window, { key: 'Escape' })

    // Poll through remaining live states so media & rekordbox state are active before opening hwModal
    await waitFor(() => {
      const liveCalls = reqSpy.mock.calls.filter(([m]) => m === 'live')
      expect(liveCalls.length).toBeGreaterThanOrEqual(6)
    }, { timeout: 5000 })

    fireEvent.click(document.querySelector('#liveStatusBtn')!)
    const hwModal = within(document.querySelector('.modal')! as HTMLElement)
    for (const label of ['Pro DJ Link verbinden', 'Demo-Link', 'Trennen', /\) binden$/, 'Lösen']) {
      await waitFor(() => {
        const btn = hwModal.queryByText(label)
        if (btn) expect(btn).not.toBeDisabled()
      }, { timeout: 2000 })
      const btn = hwModal.queryByText(label)
      if (btn) fireEvent.click(btn)
    }
    fireEvent.keyDown(window, { key: 'Escape' })
  }, 30000)

  it('falls back cleanly when localStorage holds non-array values or empty columns', async () => {
    localStorage.setItem('airdox.setTracks', '{"not":"array"}')
    localStorage.setItem('airdox.columns', '[]')
    localStorage.setItem('airdox.customPresets', '{"not":"array"}')
    const reqSpy = makeMockBridge()
    const { unmount } = render(<App />)
    await waitFor(() => expect(reqSpy).toHaveBeenCalledWith('open', { path: undefined }))
    unmount()
  })
})

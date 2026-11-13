const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('@playwright/test')

async function capture(page, captureDir, filename) {
  if (!captureDir) return
  fs.mkdirSync(captureDir, { recursive: true })
  await page.screenshot({ path: path.join(captureDir, filename) })
}

async function assertVisualLayout(page, viewSelector) {
  const layout = await page.evaluate((sel) => {
    const docOverflow = document.documentElement.scrollWidth - window.innerWidth
    const bodyBg = getComputedStyle(document.body).backgroundColor
    const winbar = document.querySelector('.windowbar')?.getBoundingClientRect()
    const topnav = document.querySelector('.topnav')?.getBoundingClientRect()
    const livebar = document.querySelector('.livebar')?.getBoundingClientRect()
    const footer = document.querySelector('.footer')?.getBoundingClientRect()
    const panes = [...document.querySelectorAll(`${sel} .pane`)].map((p) => {
      const r = p.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    })
    const activeTab = document.querySelector('.navtab.active')
    const activeTabBg = activeTab ? getComputedStyle(activeTab).backgroundColor : null

    const visibleView = document.querySelector(sel)
    const headerCells = [...visibleView.querySelectorAll('.track-header .th-cell')].map((c) => {
      const r = c.getBoundingClientRect()
      return { left: r.left, width: r.width }
    })
    const firstRow = visibleView.querySelector('.track-row')
    const firstRowCells = firstRow
      ? [...firstRow.querySelectorAll('.td-cell')].map((c) => {
          const r = c.getBoundingClientRect()
          return { left: r.left, width: r.width }
        })
      : []

    const selectedRow = visibleView.querySelector('.track-row.selected')
    const selectedRowBg = selectedRow ? getComputedStyle(selectedRow).backgroundColor : null

    const clippedButtons = [
      ...visibleView.querySelectorAll('.panefoot button, .trackinspect .btnrow button, .resultsbar button, .settoolbar button'),
    ]
      .filter((btn) => {
        const r = btn.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && !btn.closest('[hidden]')
      })
      .map((btn) => ({
        text: btn.textContent?.trim() || btn.id || 'button',
        overflow: btn.scrollWidth - btn.clientWidth,
        rightOverflow: btn.getBoundingClientRect().right - window.innerWidth,
      }))
      .filter((b) => b.overflow > 2 || b.rightOverflow > 2)

    return {
      docOverflow,
      bodyBg,
      winbar,
      topnav,
      livebar,
      footer,
      panes,
      activeTabBg,
      headerCells,
      firstRowCells,
      selectedRowBg,
      clippedButtons,
    }
  }, viewSelector)

  assert.ok(layout.docOverflow <= 1, `Horizontal overflow detected: ${layout.docOverflow}px`)
  assert.equal(layout.bodyBg, 'rgb(17, 20, 24)')
  assert.equal(layout.activeTabBg, 'rgb(32, 75, 121)')
  assert.ok(layout.winbar && layout.winbar.height >= 30 && layout.winbar.height <= 38)
  assert.ok(layout.topnav && layout.topnav.height >= 50 && layout.topnav.height <= 60)
  assert.ok(layout.livebar && layout.livebar.height >= 95 && layout.livebar.height <= 120)
  assert.ok(layout.footer && layout.footer.height >= 26 && layout.footer.height <= 36)
  assert.deepEqual(layout.clippedButtons, [], `Text-Clipping oder Überlauf bei Buttons: ${JSON.stringify(layout.clippedButtons)}`)
  if (layout.selectedRowBg) {
    assert.equal(layout.selectedRowBg, 'rgb(37, 81, 134)', `High-Contrast Auswahlfarbe erwartet, erhalten: ${layout.selectedRowBg}`)
  }

  for (let i = 0; i < layout.panes.length; i++) {
    assert.ok(layout.panes[i].width > 200, `Pane ${i} too narrow: ${layout.panes[i].width}`)
    assert.ok(layout.panes[i].height > 200, `Pane ${i} too short: ${layout.panes[i].height}`)
    if (i > 0) {
      assert.ok(
        layout.panes[i - 1].right <= layout.panes[i].left + 2,
        `Panes ${i - 1} and ${i} overlap horizontally`,
      )
    }
  }

  if (layout.firstRowCells.length > 0) {
    assert.equal(layout.firstRowCells.length, layout.headerCells.length)
    for (let i = 0; i < layout.headerCells.length; i++) {
      assert.ok(
        Math.abs(layout.headerCells[i].left - layout.firstRowCells[i].left) <= 2,
        `Column ${i} left mismatch: header=${layout.headerCells[i].left}, row=${layout.firstRowCells[i].left}`,
      )
      assert.ok(
        Math.abs(layout.headerCells[i].width - layout.firstRowCells[i].width) <= 2,
        `Column ${i} width mismatch: header=${layout.headerCells[i].width}, row=${layout.firstRowCells[i].width}`,
      )
    }
  }
}

async function readVisibleYears(page, viewSelector) {
  return page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(`${sel} [data-track-id]`)]
      .map((row) => ({
        top: row.getBoundingClientRect().top,
        year: row.querySelector('.cell-year')?.textContent?.trim() ?? '',
      }))
      .filter((r) => r.year !== '')
      .sort((a, b) => a.top - b.top)
    return rows.map((r) => r.year)
  }, viewSelector)
}

function assertYearOrdering(values, direction) {
  assert.ok(values.length >= 5, `Zu wenige sichtbare Jahreswerte für Sortierprüfung: ${JSON.stringify(values)}`)
  let seenMissing = false
  const validYears = []
  for (const raw of values) {
    if (raw === '—' || raw === '–' || raw === '') {
      seenMissing = true
      continue
    }
    assert.ok(!seenMissing, `Fehlendes Jahr '—' steht VOR gültigem Jahr '${raw}' in ${JSON.stringify(values)}`)
    const num = Number(raw)
    assert.ok(Number.isFinite(num) && num >= 1900 && num <= 2100, `Ungültiges Jahr in .cell-year: '${raw}'`)
    validYears.push(num)
  }
  assert.ok(validYears.length >= 3, `Zu wenige gültige Jahreszahlen in ${JSON.stringify(values)}`)
  for (let i = 0; i < validYears.length - 1; i++) {
    if (direction === 'desc') {
      assert.ok(
        validYears[i] >= validYears[i + 1],
        `Jahr ↓ Sortierfehler an Index ${i}: ${validYears[i]} < ${validYears[i + 1]} (Werte: ${validYears.join(', ')})`,
      )
    } else {
      assert.ok(
        validYears[i] <= validYears[i + 1],
        `Jahr ↑ Sortierfehler an Index ${i}: ${validYears[i]} > ${validYears[i + 1]} (Werte: ${validYears.join(', ')})`,
      )
    }
  }
}

async function assertTooltips(page, selectors, contextLabel) {
  const missing = await page.evaluate((sels) => {
    const bad = []
    for (const sel of sels) {
      const els = [...document.querySelectorAll(sel)]
      if (els.length === 0) {
        bad.push({ sel, reason: 'not found' })
        continue
      }
      for (const el of els) {
        const ownTitle = el.getAttribute('title')
        const closestTitle = el.closest('[title]')?.getAttribute('title')
        const title = (ownTitle ?? closestTitle ?? '').trim()
        if (title.length <= 5) {
          bad.push({ sel, reason: `title too short/missing: '${title}'` })
        }
      }
    }
    return bad
  }, selectors)
  assert.deepEqual(missing, [], `Fehlende/leere Tooltips in ${contextLabel}: ${JSON.stringify(missing)}`)
}

async function verifyToast(page, actionFn, expectedPattern = /rekordbox/i) {
  await actionFn()
  const toast = page.locator('#toast')
  await toast.waitFor({ state: 'visible', timeout: 6000 })
  const patStr = expectedPattern instanceof RegExp ? expectedPattern.source : String(expectedPattern)
  await page.waitForFunction(
    (p) => {
      const el = document.querySelector('#toast')
      if (!el) return false
      const txt = (el.textContent || '').trim()
      return new RegExp(p, 'i').test(txt) && txt.length > 3
    },
    patStr,
    { timeout: 6000 },
  )
  const text = (await toast.innerText()).trim()
  assert.ok(
    new RegExp(patStr, 'i').test(text),
    `Toast-Text '${text}' matcht nicht '${expectedPattern}'`,
  )
  return text
}

async function run() {
  const real = process.env.CUEPOINT_VERIFY_REAL === '1'
  const fixture = path.resolve('build', 'synthetic_test_master.db')
  if (!real) assert.ok(fs.existsSync(fixture), 'Zuerst tests/generate_synthetic_db.py ausführen.')

  const captureDir = process.env.CUEPOINT_CAPTURE_DIR || ''
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cuepoint-test-'))
  const env = { ...process.env, CUEPOINT_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  if (real) delete env.CUEPOINT_LIBRARY_PATH
  else env.CUEPOINT_LIBRARY_PATH = fixture

  const app = await _electron.launch({
    executablePath: process.env.CUEPOINT_TEST_EXE,
    args: process.env.CUEPOINT_TEST_EXE ? [] : ['.'],
    env,
  })

  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    // Wait for initial tracks to load in Filter-Studio or Live-Match
    await page.waitForFunction(
      () => {
        const total = document.querySelector('#sidebarTotal')?.textContent || '0'
        return Number(total.replace(/\./g, '')) >= (window ? 1 : 0) &&
          document.querySelector('#playingName')?.textContent !== 'Keine Bibliothek geladen'
      },
      undefined,
      { timeout: 60_000 },
    )

    if (real) {
      const sourceLabel = await page.locator('#sourceButton').innerText()
      const footerText = await page.locator('.footer').innerText()
      assert.ok(footerText.toLowerCase().includes('e:\\pioneer\\master\\master.db'), `Unexpected footer: ${footerText}`)
      assert.ok(/Master · [\d.]+ Tracks/.test(sourceLabel), `Unexpected source button: ${sourceLabel}`)

      await page.locator('#tab-filter').click()
      await page.waitForFunction(
        () => Number(document.querySelector('#view-filter [role=grid]')?.getAttribute('aria-rowcount')) > 1000,
        undefined,
        { timeout: 45_000 },
      )
      await assertVisualLayout(page, '#view-filter')
      const realCount = Number(await page.locator('#view-filter [role=grid]').getAttribute('aria-rowcount')) - 1
      assert.deepEqual(errors, [])
      console.log(`Echte Rekordbox-DB verifiziert: ${realCount} Tracks aus ${sourceLabel} (Read-Only + Layout OK).`)
      return
    }

    // ---- 1. LIVE-MATCH VIEW (Initial + Visual + Jahr-Sort + Camelot Wheel + Filters + Transport) ----
    await page.waitForFunction(
      () => document.querySelectorAll('#view-live [data-track-id]').length > 0,
      undefined,
      { timeout: 45_000 },
    )
    await assertVisualLayout(page, '#view-live')

    const totalSidebar = await page.locator('#sidebarTotal').innerText()
    assert.equal(totalSidebar, '15.500')
    const liveHeadingCount = await page.locator('#liveHeadingCount').innerText()
    assert.ok(!liveHeadingCount.startsWith('0 Treffer'), `Expected >0 live hits, got: ${liveHeadingCount}`)
    const studioBtnOverflow = await page.locator('#toFilterStudio').evaluate((el) => el.scrollWidth - el.clientWidth)
    assert.ok(studioBtnOverflow <= 2, `Button text clipped: ${studioBtnOverflow}px`)

    // Waveform rendered in Livebar
    const waveBars = await page.locator('#wave svg rect').count()
    assert.ok(waveBars >= 200, `Expected >= 200 waveform rects, got ${waveBars}`)

    // Camelot Wheel: 24 clickable segments
    const wheelSegments = await page.locator('#view-live svg.wheel .region').count()
    assert.equal(wheelSegments, 24)

    // Tooltips in Live-Match, Livebar, Topnav & Table Headers
    await assertTooltips(
      page,
      [
        '#view-live .panehead .infotip',
        '#view-live .live-quick .infotip',
        '#liveSort',
        '#liveSearch',
        '#useBpm',
        '#sameGenre',
        '#unplayedLive',
        '#allHarmonic',
        '#autoFollow',
        '#includeCurrent',
        '#changeTrack',
        '#pinTrack',
        '#toFilterStudio',
        '#toSetBuilder',
        '#tab-live',
        '#tab-filter',
        '#tab-set',
        '#view-live .track-header button.th-sort',
      ],
      'Live-Match',
    )

    // Enable "Jahr" column in Live-Match via header context menu
    const liveGrid = page.locator('#view-live [role=grid]')
    await liveGrid.getByRole('columnheader', { name: 'Titel', exact: true }).click({ button: 'right' })
    await page.getByRole('checkbox', { name: 'Jahr', exact: true }).check()
    await page.keyboard.press('Escape')
    const liveYearHeader = liveGrid.getByRole('columnheader', { name: 'Jahr', exact: true })
    await liveYearHeader.waitFor()
    await assertVisualLayout(page, '#view-live')

    // 1a. Live-Match Jahr ↓ (yearnew)
    await page.locator('#liveSort').selectOption('yearnew')
    await page.waitForTimeout(160)
    await page.waitForFunction(() => {
      const busy = document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy')
      const headers = [...document.querySelectorAll('#view-live [role=columnheader]')]
      const yearTh = headers.find((h) => h.textContent?.includes('Jahr'))
      return (!busy || busy === 'false') && yearTh?.getAttribute('aria-sort') === 'descending'
    })
    const yearsDesc = await readVisibleYears(page, '#view-live')
    assertYearOrdering(yearsDesc, 'desc')
    await capture(page, captureDir, '01-live-year-desc.png')

    // 1b. Click column header "Jahr" -> switches to Jahr ↑ (yearold)
    await liveYearHeader.locator('button.th-sort').click()
    await page.waitForTimeout(160)
    await page.waitForFunction(() => {
      const busy = document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy')
      const headers = [...document.querySelectorAll('#view-live [role=columnheader]')]
      const yearTh = headers.find((h) => h.textContent?.includes('Jahr'))
      const sortVal = document.querySelector('#liveSort')?.value
      return (!busy || busy === 'false') && yearTh?.getAttribute('aria-sort') === 'ascending' && sortVal === 'yearold'
    })
    const yearsAsc = await readVisibleYears(page, '#view-live')
    assertYearOrdering(yearsAsc, 'asc')
    await capture(page, captureDir, '02-live-year-asc.png')

    // Reset sort back to bpmasc
    await page.locator('#liveSort').selectOption('bpmasc')
    await page.waitForTimeout(120)

    // Single key click ("9A")
    await page.locator('#view-live svg.wheel [data-wheel-key="9A"]').click()
    await page.waitForFunction(
      () => document.querySelector('#wheelNotice')?.textContent?.includes('Aktive Keys: 9A'),
    )
    await page.waitForFunction(
      () => document.querySelectorAll('#view-live [data-track-id]').length > 0 &&
        document.querySelector('#view-live')?.getAttribute('aria-label') === 'Live-Match',
    )
    await page.waitForFunction(() => {
      const cells = [...document.querySelectorAll('#view-live [data-track-id] .cell-key')]
      return cells.length > 0 && cells.every((c) => c.textContent.trim() === '9A')
    })

    // Ctrl+Click adds "8A"
    await page.locator('#view-live svg.wheel [data-wheel-key="8A"]').click({ modifiers: ['Control'] })
    await page.waitForFunction(
      () => document.querySelector('#wheelNotice')?.textContent?.includes('9A, 8A'),
    )

    // Click "Alle harmonisch passenden Keys wählen"
    await page.locator('#allHarmonic').click()
    const allHarmonicKeys = await page.locator('#wheelNotice').innerText()
    assert.ok(allHarmonicKeys.split(',').length === 4, `Expected 4 harmonic keys, got: ${allHarmonicKeys}`)

    // Demo-Track cycling FIRST so Livebar has a realistic 134.7 BPM / 9A reference track
    const firstPlaying = await page.locator('#playingName').innerText()
    await page.locator('#changeTrack').click()
    await page.waitForFunction(
      (prev) => document.querySelector('#playingName')?.textContent !== prev && document.querySelector('.livestatus')?.textContent?.includes('Demo-Track'),
      firstPlaying,
    )
    await page.waitForTimeout(160)
    await page.waitForFunction(
      () => !document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') ||
        document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') === 'false',
    )

    // 2. Live-Match additional filters: #useBpm + #unplayedLive + #liveRating (4)
    const parseLiveHitCount = async () => {
      const txt = await page.locator('#liveHeadingCount').innerText()
      const m = txt.match(/^([\d.]+)\s+Treffer/)
      return m ? Number(m[1].replace(/\./g, '')) : 0
    }
    const liveCountBefore = await parseLiveHitCount()
    assert.ok(liveCountBefore > 0, `Erwarte >0 Treffer vor Filter, erhalten: ${liveCountBefore}`)

    await page.locator('#useBpm').check()
    await page.locator('#unplayedLive').check()
    await page.locator('#liveRating').selectOption('4')
    await page.waitForTimeout(160)
    await page.waitForFunction(
      () => !document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') ||
        document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') === 'false',
    )
    const liveCountAfter = await parseLiveHitCount()
    assert.ok(
      liveCountAfter > 0 && liveCountAfter < liveCountBefore,
      `Filter (#useBpm + #unplayedLive + #liveRating=4) sollte Trefferzahl senken: vorher=${liveCountBefore}, nachher=${liveCountAfter}`,
    )
    const badgeText = await page.locator('#liveFilterSummary').innerText()
    assert.ok(
      badgeText.includes('BPM: ±4 %') && badgeText.includes('Selten gespielt ≤ 2') && badgeText.includes('Rating ≥ 4 ★'),
      `Erwartete Filter-Badges fehlen: ${badgeText}`,
    )

    // Every visible row must have >= 4 stars and BPM within tolerance of live BPM
    const liveBpmText = await page.locator('#playingBpm').innerText()
    const liveBpmMatch = liveBpmText.match(/([\d.]+)/)
    const liveBpm = liveBpmMatch ? Number(liveBpmMatch[1]) : null
    const liveFilteredRows = await page.locator('#view-live [data-track-id]').evaluateAll((rows) =>
      rows.map((r) => ({
        title: r.querySelector('.cell-title')?.textContent?.trim() || '',
        bpm: Number(r.querySelector('.cell-bpm')?.textContent?.trim()),
        stars: (r.querySelector('.cell-rating')?.textContent?.match(/★/g) || []).length,
      })),
    )
    assert.ok(liveFilteredRows.length > 0, 'Keine sichtbaren Zeilen nach Live-Filter')
    for (const row of liveFilteredRows) {
      assert.ok(row.stars >= 4, `Zeile '${row.title}' hat nur ${row.stars} Sterne (< 4)`)
      if (liveBpm) {
        const radius = liveBpm * 0.04 + 0.15
        assert.ok(
          row.bpm >= liveBpm - radius && row.bpm <= liveBpm + radius,
          `Zeile '${row.title}' BPM ${row.bpm} außerhalb ±4% von ${liveBpm}`,
        )
      }
    }
    await capture(page, captureDir, '03-live-filters.png')

    // Also verify #liveSearch narrows hits further and matches
    const searchSeed = liveFilteredRows[0].title.split(/\s+/).find((w) => w.length >= 3) || liveFilteredRows[0].title
    await page.locator('#liveSearch').fill(searchSeed)
    await page.waitForTimeout(160)
    await page.waitForFunction(
      () => !document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') ||
        document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') === 'false',
    )
    const liveCountSearch = await parseLiveHitCount()
    assert.ok(liveCountSearch > 0 && liveCountSearch <= liveCountAfter, `Live-Suche '${searchSeed}' unerwartet: ${liveCountSearch}`)
    await page.locator('#liveSearch').fill('')

    // Reset live extra filters cleanly
    await page.locator('#useBpm').uncheck()
    await page.locator('#unplayedLive').uncheck()
    await page.locator('#liveRating').selectOption('0')
    await page.waitForTimeout(160)
    await page.waitForFunction(
      () => !document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') ||
        document.querySelector('#view-live [aria-label="Virtualisierte Trackliste"]')?.getAttribute('aria-busy') === 'false',
    )

    // Pin reference toggle check

    await page.locator('#pinTrack').click()
    assert.ok((await page.locator('#pinTrack').innerText()).includes('Referenz lösen'))
    await page.locator('#pinTrack').click()
    assert.ok((await page.locator('#pinTrack').innerText()).includes('Referenz fixieren'))

    // Selected row color check (#255186) + Transport Buttons in #liveInspector
    const firstRow = page.locator('#view-live [data-track-id]').first()
    await firstRow.click()
    const selectedBg = await firstRow.evaluate((el) => getComputedStyle(el).backgroundColor)
    assert.equal(selectedBg, 'rgb(37, 81, 134)')

    for (const label of ['In Rekordbox', 'Deck A', 'Deck B']) {
      const btn = page.locator('#liveInspector button', { hasText: label })
      await btn.waitFor({ state: 'visible' })
      const metrics = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { width: r.width, height: r.height, overflow: el.scrollWidth - el.clientWidth }
      })
      assert.ok(metrics.width > 40 && metrics.height >= 20, `Button '${label}' zu klein: ${JSON.stringify(metrics)}`)
      assert.ok(metrics.overflow <= 2, `Button '${label}' Text abgeschnitten: ${metrics.overflow}px`)
    }
    await assertVisualLayout(page, '#view-live')

    // 1. Live-Inspector Transport Buttons & Selection Persistence:
    // - "In Rekordbox" (reveal) -> Toast enthält /rekordbox/i
    await verifyToast(
      page,
      () => page.locator('#liveInspector button', { hasText: 'In Rekordbox' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-live .track-row.selected').count(), 1, 'Zeile muss nach In Rekordbox markiert bleiben')

    // - "Deck A" (deck1) -> Toast enthält /rekordbox/i
    await verifyToast(
      page,
      () => page.locator('#liveInspector button', { hasText: 'Deck A' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-live .track-row.selected').count(), 1, 'Zeile muss nach Deck A markiert bleiben')

    // - "Deck B" (deck2) -> Toast enthält /rekordbox/i
    await verifyToast(
      page,
      () => page.locator('#liveInspector button', { hasText: 'Deck B' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-live .track-row.selected').count(), 1, 'Zeile muss nach Deck B markiert bleiben')
    await assertVisualLayout(page, '#view-live')
    await capture(page, captureDir, '05-transport-and-set.png')

    // 2. Kontextmenü auf Track-Zeile (Rechtsklick):
    // - Rechtsklick auf Track-Zeile öffnet .context-menu -> "↗ In Rekordbox anzeigen"
    await firstRow.click({ button: 'right' })
    await page.locator('.context-menu').waitFor({ state: 'visible' })
    await verifyToast(
      page,
      () => page.locator('.context-menu button.context-action', { hasText: 'In Rekordbox anzeigen' }).click(),
      /rekordbox/i,
    )
    await page.locator('.context-menu').waitFor({ state: 'detached' })

    // - Rechtsklick erneut -> "▶ In Deck A laden"
    await firstRow.click({ button: 'right' })
    await page.locator('.context-menu').waitFor({ state: 'visible' })
    await verifyToast(
      page,
      () => page.locator('.context-menu button.context-action', { hasText: 'In Deck A laden' }).click(),
      /rekordbox/i,
    )
    await page.locator('.context-menu').waitFor({ state: 'detached' })

    // - Rechtsklick erneut -> "▶ In Deck B laden"
    await firstRow.click({ button: 'right' })
    await page.locator('.context-menu').waitFor({ state: 'visible' })
    await verifyToast(
      page,
      () => page.locator('.context-menu button.context-action', { hasText: 'In Deck B laden' }).click(),
      /rekordbox/i,
    )
    await page.locator('.context-menu').waitFor({ state: 'detached' })

    // 3. Find-in-Rekordbox Modal (über "Details" und Kontextmenü "Details / Explorer & Kopieren"):
    await page.locator('#liveInspector button', { hasText: 'Details' }).click()
    const findModal = page.locator('.modal')
    await findModal.waitFor({ state: 'visible' })
    await page.locator('.modal h2', { hasText: 'Track in Rekordbox finden' }).waitFor()

    // Prüfe die Buttons: "In Rekordbox anzeigen", "Deck A laden", "Deck B laden", "Suchtext kopieren"
    for (const bName of ['In Rekordbox anzeigen', 'Deck A laden', 'Deck B laden', 'Suchtext kopieren']) {
      await findModal.locator('button', { hasText: bName }).waitFor({ state: 'visible' })
    }

    // Klicke "Suchtext kopieren" -> Toast-Feedback verifizieren
    await verifyToast(
      page,
      () => findModal.locator('button', { hasText: 'Suchtext kopieren' }).click(),
      /zwischenablage/i,
    )
    await findModal.waitFor({ state: 'detached' })

    // Find-Modal über Kontextmenü öffnen -> Klicke "Deck B laden" und verifiziere Toast-Feedback
    await firstRow.click({ button: 'right' })
    await page.locator('.context-menu').waitFor({ state: 'visible' })
    await page.locator('.context-menu button.context-action', { hasText: 'Details / Explorer & Kopieren' }).click()
    await findModal.waitFor({ state: 'visible' })
    await verifyToast(
      page,
      () => findModal.locator('button', { hasText: 'Deck B laden' }).click(),
      /rekordbox/i,
    )
    await findModal.waitFor({ state: 'detached' })

    // Add 1st track to Set from Live-Match
    await firstRow.locator('button[title="Zum Set hinzufügen"]').click()
    assert.equal(await page.locator('#setCountTab').innerText(), '1')

    // ---- 2. FILTER-STUDIO VIEW (15.5k Virtual Scrolling, Columns, Groups, Presets, Sort Cascade, Tooltips) ----
    await page.locator('#tab-filter').click()
    const filterGrid = page.locator('#view-filter [role=grid]')
    await page.waitForFunction(
      () => Number(document.querySelector('#view-filter [role=grid]')?.getAttribute('aria-rowcount')) === 15_501,
      undefined,
      { timeout: 45_000 },
    )
    await assertVisualLayout(page, '#view-filter')

    const renderedRows = await filterGrid.locator('[data-track-id]').count()
    assert.ok(renderedRows > 5 && renderedRows < 100, `DOM must stay virtualized, got ${renderedRows}`)

    const filterScroll = page.locator('#view-filter [aria-label="Virtualisierte Trackliste"]')
    if (process.env.CUEPOINT_BENCHMARK_UI) {
      const scrollStats = await filterScroll.evaluate(async (element) => {
        async function sample(distance) {
          const frames = []
          let previous = await new Promise(requestAnimationFrame)
          for (let i = 0; i < 60; i++) {
            if (distance) element.scrollTop += distance
            const now = await new Promise(requestAnimationFrame)
            frames.push(now - previous)
            previous = now
          }
          frames.sort((a, b) => a - b)
          return { median: frames[30], p95: frames[57], max: frames[59] }
        }
        return { idle: await sample(0), scroll: await sample(95) }
      })
      console.log('Scroll-Frames (ms):', scrollStats)
    }

    // Keyboard End / Home navigation across 15,500 rows
    await filterGrid.locator('[data-track-id]').first().waitFor({ state: 'attached' })
    await filterGrid.locator('[data-track-id]').first().click()
    await filterScroll.press('End')
    await page.waitForFunction(() => !!document.querySelector('#view-filter [aria-rowindex="15501"]'))
    await filterScroll.press('Home')
    await page.waitForFunction(() => !!document.querySelector('#view-filter [aria-rowindex="2"]'))

    // Right-click header -> enable "Album" column & verify persistence across reload
    await filterGrid.getByRole('columnheader', { name: 'Titel', exact: true }).click({ button: 'right' })
    await page.getByRole('checkbox', { name: 'Album', exact: true }).check()
    await page.keyboard.press('Escape')
    await filterGrid.getByRole('columnheader', { name: 'Album' }).waitFor()
    await assertVisualLayout(page, '#view-filter')

    await page.reload()
    await page.locator('#tab-filter').click()
    await filterGrid.getByRole('columnheader', { name: 'Album' }).waitFor({ timeout: 45_000 })
    await page.waitForFunction(
      () => Number(document.querySelector('#view-filter [role=grid]')?.getAttribute('aria-rowcount')) === 15_501,
      undefined,
      { timeout: 45_000 },
    )

    // Preset "Techno / Peak": verify filtered result accuracy (all visible rows match rules!)
    await page.locator('#presetSelect').selectOption('techno')
    await page.waitForFunction(() => {
      const rc = Number(document.querySelector('#view-filter [role=grid]')?.getAttribute('aria-rowcount'))
      return rc > 1 && rc < 15_501
    })
    const technoCheck = await page.locator('#view-filter [data-track-id]').evaluateAll((rows) =>
      rows.map((r) => ({
        genre: r.querySelector('.cell-genre')?.textContent?.trim(),
        bpm: Number(r.querySelector('.cell-bpm')?.textContent?.trim()),
        stars: (r.querySelector('.cell-rating')?.textContent?.match(/★/g) || []).length,
      })),
    )
    assert.ok(technoCheck.length > 0, 'Techno preset lieferte keine sichtbaren Zeilen')
    for (const row of technoCheck) {
      assert.ok(row.genre === 'Techno' || row.genre === 'Hardgroove', `Unexpected genre: ${row.genre}`)
      assert.ok(row.bpm >= 134 && row.bpm <= 142, `Unexpected BPM: ${row.bpm}`)
      assert.ok(row.stars >= 4, `Unexpected rating: ${row.stars}`)
    }

    // Save Custom Preset via custom Modal (no native prompt!)
    await page.locator('#savePreset').click()
    await page.locator('#presetNameInput').fill('Peak Automation Test')
    await page.locator('.modal button.primary', { hasText: 'Speichern' }).click()
    await page.locator('.sidenav button', { hasText: 'Peak Automation Test' }).waitFor()

    // Select a row in Filter-Studio and verify #filterInspector transport buttons
    const filterFirstRow = filterGrid.locator('[data-track-id]').first()
    await filterFirstRow.click()
    const filterSelectedBg = await filterFirstRow.evaluate((el) => getComputedStyle(el).backgroundColor)
    assert.equal(filterSelectedBg, 'rgb(37, 81, 134)')

    for (const label of ['In Rekordbox', 'Deck A', 'Deck B']) {
      await page.locator('#filterInspector button', { hasText: label }).waitFor({ state: 'visible' })
    }

    // 4. Filter-Studio (#filterInspector) Transport-Klicks & Toast-Feedback:
    await verifyToast(
      page,
      () => page.locator('#filterInspector button', { hasText: 'In Rekordbox' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-filter .track-row.selected').count(), 1, 'Zeile muss markiert bleiben')

    await verifyToast(
      page,
      () => page.locator('#filterInspector button', { hasText: 'Deck A' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-filter .track-row.selected').count(), 1, 'Zeile muss markiert bleiben')

    await verifyToast(
      page,
      () => page.locator('#filterInspector button', { hasText: 'Deck B' }).click(),
      /rekordbox/i,
    )
    assert.equal(await page.locator('#view-filter .track-row.selected').count(), 1, 'Zeile muss markiert bleiben')

    // Open Sort Cascade Designer + verify all Filter-Studio tooltips
    await page.locator('#toggleSortDesigner').click()
    await page.waitForFunction(() => !document.querySelector('#sortDesigner')?.hidden)
    await assertTooltips(
      page,
      [
        '#view-filter .infotip',
        '#resetFilters',
        '#groupLogic',
        '#toggleSortDesigner',
        '#addSortStage',
        '#exportFilterM3u8',
        '#presetSelect',
        '#savePreset',
        '#filterSearch',
        '#applyFilter',
        '#queueOpen',
        '#view-filter .track-header button.th-sort',
      ],
      'Filter-Studio',
    )
    await assertVisualLayout(page, '#view-filter')
    await capture(page, captureDir, '04-filter-studio-tooltips.png')
    await page.locator('#closeSortDesigner').click()

    // Free search & Add 2nd track to Set
    await page.locator('#filterSearch').fill('never-a-matching-title-999111')
    await page.locator('#view-filter .empty').waitFor()
    await page.locator('#filterSearch').fill('')
    await page.locator('#resetFilters').click()
    await page.waitForFunction(
      () => Number(document.querySelector('#view-filter [role=grid]')?.getAttribute('aria-rowcount')) === 15_501,
    )
    // Add 2nd distinct track to Set
    await page.locator('#view-filter [data-track-id]').nth(2).locator('.in-set-btn').click()
    assert.equal(await page.locator('#setCountTab').innerText(), '2')

    // ---- 3. SET-BUILDER VIEW (Reorder, Transitions, Stats, Tooltips, Handover Modal, Reload Persistence, Clear) ----
    await page.locator('#tab-set').click()
    await assertVisualLayout(page, '#view-set')
    assert.equal(await page.locator('#statTracks').innerText(), '2')
    assert.equal(await page.locator('#view-set .setrow').count(), 2)
    assert.equal(await page.locator('#view-set .transition').count(), 1)
    await assertTooltips(
      page,
      ['#exportSet', '#exportSetM3u8', '#exportSetXml', '#clearSet', '#explainImport', '#addFromBrowse'],
      'Set-Builder',
    )

    // Move second track up -> verify title order flips
    const secondTitleBefore = await page.locator('#view-set .setrow').nth(1).locator('.title').innerText()
    await page.locator('#view-set .setrow').nth(1).locator('button[title="Nach oben"]').click()
    const firstTitleAfter = await page.locator('#view-set .setrow').nth(0).locator('.title').innerText()
    assert.equal(firstTitleAfter, secondTitleBefore)

    // Reload preserves Set in localStorage!
    await page.reload()
    await page.waitForFunction(() => document.querySelector('#sidebarTotal')?.textContent === '15.500', undefined, {
      timeout: 45_000,
    })
    await page.locator('#tab-set').click()
    await page.waitForFunction(() => document.querySelectorAll('#view-set .setrow').length === 2)

    // Handover modal (M3U8, Rekordbox XML, CSV) + direct toolbar export
    await page.locator('#explainImport').click()
    await page.locator('.modal h2', { hasText: 'Übergabe an Rekordbox' }).waitFor()
    for (const exportBtnLabel of ['M3U8-Playlist exportieren', 'Rekordbox XML exportieren', 'CSV exportieren']) {
      await page.locator('.modal button', { hasText: exportBtnLabel }).waitFor({ state: 'visible' })
    }
    await capture(page, captureDir, '06-set-handover.png')
    await page.locator('.modal button', { hasText: 'M3U8-Playlist exportieren' }).click()
    await page.locator('#toast').waitFor({ state: 'visible' })

    await page.locator('#explainImport').click()
    await page.locator('.modal h2', { hasText: 'Übergabe an Rekordbox' }).waitFor()
    await page.locator('.modal button', { hasText: 'Rekordbox XML exportieren' }).click()
    await page.locator('#toast').waitFor({ state: 'visible' })

    await page.locator('#explainImport').click()
    await page.locator('.modal h2', { hasText: 'Übergabe an Rekordbox' }).waitFor()
    await page.locator('.modal button', { hasText: 'CSV exportieren' }).click()
    await page.locator('#toast').waitFor({ state: 'visible' })

    // Clear Set via custom Modal
    await page.locator('#clearSet').click()
    await page.locator('.modal button.primary', { hasText: 'Set leeren' }).click()
    assert.equal(await page.locator('#setCountTab').innerText(), '0')

    // ---- 4. HARDWARE / PRO DJ LINK MODAL & HELP MODAL ----
    await page.locator('#liveStatusBtn').click()
    await page.locator('.modal h2', { hasText: 'Hardware, Pro DJ Link & Quellmedien' }).waitFor()
    await page.locator('.hw-modal button', { hasText: 'Demo-Link' }).click()
    await page.locator('.hw-deck').first().waitFor()
    await page.keyboard.press('Escape')

    await page.locator('#helpBtn').click()
    await page.locator('.modal h2', { hasText: 'Bedienung & Tastenkürzel' }).waitFor()
    await page.keyboard.press('Escape')

    // Keyboard shortcuts Ctrl+1 / Ctrl+2 / Ctrl+3
    await page.keyboard.press('Control+1')
    assert.ok(await page.locator('#view-live.active').isVisible())
    await page.keyboard.press('Control+2')
    assert.ok(await page.locator('#view-filter.active').isVisible())

    assert.deepEqual(errors, [])
    console.log(
      `Electron Technical & Visual E2E OK: 15.500 Tracks, ${renderedRows} DOM-Zeilen, Jahr-Sortierung (↓/↑ + '—' am Ende), Live-Filter, Tooltips, Rekordbox-Handover (Live-Inspector, Kontextmenü, Find-Modal & Filter-Studio), Handover-Modal & Hardware-Modal geprüft.`,
    )
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('@playwright/test')

async function run() {
  const real = process.env.CUEPOINT_VERIFY_REAL === '1'
  const fixture = path.resolve('build', 'synthetic_test_master.db')
  if (!real) assert.ok(fs.existsSync(fixture), 'Zuerst tests/generate_synthetic_db.py ausführen.')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cuepoint-test-'))
  const env = { ...process.env, CUEPOINT_TEST_PROFILE: profile }
  if (real) delete env.CUEPOINT_LIBRARY_PATH
  else env.CUEPOINT_LIBRARY_PATH = fixture
  const app = await _electron.launch({
    executablePath: process.env.CUEPOINT_TEST_EXE,
    args: process.env.CUEPOINT_TEST_EXE ? [] : ['.'],
    env,
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (real) {
      await page.waitForFunction(() => Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount')) > 1,
        undefined, { timeout: 90_000 })
      const source = await page.locator('.source-line').getAttribute('title')
      assert.equal(source.toLowerCase(), 'e:\\pioneer\\master\\master.db')
      const tracks = Number(await page.getByRole('grid').getAttribute('aria-rowcount')) - 1
      if (process.env.CUEPOINT_VERIFY_LIVE_REAL === '1') {
        const radar = page.locator('.radar')
        await radar.getByText(/^Rekordbox · Deck \d+$/).waitFor({ timeout: 90_000 })
        const liveDeck = await page.evaluate(async () => {
          const status = await window.cuepoint.request('live', { harmonic: true, tolerance: 3 })
          return status.state === 'rekordbox' && status.decks.find((deck) =>
            deck.deck === status.anchor && deck.playing && deck.key && deck.bpm)
        })
        assert.ok(liveDeck, 'Ein laufendes Rekordbox-Deck muss verfügbar sein')
        const candidates = await page.evaluate(async (deck) => {
          const number = Number(deck.key.slice(0, -1))
          const mode = deck.key.slice(-1)
          const keys = new Set([deck.key, `${number}${mode === 'A' ? 'B' : 'A'}`,
            `${(number + 10) % 12 + 1}${mode}`, `${number % 12 + 1}${mode}`])
          const library = await window.cuepoint.request('query', { facets: false })
          return library.rows.filter((track) => track.id !== deck.libraryId && keys.has(track.key)
            && track.bpm !== null && Math.abs(track.bpm - deck.bpm) <= deck.bpm * 0.03 + 1e-8).map(({ id }) => id)
        }, liveDeck)
        assert.ok(candidates.length > 0)
        await radar.getByText(liveDeck.bpm.toFixed(2), { exact: true }).waitFor()
        await radar.getByRole('button', { name: 'Live Match', exact: true }).click()
        await page.waitForFunction((count) =>
          Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount')) === count + 1, candidates.length)
        const shown = await page.locator('[data-track-id]').evaluateAll((rows) => rows.map((row) => row.dataset.trackId))
        assert.ok(shown.length > 0)
        assert.ok(shown.every((id) => candidates.includes(id)))
        console.log(`Rekordbox-Deck ${liveDeck.deck} läuft: ${liveDeck.bpm.toFixed(2)} BPM, ${liveDeck.key}. Live Match zeigt exakt ${candidates.length} passende Tracks.`)
      }
      assert.deepEqual(errors, [])
      console.log(`Windows-App mit Standardpfad: ${tracks} echte Tracks aus ${source}.`)
      return
    }
    await page.waitForFunction(() => Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount')) >= 15_001,
      undefined, { timeout: 45_000 })
    const grid = page.getByRole('grid')
    const tracks = Number(await grid.getAttribute('aria-rowcount')) - 1
    assert.ok(tracks >= 15_000)
    const scroll = page.getByLabel('Virtualisierte Trackliste')
    const rendered = await grid.locator('[data-track-id]').count()
    assert.ok(rendered > 0 && rendered < 100, 'DOM muss virtualisiert sein')
    if (process.env.CUEPOINT_CAPTURE) await page.screenshot({ path: process.env.CUEPOINT_CAPTURE })
    if (process.env.CUEPOINT_BENCHMARK_UI) {
      const scrollStats = await scroll.evaluate(async (element) => {
        async function sample(distance) {
          const frames = []
          let previous = await new Promise(requestAnimationFrame)
          for (let i = 0; i < 120; i++) {
            if (distance) element.scrollTop += distance
            const now = await new Promise(requestAnimationFrame)
            frames.push(now - previous)
            previous = now
          }
          frames.sort((a, b) => a - b)
          return { median: frames[60], p95: frames[114], max: frames[119] }
        }
        return { idle: await sample(0), scroll: await sample(83) }
      })
      console.log('Scroll-Frames (ms):', scrollStats)
    }
    await scroll.press('End')
    await page.waitForFunction((last) => !!document.querySelector(`[aria-rowindex="${last}"]`), tracks + 1)
    await scroll.press('Home')
    await grid.getByRole('columnheader', { name: 'Titel', exact: true }).click({ button: 'right' })
    await page.getByRole('checkbox', { name: 'Album', exact: true }).check()
    await page.keyboard.press('Escape')
    await grid.getByRole('columnheader', { name: 'Album' }).waitFor()
    await page.reload()
    await grid.getByRole('columnheader', { name: 'Album' }).waitFor({ timeout: 45_000 })
    await page.waitForFunction(() => Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount')) >= 15_001,
      undefined, { timeout: 45_000 })
    await page.getByRole('textbox', { name: 'Tracks suchen' }).fill('never-a-matching-title-842109')
    await page.getByText('Keine Treffer', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Suche leeren' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-track-id]').length > 0)
    const artist = await grid.locator('[data-track-id]').first().locator('.cell-artist').innerText()
    await page.getByRole('button', { name: 'Filter hinzufügen' }).click()
    await page.getByLabel('Filterfeld').selectOption('artist')
    await page.getByLabel('Filterwert').fill(artist)
    await page.getByRole('button', { name: 'Filter übernehmen' }).click()
    await page.waitForFunction((size) => {
      const actual = Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount'))
      return actual > 1 && actual < size
    }, tracks)
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).first().click()
    await page.getByRole('button', { name: 'Sortierung hinzufügen' }).click()
    await page.getByLabel('Sortierfeld').selectOption('artist')
    await page.getByRole('button', { name: 'Sortierstufe übernehmen' }).click()
    const artistSort = page.getByRole('button', { name: /Interpret.*Sortierrichtung/ })
    await artistSort.press('Alt+ArrowLeft')
    await page.waitForFunction(() => document.querySelector('.sort-chip .direction-button')?.textContent === 'Interpret')
    await page.locator('[data-track-id]').filter({ has: page.locator('.key-badge') }).first().click({ button: 'right' })
    await page.getByRole('button', { name: 'Als Referenz setzen' }).click()
    await page.locator('[data-match="exact"]').first().waitFor()
    await page.getByRole('button', { name: 'Live Match', exact: true }).first().click()
    await page.getByRole('button', { name: 'Demo starten' }).click()
    await page.getByText('Demo aktiv', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Bibliothek', exact: true }).click()
    await page.getByRole('button', { name: 'Auto-Follow', exact: true }).click()
    await page.waitForFunction(() => {
      const total = Number(document.querySelector('[role=grid]')?.getAttribute('aria-rowcount'))
      return total > 1 && total < 15_000 && document.querySelector('[data-match=exact]')
    })
    assert.deepEqual(errors, [])
    console.log(`Electron: ${tracks} Tracks, ${rendered} DOM-Zeilen, Ende/Home, Spalten-Persistenz, Suche, Sortierung, Referenz und Auto-Follow geprüft.`)
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('@playwright/test')
const { downloadPlaylist, playlistEntries } = require('./playlist-download.cjs')

async function prepare(directory, executable) {
  fs.mkdirSync(path.dirname(directory), { recursive: true })
  fs.mkdirSync(directory, { recursive: false })
  const python = process.env.CUEPOINT_TEST_PYTHON || path.resolve('.venv', 'Scripts', 'python.exe')
  execFileSync(python, ['scripts/rekordbox_reimport.py', 'fixture', directory], { stdio: 'inherit' })
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.json'), 'utf8'))
  const env = { ...process.env, CUEPOINT_TEST_PROFILE: path.join(directory, 'cuepoint-profile'),
    CUEPOINT_LIBRARY_PATH: path.join(directory, 'master.db') }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ acceptDownloads: true, executablePath: executable,
    args: executable ? [] : ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#tab-filter').click()
    for (const track of manifest.tracks) {
      const row = page.locator(`#view-filter [data-track-id="${track.id}"]`)
      await row.getByText(track.title, { exact: true }).waitFor({ timeout: 60_000 })
      await row.locator('button[title="Zum Set hinzufügen"]').click()
    }
    await page.locator('#tab-set').click()
    await page.waitForFunction(() => document.querySelectorAll('#view-set .setrow').length === 3)
    assert.deepEqual(await page.locator('#view-set .setrow .title').allTextContents(), manifest.tracks.map(t => t.title))
    await page.screenshot({ path: path.join(directory, '01-cuepoint-set.png') })
    await page.locator('#explainImport').click()
    await page.locator('.modal h2', { hasText: 'Übergabe an Rekordbox' }).waitFor()
    await page.screenshot({ path: path.join(directory, '02-cuepoint-handover.png') })
    const downloaded = await downloadPlaylist(page, directory, 'm3u8')
    assert.deepEqual(playlistEntries(downloaded), manifest.tracks.map(t => t.path))
    const uniquePlaylist = path.join(directory, manifest.playlist + '.m3u8')
    fs.renameSync(downloaded, uniquePlaylist)
    console.log(`Cuepoint download verified: ${uniquePlaylist}`)
  } finally {
    await app.close()
  }
}

const [directory, executable] = process.argv.slice(2)
if (!directory) {
  console.error('Usage: node tests/rekordbox-reimport.cjs <new evidence directory> [packaged Cuepoint.exe]')
  process.exitCode = 2
} else {
  prepare(path.resolve(directory), executable && path.resolve(executable)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

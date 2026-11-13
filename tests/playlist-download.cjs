const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function downloadPlaylist(page, directory, format) {
  const m3u8 = format === 'm3u8'
  const name = m3u8 ? 'airdox-setliste.m3u8' : 'rekordbox-import.xml'
  const label = m3u8 ? 'M3U8-Playlist exportieren' : 'Rekordbox XML exportieren'
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('.modal button', { hasText: label }).click(),
  ])
  assert.equal(download.suggestedFilename(), name)
  const target = path.join(directory, name)
  await download.saveAs(target)
  assert.ok(fs.statSync(target).size > 0)
  return target
}

function playlistEntries(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
}

module.exports = { downloadPlaylist, playlistEntries }

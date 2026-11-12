const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('@playwright/test')

async function allocatePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForDebugger(endpoint, launcher) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && launcher.exitCode === null) {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) }).catch(() => null)
    if (response?.ok) return
    await delay(250)
  }
  assert.fail(`Portable wrapper did not start its Electron debugger (exit ${launcher.exitCode})`)
}

async function run() {
  assert.equal(process.platform, 'win32')
  const exe = path.resolve(process.env.CUEPOINT_TEST_EXE)
  const portable = path.resolve(process.env.CUEPOINT_TEST_PORTABLE)
  const fixture = path.resolve('build', 'synthetic_test_master.db')
  assert.ok(fs.statSync(exe).isFile() && fs.statSync(portable).isFile() && fs.statSync(fixture).isFile())
  const env = { ...process.env, CUEPOINT_TEST_EXE: exe }
  delete env.CUEPOINT_VERIFY_REAL
  delete env.ELECTRON_RUN_AS_NODE
  execFileSync(process.execPath, ['tests/electron-smoke.cjs'], { env, stdio: 'inherit' })

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cuepoint-portable-test-'))
  const port = await allocatePort()
  const endpoint = `http://127.0.0.1:${port}`
  const launcher = spawn(portable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    env: { ...env, CUEPOINT_TEST_PROFILE: profile, CUEPOINT_LIBRARY_PATH: fixture },
    stdio: 'ignore',
    windowsHide: true,
  })
  const exited = new Promise((resolve, reject) => {
    launcher.once('error', reject)
    launcher.once('exit', resolve)
  })
  let browser
  try {
    await Promise.race([waitForDebugger(endpoint, launcher), exited.then((code) => {
      assert.fail(`Portable wrapper exited before its application started (exit ${code})`)
    })])
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    await page.waitForFunction(
      () => Number((document.querySelector('#sidebarTotal')?.textContent ?? '').replace(/\D/g, '')) === 15500,
      undefined,
      { timeout: 60_000 },
    )
    if (process.env.CUEPOINT_CAPTURE_DIR) {
      await page.screenshot({ path: path.join(process.env.CUEPOINT_CAPTURE_DIR, 'portable-boot.png') })
    }
    const session = await browser.newBrowserCDPSession()
    await session.send('Browser.close')
    assert.equal(await Promise.race([exited, delay(15_000, 'timeout', { ref: false })]), 0)
    console.log(`Portable wrapper launched and loaded the 15,500-track fixture: ${path.basename(portable)}`)
  } finally {
    await browser?.close().catch(() => {})
    if (launcher.pid && launcher.exitCode === null) {
      execFileSync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      await exited
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

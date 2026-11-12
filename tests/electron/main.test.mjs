import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Module, { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

const require = createRequire(import.meta.url)

function createElectronHarness({
  packaged = false,
  platform = 'win32',
  existsPaths = new Set(),
  savedPathContent = null,
  dialogResult = { canceled: false, filePaths: ['E:\\PIONEER\\Master\\master.db'] },
  mainFrameOverride = null,
} = {}) {
  const handles = new Map()
  const appEvents = new Map()
  const webContentsEvents = new Map()
  let windowOpenHandler = null
  let permissionHandler = null
  let destroyed = false
  let maximized = false

  class FakeStdin extends EventEmitter {
    constructor() {
      super()
      this.writes = []
      this.ended = false
    }
    write(line) {
      this.writes.push(line)
      return true
    }
    end() {
      this.ended = true
    }
  }

  class FakeChild extends EventEmitter {
    constructor() {
      super()
      this.stdout = new PassThrough()
      this.stderr = new PassThrough()
      this.stdin = new FakeStdin()
      this.killed = false
    }
    kill() {
      this.killed = true
    }
  }

  const children = []
  let whenReadyPromise = null

  const mainFrame = { id: 'main-frame' }
  const fakeWindow = {
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    maximize: () => { maximized = true },
    unmaximize: () => { maximized = false },
    minimize: () => {},
    close: () => { destroyed = true },
    loadFile: () => {},
    loadURL: () => {},
    webContents: {
      mainFrame,
      session: { setPermissionRequestHandler: (fn) => { permissionHandler = fn } },
      on: (ev, cb) => webContentsEvents.set(ev, cb),
      setWindowOpenHandler: (fn) => { windowOpenHandler = fn },
    },
  }
  const fakeWindowOn = new Map()
  fakeWindow.on = (ev, cb) => fakeWindowOn.set(ev, cb)

  const fakeSession = {
    defaultSession: {
      setPermissionRequestHandler: (fn) => { permissionHandler = fn },
    },
  }

  const app = {
    isPackaged: packaged,
    whenReady: () => {
      whenReadyPromise = Promise.resolve()
      return whenReadyPromise
    },
    on: (ev, cb) => appEvents.set(ev, cb),
    getAppPath: () => path.resolve('E:\\iste rekordbox'),
    getPath: (name) => path.join(os.tmpdir(), `cuepoint-test-${name}`),
    setPath: () => {},
    quit: () => { appEvents.get('quit-called')?.() },
  }

  const dialog = {
    showOpenDialog: async () => dialogResult,
  }

  const ipcMain = {
    handle: (channel, fn) => handles.set(channel, fn),
  }

  const BrowserWindow = function BrowserWindow(opts) {
    BrowserWindow.lastOptions = opts
    return fakeWindow
  }

  const electronMock = {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu: { setApplicationMenu: () => {} },
    session: fakeSession,
  }

  const exposed = {}
  const ipcRendererMock = {
    invoke: (channel, ...args) => ({ channel, args }),
  }
  const contextBridgeMock = {
    exposeInMainWorld: (key, api) => {
      exposed[key] = api
    },
  }

  const savedFiles = new Map()
  if (savedPathContent !== null) {
    savedFiles.set(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ path: savedPathContent }))
  }

  const origLoad = Module._load
  const origExists = fs.existsSync
  const origRead = fs.readFileSync
  const origWrite = fs.writeFileSync
  const origRename = fs.renameSync
  const origMkdir = fs.mkdirSync
  const origPlatform = process.platform

  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  fs.existsSync = (target) => existsPaths.has(String(target)) || String(target).endsWith('preload.cjs') || origExists(target)
  fs.readFileSync = (target, enc) => {
    const key = String(target)
    if (savedFiles.has(key)) return savedFiles.get(key)
    if (key.endsWith('library.json')) throw new Error('ENOENT')
    return origRead(target, enc)
  }
  fs.writeFileSync = (target, content) => {
    savedFiles.set(String(target), String(content))
  }
  fs.renameSync = (from, to) => {
    if (savedFiles.has(String(from))) {
      savedFiles.set(String(to), savedFiles.get(String(from)))
      savedFiles.delete(String(from))
    }
  }
  fs.mkdirSync = () => undefined

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        ...electronMock,
        contextBridge: contextBridgeMock,
        ipcRenderer: ipcRendererMock,
      }
    }
    if (request === 'node:child_process' || request === 'child_process') {
      return {
        spawn: (exe, args, opts) => {
          const child = new FakeChild()
          child.spawnArgs = { exe, args, opts }
          children.push(child)
          return child
        },
      }
    }
    return origLoad.apply(this, arguments)
  }

  const mainPath = require.resolve('../../electron/main.cjs')
  const preloadPath = require.resolve('../../electron/preload.cjs')
  delete require.cache[mainPath]
  delete require.cache[preloadPath]

  try {
    require(preloadPath)
    require(mainPath)
  } finally {
    Module._load = origLoad
    fs.existsSync = origExists
    fs.readFileSync = origRead
    fs.writeFileSync = origWrite
    fs.renameSync = origRename
    fs.mkdirSync = origMkdir
    Object.defineProperty(process, 'platform', { configurable: true, value: origPlatform })
  }

  const trustedEvent = {
    sender: fakeWindow.webContents,
    senderFrame: mainFrameOverride ?? mainFrame,
  }

  return {
    handles,
    appEvents,
    webContentsEvents,
    fakeWindow,
    fakeWindowOn,
    BrowserWindow,
    children,
    savedFiles,
    exposed,
    trustedEvent,
    getWindowOpenHandler: () => windowOpenHandler,
    getPermissionHandler: () => permissionHandler,
    whenReady: async () => {
      await whenReadyPromise
      await new Promise((resolve) => setTimeout(resolve, 10))
    },
    setDestroyed: (v) => { destroyed = v },
  }
}

test('preload exposes strict IPC wrapper API', () => {
  const harness = createElectronHarness()
  assert.ok(harness.exposed.cuepoint)
  assert.deepEqual(harness.exposed.cuepoint.request('query', { a: 1 }), {
    channel: 'cuepoint:request',
    args: ['query', { a: 1 }],
  })
  assert.deepEqual(harness.exposed.cuepoint.choose(true), {
    channel: 'cuepoint:choose',
    args: [true],
  })
  assert.deepEqual(harness.exposed.cuepoint.window('minimize'), {
    channel: 'cuepoint:window',
    args: ['minimize'],
  })
})

test('main.cjs security settings, navigation/permission blocks, window controls and choose dialog', async () => {
  const harness = createElectronHarness({
    dialogResult: { canceled: false, filePaths: ['D:\\Rekordbox\\master.db'] },
  })
  await harness.whenReady()

  const opts = harness.BrowserWindow.lastOptions.webPreferences
  assert.equal(opts.contextIsolation, true)
  assert.equal(opts.sandbox, true)
  assert.equal(opts.nodeIntegration, false)

  // Security guards: permission deny, external window deny, foreign navigation deny
  let allowed = true
  harness.getPermissionHandler()({}, 'media', (res) => { allowed = res })
  assert.equal(allowed, false)
  assert.deepEqual(harness.getWindowOpenHandler()(), { action: 'deny' })

  let prevented = false
  harness.webContentsEvents.get('will-navigate')({ preventDefault: () => { prevented = true } }, 'https://evil.example')
  assert.equal(prevented, true)

  // Window control actions + maximize toggle
  const winHandler = harness.handles.get('cuepoint:window')
  assert.equal(await winHandler(harness.trustedEvent, 'minimize'), undefined)
  await winHandler(harness.trustedEvent, 'maximize')
  assert.equal(harness.fakeWindow.isMaximized(), true)
  await winHandler(harness.trustedEvent, 'maximize')
  assert.equal(harness.fakeWindow.isMaximized(), false)
  await winHandler(harness.trustedEvent, 'close')
  assert.equal(harness.fakeWindow.isDestroyed(), true)

  // Untrusted frame rejection
  harness.setDestroyed(false)
  await assert.rejects(
    () => harness.handles.get('cuepoint:request')({ sender: harness.fakeWindow.webContents, senderFrame: { id: 'evil' } }, 'query'),
    /Unbekannter Bibliotheksbefehl/,
  )
  assert.equal(await harness.handles.get('cuepoint:choose')({ sender: null }, true), null)
  assert.equal(await harness.handles.get('cuepoint:window')({ sender: null }, 'close'), undefined)

  // Choose dialog
  const chosen = await harness.handles.get('cuepoint:choose')(harness.trustedEvent, true)
  assert.equal(chosen, 'D:\\Rekordbox\\master.db')

  harness.fakeWindowOn.get('closed')?.()
  harness.appEvents.get('window-all-closed')?.()
})

test('main.cjs request routing, worker RPC responses, errors, stderr and exit recovery', async () => {
  const fsExists = new Set([path.resolve('E:\\iste rekordbox\\dist\\index.html')])
  const harness = createElectronHarness({
    savedPathContent: 'C:\\Saved\\master.db',
    existsPaths: fsExists,
  })
  await harness.whenReady()

  const reqHandler = harness.handles.get('cuepoint:request')

  // Reject disallowed method
  await assert.rejects(() => reqHandler(harness.trustedEvent, 'evalShell', {}), /Unbekannter Bibliotheksbefehl/)

  // Enqueue demoLibrary with non-existent test fixture fallback + open with savedPath fallback
  const demoPromise = reqHandler(harness.trustedEvent, 'demoLibrary', {})
  assert.equal(harness.children.length, 1)
  const child = harness.children[0]
  const demoPayload = JSON.parse(child.stdin.writes[0].trim())
  assert.equal(demoPayload.method, 'demoLibrary')
  child.stdout.write(JSON.stringify({ id: demoPayload.id, result: { kind: 'Demo', total: 40 } }) + '\n')
  const demoRes = await demoPromise
  assert.equal(demoRes.kind, 'Demo')

  const openPromise = reqHandler(harness.trustedEvent, 'open', {})
  const openPayload = JSON.parse(child.stdin.writes[1].trim())
  assert.equal(openPayload.method, 'open')
  assert.equal(openPayload.params.path, 'C:\\Saved\\master.db')

  // Send noise (empty line + invalid JSON + unknown id) before valid response
  child.stdout.write('\nnot-json\n{"id":999,"result":1}\n')
  child.stdout.write(JSON.stringify({ id: openPayload.id, result: { path: 'E:\\PIONEER\\Master\\master.db', kind: 'Master', total: 100 } }) + '\n')
  const openRes = await openPromise
  assert.equal(openRes.kind, 'Master')

  // Error response from worker rejects promise
  const queryPromise = reqHandler(harness.trustedEvent, 'query', { search: 'techno' })
  const queryPayload = JSON.parse(child.stdin.writes[2].trim())
  child.stdout.write(JSON.stringify({ id: queryPayload.id, error: 'DB Fehler' }) + '\n')
  await assert.rejects(() => queryPromise, /DB Fehler/)

  // Pending promise rejects when child exits cleanly/crashes
  const tailPromise = reqHandler(harness.trustedEvent, 'interfaces', {})
  child.stderr.write('traceback line\n')
  child.emit('exit', 1)
  await assert.rejects(() => tailPromise, /Der Python-Dienst wurde beendet \(1\)/)

  // Subsequent request after crash immediately rejects with workerError
  await assert.rejects(() => reqHandler(harness.trustedEvent, 'usb', {}), /Der Python-Dienst wurde beendet/)

  harness.appEvents.get('before-quit')?.()
})

test('main.cjs covers packaged mode, CUEPOINT_TEST_PROFILE, open fallback, canceled choose and timeout', async () => {
  process.env.CUEPOINT_TEST_PROFILE = path.join(os.tmpdir(), 'cuepoint-profile-override')
  process.resourcesPath = path.join(os.tmpdir(), 'cuepoint-res')
  const origSetTimeout = globalThis.setTimeout
  const harness = createElectronHarness({
    packaged: true,
    savedPathContent: 'C:\\Stale\\master.db',
    dialogResult: { canceled: true, filePaths: [] },
    existsPaths: new Set([path.join(process.resourcesPath, 'synthetic_test_master.db')]),
  })
  delete process.env.CUEPOINT_TEST_PROFILE
  await harness.whenReady()
  assert.equal(await harness.handles.get('cuepoint:choose')(harness.trustedEvent, false), null)

  const reqHandler = harness.handles.get('cuepoint:request')
  const child = harness.children[0]

  // demoLibrary when packaged uses resourcesPath synthetic_test_master.db
  const demoP = reqHandler(harness.trustedEvent, 'demoLibrary', {})
  const demoMsg = JSON.parse(child.stdin.writes[0].trim())
  assert.ok(demoMsg.params.path.endsWith('synthetic_test_master.db'))
  child.stdout.write(JSON.stringify({ id: demoMsg.id, result: { kind: 'Demo' } }) + '\n')
  await demoP

  // open fails with stale savedPath, automatically retries {} cleanly
  const openP = reqHandler(harness.trustedEvent, 'open', {})
  const open1 = JSON.parse(child.stdin.writes[1].trim())
  child.stdout.write(JSON.stringify({ id: open1.id, error: 'Stale path' }) + '\n')
  await new Promise((r) => origSetTimeout(r, 10))
  const open2 = JSON.parse(child.stdin.writes[2].trim())
  assert.deepEqual(open2.params, {})
  child.stdout.write(JSON.stringify({ id: open2.id, result: { path: 'E:\\PIONEER\\Master\\master.db', kind: 'Master' } }) + '\n')
  await openP

  // Explicit params.path open error rejects immediately without {} fallback (covers line 106)
  const explicitFailP = reqHandler(harness.trustedEvent, 'open', { path: 'C:\\Missing\\master.db' })
  const openExplicit = JSON.parse(child.stdin.writes[3].trim())
  child.stdout.write(JSON.stringify({ id: openExplicit.id, error: 'Nicht gefunden' }) + '\n')
  await assert.rejects(() => explicitFailP, /Nicht gefunden/)

  // Request timeout (mock 90_000 timer) + stdin error
  globalThis.setTimeout = (fn, ms) => (ms === 90_000 ? origSetTimeout(fn, 5) : origSetTimeout(fn, ms))
  try {
    await assert.rejects(() => reqHandler(harness.trustedEvent, 'usb', {}), /Zeitüberschreitung/)
  } finally {
    globalThis.setTimeout = origSetTimeout
  }
  const failAfterClose = reqHandler(harness.trustedEvent, 'usb', {})
  child.stdin.emit('error', new Error('broken pipe'))
  await assert.rejects(() => failAfterClose, /broken pipe/)
  // Late error/exit after worker already cleared is ignored cleanly
  child.emit('error', new Error('ignored'))
})

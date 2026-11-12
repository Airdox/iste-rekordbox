const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')

const methods = new Set([
  'open', 'demoLibrary', 'query', 'detail', 'interfaces', 'usb', 'linkStart', 'linkStop',
  'demoLink', 'live', 'bindMedia', 'unbindMedia',
])
let worker
let workerError
let nextId = 0
let window
const pending = new Map()

if (process.env.CUEPOINT_TEST_PROFILE) {
  app.setPath('userData', process.env.CUEPOINT_TEST_PROFILE)
}

function launchWorker() {
  const root = app.getAppPath()
  const localPython = join(root, '.venv', 'Scripts', 'python.exe')
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'core', 'cuepoint-core.exe')
    : existsSync(localPython) ? localPython : 'py'
  const args = app.isPackaged ? [] : [
    ...(executable === 'py' ? ['-3.11'] : []), '-u', join(root, 'backend', 'main.py'),
  ]
  workerError = undefined
  mkdirSync(app.getPath('userData'), { recursive: true })
  const processHandle = spawn(executable, args, {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: app.getPath('userData'),
    env: { ...process.env, PYTHONUTF8: '1' },
  })
  worker = processHandle
  const fail = (message) => {
    if (worker !== processHandle) return
    worker = undefined
    workerError = message
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new Error(message))
    }
    pending.clear()
  }
  processHandle.on('error', (error) => fail(error.message))
  processHandle.on('exit', (code) => fail(`Der Python-Dienst wurde beendet (${code}).`))
  processHandle.stdin.on('error', (error) => fail(error.message))
  processHandle.stderr.on('data', (chunk) => process.stderr.write(chunk))
  createInterface({ input: processHandle.stdout }).on('line', (line) => {
    let data
    try { data = JSON.parse(line) } catch { return }
    const entry = pending.get(data.id)
    if (!entry) return
    clearTimeout(entry.timeout)
    pending.delete(data.id)
    if (data.error) entry.reject(new Error(data.error))
    else entry.resolve(data.result)
  })
}

function request(method, params) {
  if (!worker) return Promise.reject(new Error(workerError || 'Der Python-Dienst ist nicht verfügbar.'))
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Zeitüberschreitung beim Lesen der Bibliothek.'))
    }, 90_000)
    pending.set(id, { resolve, reject, timeout })
    worker.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}

function preferences() {
  return join(app.getPath('userData'), 'library.json')
}

function savedPath() {
  try { return JSON.parse(readFileSync(preferences(), 'utf8')).path } catch { return undefined }
}

function remember(path) {
  const target = preferences()
  try {
    writeFileSync(target + '.tmp', JSON.stringify({ path }), 'utf8')
    renameSync(target + '.tmp', target)
  } catch (error) {
    console.error('Bibliothekspfad konnte nicht gespeichert werden:', error.message)
  }
}

function trusted(event) {
  return event.sender === window?.webContents && event.senderFrame === window?.webContents.mainFrame
}

ipcMain.handle('cuepoint:request', async (event, method, params = {}) => {
  if (!trusted(event) || !methods.has(method)) throw new Error('Unbekannter Bibliotheksbefehl.')
  if (method === 'open') {
    const testPath = process.env.CUEPOINT_LIBRARY_PATH
    const previous = testPath || savedPath()
    const path = params.path || previous
    const result = await request(method, { path }).catch((error) => {
      if (!params.path && !testPath && previous) return request(method, {})
      throw error
    })
    if (!testPath) remember(result.path)
    return result
  }
  if (method === 'demoLibrary') {
    const fixture = app.isPackaged
      ? join(process.resourcesPath, 'synthetic_test_master.db')
      : join(app.getAppPath(), 'build', 'synthetic_test_master.db')
    return request(method, existsSync(fixture) ? { path: fixture } : {})
  }
  return request(method, params)
})

ipcMain.handle('cuepoint:choose', async (event, directory) => {
  if (!trusted(event)) return null
  const result = await dialog.showOpenDialog(window, {
    title: directory ? 'Rekordbox-Ordner öffnen' : 'Rekordbox-Datenbank öffnen',
    properties: [directory ? 'openDirectory' : 'openFile'],
    filters: [{ name: 'Rekordbox-Bibliothek', extensions: ['db', 'pdb'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('cuepoint:window', (event, action) => {
  if (!trusted(event)) return
  if (action === 'minimize') window.minimize()
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  if (action === 'close') window.close()
})

function createWindow() {
  window = new BrowserWindow({
    width: 1500, height: 960, minWidth: 920, minHeight: 660,
    backgroundColor: '#0b0c10', titleBarStyle: 'hidden', frame: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  })
  Menu.setApplicationMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
}

app.whenReady().then(() => {
  launchWorker()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => worker?.stdin.end())

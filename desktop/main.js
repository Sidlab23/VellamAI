'use strict'

// Vellam desktop — Electron main process.
//
// Orchestrates the whole local stack (Ollama + FastAPI backend + UI) inside one
// app window:
//   1. ensure Ollama is running (detect + auto-launch, or point the user to install)
//   2. spawn the bundled FastAPI backend (PyInstaller exe) on 127.0.0.1:8000
//   3. wait for /health, then load the static frontend into the window
// On quit, the backend (and its child Chromium) is torn down.

const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn, execFile } = require('child_process')
const { startStaticServer } = require('./lib/static-server')

// Brand the app. app.getName() drives the userData dir (%APPDATA%/Vellam) and the
// window/about name; set it before any getPath('userData') call below.
app.setName('Vellam')

const isDev = process.env.ELECTRON_DEV === '1'
const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 8000
const OLLAMA_PORT = 11434
const HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`

// ── Paths & main-process log ─────────────────────────────────────────────────
// Writable per-user data dir: DB, vault, logs and uploads land here because the
// backend is launched with this as its cwd (config paths are cwd-relative).
const dataDir = app.getPath('userData') // %APPDATA%/Vellam
const logsDir = path.join(dataDir, 'logs')

// The packaged app is a GUI binary with no attached console, so record startup
// milestones/errors to a log beside the backend log for troubleshooting.
const MAIN_LOG = path.join(logsDir, 'main.log')
function log(msg) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    fs.appendFileSync(MAIN_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch (_) {}
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + (e && e.stack ? e.stack : e)))
process.on('unhandledRejection', (e) => log('UNHANDLED_REJECTION: ' + (e && e.stack ? e.stack : e)))

let mainWindow = null
let splashWindow = null
let backendProc = null
let ollamaProc = null
let staticServer = null

function resourcePaths() {
  if (isDev) {
    const repo = path.join(__dirname, '..')
    return {
      backendExe: null, // dev: developer runs `python backend/run.py` themselves
      frontendDir: path.join(repo, 'frontend', 'out'),
      playwrightDir: null, // dev: use whatever browser_use finds locally
    }
  }
  const res = process.resourcesPath
  return {
    backendExe: path.join(res, 'backend', 'vellam-backend.exe'),
    frontendDir: path.join(res, 'frontend', 'out'),
    playwrightDir: path.join(res, 'ms-playwright'),
  }
}

// Resolve the exact Chromium executable inside the bundled ms-playwright folder.
// Layout is ms-playwright/chromium-<rev>/chrome-win64/chrome.exe (older Playwright
// used chrome-win); we try both so a version bump doesn't break us. Returns '' if
// not found, in which case the backend falls back to browser_use's own discovery.
function findBundledChrome(playwrightDir) {
  if (!playwrightDir || !fs.existsSync(playwrightDir)) return ''
  let entries = []
  try {
    entries = fs.readdirSync(playwrightDir)
  } catch (_) {
    return ''
  }
  const chromiumDirs = entries
    .filter((n) => n.startsWith('chromium-') && !n.includes('headless'))
    .sort()
    .reverse() // prefer the highest revision
  for (const dir of chromiumDirs) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = path.join(playwrightDir, dir, sub, 'chrome.exe')
      if (fs.existsSync(exe)) return exe
    }
  }
  return ''
}

// ── Small HTTP helper (GET, short timeout) ───────────────────────────────────
function httpOk(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitFor(url, attempts, intervalMs) {
  for (let i = 0; i < attempts; i++) {
    if (await httpOk(url)) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

// ── Ollama: detect + auto-launch ─────────────────────────────────────────────
function findOllamaExe() {
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Ollama',
      'ollama.exe'
    ),
    path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return 'ollama' // fall back to PATH; spawn will error if truly absent
}

async function ensureOllama() {
  if (await httpOk(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`)) return true

  const exe = findOllamaExe()
  try {
    ollamaProc = spawn(exe, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    ollamaProc.unref()
  } catch (e) {
    // Ollama not installed / not on PATH.
    dialog.showMessageBox(splashWindow, {
      type: 'warning',
      title: 'Ollama not found',
      message: 'Vellam uses Ollama to run local AI models, but it is not installed.',
      detail:
        'You can still open Vellam, but tasks will not run until Ollama is ' +
        'installed and running. Download it from https://ollama.com/download, ' +
        'then restart Vellam.',
      buttons: ['Get Ollama', 'Continue anyway'],
      defaultId: 0,
    }).then((r) => {
      if (r.response === 0) shell.openExternal('https://ollama.com/download')
    })
    return false
  }
  // Give the freshly-spawned server up to ~60s to answer.
  return waitFor(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, 60, 1000)
}

// ── Backend: spawn the PyInstaller bundle ────────────────────────────────────
function startBackend() {
  const { backendExe, playwrightDir } = resourcePaths()
  fs.mkdirSync(logsDir, { recursive: true })
  const logStream = fs.createWriteStream(path.join(logsDir, 'backend.log'), {
    flags: 'a',
  })

  const chromeExe = findBundledChrome(playwrightDir)
  backendProc = spawn(backendExe, [], {
    cwd: dataDir, // cwd-relative DB/vault/logs/uploads land in %APPDATA%/Vellam
    env: {
      ...process.env,
      VELLAM_DEBUG: 'false',
      VELLAM_HOST: BACKEND_HOST,
      VELLAM_PORT: String(BACKEND_PORT),
      // Point browser_use at the shipped Chromium two ways: the explicit
      // executable_path (authoritative), and PLAYWRIGHT_BROWSERS_PATH as a backstop
      // for any code path that searches by pattern.
      VELLAM_BROWSER_EXECUTABLE_PATH: chromeExe,
      PLAYWRIGHT_BROWSERS_PATH: playwrightDir,
    },
    windowsHide: true,
  })
  backendProc.stdout.pipe(logStream)
  backendProc.stderr.pipe(logStream)
  backendProc.on('exit', (code) => {
    backendProc = null
    if (code && code !== 0 && !app.isQuitting) {
      // Unexpected crash — surface it rather than leaving a dead window.
      dialog.showMessageBox(mainWindow || splashWindow, {
        type: 'error',
        title: 'Vellam backend stopped',
        message: `The Vellam backend exited unexpectedly (code ${code}).`,
        detail: 'See the log for details.',
        buttons: ['Open log', 'Quit'],
      }).then((r) => {
        if (r.response === 0) shell.openPath(path.join(logsDir, 'backend.log'))
        app.quit()
      })
    }
  })
}

function killBackendTree() {
  if (backendProc && backendProc.pid) {
    // Kill the whole tree so the child Chromium goes too.
    try {
      execFile('taskkill', ['/pid', String(backendProc.pid), '/T', '/F'])
    } catch (_) {
      backendProc.kill()
    }
    backendProc = null
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: '#0b0b12',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b12',
    title: 'Vellam',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.removeMenu()
  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (splashWindow) {
      splashWindow.close()
      splashWindow = null
    }
  })

  // Open external links (target=_blank) in the system browser, not a child window.
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u)) shell.openExternal(u)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Boot sequence ────────────────────────────────────────────────────────────
async function boot() {
  log('boot() start; dataDir=' + dataDir)
  createSplash()
  log('splash created')

  // Ollama is best-effort: the backend already tolerates it being down, so we
  // don't block the UI on it beyond the auto-launch attempt.
  await ensureOllama()
  log('ensureOllama done')

  let appUrl
  if (isDev) {
    appUrl = 'http://localhost:3000' // next dev server, started by the developer
  } else {
    const rp = resourcePaths()
    log('resourcePaths: ' + JSON.stringify(rp))
    log('backendExe exists=' + fs.existsSync(rp.backendExe))
    startBackend()
    log('startBackend() called; waiting for health')
    const healthy = await waitFor(HEALTH_URL, 40, 1000)
    log('health result=' + healthy)
    if (!healthy) {
      const r = await dialog.showMessageBox(splashWindow, {
        type: 'error',
        title: 'Vellam failed to start',
        message: 'The Vellam backend did not respond in time.',
        detail: `Expected it at ${HEALTH_URL}. Check the backend log for the error.`,
        buttons: ['Open log', 'Quit'],
        defaultId: 0,
      })
      if (r.response === 0) shell.openPath(path.join(logsDir, 'backend.log'))
      app.quit()
      return
    }
    const { frontendDir } = resourcePaths()
    staticServer = await startStaticServer(frontendDir)
    appUrl = staticServer.url
  }

  createMainWindow(appUrl)
}

// ── App lifecycle ────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('single-instance lock NOT acquired -> quitting')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  log('single-instance lock acquired; registering whenReady')
  app.whenReady().then(boot).catch((e) => {
    log('boot() REJECTED: ' + (e && e.stack ? e.stack : e))
  })

  app.on('will-quit', () => log('event: will-quit'))
  app.on('quit', () => log('event: quit'))

  app.on('window-all-closed', () => {
    app.quit() // Windows-only target
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    killBackendTree()
    if (staticServer && staticServer.server) staticServer.server.close()
  })
}

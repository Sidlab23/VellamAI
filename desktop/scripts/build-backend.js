'use strict'

// Builds the self-contained backend used by the desktop app:
//   1. PyInstaller bundle  → backend/dist/vellam-backend/  (extraResource: backend)
//   2. Playwright Chromium → backend/pw-browsers/          (extraResource: ms-playwright)
//
// Run from desktop/:  npm run build:backend
// Requires Python with the backend deps + pyinstaller installed (see backend/requirements.txt).

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const backendDir = path.join(__dirname, '..', '..', 'backend')
const pwDir = path.join(backendDir, 'pw-browsers')

function run(cmd, env) {
  console.log('>', cmd)
  execSync(cmd, { cwd: backendDir, stdio: 'inherit', env: { ...process.env, ...env } })
}

// 1. Freeze the FastAPI backend into a one-folder bundle.
console.log('[build:backend] PyInstaller bundle')
run('python -m PyInstaller --noconfirm vellam-backend.spec')

// 2. Download a pinned Chromium into the staging folder the installer ships.
//    Skip if it already looks present to avoid a needless re-download.
const haveChromium =
  fs.existsSync(pwDir) &&
  fs.readdirSync(pwDir).some((n) => n.startsWith('chromium-') && !n.includes('headless'))

if (haveChromium) {
  console.log('[build:backend] Chromium already staged in', pwDir, '- skipping download')
} else {
  console.log('[build:backend] downloading Chromium into', pwDir)
  fs.mkdirSync(pwDir, { recursive: true })
  run('python -m playwright install chromium', { PLAYWRIGHT_BROWSERS_PATH: pwDir })
}

console.log('[build:backend] done')

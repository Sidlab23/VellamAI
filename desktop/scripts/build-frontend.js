'use strict'

// Builds the Next.js static export into frontend/out (consumed as an extraResource).
const { execSync } = require('child_process')
const path = require('path')

const frontendDir = path.join(__dirname, '..', '..', 'frontend')

console.log('[build:frontend] next build (static export) in', frontendDir)
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' })
console.log('[build:frontend] done → frontend/out')

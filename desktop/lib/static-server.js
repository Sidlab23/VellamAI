'use strict'

// Minimal static file server for the Next.js static export (frontend/out).
//
// The packaged app loads the UI from http://127.0.0.1:<random-port>/ rather than
// file:// because Next's exported assets use absolute /_next/... paths, and a real
// HTTP origin is also the most reliable for the app's fetch()/WebSocket calls to
// the backend on 127.0.0.1:8000. No third-party dependency — just Node's http/fs.

const http = require('http')
const fs = require('fs')
const path = require('path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function sendFile(res, filePath, code = 200) {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(code, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

/**
 * Start a localhost static server rooted at `rootDir`.
 * @returns {Promise<{server: import('http').Server, port: number, url: string}>}
 */
function startStaticServer(rootDir) {
  const root = path.resolve(rootDir)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        if (urlPath.endsWith('/')) urlPath += 'index.html'

        let filePath = path.normalize(path.join(root, urlPath))

        // Reject path traversal outside the export root.
        if (filePath !== root && !filePath.startsWith(rootWithSep)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        fs.stat(filePath, (err, stat) => {
          if (!err && stat.isFile()) {
            sendFile(res, filePath)
            return
          }
          // Next export writes /404.html, /foo.html etc. — try the .html sibling,
          // then fall back to index.html so client-side routing always resolves.
          const htmlTry = filePath + '.html'
          if (fs.existsSync(htmlTry)) {
            sendFile(res, htmlTry)
            return
          }
          sendFile(res, path.join(root, 'index.html'), 200)
        })
      } catch (e) {
        res.writeHead(500)
        res.end('Server error')
      }
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port, url: `http://127.0.0.1:${port}/` })
    })
  })
}

module.exports = { startStaticServer }

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Emit a fully static site to `out/` so the Electron desktop build can ship it
  // as plain files (no Node server at runtime). The app is already SSR-free
  // (pages/index.jsx loads it with `dynamic(..., { ssr: false })`) and talks to
  // the backend at an absolute 127.0.0.1:8000 URL, so nothing here needs a server.
  output: 'export',

  // next/image's optimizer needs a server; with a static export there is none, so
  // serve images as-is. (Harmless even though the app currently uses no <Image>.)
  images: { unoptimized: true },

  // Reference assets relatively so the export works when loaded from the
  // electron-serve `app://` protocol root as well as from a plain web server.
  trailingSlash: true,
}

module.exports = nextConfig

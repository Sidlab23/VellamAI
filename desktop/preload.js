'use strict'

// Minimal, safe preload. The Vellam UI is a plain web app that talks to the
// backend over HTTP/WebSocket and needs no privileged APIs, so we expose only a
// tiny read-only surface. contextIsolation stays on; nothing from Node leaks in.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('vellam', {
  isDesktop: true,
  platform: process.platform,
})

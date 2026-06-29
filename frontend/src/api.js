// Use 127.0.0.1, not localhost: the backend binds 127.0.0.1 (IPv4), but Windows
// resolves "localhost" to ::1 (IPv6) first, so localhost calls can hang/fail.
const BASE = 'http://127.0.0.1:8000'
const WS_BASE = 'ws://127.0.0.1:8000'

// Raised when the backend can't be reached at all (server not started, crashed,
// or port blocked). fetch() rejects with a bare "TypeError: Failed to fetch",
// which tells the user nothing — translate it into something actionable.
export class BackendOfflineError extends Error {
  constructor() {
    super(
      'Can’t reach the Vellam backend at 127.0.0.1:8000. ' +
      'It starts automatically with the Vellam app — wait a few seconds for it to come up, or restart the app, then try again.'
    )
    this.name = 'BackendOfflineError'
    this.offline = true
  }
}

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
  } catch (err) {
    // A network-level failure (TypeError: Failed to fetch / connection refused).
    // Anything thrown here means the request never reached the server.
    throw new BackendOfflineError()
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || res.statusText)
  }
  // 204 / empty bodies (e.g. DELETE) have no JSON to parse.
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const OLLAMA_DIRECT = 'http://127.0.0.1:11434/api/tags'

// Embedding-only models (nomic-embed-text, qwen3-embedding, mxbai-embed, ...) can't
// be used for chat/generation, so they're hidden from the model picker.
const EMBED_RE = /embed/i
export function filterChatModels(names) {
  return (names || []).filter(n => n && !EMBED_RE.test(n)).sort()
}

// Native OpenAI models (gpt-*, chatgpt-*, o1/o3/o4) — used to route the API key
// and to pick the right provider tab when an OpenAI model is already selected.
const OPENAI_RE = /^(gpt|chatgpt|o[1-4])/i
export function isOpenaiModel(name) {
  return !!name && OPENAI_RE.test(name)
}

export const api = {
  // Health
  health: () => request('/health'),

  // PC specs + per-model efficiency scores + best-fit recommendation
  getSystemInfo: () => request('/health/system'),

  // Is Ollama reachable? Prefer the backend proxy, but fall back to a direct probe
  // so the status reflects OLLAMA itself even when the backend is down or still booting.
  ollamaHealth: async () => {
    try {
      const d = await request('/health/ollama')
      if (d.available) return d
    } catch {}
    try {
      const r = await fetch(OLLAMA_DIRECT)
      if (r.ok) {
        const d = await r.json()
        const models = filterChatModels((d.models || []).map(m => m.name || m.model || ''))
        return { available: true, models }
      }
    } catch {}
    return { available: false, models: [] }
  },

  // Ollama model list — try backend proxy first, fall back to direct call
  listOllamaModels: async () => {
    // 1. Backend proxy (returns name strings already)
    try {
      const d = await request('/health/ollama')
      const models = filterChatModels((d.models || []))
      if (models.length > 0) return models
    } catch {}

    // 2. Direct Ollama (model objects with .name field)
    try {
      const r = await fetch(OLLAMA_DIRECT)
      if (r.ok) {
        const d = await r.json()
        const models = filterChatModels((d.models || []).map(m => m.name || m.model || ''))
        if (models.length > 0) return models
      }
    } catch {}

    return []
  },

  // Credential vault — site logins stored encrypted at rest on the backend.
  // Passwords are write-only: list never returns them.
  getVault: () => request('/vault'),
  saveVaultEntry: (entry) => request('/vault', { method: 'POST', body: JSON.stringify(entry) }),
  deleteVaultEntry: (id) =>
    request(`/vault/${id}`, { method: 'DELETE' }).then(() => true).catch(() => false),
  // Bulk-import logins from a browser password CSV export. Uses multipart, so it
  // can't go through request() (which forces a JSON content-type) — the browser must
  // set the multipart boundary itself.
  importVaultCsv: async (file) => {
    const form = new FormData()
    form.append('file', file)
    let res
    try {
      res = await fetch(`${BASE}/vault/import-csv`, { method: 'POST', body: form })
    } catch {
      throw new BackendOfflineError()
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(err.message || res.statusText)
    }
    return res.json()
  },

  // User profile — the agent's local "memory" of the user (name, city, sizes,
  // preferences). Stored in the encrypted vault; injected into every run.
  getProfile: () => request('/profile'),
  saveProfile: (profile) => request('/profile', { method: 'PUT', body: JSON.stringify(profile) }),

  // API-key vault — provider + service keys, encrypted at rest. Values are
  // write-only (list never returns them); the backend uses them directly.
  getVaultApiKeys: () => request('/vault/api-keys'),
  saveVaultApiKey: (entry) => request('/vault/api-keys', { method: 'POST', body: JSON.stringify(entry) }),
  deleteVaultApiKey: (id) =>
    request(`/vault/api-keys/${id}`, { method: 'DELETE' }).then(() => true).catch(() => false),

  // Tasks
  createTask: (body) => request('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  listTasks: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request(`/tasks${q ? `?${q}` : ''}`)
  },
  getTask: (id) => request(`/tasks/${id}`),
  cancelTask: (id, reason) =>
    request(`/tasks/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }).catch(() => {}),
  approveTask: (id, approved, note) =>
    request(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved, note }) }),
  // Provider key for question generation is resolved server-side from the vault.
  getQuestions: (id) =>
    request(`/tasks/${id}/questions`, { method: 'POST', body: JSON.stringify({}) }),
  submitClarifications: (id, answers) =>
    request(`/tasks/${id}/clarify`, { method: 'POST', body: JSON.stringify({ answers }) }),

  // Agent. Secrets (provider key + credentials/service keys) are resolved
  // server-side from the encrypted vault, so the browser sends only the task id.
  runAgent: (taskId) =>
    request('/agent/run', { method: 'POST', body: JSON.stringify({ task_id: taskId }) }),
  stopAgent: (taskId) => request(`/agent/stop/${taskId}`, { method: 'POST' }),
  getScreenshot: (taskId) => request(`/agent/screenshot/${taskId}`),

  // OTP / verification codes — when the agent pauses on a site that needs a code
  submitOtp: (taskId, code) =>
    request(`/agent/otp/${taskId}`, { method: 'POST', body: JSON.stringify({ code }) }),
  getOtpState: (taskId) => request(`/agent/otp/${taskId}`),

  // Credentials — when the agent pauses because a site needs sign-in but none were saved
  submitCredentials: (taskId, username, password) =>
    request(`/agent/credentials/${taskId}`, {
      method: 'POST',
      body: JSON.stringify({ username, password: password || '' }),
    }),
  getCredentialState: (taskId) => request(`/agent/credentials/${taskId}`),

  // Questions — when the agent pauses to ask the user a decision (e.g. raise the budget)
  submitAnswer: (taskId, answer) =>
    request(`/agent/ask/${taskId}`, { method: 'POST', body: JSON.stringify({ answer }) }),
  getAskState: (taskId) => request(`/agent/ask/${taskId}`),

  // Grok (xAI) models — proxied through the backend (xAI blocks browser CORS).
  // The key is read from the vault server-side; no key is sent from the browser.
  listXaiModels: async () => {
    try {
      return await request('/agent/xai/models', { method: 'POST', body: JSON.stringify({}) })
    } catch {
      return { models: [], error: 'Could not reach the server.' }
    }
  },

  // OpenAI models — proxied through the backend (filtered to chat-capable models).
  listOpenaiModels: async () => {
    try {
      return await request('/agent/openai/models', { method: 'POST', body: JSON.stringify({}) })
    } catch {
      return { models: [], error: 'Could not reach the server.' }
    }
  },

  // WebSocket URL
  taskWsUrl: (taskId) => `${WS_BASE}/ws/tasks/${taskId}`,
}

import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AgentSidebar } from './components/AgentSidebar'
import { AgentCenter } from './components/AgentCenter'
import { AgentViewport } from './components/AgentViewport'
import { ApiKeysSheet } from './components/ApiKeysSheet'
import { CredentialsSheet } from './components/CredentialsSheet'
import { ProfileSheet } from './components/ProfileSheet'
import { ModelSheet } from './components/ModelSheet'
import { api, filterChatModels, isOpenaiModel } from './api'

const CACHE_KEY = 'fw_ollama_models'
const THEME_KEY = 'fw_theme'

function loadCached() {
  try { return filterChatModels(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')) } catch { return [] }
}
function saveCache(m) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)) } catch {} }

// Reconcile the selected model against a freshly fetched local Ollama list.
// Hosted models (Grok / OpenAI) never appear in that list, so they must be left
// untouched — otherwise the health poll would reset a chosen Grok model back to
// the first local model (e.g. gemma) within seconds.
function reconcileModel(current, live) {
  if (current && (current.startsWith('grok') || isOpenaiModel(current))) return current
  return live.includes(current) ? current : live[0]
}

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const ACTIVE = new Set(['pending', 'planning', 'running', 'waiting_approval', 'waiting_otp'])

// Below this width the sidebar is an overlay drawer (must match index.css)
const MOBILE_QUERY = '(max-width: 900px)'
function isMobile() {
  try { return window.matchMedia(MOBILE_QUERY).matches } catch { return false }
}

const sheetVariants = {
  hidden:  { x: 24, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } },
  exit:    { x: 24, opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
}

const overlayVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
}

export default function App() {
  const [tasks,          setTasks]          = useState([])
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [refreshTick,    setRefreshTick]    = useState(0)
  // On phones the sidebar is an overlay, so it starts closed there.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile)
  const [theme, setTheme] = useState(loadTheme)

  // Clarification flow: { taskId, state: 'loading' | 'ready', questions }
  const [clarification, setClarification] = useState(null)

  const cachedRef                       = useRef(loadCached())
  const [type,         setType]         = useState('general')
  const [model,        setModel]        = useState(cachedRef.current[0] || '')
  const [ollamaModels, setOllamaModels] = useState(cachedRef.current)
  const [ollamaOk,     setOllamaOk]     = useState(null)
  // null = unknown (still checking), true/false once probed. The model list can
  // load straight from Ollama, so a down backend stays invisible until submit —
  // this drives an explicit "backend offline" banner.
  const [backendOk,    setBackendOk]    = useState(null)

  const [showApiKeys,  setShowApiKeys]  = useState(false)
  const [showCreds,    setShowCreds]    = useState(false)
  const [showProfile,  setShowProfile]  = useState(false)
  const [showModel,    setShowModel]    = useState(false)

  // Saved site logins and API keys live in the encrypted backend vault, not the
  // browser. We keep only non-secret info here (sites, key names) for the topbar
  // counts, the sheets, and to know which provider keys exist.
  const [vaultEntries,  setVaultEntries]  = useState([])  // [{id, site, username, has_password}]
  const [apiKeyEntries, setApiKeyEntries] = useState([])  // [{id, name, has_value}]

  async function refreshVault() {
    try { const d = await api.getVault(); setVaultEntries(d.entries || []) } catch {}
  }
  async function refreshApiKeys() {
    try { const d = await api.getVaultApiKeys(); setApiKeyEntries(d.keys || []) } catch {}
  }

  // On startup: migrate any plaintext secrets left in old localStorage into the
  // encrypted vault (then clear them from the browser), and load the lists.
  useEffect(() => {
    (async () => {
      try {
        const legacyCreds = JSON.parse(localStorage.getItem('fw_credentials') || '[]')
        if (Array.isArray(legacyCreds) && legacyCreds.length) {
          for (const c of legacyCreds) {
            if (c?.url?.trim()) {
              await api.saveVaultEntry({
                site: c.url.trim(),
                username: (c.username || '').trim(),
                password: c.password || '',
              }).catch(() => {})
            }
          }
          localStorage.removeItem('fw_credentials')
        }
      } catch {}
      try {
        const legacyKeys = JSON.parse(localStorage.getItem('fw_api_keys') || '[]')
        if (Array.isArray(legacyKeys) && legacyKeys.length) {
          for (const k of legacyKeys) {
            if (k?.name?.trim() && k?.value?.trim()) {
              await api.saveVaultApiKey({ name: k.name.trim(), value: k.value.trim() }).catch(() => {})
            }
          }
          localStorage.removeItem('fw_api_keys')
        }
      } catch {}
      refreshVault()
      refreshApiKeys()
    })()
  }, [])

  useEffect(() => {
    const isDark = theme === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1c1917' : '#faf7f5')
    try { localStorage.setItem(THEME_KEY, theme) } catch {}
  }, [theme])

  useEffect(() => {
    let cancelled = false
    let timer

    async function scan() {
      const live = await api.listOllamaModels()
      if (!cancelled && live.length > 0) {
        setOllamaModels(live)
        setModel(m => reconcileModel(m, live))
        saveCache(live)
      }
    }

    // Poll health forever so the banner always reflects live state: it clears
    // within a couple of seconds of the backend coming up (slow boot, or started
    // after the page was already open), and reappears if it later goes down.
    // Fast cadence while something is down, relaxed once everything is healthy.
    async function checkHealth() {
      if (cancelled) return
      const up = await api.health().then(() => true).catch(() => false)
      if (cancelled) return
      setBackendOk(up)
      const d = await api.ollamaHealth().catch(() => ({ available: false }))
      if (cancelled) return
      setOllamaOk(d.available)
      if (up && d.available) scan()
      const healthy = up && d.available
      timer = setTimeout(checkHealth, healthy ? 15000 : 2500)
    }

    checkHealth()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await api.listTasks({ page_size: 50 })
        if (active) setTasks(data.tasks || [])
      } catch {}
    }
    load()
    return () => { active = false }
  }, [refreshTick])

  useEffect(() => {
    const hasActive = tasks.some(t => ACTIVE.has(t.status))
    if (!hasActive) return
    const id = setInterval(() => setRefreshTick(n => n + 1), 3000)
    return () => clearInterval(id)
  }, [tasks])

  // One-shot re-probe for the "backend offline" banner's Retry button.
  async function recheckBackend() {
    const up = await api.health().then(() => true).catch(() => false)
    setBackendOk(up)
    if (up) {
      const d = await api.ollamaHealth().catch(() => ({ available: false }))
      setOllamaOk(d.available)
      if (d.available) {
        const live = await api.listOllamaModels()
        if (live.length > 0) { setOllamaModels(live); setModel(m => reconcileModel(m, live)); saveCache(live) }
      }
    }
  }

  // Only non-secret, free-text context is stored on the task and sent to the LLM.
  // Credentials and API keys are NEVER put here — they live in the encrypted vault
  // and the backend injects them as browser-use sensitive_data at run time.
  function buildContext(extra) {
    return extra?.trim() ? extra.trim() : undefined
  }

  // Hosted providers run remotely. The browser no longer holds the key values — it
  // only knows whether each provider key exists (the backend resolves the actual key
  // from the encrypted vault for model listing and runs).
  const hasGrokKey   = apiKeyEntries.some(k => k.name === 'Grok (xAI)' && k.has_value)
  const hasOpenaiKey = apiKeyEntries.some(k => k.name === 'OpenAI' && k.has_value)

  // All run secrets (provider key + credentials + service keys) are resolved
  // server-side from the vault, so starting a task sends only the task id.
  function runAgentForTask(taskId) {
    return api.runAgent(taskId)
  }

  // Save credentials the agent asked for mid-run into the encrypted vault, so future
  // runs already have them. (Used by the in-run "sign-in required" banner.)
  async function handleSaveCredential({ url, username, password }) {
    if (!username?.trim()) return
    try {
      await api.saveVaultEntry({
        site: (url || '').trim(),
        username: username.trim(),
        password: password || '',
      })
      refreshVault()
    } catch {}
  }

  // Generic form shown if question generation can't be reached at all — we still
  // want the user to narrow the request rather than running blind.
  const FALLBACK_QUESTIONS = [
    { id: 0, question: "What's your budget or price range?", type: 'text', placeholder: 'e.g. under $500, no limit' },
    { id: 1, question: 'Any preferred brands, websites, or sources?', type: 'text', placeholder: 'e.g. Sony, official store' },
    { id: 2, question: 'What matters most here?', type: 'text', placeholder: 'e.g. quality, reviews, lowest price' },
    { id: 3, question: 'How should I present the results?', type: 'choice',
      options: ['Best pick + alternatives', 'Detailed comparison', 'Just the single best', 'Full list'] },
  ]

  /**
   * New task flow:
   * 1. Create the task (status: pending)
   * 2. Ask the model for clarifying questions
   * 3. If questions come back → render the form; agent starts after submit/skip
   *    If none → start the agent immediately
   */
  async function handleNewTask(goal, context) {
    const task = await api.createTask({
      goal: goal.trim(),
      type,
      model: model.trim() || undefined,
      context: buildContext(context),
    })
    setRefreshTick(n => n + 1)
    setSelectedTaskId(task.id)
    setClarification({ taskId: task.id, state: 'loading', questions: [] })

    try {
      const res = await api.getQuestions(task.id)
      const questions = res.questions?.length ? res.questions : FALLBACK_QUESTIONS
      setClarification({ taskId: task.id, state: 'ready', questions })
    } catch {
      // Couldn't reach question generation — still show a generic form so the
      // user can narrow the request instead of running blind.
      setClarification({ taskId: task.id, state: 'ready', questions: FALLBACK_QUESTIONS })
    }
    return task
  }

  async function handleClarifySubmit(taskId, answers) {
    try {
      if (answers.some(a => a.answer.trim())) {
        await api.submitClarifications(taskId, answers)
      }
    } catch {}
    setClarification(null)
    await runAgentForTask(taskId).catch(() => {})
    setRefreshTick(n => n + 1)
  }

  async function handleClarifySkip(taskId) {
    setClarification(null)
    await runAgentForTask(taskId).catch(() => {})
    setRefreshTick(n => n + 1)
  }

  function handleTaskDeleted(id) {
    setRefreshTick(n => n + 1)
    if (selectedTaskId === id) setSelectedTaskId(null)
    if (clarification?.taskId === id) setClarification(null)
  }

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null

  const activeSheet = showApiKeys ? 'apikeys' : showCreds ? 'creds' : showProfile ? 'profile' : showModel ? 'model' : null

  function openSheet(name) {
    setShowApiKeys(name === 'apikeys')
    setShowCreds(name === 'creds')
    setShowProfile(name === 'profile')
    setShowModel(name === 'model')
  }

  function closeSheet() {
    setShowApiKeys(false)
    setShowCreds(false)
    setShowProfile(false)
    setShowModel(false)
  }

  return (
    <div className="shell">
      {/* Top bar */}
      <header className="tb">
        <div className="tb-left">
          <button
            className="tb-toggle"
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <path d="M9 4v16"/>
            </svg>
          </button>
          <div className="tb-name">Vellam AI</div>
        </div>

        <div className="tb-right">
          <button
            className={`config-btn${activeSheet === 'apikeys' ? ' config-btn--active' : ''}`}
            onClick={() => activeSheet === 'apikeys' ? closeSheet() : openSheet('apikeys')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span className="config-btn-label">API keys</span>
            {apiKeyEntries.length > 0 && (
              <span style={{ color: 'var(--l3)', fontSize: 11.5 }}>
                {apiKeyEntries.length}
              </span>
            )}
          </button>

          <button
            className={`config-btn${activeSheet === 'creds' ? ' config-btn--active' : ''}`}
            onClick={() => activeSheet === 'creds' ? closeSheet() : openSheet('creds')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="config-btn-label">Credentials</span>
            {vaultEntries.length > 0 && (
              <span style={{ color: 'var(--l3)', fontSize: 11.5 }}>
                {vaultEntries.length}
              </span>
            )}
          </button>

          <button
            className={`config-btn${activeSheet === 'profile' ? ' config-btn--active' : ''}`}
            onClick={() => activeSheet === 'profile' ? closeSheet() : openSheet('profile')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span className="config-btn-label">Profile</span>
          </button>

          <button
            className={`config-btn${activeSheet === 'model' ? ' config-btn--active' : ''}`}
            onClick={() => activeSheet === 'model' ? closeSheet() : openSheet('model')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93l-1.41 1.41M21 12h-2M17.66 17.66l-1.41 1.41M12 21v-2M4.93 19.07l1.41-1.41M3 12h2M6.34 6.34 7.75 7.75M12 3v2"/>
            </svg>
            {model ? model.split(':')[0].slice(0, 14) : 'Model'}
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: ollamaOk ? 'var(--green)' : 'var(--l4)',
            }} />
          </button>

          <button
            className="theme-toggle"
            onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Backend-offline banner — the model list can load straight from Ollama,
          so without this a down backend only surfaces as a cryptic error on submit. */}
      {backendOk === false && (
        <div className="offline-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <path d="M12 9v4M12 17h.01"/>
          </svg>
          <span>
            Backend offline — can’t reach the server at 127.0.0.1:8000. Tasks won’t run until it’s started.
          </span>
          <button className="offline-banner-retry" onClick={recheckBackend}>Retry</button>
        </div>
      )}

      {/* Body */}
      <div className="shell-body">
        <AgentSidebar
          tasks={tasks}
          selectedId={selectedTaskId}
          onSelect={(id) => {
            setSelectedTaskId(id)
            if (isMobile()) setSidebarCollapsed(true) // overlay drawer: close after picking
          }}
          onDelete={handleTaskDeleted}
          onNewChat={() => {
            setSelectedTaskId(null)
            if (isMobile()) setSidebarCollapsed(true)
          }}
          collapsed={sidebarCollapsed}
        />
        <AgentCenter
          selectedTask={selectedTask}
          selectedTaskId={selectedTaskId}
          onNewTask={handleNewTask}
          onStartAgent={runAgentForTask}
          onSaveCredential={handleSaveCredential}
          onTaskUpdated={() => setRefreshTick(n => n + 1)}
          type={type}
          model={model}
          clarification={clarification?.taskId === selectedTaskId ? clarification : null}
          onClarifySubmit={handleClarifySubmit}
          onClarifySkip={handleClarifySkip}
        />
        <AgentViewport selectedTaskId={selectedTaskId} selectedTask={selectedTask} />
      </div>

      {/* Config sheets */}
      <AnimatePresence>
        {activeSheet && (
          <motion.div
            key="sheet-overlay"
            className="sheet-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={e => e.target === e.currentTarget && closeSheet()}
          >
            <motion.div
              key={activeSheet}
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ height: '100%' }}
            >
              {activeSheet === 'apikeys' && (
                <ApiKeysSheet onSaved={refreshApiKeys} onClose={closeSheet} />
              )}
              {activeSheet === 'creds' && (
                <CredentialsSheet onSaved={refreshVault} onClose={closeSheet} />
              )}
              {activeSheet === 'profile' && (
                <ProfileSheet onClose={closeSheet} />
              )}
              {activeSheet === 'model' && (
                <ModelSheet
                  model={model}
                  type={type}
                  ollamaModels={ollamaModels}
                  ollamaOk={ollamaOk}
                  hasGrokKey={hasGrokKey}
                  hasOpenaiKey={hasOpenaiKey}
                  onModelChange={setModel}
                  onTypeChange={setType}
                  onModelsRefresh={async () => {
                    const live = await api.listOllamaModels()
                    if (live.length > 0) { setOllamaModels(live); setModel(m => reconcileModel(m, live)); saveCache(live) }
                  }}
                  onOpenApiKeys={() => openSheet('apikeys')}
                  onClose={closeSheet}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

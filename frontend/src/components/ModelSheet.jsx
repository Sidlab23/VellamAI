import { useState, useEffect } from 'react'
import { api, isOpenaiModel } from '../api'
import { clientScan } from '../pcScan'

const TASK_TYPES = [
  { value: 'general',    label: 'General',  desc: 'Browsing, research, information gathering' },
  { value: 'shopping',   label: 'Shopping', desc: 'Product search, price comparison, reviews' },
  { value: 'job_search', label: 'Jobs',     desc: 'Job listings, career research, applications' },
]

const listBtn = (selected) => ({
  width: '100%', textAlign: 'left', padding: '9px 2px',
  fontSize: 13, fontWeight: selected ? 600 : 400,
  borderBottom: '1px solid var(--sep2)',
  // Selected model uses the app's red accent (not the lighter pinkish --accent-light)
  // so it matches the rest of the red theme.
  color: selected ? 'var(--red)' : 'var(--l2)',
  transition: 'color 0.12s',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
})

export function ModelSheet({
  model, type, ollamaModels, ollamaOk, hasGrokKey, hasOpenaiKey,
  onModelChange, onTypeChange, onModelsRefresh, onOpenApiKeys, onClose,
}) {
  const [localModel, setLocalModel] = useState(model)
  const [localType,  setLocalType]  = useState(type)
  const [provider,   setProvider]   = useState(
    model?.startsWith('grok') ? 'grok' : isOpenaiModel(model) ? 'openai' : 'ollama'
  )

  // Ollama
  const [refreshing, setRefreshing]   = useState(false)
  const [manualEntry, setManualEntry] = useState(
    !ollamaModels.includes(model) && !!model && !model.startsWith('grok') && !isOpenaiModel(model)
  )

  async function handleRefresh() {
    setRefreshing(true)
    await onModelsRefresh()
    setRefreshing(false)
  }

  function save() {
    onModelChange(localModel)
    onTypeChange(localType)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <div>
            <div className="sheet-title">Model & Type</div>
            <div className="sheet-desc">Choose the model and task type the agent uses.</div>
          </div>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="sheet-body">
          {/* Task type */}
          <div className="sheet-field">
            <span className="sheet-label">Task type</span>
            <div className="seg-control" style={{ width: '100%' }}>
              {TASK_TYPES.map(t => (
                <button
                  key={t.value}
                  className={`seg-btn${localType === t.value ? ' seg-btn--active' : ''}`}
                  onClick={() => setLocalType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {TASK_TYPES.find(t => t.value === localType) && (
              <p style={{ fontSize: 11.5, color: 'var(--l2)', marginTop: 6, lineHeight: 1.5 }}>
                {TASK_TYPES.find(t => t.value === localType).desc}
              </p>
            )}
          </div>

          <div className="sheet-divider" />

          {/* Provider */}
          <div className="sheet-field">
            <span className="sheet-label">Provider</span>
            <div className="seg-control" style={{ width: '100%' }}>
              <button
                className={`seg-btn${provider === 'ollama' ? ' seg-btn--active' : ''}`}
                onClick={() => setProvider('ollama')}
              >
                Ollama (local)
              </button>
              <button
                className={`seg-btn${provider === 'grok' ? ' seg-btn--active' : ''}`}
                onClick={() => setProvider('grok')}
              >
                Grok (xAI)
              </button>
              <button
                className={`seg-btn${provider === 'openai' ? ' seg-btn--active' : ''}`}
                onClick={() => setProvider('openai')}
              >
                OpenAI
              </button>
            </div>
          </div>

          {provider === 'ollama' && (
            <OllamaModels
              ollamaModels={ollamaModels}
              ollamaOk={ollamaOk}
              localModel={localModel}
              setLocalModel={setLocalModel}
              manualEntry={manualEntry}
              setManualEntry={setManualEntry}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}

          {provider === 'grok' && (
            <HostedModels
              hasKey={hasGrokKey}
              fetchModels={api.listXaiModels}
              localModel={localModel}
              setLocalModel={setLocalModel}
              onOpenApiKeys={onOpenApiKeys}
              label="Grok"
              placeholder="e.g. grok-4.3, grok-4, grok-4-1-fast-reasoning"
              noKeyHint="Add your Grok (xAI) API key to use Grok models. They handle structured output far more reliably than small local models."
              ownsModel={m => !!m && m.toLowerCase().startsWith('grok')}
            />
          )}

          {provider === 'openai' && (
            <HostedModels
              hasKey={hasOpenaiKey}
              fetchModels={api.listOpenaiModels}
              localModel={localModel}
              setLocalModel={setLocalModel}
              onOpenApiKeys={onOpenApiKeys}
              label="OpenAI"
              placeholder="e.g. gpt-4o, gpt-4.1, o4-mini"
              noKeyHint="Add your OpenAI API key to use GPT and o-series models. They handle structured output far more reliably than small local models."
              ownsModel={isOpenaiModel}
            />
          )}
        </div>

        <div className="sheet-footer">
          <button className="sheet-save-btn" onClick={save}>Apply</button>
        </div>
      </div>
    </div>
  )
}

function OllamaModels({ ollamaModels, ollamaOk, localModel, setLocalModel, manualEntry, setManualEntry, refreshing, onRefresh }) {
  const [sys, setSys]           = useState(null)   // { specs, models, recommended }
  const [scanning, setScanning] = useState(false)

  async function scan() {
    setScanning(true)
    let result = null
    try { result = await api.getSystemInfo() } catch {}
    // Prefer the backend (real RAM/VRAM), but fall back to a client-side scan that
    // works whenever Ollama is reachable — so this never gets stuck "scanning".
    if (!result || !(result.models && result.models.length)) {
      const local = await clientScan().catch(() => null)
      if (local) result = local
    }
    setSys(result)
    setScanning(false)
    return result
  }

  // One "scanner": refresh the Ollama model list and re-scan the PC together.
  async function rescanAll() {
    await Promise.all([onRefresh(), scan()])
  }

  useEffect(() => { scan() }, [])

  const busy = refreshing || scanning
  const scoreByName = {}
  ;(sys?.models || []).forEach(m => { scoreByName[m.name] = m })

  return (
    <div className="sheet-field">
      <p style={{ fontSize: 12.5, color: ollamaOk ? 'var(--l2)' : 'var(--amber)', marginBottom: 12 }}>
        {ollamaOk ? 'Ollama connected' : 'Ollama not detected — start it with `ollama serve`'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="sheet-label" style={{ marginBottom: 0 }}>Model</span>
        <button
          style={{ fontSize: 11.5, color: 'var(--l2)', opacity: busy ? 0.6 : 1 }}
          onClick={rescanAll}
          disabled={busy}
        >
          ↺ Refresh
        </button>
      </div>

      {ollamaModels.length > 0 && !manualEntry ? (
        <div>
          {ollamaModels.map(m => {
            const sc = scoreByName[m]
            return (
              <button key={m} onClick={() => setLocalModel(m)} style={listBtn(localModel === m)}>
                <span>{m}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {localModel === m && <span style={{ fontSize: 12, color: 'var(--red)' }}>✓</span>}
                  {sc && <ScoreBadge score={sc.score} tier={sc.tier} />}
                </span>
              </button>
            )
          })}
          <button
            style={{ fontSize: 11.5, color: 'var(--l3)', marginTop: 6, textAlign: 'left' }}
            onClick={() => setManualEntry(true)}
          >
            Enter model name manually →
          </button>
        </div>
      ) : (
        <div>
          <input
            className="sheet-input"
            value={localModel}
            onChange={e => setLocalModel(e.target.value)}
            placeholder="e.g. llama3.1:8b, qwen2.5:7b"
          />
          {ollamaModels.length > 0 && (
            <button
              style={{ fontSize: 11.5, color: 'var(--l3)', marginTop: 8, textAlign: 'left' }}
              onClick={() => setManualEntry(false)}
            >
              ← Show detected models
            </button>
          )}
          <p style={{ fontSize: 11, color: 'var(--l3)', marginTop: 8, lineHeight: 1.5 }}>
            Pull a model with{' '}
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--l2)' }}>
              ollama pull {localModel || 'llama3.1:8b'}
            </code>
          </p>
        </div>
      )}

      <PcRecommendation
        sys={sys}
        scanning={scanning}
        onRescan={rescanAll}
        localModel={localModel}
        setLocalModel={setLocalModel}
      />
    </div>
  )
}

// Efficiency score (1-10) for how smoothly a model runs on the user's PC.
function ScoreBadge({ score, tier }) {
  const color = score >= 8 ? 'var(--green)' : score >= 5 ? 'var(--amber)' : 'var(--red)'
  return (
    <span
      title={`${tier} on your PC`}
      style={{ fontSize: 11, fontWeight: 600, color, fontFamily: 'var(--font-mono)' }}
    >
      {score}/10
    </span>
  )
}

function specsLine(s) {
  if (!s) return ''
  const parts = []
  if (s.ram_gb) parts.push(`${Math.round(s.ram_gb)}${s.ram_capped ? '+' : ''} GB RAM`)
  if (s.gpu_name) parts.push(`${s.gpu_name.replace(/NVIDIA GeForce /i, '')}${s.vram_gb ? ` ${s.vram_gb} GB` : ''}`)
  else parts.push('no GPU')
  if (s.cpu_cores) parts.push(`${s.cpu_cores} cores`)
  let line = parts.join(' · ')
  if (s.approximate) line += ' · estimated'
  return line
}

// "Best for your PC" — scans hardware and recommends the most capable model
// that still runs smoothly. Sits at the bottom of the sheet, near Apply.
function PcRecommendation({ sys, scanning, onRescan, localModel, setLocalModel }) {
  const rec = sys?.recommended
  return (
    <div style={{
      marginTop: 16, padding: '11px 13px', borderRadius: 'var(--r-sm)',
      background: 'var(--bg3)', border: '1px solid var(--sep)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--l1)' }}>Best for your PC</span>
        <button
          onClick={onRescan}
          disabled={scanning}
          style={{ fontSize: 11, color: 'var(--l2)', opacity: scanning ? 0.6 : 1 }}
        >
          {scanning ? 'Scanning…' : '↺ Rescan'}
        </button>
      </div>

      {scanning ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--l3)' }}>
          <span className="spinner spinner-sm" /> Scanning your hardware…
        </div>
      ) : !sys ? (
        <p style={{ fontSize: 11.5, color: 'var(--l3)', lineHeight: 1.5 }}>
          Couldn’t scan — make sure the backend is running.
        </p>
      ) : rec ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--red)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {rec}
            </div>
            <div style={{ fontSize: 11, color: 'var(--l3)', marginTop: 2 }}>{specsLine(sys.specs)}</div>
          </div>
          {localModel !== rec && (
            <button
              onClick={() => setLocalModel(rec)}
              style={{
                flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--on-accent)',
                background: 'var(--grad-accent)', padding: '6px 14px', borderRadius: 'var(--r-sm)',
              }}
            >
              Use
            </button>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 11.5, color: 'var(--l3)', lineHeight: 1.5 }}>
          No installed chat models to score. {specsLine(sys.specs)}
        </p>
      )}
    </div>
  )
}

// Shared view for hosted providers (Grok, OpenAI). Self-contained: fetches its own
// model list via `fetchModels()` (the backend resolves the key from the vault) and
// manages loading / error / manual state. `hasKey` says whether a key is saved.
function HostedModels({
  hasKey, fetchModels, localModel, setLocalModel, onOpenApiKeys,
  label, placeholder, noKeyHint, ownsModel,
}) {
  const [models,  setModels]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [manual,  setManual]  = useState(false)
  const [draft,   setDraft]   = useState(() => (ownsModel(localModel) ? localModel : ''))

  async function load() {
    if (!hasKey) return
    setLoading(true); setError(null)
    const res = await fetchModels()
    setModels(res.models || [])
    setError(res.error || null)
    setLoading(false)
  }

  useEffect(() => {
    if (hasKey) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey])

  function pickManual(value) {
    setDraft(value)
    setLocalModel(value)
  }

  if (!hasKey) {
    return (
      <div className="sheet-field">
        <p style={{ fontSize: 12.5, color: 'var(--l2)', lineHeight: 1.6, marginBottom: 12 }}>
          {noKeyHint}
        </p>
        <button
          onClick={onOpenApiKeys}
          style={{
            fontSize: 13, fontWeight: 600, color: 'var(--on-accent)',
            background: 'var(--grad-accent)', padding: '8px 16px', borderRadius: 'var(--r-sm)',
          }}
        >
          Add {label} API key
        </button>
      </div>
    )
  }

  return (
    <div className="sheet-field">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="sheet-label" style={{ marginBottom: 0 }}>Model</span>
        <button
          style={{ fontSize: 11.5, color: 'var(--l2)', opacity: loading ? 0.6 : 1 }}
          onClick={load}
          disabled={loading}
        >
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 12.5, color: 'var(--l3)' }}>
          <span className="spinner spinner-sm" /> Loading models…
        </div>
      ) : error ? (
        <p style={{ fontSize: 12.5, color: 'var(--amber)', lineHeight: 1.5 }}>{error}</p>
      ) : models.length > 0 && !manual ? (
        <div>
          {models.map(m => (
            <button key={m} onClick={() => setLocalModel(m)} style={listBtn(localModel === m)}>
              <span>{m}</span>
              {localModel === m && <span style={{ fontSize: 12, color: 'var(--red)' }}>✓</span>}
            </button>
          ))}
          <button
            style={{ fontSize: 11.5, color: 'var(--l3)', marginTop: 6, textAlign: 'left' }}
            onClick={() => { setDraft(ownsModel(localModel) ? localModel : ''); setManual(true) }}
          >
            Enter model name manually →
          </button>
        </div>
      ) : (
        <div>
          <input
            className="sheet-input"
            value={draft}
            onChange={e => pickManual(e.target.value)}
            placeholder={placeholder}
          />
          {models.length > 0 && (
            <button
              style={{ fontSize: 11.5, color: 'var(--l3)', marginTop: 8, textAlign: 'left' }}
              onClick={() => setManual(false)}
            >
              ← Show available models
            </button>
          )}
        </div>
      )}
    </div>
  )
}

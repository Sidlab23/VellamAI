import { useState, useEffect } from 'react'
import { api } from '../api'

const GROK_KEY_NAME = 'Grok (xAI)'
const OPENAI_KEY_NAME = 'OpenAI'
const FEATURED_NAMES = [GROK_KEY_NAME, OPENAI_KEY_NAME]

const blankRow = () => ({ id: null, name: '', value: '', hasValue: false, dirty: true })

export function ApiKeysSheet({ onSaved, onClose }) {
  const [grok,    setGrok]    = useState({ value: '', hasValue: false, dirty: false })
  const [openai,  setOpenai]  = useState({ value: '', hasValue: false, dirty: false })
  const [rows,    setRows]    = useState([blankRow()])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  // Load saved keys from the encrypted vault (values are never returned).
  useEffect(() => {
    let active = true
    api.getVaultApiKeys()
      .then(d => {
        if (!active) return
        const keys = d.keys || []
        const g = keys.find(k => k.name === GROK_KEY_NAME)
        const o = keys.find(k => k.name === OPENAI_KEY_NAME)
        setGrok({ value: '', hasValue: !!g?.has_value, dirty: false })
        setOpenai({ value: '', hasValue: !!o?.has_value, dirty: false })
        const custom = keys
          .filter(k => !FEATURED_NAMES.includes(k.name))
          .map(k => ({ id: k.id, name: k.name, value: '', hasValue: k.has_value, dirty: false }))
        setRows(custom.length ? custom : [blankRow()])
        setLoading(false)
      })
      .catch(e => { if (active) { setError(e.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  function add() { setRows(r => [...r, blankRow()]) }

  async function remove(idx) {
    const row = rows[idx]
    if (row.id) { await api.deleteVaultApiKey(row.id) }
    setRows(r => (r.length > 1 ? r.filter((_, i) => i !== idx) : [blankRow()]))
  }

  function update(idx, field, val) {
    setRows(r => r.map((x, i) =>
      i === idx ? { ...x, [field]: val, ...(field === 'value' ? { dirty: true } : {}) } : x
    ))
  }

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      if (grok.dirty && grok.value.trim())     await api.saveVaultApiKey({ name: GROK_KEY_NAME, value: grok.value.trim() })
      if (openai.dirty && openai.value.trim()) await api.saveVaultApiKey({ name: OPENAI_KEY_NAME, value: openai.value.trim() })
      for (const r of rows.filter(r => r.name?.trim())) {
        // Blank value keeps the stored one (write-only field).
        await api.saveVaultApiKey({ name: r.name.trim(), value: r.dirty ? (r.value || '') : '' })
      }
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const featured = (label, state, setState, placeholder, link, linkLabel) => (
    <div className="sheet-field">
      <label className="sheet-label">{label}</label>
      <input
        className="sheet-input"
        value={state.value}
        onChange={e => setState({ ...state, value: e.target.value, dirty: true })}
        placeholder={state.hasValue ? 'saved — leave blank to keep' : placeholder}
        type="password"
        autoComplete="off"
        spellCheck={false}
      />
      <p style={{ fontSize: 11.5, color: 'var(--l3)', marginTop: 6, lineHeight: 1.5 }}>
        Create a key at{' '}
        <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-light)' }}>{linkLabel}</a>.
      </p>
    </div>
  )

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <div>
            <div className="sheet-title">API Keys</div>
            <div className="sheet-desc">Provider and service keys, stored encrypted on this device.</div>
          </div>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--l3)' }}>
              <span className="spinner spinner-sm" /> Loading vault…
            </div>
          ) : (
            <>
              {featured('Grok (xAI)', grok, setGrok, 'xai-...', 'https://console.x.ai', 'console.x.ai')}
              {featured('OpenAI', openai, setOpenai, 'sk-...', 'https://platform.openai.com/api-keys', 'platform.openai.com')}

              <div className="sheet-divider" />
              <div className="sheet-section-title">Other keys</div>

              {rows.map((row, idx) => (
                <div key={row.id || `new-${idx}`} className="sheet-row">
                  <input
                    value={row.name}
                    onChange={e => update(idx, 'name', e.target.value)}
                    placeholder="Key name (e.g. Serper)"
                    style={{ flex: '0 0 38%' }}
                  />
                  <div className="sheet-sep" />
                  <input
                    value={row.value}
                    onChange={e => update(idx, 'value', e.target.value)}
                    placeholder={row.hasValue ? 'saved — leave blank to keep' : 'Value'}
                    type="password"
                    autoComplete="off"
                    style={{ flex: 1 }}
                  />
                  <button className="sheet-row-del" onClick={() => remove(idx)}>×</button>
                </div>
              ))}

              <button className="sheet-add-btn" onClick={add} style={{ marginTop: 4 }}>
                + Add key
              </button>

              <div className="sheet-divider" />

              {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</p>}

              <p style={{ fontSize: 12, color: 'var(--l3)', lineHeight: 1.6 }}>
                Keys are encrypted at rest on this device and never returned to the browser.
                Provider keys (Grok/OpenAI) are used by the backend; other keys are exposed to
                the agent only as placeholder variables, never as raw values.
              </p>
            </>
          )}
        </div>

        <div className="sheet-footer">
          <button className="sheet-save-btn" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Keys'}
          </button>
        </div>
      </div>
    </div>
  )
}

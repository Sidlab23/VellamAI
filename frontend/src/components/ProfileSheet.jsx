import { useState, useEffect } from 'react'
import { api } from '../api'

// The agent's local "memory" of the user: a few editable facts (name, city, sizes,
// preferences) that get added to every task so the user doesn't keep repeating
// themselves. Stored in the encrypted vault, never sent anywhere but the local model.
const FIELDS = [
  { key: 'name',        label: 'Name',        placeholder: 'Your name',                 type: 'text' },
  { key: 'email',       label: 'Email',       placeholder: 'you@example.com',           type: 'text' },
  { key: 'phone',       label: 'Phone',       placeholder: 'For order/contact fields',  type: 'text' },
  { key: 'city',        label: 'City',        placeholder: 'e.g. Pune',                 type: 'text' },
  { key: 'address',     label: 'Address',     placeholder: 'Default delivery address',  type: 'area' },
]

const empty = () => Object.fromEntries(FIELDS.map(f => [f.key, '']))

export function ProfileSheet({ onSaved, onClose }) {
  const [profile, setProfile] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let active = true
    api.getProfile()
      .then(p => { if (active) { setProfile({ ...empty(), ...(p || {}) }); setLoading(false) } })
      .catch(e => { if (active) { setError(e.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  function update(key, val) {
    setProfile(p => ({ ...p, [key]: val }))
  }

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      await api.saveProfile(profile)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const fieldRow   = { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }
  const fieldLabel = { fontSize: 12, color: 'var(--l3)', width: 88, flexShrink: 0, paddingTop: 7 }
  const fieldInput = {
    flex: 1, fontSize: 13, color: 'var(--l1)',
    padding: '7px 0', borderBottom: '1px solid var(--sep2)',
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <div>
            <div className="sheet-title">Your profile</div>
            <div className="sheet-desc">
              What the agent remembers about you. Added to every task so you don't repeat
              yourself. Stored encrypted on this device.
            </div>
          </div>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--l3)' }}>
              <span className="spinner spinner-sm" /> Loading…
            </div>
          ) : (
            <>
              {FIELDS.map(f => (
                <div key={f.key} style={fieldRow}>
                  <span style={fieldLabel}>{f.label}</span>
                  {f.type === 'area' ? (
                    <textarea
                      value={profile[f.key] || ''}
                      onChange={e => update(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      rows={2}
                      style={{ ...fieldInput, resize: 'vertical', minHeight: 34 }}
                    />
                  ) : (
                    <input
                      value={profile[f.key] || ''}
                      onChange={e => update(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      style={fieldInput}
                    />
                  )}
                </div>
              ))}

              <div className="sheet-divider" />

              {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</p>}

              <p style={{ fontSize: 12, color: 'var(--l3)', lineHeight: 1.6 }}>
                Used to fill forms and choose delivery. The agent treats an explicit
                instruction in a task as overriding anything here.
              </p>
            </>
          )}
        </div>

        <div className="sheet-footer">
          <button className="sheet-save-btn" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

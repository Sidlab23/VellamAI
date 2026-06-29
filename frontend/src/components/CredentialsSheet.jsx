import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

const blankRow = () => ({ id: null, site: '', username: '', password: '', hasPassword: false, dirtyPw: true })

export function CredentialsSheet({ onSaved, onClose }) {
  const [rows,    setRows]    = useState([blankRow()])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const [backend, setBackend] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const fileRef = useRef(null)

  // Re-fetch the saved logins into the editor (after an import).
  async function reload() {
    const d = await api.getVault()
    setBackend(d.backend)
    const entries = (d.entries || []).map(e => ({
      id: e.id, site: e.site, username: e.username,
      password: '', hasPassword: e.has_password, dirtyPw: false,
    }))
    setRows(entries.length ? entries : [blankRow()])
  }

  async function onPickCsv(e) {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-picking the same file
    if (!file) return
    setImporting(true); setError(null); setImportMsg(null)
    try {
      const res = await api.importVaultCsv(file)
      setImportMsg(
        `Imported ${res.imported} login${res.imported === 1 ? '' : 's'}` +
        (res.skipped ? `, skipped ${res.skipped} incomplete row${res.skipped === 1 ? '' : 's'}` : '') + '.'
      )
      await reload()
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  // Load saved logins from the encrypted vault (passwords are never returned).
  useEffect(() => {
    let active = true
    api.getVault()
      .then(d => {
        if (!active) return
        setBackend(d.backend)
        const entries = (d.entries || []).map(e => ({
          id: e.id, site: e.site, username: e.username,
          password: '', hasPassword: e.has_password, dirtyPw: false,
        }))
        setRows(entries.length ? entries : [blankRow()])
        setLoading(false)
      })
      .catch(e => { if (active) { setError(e.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  function add() {
    setRows(r => [...r, blankRow()])
  }

  async function remove(idx) {
    const row = rows[idx]
    if (row.id) { await api.deleteVaultEntry(row.id) }
    setRows(r => (r.length > 1 ? r.filter((_, i) => i !== idx) : [blankRow()]))
  }

  function update(idx, field, val) {
    setRows(r => r.map((x, i) =>
      i === idx ? { ...x, [field]: val, ...(field === 'password' ? { dirtyPw: true } : {}) } : x
    ))
  }

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      for (const r of rows.filter(r => r.site?.trim())) {
        await api.saveVaultEntry({
          site: r.site.trim(),
          username: (r.username || '').trim(),
          // Only send a password when the user actually typed a new one; a blank
          // value keeps the stored password (write-only field).
          password: r.dirtyPw ? (r.password || '') : '',
        })
      }
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const fieldRow = { display: 'flex', alignItems: 'center', gap: 10 }
  const fieldLabel = { fontSize: 12, color: 'var(--l3)', width: 72, flexShrink: 0 }
  const fieldInput = {
    flex: 1, fontSize: 13, color: 'var(--l1)',
    padding: '7px 0', borderBottom: '1px solid var(--sep2)',
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <div>
            <div className="sheet-title">Credentials</div>
            <div className="sheet-desc">Site logins the agent uses to sign in. Stored encrypted on this device.</div>
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
              {rows.map((row, idx) => (
                <div key={row.id || `new-${idx}`} style={{ marginBottom: 6 }}>
                  {idx > 0 && <div className="sheet-divider" />}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={fieldRow}>
                      <span style={fieldLabel}>Site</span>
                      <input
                        value={row.site}
                        onChange={e => update(idx, 'site', e.target.value)}
                        placeholder="amazon.in"
                        style={fieldInput}
                      />
                      <button className="sheet-row-del" onClick={() => remove(idx)}>×</button>
                    </div>
                    <div style={fieldRow}>
                      <span style={fieldLabel}>Username</span>
                      <input
                        value={row.username}
                        onChange={e => update(idx, 'username', e.target.value)}
                        placeholder="username or email"
                        type="password"
                        autoComplete="off"
                        style={fieldInput}
                      />
                    </div>
                    <div style={fieldRow}>
                      <span style={fieldLabel}>Password</span>
                      <input
                        value={row.password}
                        onChange={e => update(idx, 'password', e.target.value)}
                        placeholder={row.hasPassword ? '•••••••• (saved — leave blank to keep)' : 'password'}
                        type="password"
                        autoComplete="off"
                        style={fieldInput}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button className="sheet-add-btn" onClick={add} style={{ marginTop: 8 }}>
                + Add credential
              </button>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={onPickCsv}
              />
              <button
                className="sheet-add-btn"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                style={{ marginTop: 6 }}
              >
                {importing ? 'Importing…' : '↥ Import from CSV (browser export)'}
              </button>
              {importMsg && (
                <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>{importMsg}</p>
              )}
              <p style={{ fontSize: 11.5, color: 'var(--l4)', marginTop: 4, lineHeight: 1.5 }}>
                Export saved passwords from your browser (Chrome/Edge/Firefox → Settings →
                Passwords → Export) and pick the .csv here. It's parsed locally into the
                encrypted vault; the file never leaves your machine.
              </p>

              <div className="sheet-divider" />

              {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</p>}

              <p style={{ fontSize: 12, color: 'var(--l3)', lineHeight: 1.6 }}>
                Encrypted at rest on this device
                {backend === 'dpapi' ? ' with Windows DPAPI (tied to your Windows login)' : ''} and
                never sent to any server. When the agent signs in it only ever sees a placeholder
                variable — the real password is typed into the site and redacted from logs.
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

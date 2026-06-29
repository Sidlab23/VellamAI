import { useState, useRef, useEffect } from 'react'
import { api } from '../api'

// Shown when the agent must sign in to a site but no saved credentials exist for it.
// The user enters them here; they're saved to the Credentials tab (so future runs
// have them) and handed back to the paused agent to log in with.
export function CredentialBanner({ taskId, site, reason, onSaveCredential, onSubmitted }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit() {
    const u = username.trim()
    if (!u || loading) return
    setLoading(true); setError(null)
    try {
      const res = await api.submitCredentials(taskId, u, password)
      if (res.ok) {
        // Save to the Credentials tab so the agent has them next time, too.
        onSaveCredential?.({ url: site || '', username: u, password })
        onSubmitted?.()
      } else {
        setError(res.error || 'Could not deliver the credentials.')
        setLoading(false)
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', fontSize: 13, color: 'var(--l1)',
    padding: '8px 10px', marginTop: 6,
    background: 'var(--surface)', borderRadius: 'var(--r-sm)',
    border: '1px solid var(--sep2)',
  }

  return (
    <div className="approval-banner otp-banner">
      <div className="approval-header">
        <span>🔐</span> Sign-in required{site ? ` — ${site}` : ''}
      </div>

      <div className="approval-body">
        <p style={{ fontSize: 13, color: 'var(--l2)', lineHeight: 1.6 }}>
          {reason || `The agent needs to sign in${site ? ` to ${site}` : ''} to continue, but no saved credentials were found.`}
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--l3)', lineHeight: 1.55, marginTop: 4 }}>
          Saved to your Credentials (in this browser only) and sent only to the local agent.
        </p>
        <input
          ref={inputRef}
          style={inputStyle}
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Username or email"
          autoComplete="off"
          disabled={loading}
        />
        <input
          style={inputStyle}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Password"
          type="password"
          autoComplete="off"
          disabled={loading}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</p>}
      </div>

      <div className="approval-actions">
        <button className="btn-approve" onClick={submit} disabled={loading || !username.trim()}>
          {loading ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  )
}

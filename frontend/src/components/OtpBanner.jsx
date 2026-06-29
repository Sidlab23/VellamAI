import { useState, useRef, useEffect } from 'react'
import { api } from '../api'

// Shown when the agent pauses on a page that needs a one-time / verification code.
// The user types the code they received; it's handed back to the paused agent.
export function OtpBanner({ taskId, reason, onSubmitted }) {
  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit() {
    const c = code.trim()
    if (!c || loading) return
    setLoading(true); setError(null)
    try {
      const res = await api.submitOtp(taskId, c)
      if (res.ok) {
        onSubmitted?.()
      } else {
        setError(res.error || 'Could not deliver the code.')
        setLoading(false)
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="approval-banner otp-banner">
      <div className="approval-header">
        <span>🔐</span> Enter verification code
      </div>

      <div className="approval-body">
        <p style={{ fontSize: 13, color: 'var(--l2)', lineHeight: 1.6 }}>
          {reason || 'A site asked for a one-time code. Enter the code you received to continue.'}
        </p>
        <input
          ref={inputRef}
          className="otp-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Enter code (e.g. 482913)"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={loading}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--red)' }}>{error}</p>}
      </div>

      <div className="approval-actions">
        <button className="btn-approve" onClick={submit} disabled={loading || !code.trim()}>
          {loading ? 'Submitting…' : 'Submit code'}
        </button>
      </div>
    </div>
  )
}

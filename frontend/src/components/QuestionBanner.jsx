import { useState, useRef, useEffect } from 'react'
import { api } from '../api'

// Shown when the agent pauses to ask the user a decision mid-run — e.g. "nothing
// under ₹500, raise the budget?". Renders the offered choices as buttons plus a
// free-text fallback; the chosen answer is handed back to the paused agent.
export function QuestionBanner({ taskId, question, options, onSubmitted }) {
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function send(answer) {
    const a = (answer ?? text).trim()
    if (!a || loading) return
    setLoading(true); setError(null)
    try {
      const res = await api.submitAnswer(taskId, a)
      if (res.ok) {
        onSubmitted?.()
      } else {
        setError(res.error || 'Could not deliver your answer.')
        setLoading(false)
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  const opts = Array.isArray(options) ? options.filter(o => o && o.trim()) : []

  return (
    <div className="approval-banner otp-banner">
      <div className="approval-header">
        <span>💬</span> The agent needs your input
      </div>

      <div className="approval-body">
        <p style={{ fontSize: 13, color: 'var(--l2)', lineHeight: 1.6 }}>
          {question || 'The agent has a question before it continues.'}
        </p>

        {opts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {opts.map(o => (
              <button
                key={o}
                onClick={() => send(o)}
                disabled={loading}
                style={{
                  fontSize: 12.5, fontWeight: 600, color: 'var(--l1)',
                  background: 'var(--surface)', border: '1px solid var(--accent-border)',
                  padding: '7px 14px', borderRadius: 'var(--r-sm)',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {o}
              </button>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          className="otp-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder={opts.length > 0 ? 'Or type a different answer…' : 'Type your answer…'}
          disabled={loading}
          style={{ marginTop: 10 }}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</p>}
      </div>

      <div className="approval-actions">
        <button className="btn-approve" onClick={() => send()} disabled={loading || !text.trim()}>
          {loading ? 'Sending…' : 'Send answer'}
        </button>
      </div>
    </div>
  )
}

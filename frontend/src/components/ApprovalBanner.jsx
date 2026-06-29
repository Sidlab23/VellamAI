import { useState } from 'react'
import { api } from '../api'

export function ApprovalBanner({ taskId, approvalData, onDecision }) {
  const [loading, setLoading] = useState(false)
  const [note,    setNote]    = useState('')

  async function decide(approved) {
    setLoading(true)
    try {
      await api.approveTask(taskId, approved, note || undefined)
      onDecision(approved)
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="approval-banner">
      <div className="approval-header">
        Approval required
      </div>

      <div className="approval-body">
        <Field label="Requested action" value={approvalData?.action} />
        {approvalData?.details && <Field label="Details" value={approvalData.details} />}
        {approvalData?.reason  && <Field label="Why" value={approvalData.reason} />}

        <input
          style={{
            width:'100%', padding:'7px 0',
            borderBottom:'1px solid var(--sep)',
            fontSize:12.5, color:'var(--l1)',
          }}
          placeholder="Optional note (e.g. only if price is under ₹50,000)"
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="approval-actions">
        <button className="btn-approve" onClick={() => decide(true)} disabled={loading}>
          {loading ? 'Processing…' : 'Approve'}
        </button>
        <button className="btn-reject" onClick={() => decide(false)} disabled={loading}>Reject</button>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <span className="approval-field-label">{label}</span>
      <p>{value || '—'}</p>
    </div>
  )
}

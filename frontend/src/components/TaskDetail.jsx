import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useTaskSocket } from '../hooks/useTaskSocket'
import { StatusBadge } from './StatusBadge'
import { LogEntry } from './LogEntry'
import { ApprovalBanner } from './ApprovalBanner'
import { ActivityLog, useActivityLog } from './ActivityLog'

// ── Result renderer ───────────────────────────────────────────────────
function ResultRenderer({ text }) {
  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|[-| :]+\|$/)) {
      const headers = line.split('|').map(c => c.trim()).filter(Boolean)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean))
        i++
      }
      elements.push(
        <div key={i} className="result-table-wrap">
          <table className="result-table">
            <thead><tr>{headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    if (!line.trim())       { elements.push(<br key={i} />); i++; continue }
    if (line.startsWith('## ')) { elements.push(<h4 key={i} className="result-h4">{line.slice(3)}</h4>); i++; continue }
    if (line.startsWith('# '))  { elements.push(<h3 key={i} className="result-h3">{line.slice(2)}</h3>); i++; continue }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(<li key={i} className="result-li">{line.slice(2)}</li>); i++; continue
    }
    if (line.match(/^\d+\.\s/)) {
      elements.push(<li key={i} className="result-li result-li--num">{line.replace(/^\d+\.\s/, '')}</li>); i++; continue
    }
    elements.push(<p key={i} className="result-p">{line}</p>)
    i++
  }
  return <>{elements}</>
}

// ── Constants ─────────────────────────────────────────────────────────
const ACTIVE_STATUSES   = new Set(['pending', 'planning', 'running'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'waiting_approval'])

// ── Label styles ──────────────────────────────────────────────────────
const SECTION_LABEL = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.1em', color: 'rgba(255,255,255,0.22)', display: 'block', marginBottom: 6,
}

// ── Component ─────────────────────────────────────────────────────────
export function TaskDetail({ taskId, onBack }) {
  const [task,         setTask]         = useState(null)
  const [logs,         setLogs]         = useState([])
  const [liveSteps,    setLiveSteps]    = useState([])
  const [approvalData, setApprovalData] = useState(null)
  const [showSteps,    setShowSteps]    = useState(true)
  const [loading,      setLoading]      = useState(true)
  const [llmWaiting,   setLlmWaiting]   = useState(false)

  const resultRef    = useRef(null)
  const logBottomRef = useRef(null)
  const taskRef      = useRef(task)
  taskRef.current    = task

  const { entries, push, clear } = useActivityLog()

  const refreshTask = useCallback(async () => {
    try {
      const data = await api.getTask(taskId)
      setTask(data)
      setLogs(data.logs || [])
      if (TERMINAL_STATUSES.has(data.status)) setLiveSteps([])
    } catch (err) {
      push('error', `Failed to refresh: ${err.message}`)
    }
  }, [taskId])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); clear()
      push('info', 'Loading task…')
      try {
        const data = await api.getTask(taskId)
        if (!active) return
        setTask(data); setLogs(data.logs || [])
        push('info', `Task loaded — status: ${data.status}, ${data.steps_taken} steps`)
      } catch (err) {
        if (active) push('error', `Failed to load: ${err.message}`)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [taskId])

  useEffect(() => {
    const id = setInterval(() => {
      const cur = taskRef.current
      if (!cur || TERMINAL_STATUSES.has(cur.status)) return
      refreshTask()
    }, 3000)
    return () => clearInterval(id)
  }, [refreshTask])

  function handleEvent(msg) {
    const { type, data } = msg

    if (type === 'status_update') {
      const prev = taskRef.current?.status; const next = data.status
      if (prev !== next) push(next === 'failed' ? 'error' : next === 'completed' ? 'success' : 'info', `Status: ${prev} → ${next}`)
      setTask(t => t ? { ...t, status: next } : t)
    }
    if (type === 'thinking') { setLlmWaiting(true); push('debug', `Step ${data.step} — thinking…`) }
    if (type === 'log') {
      setLlmWaiting(false)
      const thought = data.thought || data.next_goal || ''
      const preview = thought.split('\n')[0].slice(0, 80)
      push('info', `Step ${data.step} — ${data.action || 'step'}${preview ? ': ' + preview : ''}`, thought.length > 80 ? thought : null)
      setLiveSteps(prev => {
        const exists = prev.find(s => s.step === data.step)
        return exists ? prev.map(s => s.step === data.step ? { ...s, ...data } : s) : [...prev, data]
      })
      setTask(t => t ? { ...t, steps_taken: data.step } : t)
    }
    if (type === 'observation') {
      const obs = data.observation || ''
      push('debug', `Step ${data.step} obs: ${obs.slice(0, 80)}${obs.length > 80 ? '…' : ''}`, obs.length > 80 ? obs : null)
      setLiveSteps(prev => prev.map(s => s.step === data.step ? { ...s, observation: data.observation } : s))
    }
    if (type === 'step_errors')  { (data.errors || []).forEach(e => push('warn', `Step error: ${e}`)) }
    if (type === 'error_detail') { push('error', `Error step ${data.step}: ${data.error}`, data.traceback || null) }
    if (type === 'approval_required') {
      setApprovalData(data)
      setTask(t => t ? { ...t, status: 'waiting_approval' } : t)
      push('warn', `Approval required — ${data.action}`, data.details || null)
    }
    if (type === 'completed') {
      setLlmWaiting(false)
      setTask(t => t ? { ...t, status: 'completed', result: data.result } : t)
      push('success', `Completed in ${data.steps} steps`)
      setTimeout(() => refreshTask(), 600)
    }
    if (type === 'failed') {
      setLlmWaiting(false)
      setTask(t => t ? { ...t, status: 'failed', error: data.reason } : t)
      push('error', `Task failed: ${data.reason}`)
      setTimeout(() => refreshTask(), 600)
    }
  }

  const { connected } = useTaskSocket(taskId, handleEvent)

  const prevConnected = useRef(null)
  useEffect(() => {
    if (prevConnected.current === null) { prevConnected.current = connected; return }
    if (connected  && !prevConnected.current) push('info', 'Connected to live feed')
    if (!connected && prevConnected.current)  push('warn', 'Disconnected — REST polling active')
    prevConnected.current = connected
  }, [connected])

  const dbStepNums = new Set(logs.map(l => l.step))
  const allLogs    = [
    ...logs,
    ...liveSteps.filter(s => !dbStepNums.has(s.step)),
  ].sort((a, b) => a.step - b.step)

  useEffect(() => {
    if (showSteps && task && ACTIVE_STATUSES.has(task.status))
      logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allLogs.length, showSteps, task?.status])

  useEffect(() => {
    if (task?.result) resultRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [task?.result])

  async function handleCancel() {
    if (!window.confirm('Cancel this task?')) return
    push('warn', 'Cancelling…')
    try {
      await api.stopAgent(taskId)
      await api.cancelTask(taskId, 'Cancelled by user')
      push('info', 'Task cancelled')
      refreshTask()
    } catch (err) {
      push('error', `Cancel failed: ${err.message}`)
      alert('Error: ' + err.message)
    }
  }

  if (loading) return (
    <div className="flex items-center gap-3 py-16 justify-center" style={{color: 'rgba(255,255,255,0.3)'}}>
      <span className="spinner" /> <span style={{fontSize: 13}}>Loading task…</span>
    </div>
  )
  if (!task) return (
    <p className="py-16 text-center" style={{fontSize: 13, color: 'rgba(255,255,255,0.25)'}}>Task not found.</p>
  )

  const isActive  = ACTIVE_STATUSES.has(task.status)
  const statusMsg = {
    pending:  'Starting agent…',
    planning: 'Planning…',
    running:  llmWaiting
      ? `Step ${task.steps_taken} — waiting for ${task.model}…`
      : `Step ${task.steps_taken} — processing…`,
  }[task.status] || ''

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost px-3 py-1.5 rounded-xl flex items-center gap-1.5">
          ← <span>Back</span>
        </button>
        <div className="flex items-center gap-2.5 ml-auto">
          <StatusBadge status={task.status} animate />
          {connected && isActive && (
            <span className="flex items-center gap-1.5" style={{
              fontSize: 10, fontWeight: 700, color: '#34d399',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <span className="live-dot" /> Live
            </span>
          )}
        </div>
      </div>

      {/* Goal */}
      <div className="glass rounded-2xl p-5">
        <span style={SECTION_LABEL}>Goal</span>
        <p style={{fontSize: 14, color: 'rgba(255,255,255,0.72)', lineHeight: 1.65}}>{task.goal}</p>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip-surface">{task.type}</span>
        <span className="chip-surface">{task.model}</span>
        <span className="chip-surface">{task.steps_taken} step{task.steps_taken !== 1 ? 's' : ''}</span>
        {isActive && (
          <button className="btn-danger ml-auto" onClick={handleCancel}>■ Stop</button>
        )}
      </div>

      {/* Running indicator */}
      {isActive && statusMsg && (
        <div className="glass rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="spinner" />
          <span style={{fontSize: 13, color: 'rgba(255,255,255,0.45)'}}>{statusMsg}</span>
        </div>
      )}

      {/* Approval banner */}
      {task.status === 'waiting_approval' && approvalData && (
        <ApprovalBanner
          taskId={taskId}
          approvalData={approvalData}
          onDecision={() => { setApprovalData(null); refreshTask() }}
        />
      )}

      {/* Result */}
      {task.result && (
        <div className="glass-elevated rounded-2xl overflow-hidden" ref={resultRef}>
          <div className="px-5 py-3 flex items-center justify-between"
            style={{
              background: 'rgba(52,211,153,0.055)',
              borderBottom: '1px solid rgba(52,211,153,0.1)',
            }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', color: '#34d399',
            }}>✓ Result</span>
            <span style={{fontSize: 10, color: 'rgba(255,255,255,0.22)'}}>
              {task.steps_taken} steps
            </span>
          </div>
          <div className="p-5 space-y-2">
            <ResultRenderer text={task.result} />
          </div>
        </div>
      )}

      {/* Error */}
      {task.error && !task.result && (
        <div className="glass rounded-xl p-5"
          style={{borderColor: 'rgba(248,113,113,0.2)'}}>
          <span style={{...SECTION_LABEL, color: '#f87171'}}>Error</span>
          <p style={{fontSize: 13, color: 'rgba(248,113,113,0.7)', lineHeight: 1.65}}>{task.error}</p>
        </div>
      )}

      {/* Activity Log */}
      <ActivityLog entries={entries} />

      {/* Agent Steps */}
      <div className="space-y-2">
        <button
          onClick={() => setShowSteps(v => !v)}
          className="w-full glass rounded-xl px-4 py-3 flex items-center justify-between transition-colors"
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '' }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)',
          }}>
            {showSteps ? '▾' : '▸'} Agent Steps
          </span>
          <div className="flex items-center gap-2">
            {isActive && <span className="live-dot" />}
            <span className="chip-surface">{allLogs.length}</span>
          </div>
        </button>

        {showSteps && (
          <div className="glass rounded-2xl overflow-hidden">
            {allLogs.length === 0 && (
              <p style={{
                textAlign: 'center', fontSize: 12,
                color: 'rgba(255,255,255,0.22)', padding: '24px 0',
              }}>
                {isActive ? 'Waiting for first step…' : 'No steps recorded.'}
              </p>
            )}
            {allLogs.map((log, i) => (
              <LogEntry key={`${log.id || log.step}-${i}`} log={log} />
            ))}
            <div ref={logBottomRef} />
          </div>
        )}
      </div>

    </div>
  )
}

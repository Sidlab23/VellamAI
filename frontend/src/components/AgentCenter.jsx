import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import { useTaskSocket } from '../hooks/useTaskSocket'
import { ApprovalBanner } from './ApprovalBanner'
import { OtpBanner } from './OtpBanner'
import { CredentialBanner } from './CredentialBanner'
import { QuestionBanner } from './QuestionBanner'
import { FlowMascot } from './FlowMascot'
import { ActivityLog, useActivityLog } from './ActivityLog'

const EXAMPLES = [
  'Find me a laptop under ₹60,000 on Flipkart with at least 16GB RAM and good battery life',
  'Compare prices of iPhone 16 on Amazon.in, Flipkart and Croma and tell me the best deal',
  'Search for software engineer jobs in Bangalore on Naukri with 2–5 years Python experience',
]

const fade = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
}

// ── Result renderer ───────────────────────────────────────────────────
function ResultRenderer({ text }) {
  const lines = text.split('\n')
  const els = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|[-| :]+\|$/)) {
      const headers = line.split('|').map(c => c.trim()).filter(Boolean)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean)); i++
      }
      els.push(
        <div key={i} className="result-table-wrap">
          <table className="result-table">
            <thead><tr>{headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ); continue
    }
    if (!line.trim()) { els.push(<br key={i} />); i++; continue }
    if (line.startsWith('## ')) {
      const text = line.slice(3)
      // The agent leads its answer with "## ✅ Recommended: <name>" — surface it
      // as a highlighted callout so the best pick stands out above the rest.
      if (/^\s*(✅\s*)?(recommended|best pick|top pick)\b/i.test(text)) {
        const name = text.replace(/^\s*✅\s*/, '').replace(/^(recommended|best pick|top pick)\s*:?\s*/i, '')
        els.push(
          <div key={i} className="result-recommend">
            <span className="result-recommend-tag">★ Recommended</span>
            <span className="result-recommend-name">{name}</span>
          </div>
        ); i++; continue
      }
      els.push(<h4 key={i} className="result-h4">{text}</h4>); i++; continue
    }
    if (line.startsWith('# '))  { els.push(<h3 key={i} className="result-h3">{line.slice(2)}</h3>); i++; continue }
    if (line.startsWith('- ') || line.startsWith('• ')) { els.push(<li key={i} className="result-li">{line.slice(2)}</li>); i++; continue }
    if (line.match(/^\d+\.\s/)) { els.push(<li key={i} className="result-li result-li--num">{line.replace(/^\d+\.\s/, '')}</li>); i++; continue }
    els.push(<p key={i} className="result-p">{line}</p>); i++
  }
  return <>{els}</>
}

// ── Clarification form ────────────────────────────────────────────────
function ClarificationForm({ questions, onSubmit, onSkip }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ''))
  const [submitting, setSubmitting] = useState(false)

  function setAnswer(idx, value) {
    setAnswers(prev => prev.map((a, i) => i === idx ? value : a))
  }

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit(questions.map((q, i) => ({ question: q.question, answer: answers[i] || '' })))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSkip() {
    if (submitting) return
    setSubmitting(true)
    try { await onSkip() } finally { setSubmitting(false) }
  }

  const answeredCount = answers.filter(a => a.trim()).length

  return (
    <div className="clarify-card">
      <div className="clarify-head">
        <div className="clarify-title">Before I start, a few questions</div>
        <div className="clarify-sub">Answers are optional but help me get it right.</div>
      </div>

      <div className="clarify-body">
        {questions.map((q, idx) => (
          <div key={q.id ?? idx}>
            <div className="clarify-q">{q.question}</div>
            {q.type === 'choice' && q.options?.length > 0 ? (
              <div className="clarify-options">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    className={`clarify-chip${answers[idx] === opt ? ' clarify-chip--selected' : ''}`}
                    onClick={() => setAnswer(idx, answers[idx] === opt ? '' : opt)}
                    type="button"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="clarify-input"
                value={answers[idx]}
                onChange={e => setAnswer(idx, e.target.value)}
                placeholder={q.placeholder || 'Your answer'}
              />
            )}
          </div>
        ))}
      </div>

      <div className="clarify-actions">
        <button className="clarify-submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Starting…' : answeredCount > 0 ? 'Submit and start' : 'Start'}
        </button>
        <button className="clarify-skip" onClick={handleSkip} disabled={submitting}>
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Welcome ───────────────────────────────────────────────────────────
function WelcomeState({ onExample }) {
  return (
    <motion.div className="cp-welcome" variants={fade} initial="hidden" animate="visible">
      <div className="cp-agent-name">Vellam AI Agent</div>
      <p className="cp-agent-desc">
        An autonomous browser agent that searches the web, compares options,
        and completes tasks on your behalf — running entirely on your machine.
      </p>
      <div className="cp-example-label">Examples</div>
      <div>
        {EXAMPLES.map(ex => (
          <button key={ex} className="cp-example-row" onClick={() => onExample(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

// Pull a step's details into one shape. Live WS steps carry the fields directly;
// DB logs (after a reload) pack them into `observation` as JSON.
function stepDetail(s) {
  let input = s.action_input || null
  let next_goal = s.next_goal || ''
  let thought = s.thought || ''
  if ((!input || !next_goal || !thought) && s.observation) {
    try {
      const o = JSON.parse(s.observation)
      input = input || o.input || null
      next_goal = next_goal || o.next_goal || ''
      thought = thought || o.thought || ''
    } catch {}
  }
  thought = thought || s.reasoning || ''
  return { input, next_goal, thought, action: s.action || '' }
}

// Turn a raw action name (e.g. "go_to_url", "input_text") into a clean label
// for the collapsed step row. The full reasoning shows only once expanded.
function humanizeAction(name) {
  if (!name || name === 'step') return ''
  const s = name.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Live conversation ─────────────────────────────────────────────────
const ACTIVE = new Set(['pending', 'planning', 'running'])
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
// Statuses where the agent is busy and can be stopped by the user.
const STOPPABLE = new Set(['pending', 'planning', 'running', 'waiting_approval', 'waiting_otp', 'waiting_credentials', 'waiting_input'])

function LiveConversation({ taskId, task: initialTask, onTaskUpdated, onStartAgent, onSaveCredential, clarification, onClarifySubmit, onClarifySkip }) {
  const [task,         setTask]         = useState(initialTask)
  const [liveSteps,    setLiveSteps]    = useState([])
  const [approvalData, setApprovalData] = useState(null)
  const [otpData,      setOtpData]      = useState(null)
  const [credData,     setCredData]     = useState(null)
  const [askData,      setAskData]      = useState(null)
  const [showSteps,    setShowSteps]    = useState(true)
  const [expandedStep, setExpandedStep] = useState(null)
  const [llmWaiting,   setLlmWaiting]   = useState(false)
  const [manualStarting, setManualStarting] = useState(false)

  const taskRef   = useRef(task)
  taskRef.current = task
  const bottomRef = useRef(null)
  const { entries, push, clear } = useActivityLog()

  const refresh = useCallback(async () => {
    try {
      const data = await api.getTask(taskId)
      setTask(data)
      if (TERMINAL.has(data.status)) setLiveSteps([])
      onTaskUpdated?.()
    } catch {}
  }, [taskId])

  useEffect(() => {
    let active = true
    clear()
    async function load() {
      try {
        const data = await api.getTask(taskId)
        if (active) { setTask(data); setLiveSteps([]) }
      } catch {}
    }
    load()
    return () => { active = false }
  }, [taskId])

  useEffect(() => {
    const id = setInterval(() => {
      if (taskRef.current && !TERMINAL.has(taskRef.current.status)) refresh()
    }, 2500)
    return () => clearInterval(id)
  }, [refresh])

  // Recover the OTP prompt after a reload or a missed WebSocket event.
  useEffect(() => {
    if (task?.status === 'waiting_otp' && !otpData) {
      api.getOtpState(taskId)
        .then(s => { if (s.waiting) setOtpData({ reason: s.reason }) })
        .catch(() => {})
    }
  }, [task?.status, otpData, taskId])

  // Recover the credentials prompt after a reload or a missed WebSocket event.
  useEffect(() => {
    if (task?.status === 'waiting_credentials' && !credData) {
      api.getCredentialState(taskId)
        .then(s => { if (s.waiting) setCredData({ site: s.site, reason: s.reason }) })
        .catch(() => {})
    }
  }, [task?.status, credData, taskId])

  // Recover the question prompt after a reload or a missed WebSocket event.
  useEffect(() => {
    if (task?.status === 'waiting_input' && !askData) {
      api.getAskState(taskId)
        .then(s => { if (s.waiting) setAskData({ question: s.question, options: s.options }) })
        .catch(() => {})
    }
  }, [task?.status, askData, taskId])

  function handleWsEvent({ type, data }) {
    if (type === 'status_update') {
      const prev = taskRef.current?.status
      if (prev !== data.status) push(data.status === 'failed' ? 'error' : data.status === 'completed' ? 'success' : 'info', `Status → ${data.status}`)
      setTask(t => t ? { ...t, status: data.status } : t)
      if (data.status !== 'waiting_otp') setOtpData(null)
      if (data.status !== 'waiting_credentials') setCredData(null)
      if (data.status !== 'waiting_input') setAskData(null)
    }
    if (type === 'otp_required') {
      setOtpData({ reason: data.reason })
      setTask(t => t ? { ...t, status: 'waiting_otp' } : t)
      push('warn', 'Verification code required', data.reason || null)
    }
    if (type === 'otp_submitted') { setOtpData(null) }
    if (type === 'credentials_required') {
      setCredData({ site: data.site, reason: data.reason })
      setTask(t => t ? { ...t, status: 'waiting_credentials' } : t)
      push('warn', `Sign-in required${data.site ? ` — ${data.site}` : ''}`, data.reason || null)
    }
    if (type === 'credentials_submitted') { setCredData(null) }
    if (type === 'input_required') {
      setAskData({ question: data.question, options: data.options })
      setTask(t => t ? { ...t, status: 'waiting_input' } : t)
      push('warn', 'The agent needs your input', data.question || null)
    }
    if (type === 'input_submitted') { setAskData(null) }
    if (type === 'thinking') { setLlmWaiting(true) }
    if (type === 'log') {
      setLlmWaiting(false)
      setLiveSteps(prev => {
        const exists = prev.find(s => s.step === data.step)
        return exists ? prev.map(s => s.step === data.step ? { ...s, ...data } : s) : [...prev, data]
      })
      setTask(t => t ? { ...t, steps_taken: data.step } : t)
    }
    if (type === 'approval_required') {
      setApprovalData(data)
      setTask(t => t ? { ...t, status: 'waiting_approval' } : t)
    }
    if (type === 'completed') {
      setLlmWaiting(false)
      setTask(t => t ? { ...t, status: 'completed', result: data.result } : t)
      push('success', `Completed in ${data.steps} steps`)
      setTimeout(refresh, 600)
    }
    if (type === 'failed') {
      setLlmWaiting(false)
      setTask(t => t ? { ...t, status: 'failed', error: data.reason } : t)
      push('error', `Failed: ${data.reason}`)
      setTimeout(refresh, 600)
    }
  }

  useTaskSocket(taskId, handleWsEvent)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveSteps.length, task?.result, clarification?.state, askData, otpData, credData, approvalData])

  if (!task) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  )

  const isActive = ACTIVE.has(task.status)
  const dbNums   = new Set((task.logs || []).map(l => l.step))
  const allSteps = [...(task.logs || []), ...liveSteps.filter(s => !dbNums.has(s.step))].sort((a, b) => a.step - b.step)

  const showManualStart =
    task.status === 'pending' && !clarification && allSteps.length === 0

  async function handleManualStart() {
    setManualStarting(true)
    try {
      await (onStartAgent ? onStartAgent(taskId) : api.runAgent(taskId))
      await refresh()
    } catch {}
    setManualStarting(false)
  }

  const workingText =
    task.status === 'pending' ? 'Starting up…'
    : task.status === 'planning' ? 'Planning approach…'
    : llmWaiting ? `Thinking at step ${task.steps_taken}…`
    : `Working — step ${task.steps_taken}`

  return (
    <div className="cp-convo">
      {/* Goal */}
      <motion.div variants={fade} initial="hidden" animate="visible">
        <div className="cp-goal">{task.goal}</div>
        <div className="cp-goal-meta">
          {task.type}{task.model ? ` · ${task.model}` : ''}
        </div>
      </motion.div>

      {/* Clarification: loading */}
      {clarification?.state === 'loading' && (
        <motion.div className="cp-working" variants={fade} initial="hidden" animate="visible">
          <span className="spinner spinner-sm" />
          <span>Reviewing your request…</span>
        </motion.div>
      )}

      {/* Clarification: form */}
      {clarification?.state === 'ready' && clarification.questions.length > 0 && (
        <motion.div variants={fade} initial="hidden" animate="visible">
          <ClarificationForm
            questions={clarification.questions}
            onSubmit={(answers) => onClarifySubmit(taskId, answers)}
            onSkip={() => onClarifySkip(taskId)}
          />
        </motion.div>
      )}

      {/* Stranded pending task */}
      {showManualStart && (
        <div className="cp-working">
          <span>This task hasn't started yet.</span>
          <button
            onClick={handleManualStart}
            disabled={manualStarting}
            style={{ color: 'var(--accent-light)', fontWeight: 500 }}
          >
            {manualStarting ? 'Starting…' : 'Start now'}
          </button>
        </div>
      )}

      {/* Working line */}
      {isActive && !clarification && !showManualStart && (
        <div className="cp-working">
          <span className="spinner spinner-sm" />
          <span>{workingText}</span>
        </div>
      )}

      {/* Human-input banners (approval / OTP / sign-in / question) render at the
          BOTTOM of the conversation — see just above the scroll anchor below — so they
          sit next to the composer/mascot and the auto-scroll lands right on them.
          Rendered up here they ended up above a long step list, scrolled out of view,
          which is why the input box looked "missing". */}

      {/* Steps */}
      {allSteps.length > 0 && (
        <div className="cp-section">
          <button className="cp-section-head" onClick={() => setShowSteps(v => !v)}>
            <span className="cp-section-title">Action models</span>
            <span className="cp-section-meta">{allSteps.length}</span>
            <span className="cp-section-meta" style={{ marginLeft: 'auto' }}>{showSteps ? 'Hide' : 'Show'}</span>
          </button>
          {showSteps && (
            <div style={{ marginTop: 6 }}>
              {allSteps.map(s => {
                const d = stepDetail(s)
                // Collapsed rows are labeled "Action model N"; the real action and
                // reasoning paragraph are revealed only when the step is expanded.
                const label = `Action model ${s.step}`
                const open = expandedStep === s.step
                const params = d.input && typeof d.input === 'object' ? Object.entries(d.input) : []
                return (
                  <div key={s.step}>
                    <button
                      className={`cp-step-row cp-step-row--btn${open ? ' cp-step-row--open' : ''}`}
                      onClick={() => setExpandedStep(open ? null : s.step)}
                      title="Show what happened in this step"
                    >
                      <span className="cp-step-num">{s.step}</span>
                      <span className="cp-step-text">{label.slice(0, 110)}</span>
                      <span className="cp-step-caret">{open ? '▾' : '▸'}</span>
                    </button>
                    {open && (
                      <div className="cp-step-detail">
                        {d.action && (
                          <div className="cp-step-detail-row">
                            <span className="cp-step-detail-k">Action</span>
                            <span className="cp-step-detail-v cp-step-action">{humanizeAction(d.action) || d.action}</span>
                          </div>
                        )}
                        {d.thought && (
                          <div className="cp-step-detail-row">
                            <span className="cp-step-detail-k">Thought</span>
                            <span className="cp-step-detail-v">{d.thought}</span>
                          </div>
                        )}
                        {d.next_goal && (
                          <div className="cp-step-detail-row">
                            <span className="cp-step-detail-k">Next goal</span>
                            <span className="cp-step-detail-v">{d.next_goal}</span>
                          </div>
                        )}
                        {params.length > 0 && (
                          <div className="cp-step-detail-row">
                            <span className="cp-step-detail-k">Details</span>
                            <span className="cp-step-detail-v">
                              {params.map(([k, v]) => (
                                <div key={k}>
                                  <span className="cp-step-detail-pk">{k}:</span>{' '}
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </div>
                              ))}
                            </span>
                          </div>
                        )}
                        {!d.action && !d.thought && !d.next_goal && params.length === 0 && (
                          <div className="cp-step-detail-row">
                            <span className="cp-step-detail-v" style={{ color: 'var(--l4)' }}>
                              No details captured for this step.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {task.result && (
        <motion.div className="cp-section" variants={fade} initial="hidden" animate="visible">
          <div className="cp-section-head">
            <span className="cp-section-title" style={{ color: 'var(--green)' }}>Result</span>
            <span className="cp-section-meta">{task.steps_taken} step{task.steps_taken !== 1 ? 's' : ''}</span>
          </div>
          <div className="cp-result-body">
            <ResultRenderer text={task.result} />
          </div>
        </motion.div>
      )}

      {/* Error */}
      {task.status === 'failed' && !task.result && (
        <motion.div className="cp-section" variants={fade} initial="hidden" animate="visible">
          <div className="cp-section-head">
            <span className="cp-section-title" style={{ color: 'var(--red)' }}>Failed</span>
          </div>
          <p className="cp-error-text">
            {task.error || 'The agent could not complete this task.'}
          </p>
          {task.steps_taken === 0 && (
            <p className="cp-error-hint">
              The agent could not take any steps. Confirm Ollama is running
              (<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>ollama serve</code>) and
              the model is pulled. A 7B+ model such as llama3.1:8b or qwen2.5:7b is recommended.
            </p>
          )}
        </motion.div>
      )}

      {/* Activity log */}
      {entries.length > 0 && <ActivityLog entries={entries} />}

      {/* Interactive prompts — pinned at the bottom so they're always next to the
          composer and the auto-scroll reveals them. Gated on the data that arrives over
          the WebSocket (not only the separately-polled task.status), so a status-sync
          lag can't stop the banner from mounting. */}
      {task.status === 'waiting_approval' && approvalData && (
        <ApprovalBanner
          taskId={taskId}
          approvalData={approvalData}
          onDecision={() => { setApprovalData(null); refresh() }}
        />
      )}
      {(otpData || task.status === 'waiting_otp') && (
        <OtpBanner
          taskId={taskId}
          reason={otpData?.reason}
          onSubmitted={() => { setOtpData(null); refresh() }}
        />
      )}
      {(credData || task.status === 'waiting_credentials') && (
        <CredentialBanner
          taskId={taskId}
          site={credData?.site}
          reason={credData?.reason}
          onSaveCredential={onSaveCredential}
          onSubmitted={() => { setCredData(null); refresh() }}
        />
      )}
      {(askData || task.status === 'waiting_input') && (
        <QuestionBanner
          taskId={taskId}
          question={askData?.question}
          options={askData?.options}
          onSubmitted={() => { setAskData(null); refresh() }}
        />
      )}

      <div ref={bottomRef} style={{ height: 28 }} />
    </div>
  )
}

// ── Main center panel ─────────────────────────────────────────────────
export function AgentCenter({
  selectedTask, selectedTaskId, onNewTask, onStartAgent, onTaskUpdated, onSaveCredential, type, model,
  clarification, onClarifySubmit, onClarifySkip,
}) {
  const [goal,       setGoal]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stopping,   setStopping]   = useState(false)
  const [error,      setError]      = useState(null)
  const textareaRef = useRef(null)

  // The agent is busy on the selected task → show a Stop button instead of Send.
  const isRunning = !!selectedTask && STOPPABLE.has(selectedTask.status)

  // 0..1 progress that slides the mascot along its rail: proportion of steps used
  // while the agent is working, full when completed, none when idle/terminal-failed.
  const mascotProgress = (() => {
    const t = selectedTask
    if (!t) return 0
    if (t.status === 'completed') return 1
    if (t.status === 'failed' || t.status === 'cancelled') return 0
    if (!STOPPABLE.has(t.status)) return 0
    const max = t.max_steps || 40
    return Math.max(0.04, Math.min(0.96, (t.steps_taken || 0) / max))
  })()

  function handleExample(ex) {
    setGoal(ex)
    textareaRef.current?.focus()
  }

  async function handleStop() {
    if (!selectedTaskId || stopping) return
    setStopping(true)
    setError(null)
    try {
      await api.stopAgent(selectedTaskId)
    } catch (err) {
      setError(err.message)
    } finally {
      setStopping(false)
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!goal.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onNewTask(goal)
      setGoal('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 130) + 'px'
  }, [goal])

  return (
    <div className="center">
      <AnimatePresence mode="wait">
        {!selectedTaskId ? (
          <motion.div
            key="welcome"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18 }}
          >
            <WelcomeState onExample={handleExample} />
          </motion.div>
        ) : (
          <motion.div
            key={selectedTaskId}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18 }}
          >
            <LiveConversation
              taskId={selectedTaskId}
              task={selectedTask}
              onTaskUpdated={onTaskUpdated}
              onStartAgent={onStartAgent}
              onSaveCredential={onSaveCredential}
              clarification={clarification}
              onClarifySubmit={onClarifySubmit}
              onClarifySkip={onClarifySkip}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="cp-input-area">
        <FlowMascot status={selectedTask?.status} taskId={selectedTaskId} progress={mascotProgress} />
        {error && (
          <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 8 }}>
            {error}
          </div>
        )}

        <div className="cp-input-wrap">
          <textarea
            ref={textareaRef}
            className="cp-textarea"
            placeholder="Describe what the agent should do…"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          {isRunning ? (
            <button
              className="cp-stop-btn"
              onClick={handleStop}
              disabled={stopping}
              title="Stop the agent"
            >
              {stopping ? (
                <span className="spinner" style={{ width: 13, height: 13, borderTopColor: 'white' }} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              )}
            </button>
          ) : (
            <button
              className="cp-send-btn"
              onClick={handleSubmit}
              disabled={!goal.trim() || submitting}
              title="Send"
            >
              {submitting ? (
                <span className="spinner" style={{ width: 13, height: 13, borderTopColor: 'var(--on-accent)' }} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="cp-input-meta">
          <span>{isRunning ? 'Agent is running — press stop to cancel' : 'Enter to send'}</span>
          <span>{model || 'No model selected'}</span>
        </div>
      </div>
    </div>
  )
}

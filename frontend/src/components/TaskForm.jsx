import { useState } from 'react'
import { api } from '../api'

const EXAMPLE_GOALS = [
  'Find me a laptop under $800 on Amazon with at least 16GB RAM',
  'Search for the best noise-cancelling headphones and compare top 3 options',
  'Find software engineer jobs in New York that match a Python background',
]

export function TaskForm({ onTaskCreated, model, type, setType }) {
  const [goal,        setGoal]        = useState('')
  const [context,     setContext]     = useState('')
  const [showContext, setShowContext] = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!goal.trim()) return
    setLoading(true)
    setError(null)
    try {
      const task = await api.createTask({
        goal:    goal.trim(),
        type,
        model:   model.trim() || undefined,
        context: context.trim() || undefined,
      })
      await api.runAgent(task.id)
      setGoal('')
      setContext('')
      onTaskCreated(task.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function pickGoal(g) {
    setGoal(g)
    if (g.includes('job')) setType('job_search')
    else if (g.includes('laptop') || g.includes('headphones')) setType('shopping')
    else setType('general')
  }

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-[15px] font-semibold text-white tracking-tight leading-tight">New Task</h2>
        <p className="text-[11px] text-white/30 mt-0.5">Describe what you want the agent to do</p>
      </div>

      {/* Suggestions */}
      <div className="space-y-1.5">
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)',
        }}>Suggested</span>
        <div className="flex flex-col gap-1">
          {EXAMPLE_GOALS.map((g) => (
            <button
              key={g}
              onClick={() => pickGoal(g)}
              className="text-left text-[11px] text-white/35 hover:text-white/65 transition-colors px-3 py-2 rounded-xl truncate"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <textarea
            className="glass-textarea"
            placeholder="What should the agent do? Be specific — more detail means better results."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={5}
            required
          />
          {goal.length > 0 && (
            <span className="absolute bottom-2.5 right-3 text-[10px] font-mono"
              style={{color: 'rgba(255,255,255,0.2)'}}>
              {goal.length}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowContext(!showContext)}
          className="btn-ghost text-[11px]"
        >
          {showContext ? '▾' : '▸'} {showContext ? 'Hide context' : 'Add context'}
        </button>

        {showContext && (
          <textarea
            className="glass-input resize-none text-sm"
            style={{minHeight: 80, lineHeight: 1.6}}
            placeholder="Optional: constraints, preferences, login info, background context…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
          />
        )}

        {error && (
          <p className="text-[11px] px-3 py-2 rounded-xl"
            style={{
              color: '#fca5a5',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.18)',
            }}>
            {error}
          </p>
        )}

        <button className="btn-filled" type="submit" disabled={loading || !goal.trim()}>
          {loading
            ? <><span className="spinner" /> Starting agent…</>
            : <>▶ Run Agent</>
          }
        </button>
      </form>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../api'
import { StatusBadge } from './StatusBadge'

const ACTIVE = new Set(['pending', 'planning', 'running'])

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return `${Math.round(diff)}s`
  if (diff < 3600) return `${Math.round(diff / 60)}m`
  return `${Math.round(diff / 3600)}h`
}

export function TaskList({ selectedId, onSelect, onDelete, refreshTick }) {
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await api.listTasks({ page_size: 30 })
        if (active) setTasks(data.tasks)
      } catch {}
      finally { if (active) setLoading(false) }
    }
    load()
    return () => { active = false }
  }, [refreshTick])

  async function handleStop(e, task) {
    e.stopPropagation()
    try {
      await api.stopAgent(task.id)
      await api.cancelTask(task.id, 'Stopped by user')
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: 'cancelled' } : t))
    } catch {}
  }

  async function handleDelete(e, task) {
    e.stopPropagation()
    if (ACTIVE.has(task.status)) {
      try { await api.stopAgent(task.id); await api.cancelTask(task.id, 'Deleted') } catch {}
    }
    await api.deleteTask(task.id)
    setTasks(ts => ts.filter(t => t.id !== task.id))
    onDelete?.(task.id)
  }

  if (loading) {
    return (
      <p style={{fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '8px 0'}}>Loading…</p>
    )
  }
  if (!tasks.length) {
    return (
      <p style={{fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '8px 0'}}>
        No tasks yet. Create one above.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {tasks.map((t) => {
        const isSelected = selectedId === t.id
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="glass rounded-xl p-3.5 cursor-pointer transition-all duration-150"
            style={{
              borderColor: isSelected ? 'rgba(139,92,246,0.4)' : undefined,
              background: isSelected ? 'rgba(139,92,246,0.07)' : undefined,
              boxShadow: isSelected ? '0 0 0 1px rgba(139,92,246,0.2) inset' : undefined,
            }}
            onMouseEnter={e => {
              if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.055)'
            }}
            onMouseLeave={e => {
              if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'
            }}
          >
            {/* Top row */}
            <div className="flex items-center justify-between mb-2">
              <StatusBadge status={t.status} animate />
              <div className="flex items-center gap-1">
                <span style={{fontSize: 10, color: 'rgba(255,255,255,0.2)'}}>
                  {timeAgo(t.created_at)}
                </span>
                {ACTIVE.has(t.status) && (
                  <button
                    onClick={(e) => handleStop(e, t)}
                    title="Stop agent"
                    className="btn-ghost w-6 h-6 flex items-center justify-center"
                    style={{fontSize: 11}}
                  >■</button>
                )}
                <button
                  onClick={(e) => handleDelete(e, t)}
                  title="Delete"
                  className="btn-ghost w-6 h-6 flex items-center justify-center"
                  style={{fontSize: 14, fontWeight: 400}}
                >×</button>
              </div>
            </div>

            {/* Goal */}
            <p style={{
              fontSize: 12.5, color: 'rgba(255,255,255,0.65)',
              lineHeight: 1.5, marginBottom: 10,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {t.goal}
            </p>

            {/* Tags */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="chip-surface">{t.type}</span>
              {t.model && <span className="chip-surface">{t.model}</span>}
              {t.steps_taken > 0 && <span className="chip-surface">{t.steps_taken} steps</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

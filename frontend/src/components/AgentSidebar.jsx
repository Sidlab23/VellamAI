import { useState } from 'react'
import { api } from '../api'

const ACTIVE = new Set(['pending', 'planning', 'running', 'waiting_approval', 'waiting_otp'])

const STATUS_LABEL = {
  pending:          'Pending',
  planning:         'Planning',
  running:          'Running',
  waiting_approval: 'Needs approval',
  waiting_otp:      'Needs code',
  approved:         'Approved',
  completed:        'Completed',
  failed:           'Failed',
  cancelled:        'Cancelled',
}

const STATUS_CLASS = {
  running:          'sb-item-status--running',
  planning:         'sb-item-status--running',
  failed:           'sb-item-status--failed',
  waiting_approval: 'sb-item-status--attention',
  waiting_otp:      'sb-item-status--attention',
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function AgentSidebar({ tasks, selectedId, onSelect, onDelete, onNewChat, collapsed }) {
  async function handleDelete(e, task) {
    e.stopPropagation()
    if (ACTIVE.has(task.status)) {
      try { await api.stopAgent(task.id); await api.cancelTask(task.id, 'Deleted') } catch {}
    }
    await api.deleteTask(task.id)
    onDelete?.(task.id)
  }

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sb-header">
        <button className="sb-new-btn" onClick={onNewChat}>
          New task
        </button>
      </div>

      {tasks.length > 0 && (
        <div className="sb-section-label">Recent</div>
      )}

      <div className="sb-list">
        {tasks.length === 0 ? (
          <div className="sb-empty">
            <p className="sb-empty-text">No tasks yet. Describe one in the panel to the right to get started.</p>
          </div>
        ) : (
          tasks.map(t => (
            <ConvoItem
              key={t.id}
              task={t}
              isSelected={selectedId === t.id}
              onSelect={() => onSelect(t.id)}
              onDelete={(e) => handleDelete(e, t)}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function ConvoItem({ task, isSelected, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`sb-item${isSelected ? ' sb-item--active' : ''}`}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="sb-item-meta">
        <span className={`sb-item-status ${STATUS_CLASS[task.status] || ''}`}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
        <span className="sb-item-time">{timeAgo(task.created_at)}</span>
        <button
          onClick={onDelete}
          title="Delete task"
          style={{
            width: 18, height: 18, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: 'var(--l4)',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.12s ease, color 0.12s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--l4)' }}
        >×</button>
      </div>
      <p className="sb-item-goal">{task.goal}</p>
    </div>
  )
}

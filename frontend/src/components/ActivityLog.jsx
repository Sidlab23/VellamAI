import { useEffect, useRef, useState } from 'react'

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

export function useActivityLog() {
  const [entries, setEntries] = useState([])

  function push(level, msg, detail = null) {
    setEntries(prev => [...prev, { id: Date.now() + Math.random(), time: ts(), level, msg, detail }])
  }

  function clear() { setEntries([]) }

  return { entries, push, clear }
}

const LEVEL_CLASS = {
  info:    'al-info',
  success: 'al-success',
  warn:    'al-warn',
  error:   'al-error',
  debug:   'al-debug',
}

const LEVEL_PREFIX = {
  info:    '→',
  success: '✓',
  warn:    '⚠',
  error:   '✗',
  debug:   '·',
}

export function ActivityLog({ entries }) {
  const bottomRef = useRef(null)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  function toggle(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (entries.length === 0) {
    return (
      <div className="al-wrap">
        <div className="al-header">
          <span className="al-title">Activity Log</span>
          <span className="al-badge">0</span>
        </div>
        <div className="al-body">
          <div className="al-empty">No activity yet.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="al-wrap">
      <div className="al-header">
        <span className="al-title">Activity Log</span>
        <span className="al-badge">{entries.length}</span>
      </div>
      <div className="al-body">
        {entries.map(e => (
          <div
            key={e.id}
            className={`al-entry ${LEVEL_CLASS[e.level] || 'al-debug'} ${e.detail ? 'al-entry--expandable' : ''}`}
            onClick={e.detail ? () => toggle(e.id) : undefined}
          >
            <span className="al-time">{e.time}</span>
            <span className="al-prefix">{LEVEL_PREFIX[e.level] || '·'}</span>
            <span className="al-msg">{e.msg}</span>
            {e.detail && <span className="al-chevron">{expanded[e.id] ? '▾' : '▸'}</span>}
            {e.detail && expanded[e.id] && (
              <pre className="al-detail">{e.detail}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

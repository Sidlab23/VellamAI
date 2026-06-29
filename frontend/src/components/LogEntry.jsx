import { useState } from 'react'

function normalizeAction(raw) {
  if (!raw) return 'step'
  const s = raw.toLowerCase()
  if (s.includes('gotourl') || s.includes('navigate') || s.includes('openurl') || s.includes('tab')) return 'navigate'
  if (s.includes('search') || s.includes('google')) return 'search'
  if (s.includes('click') || s.includes('element')) return 'click'
  if (s.includes('input') || s.includes('type') || s.includes('fill')) return 'type'
  if (s.includes('extract') || s.includes('content') || s.includes('scrape')) return 'extract'
  if (s.includes('scroll')) return 'scroll'
  if (s.includes('wait')) return 'wait'
  if (s.includes('done') || s.includes('finish')) return 'done'
  if (s.includes('approval') || s.includes('ask')) return 'ask_approval'
  if (s.includes('think') || s.includes('reason')) return 'think'
  return raw
}

const ACTION_ICON = {
  navigate:     '→',
  search:       '◎',
  click:        '●',
  type:         '—',
  extract:      '≡',
  scroll:       '↕',
  wait:         '·',
  think:        '◌',
  ask_approval: '!',
  done:         '✓',
  browsing:     '○',
  step:         '·',
}

const ACTION_COLOR = {
  navigate:     '#818cf8',
  search:       '#60a5fa',
  click:        '#c084fc',
  type:         '#a78bfa',
  extract:      '#34d399',
  scroll:       '#94a3b8',
  done:         '#34d399',
  ask_approval: '#fbbf24',
  think:        '#64748b',
}

export function LogEntry({ log }) {
  const [open, setOpen] = useState(false)
  const normalized = normalizeAction(log.action)
  const icon  = ACTION_ICON[normalized] || '·'
  const color = ACTION_COLOR[normalized] || 'rgba(255,255,255,0.25)'
  const thought  = log.thought || log.reasoning || ''
  const isStub   = log.observation?.includes('[Browser not yet connected')

  return (
    <div style={{borderBottom: '1px solid rgba(255,255,255,0.035)'}}>
      {/* Row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors"
        style={{background: 'transparent'}}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.018)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{
          fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
          color: 'rgba(255,255,255,0.2)', width: 28, flexShrink: 0, textAlign: 'right',
        }}>
          #{log.step}
        </span>
        <span style={{
          fontSize: 13, color, width: 16, flexShrink: 0, textAlign: 'center',
          fontWeight: 700, lineHeight: 1,
        }}>
          {icon}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
          width: 62, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {normalized.replace(/_/g, ' ')}
        </span>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.28)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {thought ? thought.split('\n')[0].slice(0, 72) : ''}
        </span>
        {log.requires_approval && <span className="chip-amber" style={{fontSize: 9}}>approval</span>}
        {isStub && <span className="chip-gray" style={{fontSize: 9}}>stub</span>}
        <span style={{fontSize: 9, color: 'rgba(255,255,255,0.18)', flexShrink: 0}}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 space-y-3" style={{background: 'rgba(0,0,0,0.2)'}}>
          {thought && (
            <div>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', display: 'block', marginBottom: 4,
              }}>Thought</span>
              <p style={{fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7}}>{thought}</p>
            </div>
          )}
          {log.action_input && Object.keys(log.action_input).length > 0 && (
            <div>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', display: 'block', marginBottom: 4,
              }}>Input</span>
              <pre style={{
                fontSize: 11, color: 'rgba(255,255,255,0.4)',
                background: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: '10px 14px',
                overflow: 'auto', border: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7, margin: 0,
              }}>
                {JSON.stringify(log.action_input, null, 2)}
              </pre>
            </div>
          )}
          {log.observation && (
            <div>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'rgba(255,255,255,0.2)', display: 'block', marginBottom: 4,
              }}>Observation</span>
              <p style={{
                fontSize: 12, lineHeight: 1.7,
                color: isStub ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)',
                fontStyle: isStub ? 'italic' : 'normal',
              }}>
                {log.observation}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

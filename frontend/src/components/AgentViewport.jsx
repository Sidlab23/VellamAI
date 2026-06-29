import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'

const ACTIVE = new Set(['pending', 'planning', 'running'])

export function AgentViewport({ selectedTaskId, selectedTask }) {
  const [screenshot, setScreenshot] = useState(null)
  const intervalRef = useRef(null)

  const isActive = selectedTask && ACTIVE.has(selectedTask.status)

  // Live feed: poll at 1s while the agent is active, 4s otherwise.
  // The backend captures the browser ~1×/s independent of agent steps.
  useEffect(() => {
    clearInterval(intervalRef.current)
    setScreenshot(null)
    if (!selectedTaskId) return

    async function poll() {
      try {
        const data = await api.getScreenshot(selectedTaskId)
        if (data.screenshot) setScreenshot(data.screenshot)
      } catch {}
    }

    poll()
    intervalRef.current = setInterval(poll, isActive ? 1000 : 4000)
    return () => clearInterval(intervalRef.current)
  }, [selectedTaskId, isActive])

  return (
    // viewport--live: on phones the panel is hidden until a feed exists,
    // then docks at the bottom of the screen (see RESPONSIVE in index.css)
    <div className={`viewport${screenshot ? ' viewport--live' : ''}`}>
      <div className="vp-header">
        <span className="vp-title">Live browser</span>
        {isActive && screenshot && (
          <span className="vp-status">
            <span className="live-dot" />
            Live
          </span>
        )}
        {isActive && !screenshot && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--l3)' }}>
            <span className="spinner spinner-sm" />
            Connecting
          </span>
        )}
        {!isActive && selectedTaskId && selectedTask?.status === 'completed' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--green)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            Completed
          </span>
        )}
      </div>

      <div className="vp-content">
        <AnimatePresence mode="wait">
          {screenshot ? (
            <motion.div
              key="screenshot"
              className="vp-frame"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <img
                src={`data:image/jpeg;base64,${screenshot}`}
                alt="Live browser session"
                className="vp-img"
              />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              className="vp-idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="vp-idle-title">
                {!selectedTaskId
                  ? 'No active session'
                  : isActive
                  ? 'Opening browser'
                  : selectedTask?.status === 'failed'
                  ? 'Session failed'
                  : 'Session ended'}
              </div>
              <div className="vp-idle-sub">
                {!selectedTaskId
                  ? 'Start a task and a live view of the browser will appear here.'
                  : isActive
                  ? 'The live feed will begin once the agent starts navigating.'
                  : selectedTask?.status === 'failed'
                  ? 'The agent stopped before completing this task. See the conversation for details.'
                  : 'No browser activity was recorded for this session.'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

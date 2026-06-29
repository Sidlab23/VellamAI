import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export function BrowserPreview({ selectedTaskId }) {
  const [screenshot, setScreenshot] = useState(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    clearInterval(intervalRef.current)
    setScreenshot(null)
    if (!selectedTaskId) return

    async function poll() {
      try {
        const data = await api.getScreenshot(selectedTaskId)
        if (data.screenshot) setScreenshot(data.screenshot)
        else setScreenshot(null)
      } catch {}
    }

    poll()
    intervalRef.current = setInterval(poll, 2500)
    return () => clearInterval(intervalRef.current)
  }, [selectedTaskId])

  return (
    <div className="browser-preview">
      <div className="browser-preview-header">
        <span className="browser-preview-title">Browser</span>
        {screenshot && (
          <span className="browser-preview-live">
            <span className="live-dot" />
            Active
          </span>
        )}
      </div>
      <div className="browser-preview-content">
        {screenshot ? (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Browser session"
            className="browser-preview-img"
          />
        ) : (
          <div className="browser-preview-idle">
            {selectedTaskId
              ? <span>No active session</span>
              : <span>Select a task to see browser</span>
            }
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'

/**
 * Subscribe to real-time events for a task via WebSocket.
 * Falls back gracefully if connection fails.
 *
 * Returns: { events, connected, lastEvent }
 */
export function useTaskSocket(taskId, onEvent) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState([])
  const wsRef = useRef(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (!taskId) return
    if (wsRef.current) {
      wsRef.current.close()
    }

    const ws = new WebSocket(api.taskWsUrl(taskId))
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        setEvents((prev) => [...prev, msg])
        if (onEventRef.current) onEventRef.current(msg)
      } catch {
        // ignore malformed
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = () => {
      setConnected(false)
    }
  }, [taskId])

  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  // Ping every 25s to keep connection alive
  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25000)
    return () => clearInterval(id)
  }, [connected])

  return { events, connected }
}

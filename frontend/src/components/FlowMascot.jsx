import { useState, useEffect, useRef } from 'react'

// Vellam — a small RED wizard critter above the composer. Smooth pointy hat, big
// expressive eyes, a little smile (no beard). He greets, blinks/bobs while idle,
// reacts to the agent, and slides left→right along a rail as the task progresses —
// a rudimentary progress bar. Purely cosmetic — inline SVG, no assets.

const BODY  = '#e5392f'   // bright red body
const HAT   = '#6f4a2a'   // brown pointy hat + feet
const EYE   = '#fff2ee'   // eye white
const PUPIL = '#3a0f0f'   // dark pupil
const GLINT = '#ffffff'   // sparkle in the eye
const MOUTH = '#4a1010'   // smile

// 16×20 grid for the BODY + feet only — the hat is a smooth vector path drawn on
// top. B = body, S = foot shade. Rounded and beardless.
const GRID = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '...BBBBBBBBBB...',
  '....BBBBBBBB....',
  '...BB......BB...',
  '...SS......SS...',
]

const FILL = { B: BODY, S: HAT }

function bodyRects() {
  const rects = []
  GRID.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const f = FILL[row[x]]
      if (f) rects.push(<rect key={`b${x}-${y}`} x={x} y={y} width="1" height="1" fill={f} />)
    }
  })
  return rects
}

// A plain straight isosceles triangle hat (apex centred over the face), plus a soft
// brim. geometricPrecision keeps the edges clean.
function hat() {
  return (
    <g shapeRendering="geometricPrecision">
      <path d="M 7.5 0 L 13 9.1 L 2 9.1 Z" fill={HAT} />
      <ellipse cx="7.5" cy="9.3" rx="6.8" ry="1.1" fill={HAT} />
    </g>
  )
}

// A small, cute smile just below the eyes.
function smile() {
  return (
    <g shapeRendering="geometricPrecision" fill={MOUTH}>
      <rect x="6"   y="14.3" width="1"   height="1"    rx="0.45" />
      <rect x="9"   y="14.3" width="1"   height="1"    rx="0.45" />
      <rect x="6.8" y="15"   width="2.4" height="0.95" rx="0.47" />
    </g>
  )
}

// One big 3×3 eye at (ox,oy), expression-aware. `side` flips the pupil so the pair
// looks toward the centre.
function eye(ox, oy, side, state) {
  const r = []
  const add = (x, y, fill) => r.push(<rect key={`e${ox}-${r.length}`} x={x} y={y} width="1" height="1" fill={fill} />)

  if (state === 'blink') {
    add(ox, oy + 1, PUPIL); add(ox + 1, oy + 1, PUPIL); add(ox + 2, oy + 1, PUPIL)
    return r
  }
  if (state === 'happy') {
    // upward squint  ∧
    add(ox, oy + 1, PUPIL); add(ox + 1, oy, PUPIL); add(ox + 2, oy + 1, PUPIL)
    return r
  }
  // open / sad — 3×3 white with a 2×2 pupil (and a glint when open)
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) add(ox + dx, oy + dy, EYE)
  const prow = state === 'sad' ? oy : oy + 1
  const pcol = side === 'left' ? ox + 1 : ox
  add(pcol, prow, PUPIL); add(pcol + 1, prow, PUPIL)
  add(pcol, prow + 1, PUPIL); add(pcol + 1, prow + 1, PUPIL)
  if (state !== 'sad') add(pcol + 1, prow, GLINT) // sparkle
  return r
}

const GREETINGS = [
  "Hi, I'm Vellam AI",
  "Tell me what to do and I'll handle the browsing.",
  "I can shop, compare, and check out for you.",
  "Beep boop — ready when you are.",
]

const STARTED = new Set(['planning', 'running'])
const WAITING = new Set(['waiting_otp', 'waiting_credentials', 'waiting_input'])

export function FlowMascot({ status, taskId, progress = 0 }) {
  const [bubble,   setBubble]   = useState(null)
  const [eyeState, setEyeState] = useState('open')

  const hideTimer = useRef(null)
  const lineIdx   = useRef(0)
  const prev      = useRef({ status: undefined, taskId: undefined })

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Show a line for `ms`, optionally with an expression, then settle back to idle.
  function say(text, ms = 3600, expr = null) {
    setBubble(text)
    if (expr) setEyeState(expr)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { setBubble(null); setEyeState('open') }, ms)
  }

  // Show a line that stays put until the agent moves on (no auto-hide). Used while
  // the agent is blocked waiting for the user (OTP / sign-in / a question) so the
  // "need you here" nudge can't be missed — it lasts the whole wait, not a few seconds.
  function sayUntilResolved(text, expr = null) {
    clearTimeout(hideTimer.current)
    setBubble(text)
    if (expr) setEyeState(expr)
  }

  // Drop whatever the mascot is currently saying.
  function hush() {
    clearTimeout(hideTimer.current)
    setBubble(null)
    setEyeState('open')
  }

  function handleClick() {
    const text = GREETINGS[lineIdx.current % GREETINGS.length]
    lineIdx.current += 1
    say(text)
  }

  // Auto-greet once shortly after mount.
  useEffect(() => {
    const t = setTimeout(() => say(GREETINGS[0], 4000), 600)
    lineIdx.current = 1
    return () => { clearTimeout(t); clearTimeout(hideTimer.current) }
  }, [])

  // Occasional blink (skipped when the user prefers reduced motion).
  useEffect(() => {
    if (reduceMotion) return
    const id = setInterval(() => {
      setEyeState(s => (s === 'open' ? 'blink' : s))
      setTimeout(() => setEyeState(s => (s === 'blink' ? 'open' : s)), 150)
    }, 4200)
    return () => clearInterval(id)
  }, [reduceMotion])

  // React to the agent — only on a real status change of the SAME task, never on
  // first mount or when switching to an already-finished task.
  useEffect(() => {
    const p = prev.current
    prev.current = { status, taskId }
    if (p.taskId !== taskId || p.status === undefined || p.status === status) return
    if (STARTED.has(status))         say('On it! 🪄', 2800)
    else if (status === 'completed') say('Done! 🎉', 4200, 'happy')
    else if (status === 'failed')    say("Hmm, that didn't work 😕", 4200, 'sad')
    // Blocked on the user: keep the nudge up until the agent resumes or the run ends.
    else if (WAITING.has(status))    sayUntilResolved('Need you here 👀')
    // Left a waiting state for an idle one (e.g. cancelled) — clear the lingering nudge.
    else if (WAITING.has(p.status))  hush()
  }, [status, taskId])

  // 0..1 — how far along the run is; drives the slide + rail fill.
  const pct = Math.max(0, Math.min(1, progress))

  return (
    <div className="mascot mascot-track">
      {pct > 0 && (
        <div className="mascot-rail">
          <div className="mascot-rail-fill" style={{ width: `calc(${pct} * 100%)` }} />
        </div>
      )}

      <div className="mascot-mover" style={{ left: `calc(${pct} * (100% - 44px))` }}>
        <button
          className="mascot-sprite"
          onClick={handleClick}
          aria-label="Vellam AI mascot"
          title="Vellam AI"
        >
          <svg className="mascot-svg" viewBox="0 0 16 20" shapeRendering="crispEdges" aria-hidden="true">
            {bodyRects()}
            {hat()}
            {eye(3, 11, 'left', eyeState)}
            {eye(10, 11, 'right', eyeState)}
            {smile()}
          </svg>
        </button>
      </div>

      {/* Bubble lives on the full-width track (not the narrow mover) so it lays out
          horizontally instead of wrapping into a tall sliver. */}
      {bubble && <div className="mascot-bubble" role="status">{bubble}</div>}
    </div>
  )
}

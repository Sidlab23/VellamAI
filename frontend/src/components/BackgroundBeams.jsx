import { useEffect, useRef } from 'react'

const LAYERS = 3
const BEAMS_PER_LAYER = 8

function createBeam(width, height, layer) {
  return {
    x:          Math.random() * width,
    y:          Math.random() * height,
    width:      10 + layer * 5,
    length:     height * 2.5,
    angle:      -35 + Math.random() * 10,
    speed:      0.2 + layer * 0.2 + Math.random() * 0.2,
    opacity:    0.07 + layer * 0.045 + Math.random() * 0.08,
    pulse:      Math.random() * Math.PI * 2,
    pulseSpeed: 0.01 + Math.random() * 0.015,
    layer,
  }
}

export function BackgroundBeams() {
  const beamCanvasRef  = useRef(null)
  const noiseCanvasRef = useRef(null)
  const beamsRef       = useRef([])
  const rafRef         = useRef(0)

  useEffect(() => {
    const beamCanvas  = beamCanvasRef.current
    const noiseCanvas = noiseCanvasRef.current
    if (!beamCanvas || !noiseCanvas) return
    const ctx  = beamCanvas.getContext('2d')
    const nCtx = noiseCanvas.getContext('2d')
    if (!ctx || !nCtx) return

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight

      beamCanvas.width  = w * dpr
      beamCanvas.height = h * dpr
      beamCanvas.style.width  = `${w}px`
      beamCanvas.style.height = `${h}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)

      noiseCanvas.width  = w * dpr
      noiseCanvas.height = h * dpr
      noiseCanvas.style.width  = `${w}px`
      noiseCanvas.style.height = `${h}px`
      nCtx.setTransform(1, 0, 0, 1, 0, 0)
      nCtx.scale(dpr, dpr)

      beamsRef.current = []
      for (let layer = 1; layer <= LAYERS; layer++) {
        for (let i = 0; i < BEAMS_PER_LAYER; i++) {
          beamsRef.current.push(createBeam(w, h, layer))
        }
      }
    }

    resize()
    window.addEventListener('resize', resize)

    function generateNoise() {
      const w = noiseCanvas.width
      const h = noiseCanvas.height
      const img = nCtx.createImageData(w, h)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255
        img.data[i]     = v
        img.data[i + 1] = v
        img.data[i + 2] = v
        img.data[i + 3] = 10   // very subtle grain
      }
      nCtx.putImageData(img, 0, 0)
    }

    function drawBeam(beam) {
      ctx.save()
      ctx.translate(beam.x, beam.y)
      ctx.rotate((beam.angle * Math.PI) / 180)

      const op = Math.min(1, beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.4))
      const g  = ctx.createLinearGradient(0, 0, 0, beam.length)
      g.addColorStop(0,   `rgba(0,200,255,0)`)
      g.addColorStop(0.2, `rgba(0,200,255,${(op * 0.5).toFixed(3)})`)
      g.addColorStop(0.5, `rgba(0,200,255,${op.toFixed(3)})`)
      g.addColorStop(0.8, `rgba(0,200,255,${(op * 0.5).toFixed(3)})`)
      g.addColorStop(1,   `rgba(0,200,255,0)`)

      ctx.fillStyle = g
      ctx.filter    = `blur(${2 + beam.layer * 2}px)`
      ctx.fillRect(-beam.width / 2, 0, beam.width, beam.length)
      ctx.restore()
    }

    let frame = 0

    function animate() {
      frame++
      const h = window.innerHeight

      // Transparent clear — CSS body provides the background colour
      ctx.clearRect(0, 0, beamCanvas.width, beamCanvas.height)

      beamsRef.current.forEach(beam => {
        beam.y -= beam.speed * (beam.layer / LAYERS + 0.5)
        beam.pulse += beam.pulseSpeed
        if (beam.y + beam.length < -50) {
          beam.y = h + 50
          beam.x = Math.random() * window.innerWidth
        }
        drawBeam(beam)
      })

      // Throttle noise — every 3rd frame is plenty, saves lots of CPU
      if (frame % 3 === 0) generateNoise()

      rafRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <>
      {/* Beam canvas — renders the diagonal light streaks */}
      <canvas
        ref={beamCanvasRef}
        style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }}
      />
      {/* Noise canvas — sits on top of beams for grain texture */}
      <canvas
        ref={noiseCanvasRef}
        style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', mixBlendMode: 'overlay' }}
      />
    </>
  )
}

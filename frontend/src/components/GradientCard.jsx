import { useRef, useState } from 'react'
import { motion } from 'framer-motion'

export function GradientCard({ children }) {
  const cardRef = useRef(null)
  const [isHovered, setIsHovered] = useState(false)
  const [rotation, setRotation] = useState({ x: 0, y: 0 })

  function handleMouseMove(e) {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    setRotation({
      x: -(y / rect.height) * 3,
      y:  (x / rect.width)  * 3,
    })
  }

  function handleMouseLeave() {
    setIsHovered(false)
    setRotation({ x: 0, y: 0 })
  }

  return (
    <div style={{ perspective: '1200px' }}>
      <motion.div
        ref={cardRef}
        style={{
          position: 'relative',
          borderRadius: '14px',
          overflow: 'hidden',
          backgroundColor: '#111118',
          border: '1px solid rgba(255,255,255,0.07)',
          transformStyle: 'preserve-3d',
          boxShadow: '-8px 0 80px 8px rgba(78,99,255,0.07), 0 0 8px rgba(0,0,0,0.5)',
          willChange: 'transform',
        }}
        animate={{
          y: isHovered ? -4 : 0,
          rotateX: rotation.x,
          rotateY: rotation.y,
        }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >

        {/* Glass reflection — top-left catch-light */}
        <motion.div
          style={{
            position: 'absolute', inset: 0, zIndex: 35, pointerEvents: 'none',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 78%, rgba(255,255,255,0.025) 100%)',
          }}
          animate={{ opacity: isHovered ? 0.85 : 0.5 }}
          transition={{ duration: 0.35 }}
        />

        {/* Noise texture — adds grain depth */}
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
            opacity: 0.25, mixBlendMode: 'overlay',
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Purple / cyan bottom glow */}
        <motion.div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%',
            zIndex: 2, pointerEvents: 'none',
            background: `
              radial-gradient(ellipse at bottom right, rgba(172,92,255,0.22) -10%, rgba(79,70,229,0) 65%),
              radial-gradient(ellipse at bottom left,  rgba(56,189,248,0.18) -10%, rgba(79,70,229,0) 65%)
            `,
            filter: 'blur(30px)',
          }}
          animate={{ opacity: isHovered ? 0.85 : 0.6 }}
          transition={{ duration: 0.35 }}
        />

        {/* Central deep-purple bloom */}
        <motion.div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
            zIndex: 2, pointerEvents: 'none',
            background: 'radial-gradient(circle at bottom center, rgba(161,58,229,0.2) -20%, rgba(79,70,229,0) 55%)',
            filter: 'blur(34px)',
          }}
          animate={{ opacity: isHovered ? 0.75 : 0.5, y: isHovered ? '8%' : '12%' }}
          transition={{ duration: 0.35 }}
        />

        {/* Bottom edge glow line */}
        <motion.div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px',
            zIndex: 25, pointerEvents: 'none',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0.02) 100%)',
          }}
          animate={{
            boxShadow: isHovered
              ? '0 0 18px 4px rgba(172,92,255,0.35), 0 0 28px 6px rgba(138,58,185,0.25), 0 0 38px 8px rgba(56,189,248,0.18)'
              : '0 0 12px 3px rgba(172,92,255,0.28), 0 0 22px 5px rgba(138,58,185,0.2),  0 0 32px 7px rgba(56,189,248,0.14)',
            opacity: isHovered ? 0.9 : 0.7,
          }}
          transition={{ duration: 0.35 }}
        />

        {/* Left corner edge */}
        <motion.div
          style={{
            position: 'absolute', bottom: 0, left: 0, width: '1px', height: '28%',
            zIndex: 25, pointerEvents: 'none',
            background: 'linear-gradient(to top, rgba(255,255,255,0.55), transparent)',
          }}
          animate={{ opacity: isHovered ? 0.9 : 0.65 }}
          transition={{ duration: 0.35 }}
        />

        {/* Right corner edge */}
        <motion.div
          style={{
            position: 'absolute', bottom: 0, right: 0, width: '1px', height: '28%',
            zIndex: 25, pointerEvents: 'none',
            background: 'linear-gradient(to top, rgba(255,255,255,0.55), transparent)',
          }}
          animate={{ opacity: isHovered ? 0.9 : 0.65 }}
          transition={{ duration: 0.35 }}
        />

        {/* Card content — above all gradients */}
        <div style={{ position: 'relative', zIndex: 40 }}>
          {children}
        </div>
      </motion.div>
    </div>
  )
}

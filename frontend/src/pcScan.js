// Client-side "best model for your PC".
//
// Works whenever Ollama is reachable from the browser — no backend needed — so the
// efficiency scores and recommendation still show even when the FastAPI backend is
// down. Mirrors backend app/services/system_service.py scoring. The backend path
// (GET /health/system) is still preferred when available because it reads real RAM
// (psutil) and VRAM (nvidia-smi); this is the fallback.

const OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags'
const EMBED_RE = /embed/i
const PARAM_RE = /(\d+(?:\.\d+)?)\s*b/i

function detectGpuRaw() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return null
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || null
  } catch {
    return null
  }
}

// Chrome reports e.g. "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)"
function cleanGpuName(raw) {
  if (!raw) return null
  let s = String(raw)
  // Software/fallback renderers can't identify the real GPU — treat as unknown.
  if (/swiftshader|llvmpipe|software|microsoft basic|subzero|paravirtual/i.test(s)) return null
  const m = s.match(/ANGLE \(([^,]+),\s*(.+?)(?:\s+Direct3D|\s+\(0x|\s+vs_|,|\))/i)
  if (m) s = m[2]
  s = s
    .replace(/\s*\(0x[0-9a-f]+\)/i, '')
    .replace(/\s+Direct3D.*$/i, '')
    .replace(/\s+vs_\d.*$/i, '')
    .replace(/\s*\([^)]*$/, '') // drop a dangling " (..." with no closing paren
    .trim()
  return s || null
}

// Best-effort VRAM (GB) for common GPUs — the browser can't read it directly.
const GPU_VRAM = [
  [/RTX\s*(40|50)90/i, 24], [/RTX\s*4080/i, 16], [/RTX\s*4070/i, 12],
  [/RTX\s*4060\s*ti/i, 8], [/RTX\s*4060/i, 8],
  [/RTX\s*3090/i, 24], [/RTX\s*3080\s*ti/i, 12], [/RTX\s*3080/i, 10], [/RTX\s*3070/i, 8],
  [/RTX\s*3060\s*ti/i, 8], [/RTX\s*3060/i, 12], [/RTX\s*3050/i, 8],
  [/RTX\s*2080/i, 8], [/RTX\s*2070/i, 8], [/RTX\s*2060/i, 6],
  [/GTX\s*1660/i, 6], [/GTX\s*1650/i, 4], [/GTX\s*1080/i, 8], [/GTX\s*1070/i, 8],
  [/GTX\s*1060/i, 6], [/GTX\s*1050\s*ti/i, 4], [/GTX\s*1050/i, 2],
  [/RX\s*7900/i, 20], [/RX\s*7800/i, 16], [/RX\s*7700/i, 12], [/RX\s*6800/i, 16],
  [/RX\s*6700/i, 12], [/RX\s*6600/i, 8], [/RX\s*5700/i, 8], [/RX\s*580/i, 8],
  [/A100/i, 40], [/A6000/i, 48],
]
function vramForGpu(name) {
  if (!name) return null
  for (const [re, gb] of GPU_VRAM) if (re.test(name)) return gb
  if (/RTX|GTX|Radeon|RX\s|Arc|Quadro|Tesla/i.test(name)) return 6 // unknown discrete card
  return null // integrated / unknown — fall back to system RAM
}

export function browserSpecs() {
  const gpu_name = cleanGpuName(detectGpuRaw())
  const dm = navigator.deviceMemory || null // browsers cap this at 8
  return {
    ram_gb: dm,
    ram_capped: dm === 8,
    cpu_cores: navigator.hardwareConcurrency || null,
    gpu_name,
    vram_gb: vramForGpu(gpu_name),
    approximate: true,
  }
}

function ratioScore(r) {
  if (r <= 0.35) return 10
  if (r <= 0.5) return 9
  if (r <= 0.65) return 8
  if (r <= 0.8) return 7
  if (r <= 0.95) return 6
  if (r <= 1.1) return 4
  if (r <= 1.5) return 2
  return 1
}
function tierFor(s) {
  if (s >= 8) return 'Runs great'
  if (s >= 6) return 'Smooth'
  if (s >= 4) return 'Usable'
  return 'Heavy'
}
function scoreModel(requiredGb, specs) {
  const vram = specs.vram_gb
  let ram = specs.ram_gb || 8
  if (specs.ram_capped) ram = Math.max(ram, 16) // deviceMemory hides anything over 8 GB
  const ramUsable = ram * 0.8

  if (vram) {
    if (requiredGb <= vram) { const s = ratioScore(requiredGb / vram); return [s, tierFor(s), true] }
    if (requiredGb <= ramUsable) { const s = Math.min(6, ratioScore(requiredGb / ramUsable)); return [s, tierFor(s), false] }
    return [1, 'Heavy', false]
  }
  if (requiredGb <= ramUsable) { const s = Math.min(7, ratioScore(requiredGb / ramUsable)); return [s, tierFor(s), false] }
  return [1, 'Heavy', false]
}

function paramsB(m) {
  const ps = m.details?.parameter_size || m.name || ''
  const mm = String(ps).match(PARAM_RE)
  return mm ? Math.round(parseFloat(mm[1]) * 10) / 10 : null
}

// Returns { specs, models, recommended } (same shape as GET /health/system) or null
// if Ollama can't be reached / has no chat models.
export async function clientScan() {
  const specs = browserSpecs()
  let raw = []
  try {
    const r = await fetch(OLLAMA_TAGS)
    if (r.ok) raw = (await r.json()).models || []
  } catch {
    /* Ollama unreachable */
  }

  const models = raw
    .map(m => {
      const name = m.name || m.model || ''
      const pb = paramsB(m)
      const sizeGb = (m.size || 0) / 1e9
      const required = (sizeGb || (pb ? pb * 0.7 : 4)) * 1.25
      const [score, tier, on_gpu] = scoreModel(required, specs)
      return { name, params_b: pb, size_gb: Math.round(sizeGb * 10) / 10 || null, score, tier, on_gpu }
    })
    .filter(m => m.name && !EMBED_RE.test(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (!models.length) return null

  const cap = m => (m.params_b || 0) * 100 + (m.size_gb || 0)
  const smooth = models.filter(m => m.score >= 7)
  let recommended
  if (smooth.length) {
    recommended = smooth.reduce((best, m) => (cap(m) > cap(best) ? m : best)).name
  } else {
    recommended = models.reduce((best, m) =>
      (m.score > best.score || (m.score === best.score && (m.size_gb || 0) < (best.size_gb || 0))) ? m : best
    ).name
  }

  return { specs, models, recommended }
}

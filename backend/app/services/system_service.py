"""
Local hardware inspection + Ollama model "efficiency" scoring.

Used by GET /health/system to power the model picker's efficiency column and the
"Best for your PC" recommendation. Everything here is best-effort: if a probe
fails (no GPU, nvidia-smi missing, odd model metadata) we degrade gracefully
rather than raise.
"""

import platform
import re
import shutil
import subprocess

import psutil

from app.core.logging import get_logger

logger = get_logger(__name__)

_EMBED_RE = re.compile(r"embed", re.I)
_PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*b", re.I)

# Quantized weights need roughly this much RAM/VRAM per billion params when the
# on-disk size is unknown (Q4-ish). The disk size, when present, is preferred.
_GB_PER_B = 0.7
# Headroom for the KV cache, context and runtime on top of the weights.
_OVERHEAD = 1.25


def _cpu_name() -> str:
    if platform.system() == "Windows":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            ) as key:
                val, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                if val:
                    return val.strip()
        except Exception:
            pass
    return platform.processor() or platform.machine() or "Unknown CPU"


def _gpu_info() -> tuple[str | None, float | None]:
    """(gpu_name, vram_gb) from nvidia-smi, or (None, None) if unavailable."""
    smi = shutil.which("nvidia-smi")
    if not smi:
        return None, None
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        out = subprocess.run(
            [smi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=flags,
        )
        lines = [l for l in (out.stdout or "").splitlines() if l.strip()]
        if not lines:
            return None, None
        name, mem = lines[0].split(",")
        return name.strip(), round(float(mem.strip()) / 1024, 1)  # MiB -> GB
    except Exception as exc:
        logger.warning("gpu_probe_failed", error=str(exc))
        return None, None


def get_specs() -> dict:
    """RAM / CPU / GPU snapshot. Blocking (psutil + nvidia-smi) — call off-thread."""
    vm = psutil.virtual_memory()
    gpu_name, vram_gb = _gpu_info()
    return {
        "ram_gb": round(vm.total / 1e9, 1),
        "ram_available_gb": round(vm.available / 1e9, 1),
        "cpu_cores": psutil.cpu_count(logical=True) or 0,
        "cpu_name": _cpu_name(),
        "gpu_name": gpu_name,
        "vram_gb": vram_gb,
    }


def _params_b(model: dict) -> float | None:
    ps = (model.get("details") or {}).get("parameter_size") or ""
    m = _PARAM_RE.search(ps) or _PARAM_RE.search(model.get("name", ""))
    return round(float(m.group(1)), 1) if m else None


def _required_gb(model: dict, params_b: float | None) -> float:
    size = model.get("size") or 0
    if size:
        base = size / 1e9
    elif params_b:
        base = params_b * _GB_PER_B
    else:
        base = 4.0  # unknown — assume a mid-size model
    return base * _OVERHEAD


def _ratio_score(r: float) -> int:
    """10 (tons of headroom) down to 1 (won't fit), by required/available ratio."""
    if r <= 0.35:
        return 10
    if r <= 0.5:
        return 9
    if r <= 0.65:
        return 8
    if r <= 0.8:
        return 7
    if r <= 0.95:
        return 6
    if r <= 1.1:
        return 4
    if r <= 1.5:
        return 2
    return 1


def _gpu_score(ratio: float) -> int:
    """GPU-offloaded models — the fast path, so a high floor.

    Ollama offloads layers partially, so the VRAM boundary is soft: a model that
    needs ~all of VRAM still runs mostly on the GPU (measured: a 7B that needs
    ~98% of 6 GB loads 82% onto the GPU at ~21 tok/s). 'ratio' = required / vram.
    """
    if ratio <= 0.5:
        return 10
    if ratio <= 0.7:
        return 9
    if ratio <= 0.85:
        return 8
    return 7  # up to ~1.1x VRAM: the vast majority of layers still fit on the GPU


def _spill_score(ratio: float) -> int:
    """Partial CPU offload — usable but slower. Capped below the GPU floor (7) so a
    mostly-GPU model always outranks one that spills further to CPU. 'ratio' =
    required / usable RAM."""
    if ratio <= 0.45:
        return 5
    if ratio <= 0.6:
        return 4
    if ratio <= 0.8:
        return 3
    return 2


def _tier(s: int) -> str:
    if s >= 8:
        return "Runs great"
    if s >= 6:
        return "Smooth"
    if s >= 4:
        return "Usable"
    return "Heavy"


def _score(required_gb: float, specs: dict) -> tuple[int, str, bool]:
    """Score 1-10 for how smoothly a model of this footprint runs on this PC."""
    vram = specs.get("vram_gb")
    ram = specs.get("ram_gb") or 8.0
    ram_usable = ram * 0.8

    if vram:
        # Soft boundary: Ollama offloads layers partially, so anything up to ~1.1x
        # VRAM still runs the bulk of its layers on the GPU (the fast path).
        if required_gb <= vram * 1.1:
            s = _gpu_score(required_gb / vram)
            return s, _tier(s), True
        if required_gb <= ram_usable:
            # Spills well past VRAM but fits in RAM — partial offload: usable, slower.
            s = _spill_score(required_gb / ram_usable)
            return s, _tier(s), False
        return 1, _tier(1), False

    # CPU-only inference: fine for small models, but no GPU acceleration.
    if required_gb <= ram_usable:
        s = min(7, _ratio_score(required_gb / ram_usable))
        return s, _tier(s), False
    return 1, _tier(1), False


def score_models(models: list[dict], specs: dict) -> list[dict]:
    """Annotate each (non-embedding) Ollama model with an efficiency score."""
    scored: list[dict] = []
    for m in models:
        name = m.get("name") or m.get("model") or ""
        if not name or _EMBED_RE.search(name):
            continue
        pb = _params_b(m)
        req = _required_gb(m, pb)
        s, tier, on_gpu = _score(req, specs)
        scored.append(
            {
                "name": name,
                "params_b": pb,
                "size_gb": round((m.get("size") or 0) / 1e9, 1) or None,
                "score": s,
                "tier": tier,
                "on_gpu": on_gpu,
            }
        )
    scored.sort(key=lambda x: x["name"])
    return scored


def recommend(scored: list[dict]) -> str | None:
    """The most capable model that still runs smoothly; else the best available."""
    if not scored:
        return None

    def capability(m: dict):
        return (m["params_b"] or 0.0, m["size_gb"] or 0.0)

    smooth = [m for m in scored if m["score"] >= 7]
    if smooth:
        return max(smooth, key=capability)["name"]
    # Nothing runs smoothly — pick the best score, breaking ties toward smaller.
    return max(scored, key=lambda m: (m["score"], -(m["size_gb"] or 0.0)))["name"]

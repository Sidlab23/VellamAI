import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

OUT = r"C:\Users\sid21\AppData\Local\Temp\fw_text.png"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1280, "height": 860}, color_scheme="dark")
    pg = ctx.new_page()
    pg.goto("http://localhost:3500", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(1500)
    # sample computed colors of key text
    colors = pg.evaluate(
        """() => {
            const out = {};
            const grab = (sel, key) => { const el = document.querySelector(sel); if (el) out[key] = getComputedStyle(el).color; };
            grab('.cp-agent-name', 'title');
            grab('.cp-agent-desc', 'desc');
            grab('.cp-example-row', 'example');
            grab('.tb-name', 'topbar');
            return out;
        }"""
    )
    print("COMPUTED_COLORS:", colors)
    pg.screenshot(path=OUT)
    print("SCREENSHOT:", OUT)
    b.close()

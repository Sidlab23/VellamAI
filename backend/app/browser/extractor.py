"""
Page content extraction helpers.
All extraction runs as JavaScript inside the page so it works with any site.
"""

from playwright.async_api import Page


async def extract_page_content(page: Page, max_chars: int = 4000) -> str:
    """Extract clean readable text — strips nav, ads, scripts, etc."""
    try:
        content = await page.evaluate("""() => {
            const remove = ['script','style','noscript','nav','footer','header',
                'aside','[class*="cookie"]','[class*="popup"]','[class*="modal"]',
                '[class*="overlay"]','[class*="banner"]','[aria-hidden="true"]',
                '[class*="ad-"]','[id*="ad-"]','[class*="advertisement"]'];
            remove.forEach(s => document.querySelectorAll(s).forEach(e => e.remove()));

            const mains = ['main','article','[role="main"]','#main','#content',
                           '.main-content','.content','.product-detail','.search-results'];
            for (const s of mains) {
                const el = document.querySelector(s);
                if (el) {
                    const t = el.innerText.replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim();
                    if (t.length > 200) return t;
                }
            }
            return document.body.innerText.replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim();
        }""")
        return content[:max_chars]
    except Exception as e:
        return f"[extraction error: {e}]"


async def extract_search_results(page: Page, engine: str = "google") -> str:
    url = page.url.lower()
    if "amazon.com/s" in url or engine == "amazon":
        return await _amazon_listings(page)
    if "google.com/search" in url or engine == "google":
        return await _google_results(page)
    if "duckduckgo.com" in url or engine == "duckduckgo":
        return await _ddg_results(page)
    if "bing.com/search" in url or engine == "bing":
        return await _bing_results(page)
    return await extract_page_content(page)


async def extract_product_listings(page: Page) -> str:
    url = page.url.lower()
    if "amazon.com" in url:
        return await _amazon_listings(page)
    return await _generic_products(page)


# ── Site-specific extractors ──────────────────────────────────────────

async def _google_results(page: Page) -> str:
    try:
        items = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('div.g, div[jscontroller]').forEach(el => {
                const h = el.querySelector('h3');
                const a = el.querySelector('a[href^="http"]');
                const s = el.querySelector('[data-sncf], .VwiC3b, [class*="s3v9rd"]');
                if (h && a) out.push({
                    title: h.innerText.trim(),
                    url: a.href,
                    snippet: s ? s.innerText.trim().slice(0,220) : ''
                });
            });
            return out.filter(r => r.title && r.url).slice(0, 8);
        }""")
        if not items:
            return await extract_page_content(page)
        lines = ["Google results:\n"]
        for i, r in enumerate(items, 1):
            lines += [f"{i}. {r['title']}", f"   {r['url']}"]
            if r["snippet"]:
                lines.append(f"   {r['snippet']}")
            lines.append("")
        return "\n".join(lines)
    except Exception:
        return await extract_page_content(page)


async def _ddg_results(page: Page) -> str:
    try:
        items = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('[data-testid="result"], .result').forEach(el => {
                const t = el.querySelector('h2, [data-testid="result-title-a"]');
                const a = el.querySelector('a[href^="http"]');
                const s = el.querySelector('[data-testid="result-snippet"], .result__snippet');
                if (t) out.push({
                    title: t.innerText.trim(),
                    url: a ? a.href : '',
                    snippet: s ? s.innerText.trim().slice(0,220) : ''
                });
            });
            return out.slice(0, 8);
        }""")
        if not items:
            return await extract_page_content(page)
        lines = ["DuckDuckGo results:\n"]
        for i, r in enumerate(items, 1):
            lines += [f"{i}. {r['title']}", f"   {r['url']}"]
            if r["snippet"]:
                lines.append(f"   {r['snippet']}")
            lines.append("")
        return "\n".join(lines)
    except Exception:
        return await extract_page_content(page)


async def _bing_results(page: Page) -> str:
    try:
        items = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('li.b_algo').forEach(el => {
                const a = el.querySelector('h2 a');
                const s = el.querySelector('.b_caption p');
                if (a) out.push({title: a.innerText.trim(), url: a.href,
                    snippet: s ? s.innerText.trim().slice(0,220) : ''});
            });
            return out.slice(0, 8);
        }""")
        if not items:
            return await extract_page_content(page)
        lines = ["Bing results:\n"]
        for i, r in enumerate(items, 1):
            lines += [f"{i}. {r['title']}", f"   {r['url']}"]
            if r["snippet"]:
                lines.append(f"   {r['snippet']}")
            lines.append("")
        return "\n".join(lines)
    except Exception:
        return await extract_page_content(page)


async def _amazon_listings(page: Page) -> str:
    try:
        products = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll(
                '[data-component-type="s-search-result"][data-asin]'
            ).forEach(card => {
                const asin  = card.getAttribute('data-asin');
                if (!asin || asin === '') return;
                const title   = card.querySelector('h2 span, h2 a span');
                const price   = card.querySelector('.a-price .a-offscreen');
                const rating  = card.querySelector('.a-icon-alt');
                const reviews = card.querySelector('[aria-label*="ratings"],.s-underline-text');
                const link    = card.querySelector('h2 a[href]');
                if (!title) return;
                out.push({
                    title:   title.innerText.trim(),
                    price:   price   ? price.innerText.trim()   : 'N/A',
                    rating:  rating  ? rating.innerText.trim().split(' ')[0] : 'N/A',
                    reviews: reviews ? reviews.innerText.trim() : '',
                    url: link ? 'https://www.amazon.com' + link.getAttribute('href').split('/ref=')[0] : ''
                });
            });
            return out.slice(0, 10);
        }""")
        if not products:
            return await extract_page_content(page)
        lines = ["Amazon listings:\n"]
        for i, p in enumerate(products, 1):
            lines.append(f"{i}. {p['title']}")
            lines.append(f"   Price: {p['price']}  |  Rating: {p['rating']}" + (f"  ({p['reviews']})" if p["reviews"] else ""))
            if p["url"]:
                lines.append(f"   {p['url']}")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"[amazon extraction error: {e}]\n" + await extract_page_content(page)


async def _generic_products(page: Page) -> str:
    try:
        products = await page.evaluate("""() => {
            const selectors = ['[class*="product-card"]','[class*="product-item"]',
                               '[class*="listing-item"]','[data-product-id]'];
            let cards = [];
            for (const s of selectors) {
                cards = [...document.querySelectorAll(s)];
                if (cards.length > 2) break;
            }
            return cards.slice(0,10).map(c => {
                const title = c.querySelector('h2,h3,h4,[class*="title"],[class*="name"]');
                const price = c.querySelector('[class*="price"]');
                return { title: title ? title.innerText.trim() : '',
                         price: price ? price.innerText.trim().slice(0,20) : '' };
            }).filter(p => p.title);
        }""")
        if not products:
            return ""
        lines = ["Products found:\n"]
        for i, p in enumerate(products, 1):
            lines.append(f"{i}. {p['title']}" + (f" — {p['price']}" if p["price"] else ""))
        return "\n".join(lines)
    except Exception:
        return ""

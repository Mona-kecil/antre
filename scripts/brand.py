"""Renders every brand raster in static/ from the mark defined here.

Run: uv run -q --with playwright --with pillow python -I scripts/brand.py
(First run only: uv run -q --with playwright python -m playwright install chromium)
"""

import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

static = Path(sys.argv[0]).resolve().parent.parent / "static"
lime, ink, paper, canvas = "#e4f222", "#0f0f0d", "#ffffff", "#f6f5f2"


def icon(size: int, mark: float, radius: float = 0) -> str:
    """The masthead mark (bars 4 wide, 10/17/13 tall, 2.5 apart) centred on Lime; mark is its share of the side."""
    unit = size * mark / 17
    bars = "".join(
        f'<rect x="{(size - 17 * unit) / 2 + i * 6.5 * unit:g}" y="{(size + 17 * unit) / 2 - h * unit:g}"'
        f' width="{4 * unit:g}" height="{h * unit:g}" rx="{2 * unit:g}"/>'
        for i, h in enumerate((10, 17, 13))
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{size * radius:g}" fill="{lime}"/>'
        f'<g fill="{ink}">{bars}</g></svg>'
    )


agenda = [
    ("09:00", "#4f5bd5", "A calendar shows when. A queue shows what.", "done"),
    ("09:30", "#1d7a3e", "Wrote 400 words, kept 41. The 41 were better.", "done"),
    ("10:00", "#e08a2e", "My whole posting setup fits on one screen.", "now"),
    ("10:30", "#2a9db5", "Write the reply you wish someone sent you.", "fresh"),
    ("11:00", None, "Free", "free"),
    ("11:30", "#4f5bd5", "If the release note needs a paragraph, ship less.", ""),
    ("12:00", None, "Free", "free"),
]
rows = "".join(
    f'<li class="{kind}"><time>{at}</time><span>'
    + (f'<i style="background:{dot}"></i>' if dot else "")
    + f"<b>{text}</b></span></li>"
    + ('<li class="line"><time>10:12</time><hr></li>' if kind == "now" else "")
    for at, dot, text, kind in agenda
)
og = f"""<!doctype html><html><head><style>
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: 1200px; height: 630px; display: grid; grid-template-columns: 1fr 470px; background: {paper}; color: {ink};
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }}
main {{ display: flex; flex-direction: column; justify-content: space-between; padding: 64px 0 64px 72px; }}
.brand {{ display: flex; align-items: end; gap: 12px; font-size: 34px; font-weight: 650; letter-spacing: -0.02em; line-height: 1; }}
.brand svg {{ width: 34px; height: 34px; }}
h1 {{ font-size: 76px; font-weight: 700; line-height: 1.04; letter-spacing: -0.045em; }}
p {{ font-size: 26px; line-height: 1.35; color: #6b6a63; max-width: 22ch; }}
aside {{ background: {canvas}; border-left: 1px solid #e7e6e1; padding: 58px 40px 0; overflow: hidden; }}
h2 {{ font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }}
h2 small {{ margin-left: 8px; font-size: 17px; font-weight: 500; color: #6b6a63; letter-spacing: 0; }}
ul {{ display: grid; gap: 10px; margin-top: 24px; padding: 0; list-style: none; }}
li {{ display: grid; grid-template-columns: 62px 1fr; align-items: center; height: 48px; font-size: 17px; }}
time {{ color: #6b6a63; font-variant-numeric: tabular-nums; }}
li span {{ display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 16px; border: 1px solid #e2e1dc;
  border-radius: 12px; background: {paper}; min-width: 0; }}
li b {{ font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
li i {{ flex: none; width: 10px; height: 10px; border-radius: 50%; }}
.done b {{ color: #6b6a63; }}
.fresh span {{ background: {lime}; border-color: {lime}; }}
.free span {{ border-style: dashed; background: none; color: #a3a29b; }}
.line {{ height: 14px; color: #c62828; }}
.line time {{ color: #c62828; font-weight: 700; font-size: 15px; }}
.line hr {{ border: 0; border-top: 2px solid #c62828; }}
</style></head><body>
<main>
  <div class="brand">{icon(34, 1).replace(f'fill="{lime}"', 'fill="none"')}antre</div>
  <h1>Your agent drafts.<br>You plan the week.</h1>
  <p>The review queue between your agent and your Threads and LinkedIn.</p>
</main>
<aside><h2>Today<small>Thu 29 Oct</small></h2><ul>{rows}</ul></aside>
</body></html>"""

# The tab icon keeps the mark large so it survives 16px; app icons leave the maskable safe zone clear.
(static / "favicon.svg").write_text(icon(32, 0.62, 0.22) + "\n")
shots = {
    "icon-192.png": (icon(192, 0.44), 192, 192),
    "icon-512.png": (icon(512, 0.44), 512, 512),
    "icon-maskable-512.png": (icon(512, 0.36), 512, 512),
    "apple-touch-icon.png": (icon(180, 0.44), 180, 180),
    "og.png": (og, 1200, 630),
}
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, (html, width, height) in shots.items():
        tab = browser.new_page(viewport={"width": width, "height": height})
        tab.set_content(html if html.startswith("<!doctype") else f"<style>*{{margin:0}}svg{{display:block}}</style>{html}")
        tab.screenshot(path=static / name)
        tab.close()
    tab = browser.new_page(viewport={"width": 256, "height": 256})
    tab.set_content(f"<style>*{{margin:0}}svg{{display:block}}</style>{icon(256, 0.62, 0.22)}")
    tab.screenshot(path=static / "favicon.png", omit_background=True)
    browser.close()
with Image.open(static / "favicon.png") as image:
    image.save(static / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
(static / "favicon.png").unlink()
print("wrote", ", ".join(["favicon.svg", "favicon.ico", *shots]))

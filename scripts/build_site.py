"""Bundle the web app into one self-contained HTML file.

    python scripts/build_site.py              # -> _site/index.html (what GitHub Pages serves)
    python scripts/build_site.py --out x.html # custom path
    python scripts/build_site.py --no-csp     # omit the Content-Security-Policy meta tag
    python scripts/build_site.py --artifact   # page-body variant for hosts that supply their own <head>

The page inlines its CSS, fonts, JavaScript (including the vendored GSAP, Lenis and
React Bits ports in web/vendor) and the shared data files, so it makes no network
requests.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
ASSUMPTIONS = ROOT / "planner" / "data" / "assumptions.json"
CASE_STUDY = ROOT / "docs" / "results.json"
VENDOR = ["gsap.min.js", "ScrollTrigger.min.js", "SplitText.min.js", "lenis.js", "rb-waves.js", "rb-text.js"]
FONT_URL = re.compile(r'url\("fonts/([^"]+\.woff)"\)')


def inline_fonts(css: str) -> str:
    def data_uri(m: re.Match) -> str:
        raw = (WEB / "fonts" / m.group(1)).read_bytes()
        return 'url("data:font/woff;base64,' + base64.b64encode(raw).decode() + '")'
    return FONT_URL.sub(data_uri, css)


def script_safe(js: str) -> str:
    """Make text safe inside an inline <script>: only a literal </script can end it early."""
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.IGNORECASE)


IMPORT_ENGINE = re.compile(r"^import\s*\{[\s\S]*?\}\s*from\s*[\"']\./engine\.js[\"'];\s*", re.MULTILINE)


def to_fragment(html: str) -> str:
    """Strip the document skeleton (for hosts that wrap the page themselves) and
    drop the print button, which embedded frames cannot use."""
    title = re.search(r"<title>.*?</title>", html).group(0)
    head = re.search(r"<head>([\s\S]*?)</head>", html).group(1)
    styles = re.search(r"<style>[\s\S]*?</style>", head).group(0)
    body = re.search(r"<body>([\s\S]*?)</body>", html).group(1)
    body = re.sub(r'\s*<button[^>]*id="print-plan"[^>]*>.*?</button>', "", body)
    meta = '<meta name="claude:viewport-fit-sides" content="cover">'
    return f"{title}\n{meta}\n{styles}\n{body}"


def build(out: Path, csp: bool = True, fragment: bool = False) -> Path:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = inline_fonts((WEB / "styles.css").read_text(encoding="utf-8"))
    engine = (WEB / "engine.js").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")

    app, n = IMPORT_ENGINE.subn("", app, count=1)
    if n != 1:
        raise SystemExit("build_site: could not find the engine import in web/app.js")
    # Engine at module top level (it uses `export`); app in its own block scope.
    script = f"{engine}\n\n{{\n{app}\n}}\n"
    data = json.dumps(json.loads(ASSUMPTIONS.read_text(encoding="utf-8")), separators=(",", ":"))
    case = json.loads(CASE_STUDY.read_text(encoding="utf-8")) if CASE_STUDY.exists() else {}
    case_json = json.dumps({k: case[k] for k in ("cost_of_waiting", "fees", "outlook", "social_security") if k in case},
                           separators=(",", ":"))
    vendor = "\n;\n".join((WEB / "vendor" / name).read_text(encoding="utf-8") for name in VENDOR)

    chunks = (("/*STYLES*/", css), ("/*ASSUMPTIONS*/", data.replace("</", "<\\/")),
              ("/*CASESTUDY*/", case_json.replace("</", "<\\/")), ("/*VENDOR*/", script_safe(vendor)),
              ("/*SCRIPTS*/", script_safe(script)))
    for needle, chunk in chunks:
        if needle not in html:
            raise SystemExit(f"build_site: placeholder {needle} missing from web/index.html")
        html = html.replace(needle, chunk)

    if not csp or fragment:
        html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n', "", html)
    if fragment:
        html = to_fragment(html)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=ROOT / "_site" / "index.html")
    p.add_argument("--no-csp", action="store_true")
    p.add_argument("--artifact", action="store_true")
    a = p.parse_args()
    out = build(a.out, csp=not a.no_csp, fragment=a.artifact)
    print(f"built {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

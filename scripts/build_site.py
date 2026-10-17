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
VENDOR = ["gsap.min.js", "ScrollTrigger.min.js", "SplitText.min.js", "lenis.js", "rb-waves.js", "rb-text.js", "rb-ui.js"]
# ES modules in dependency order; each one only imports from modules listed before it.
MODULES = ["engine.js", "ui.js", "pro.js", "planner.js", "home.js", "pages.js", "site.js"]
CASE_KEYS = ("clients", "cost_of_waiting", "fees", "outlook", "social_security")
FONT_URL = re.compile(r'url\("fonts/([^"]+\.woff)"\)')


def inline_fonts(css: str) -> str:
    def data_uri(m: re.Match) -> str:
        raw = (WEB / "fonts" / m.group(1)).read_bytes()
        return 'url("data:font/woff;base64,' + base64.b64encode(raw).decode() + '")'
    return FONT_URL.sub(data_uri, css)


def script_safe(js: str) -> str:
    """Make text safe inside an inline <script>: only a literal </script can end it early."""
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.IGNORECASE)


IMPORT = re.compile(r"^import\s*\{([\s\S]*?)\}\s*from\s*[\"']\./([\w-]+)\.js[\"'];[ \t]*$", re.MULTILINE)
EXPORT = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
UNSUPPORTED_EXPORT = re.compile(r"^export\s+(?:default|\{|\*)", re.MULTILINE)


def bundle(names: list[str]) -> str:
    """A tiny ES-module bundler for this project's own code.

    Each module becomes an IIFE that returns its exports; each `import { a, b as c } from "./m.js"`
    becomes `const { a, b: c } = __m;`. Only named imports and exports declared with
    function/const/let/class are supported, which is all the site uses.
    """
    out = []
    for name in names:
        src = (WEB / name).read_text(encoding="utf-8")
        if UNSUPPORTED_EXPORT.search(src):
            raise SystemExit(f"build_site: {name} uses an export form the bundler doesn't support")
        exports = EXPORT.findall(src)

        def rewrite_import(m: re.Match) -> str:
            dep = m.group(2).replace("-", "_")
            if f"{m.group(2)}.js" not in names[: names.index(name)]:
                raise SystemExit(f"build_site: {name} imports {m.group(2)}.js, which must come earlier in MODULES")
            specs = [p.strip() for p in m.group(1).split(",") if p.strip()]
            fields = ", ".join(s.replace(" as ", ": ") for s in specs)
            return f"const {{ {fields} }} = __{dep};"

        src = IMPORT.sub(rewrite_import, src)
        if re.search(r"^import\s", src, re.MULTILINE):
            raise SystemExit(f"build_site: {name} uses an import form the bundler doesn't support")
        src = re.sub(r"^export\s+", "", src, flags=re.MULTILINE)
        var = "__" + name[:-3].replace("-", "_")
        out.append(f"const {var} = (() => {{\n{src}\nreturn {{ {', '.join(exports)} }};\n}})();")
    return "\n\n".join(out) + "\n"


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
    script = bundle(MODULES)
    data = json.dumps(json.loads(ASSUMPTIONS.read_text(encoding="utf-8")), separators=(",", ":"))
    case = json.loads(CASE_STUDY.read_text(encoding="utf-8")) if CASE_STUDY.exists() else {}
    case_json = json.dumps({k: case[k] for k in CASE_KEYS if k in case},
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

# Security and privacy

- **No data leaves the browser.** The web app computes everything locally. It has no backend, no
  analytics, no cookies and no local storage, and its Content Security Policy blocks all network requests.
- **No secrets.** The project needs no API keys, tokens or credentials, and none are stored in the repository.
- **Everything is bundled.** The page loads nothing from other sites. The third-party JavaScript it uses
  (GSAP, Lenis and ports of React Bits components) and its fonts are checked into `web/vendor/` and
  `web/fonts/` at fixed versions and inlined into the page at build time, so a compromised CDN cannot
  change what visitors run. None of it makes network requests, and the CSP would block any that it tried.
  See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for versions and licenses.
- **Pinned dependencies.** GitHub Actions are pinned to commit SHAs and updated by Dependabot. The Python
  engine depends only on NumPy (and Matplotlib for charts).

## Reporting a problem

Please use GitHub's private vulnerability reporting (the **Security** tab, then **Report a vulnerability**)
rather than opening a public issue.

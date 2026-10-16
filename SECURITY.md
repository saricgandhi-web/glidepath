# Security and privacy

- **No data leaves the browser.** The web app computes everything locally. It has no backend, no
  analytics, no cookies and no local storage, and its Content Security Policy blocks all network requests.
- **No secrets.** The project needs no API keys, tokens or credentials, and none are stored in the repository.
- **Pinned dependencies.** GitHub Actions are pinned to commit SHAs and updated by Dependabot. The web app
  has no third-party JavaScript. The Python engine depends only on NumPy (and Matplotlib for charts).

## Reporting a problem

Please use GitHub's private vulnerability reporting (the **Security** tab, then **Report a vulnerability**)
rather than opening a public issue.

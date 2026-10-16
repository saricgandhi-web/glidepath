# Third-party notices

Glidepath's own code is released under the [MIT License](LICENSE). The web app bundles the following
third-party code and fonts, each under its own license. Full license text is kept at the top of each
vendored file and next to each font.

| Component | Version | Files | License |
|---|---|---|---|
| [GSAP](https://gsap.com) core, ScrollTrigger and SplitText, by GreenSock | 3.15.0 | `web/vendor/gsap.min.js`, `ScrollTrigger.min.js`, `SplitText.min.js` | [GSAP Standard "No Charge" License](https://gsap.com/standard-license) |
| [Lenis](https://github.com/darkroomengineering/lenis), by darkroom.engineering | 1.3.26 | `web/vendor/lenis.js` | MIT |
| Waves, SplitText, ScrollReveal and CountUp from [React Bits](https://github.com/DavidHDev/react-bits), by David Haz | 2026 sources | `web/vendor/rb-waves.js`, `web/vendor/rb-text.js` | MIT + Commons Clause |
| [Geist](https://github.com/vercel/geist-font), by Vercel | 1.800 | `web/fonts/Geist-*.woff` | [SIL Open Font License 1.1](web/fonts/Geist-OFL.txt) |
| [Source Serif 4](https://github.com/adobe-fonts/source-serif), by Adobe | 4.005 | `web/fonts/GlidepathSerif*.woff` | [SIL Open Font License 1.1](web/fonts/GlidepathSerif-OFL.md) |

## Notes

- **GSAP** is free to use, including commercially, under GreenSock's standard license. The minified
  files are unmodified copies of the 3.15.0 release.
- **Lenis** was built from the tagged TypeScript sources by stripping types and module syntax; the
  code is otherwise unchanged.
- **React Bits** components are written for React. They were ported to plain JavaScript for this site:
  the shaders, simulation and animation logic follow the originals, and only the React wrappers were
  replaced. The Commons Clause allows using them as part of an application or website, which is how
  they are used here; it does not allow selling or redistributing the components on their own, so
  please take them from the [original project](https://github.com/DavidHDev/react-bits) rather than
  from this repository if you want to reuse them.
- **Source Serif 4** has the Reserved Font Name "Source". Because the copies here are subset to Latin
  characters (a modification under the license), they are renamed **Glidepath Serif** inside the font
  files and in the stylesheet, as the license requires. Geist has no reserved name and is only subset.

The Python engine's dependencies (NumPy, and Matplotlib for the case-study charts) are installed from
PyPI and are not redistributed here.

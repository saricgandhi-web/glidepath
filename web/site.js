// Entry point: routing between pages, the header and menus, page transitions, smooth
// scrolling and the hero's engraved background.
import { $, RB, ST, animate, gsap, motionOK, redrawCharts, runtime, scrollToY } from "./ui.js";
import { planner, viewFromSlug } from "./planner.js";
import { home, homeIntro } from "./home.js";
import { about, initPages, insights, method } from "./pages.js";

const PAGES = { home, planner, insights, method, about };
const TITLES = {
  home: "Glidepath: a free Monte Carlo retirement planner",
  planner: "Your plan | Glidepath",
  insights: "Insights | Glidepath",
  method: "How it works | Glidepath",
  about: "About | Glidepath",
};

// ---------- routes ----------
// "#/", "#/planner", "#/planner/stress", "#/insights", "#/method", "#/about".
// Single-word hashes from the earlier one-page version still work ("#stress", "#ss", ...).
const LEGACY = { plan: ["planner", "overview"], stress: ["planner", "stress"], spending: ["planner", "spending"], ss: ["planner", "ss"],
  compare: ["planner", "compare"], assumptions: ["planner", "assumptions"], about: ["about"] };
function parseRoute(hash) {
  const h = (hash || "").replace(/^#/, "");
  if (LEGACY[h]) return { page: LEGACY[h][0], view: LEGACY[h][1] };
  const parts = h.replace(/^\//, "").split("/").filter(Boolean);
  const page = parts[0] || "home";
  if (page === "planner") return { page, view: viewFromSlug(parts[1]) || "overview" };
  if (PAGES[page] && page !== "home") return { page };
  return { page: "home" };
}

// ---------- smooth scrolling ----------
if (animate && window.Lenis) {
  try {
    const lenis = new window.Lenis({ autoRaf: false, lerp: 0.12, smoothWheel: true, anchors: false });
    if (ST) lenis.on("scroll", ST.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    runtime.lenis = lenis;
  } catch { runtime.lenis = null; }
}

// ---------- header ----------
const header = $("site-header");
let headerTicking = false;
function updateHeader() {
  headerTicking = false;
  const y = window.scrollY;
  header.classList.toggle("is-scrolled", y > 8);
  // Light or dark text, depending on what the header is floating over.
  const probeY = header.offsetHeight / 2;
  let dark = false;
  for (const n of document.elementsFromPoint(window.innerWidth / 2, probeY)) {
    if (header.contains(n)) continue;
    dark = Boolean(n.closest(".band"));
    break;
  }
  header.classList.toggle("on-dark", dark);
}
const requestHeader = () => { if (!headerTicking) { headerTicking = true; requestAnimationFrame(updateHeader); } };
window.addEventListener("scroll", requestHeader, { passive: true });

const navLinks = [...document.querySelectorAll("[data-route-link]")];
function setNavActive(page, instant) {
  let active = null;
  for (const a of navLinks) {
    const on = a.dataset.routeLink === page;
    if (on) { a.setAttribute("aria-current", "page"); if (a.closest(".site-nav")) active = a; } else a.removeAttribute("aria-current");
  }
  const ind = $("nav-indicator");
  if (!ind) return;
  if (!active || active.offsetParent === null) { if (gsap) gsap.to(ind, { opacity: 0, duration: 0.2 }); else ind.style.opacity = "0"; return; }
  const props = { x: active.offsetLeft, width: active.offsetWidth, opacity: 1 };
  if (animate && !instant) gsap.to(ind, { ...props, duration: 0.5, ease: "power3.out" });
  else if (gsap) gsap.set(ind, props);
}

// ---------- mobile menu ----------
const menu = RB.staggeredMenu?.({
  toggle: $("menu-toggle"), panel: $("sm-panel"), layers: [...document.querySelectorAll(".sm-prelayer")],
  onOpen: () => runtime.lenis?.stop(), onClose: () => runtime.lenis?.start(),
}) || null;
if (!menu) $("menu-toggle")?.addEventListener("click", () => { const p = $("sm-panel"); p.toggleAttribute("data-open"); });

// ---------- magnets ----------
if (motionOK) document.querySelectorAll("[data-magnet]").forEach((w) => RB.magnet?.(w, { padding: 70, strength: 3.2, maxOffset: 14 }));

// ---------- the engraved background in the home hero ----------
try {
  RB.mountWaves?.($("hero-bg"), {
    lineColor: "#2e6b55", accentColor: "#c99a35", spacing: 13, lineWidth: 1, amplitude: 36, scale: 1.4, twist: 0.6,
    speed: motionOK ? 0.2 : 0, rotation: -14, mouseRadius: 200, mouseStrength: 0.9, opacity: 0.75, fade: 0.2,
    lightMode: false, intro: motionOK, clickRipple: motionOK, mouseInteraction: motionOK,
  });
} catch { /* WebGL unavailable: the band keeps its flat color */ }

// ---------- page transitions ----------
let currentPage = null;
let busy = false;
const curtain = $("curtain");
function pageEntrance(page) {
  if (!animate) return;
  const root = $(`page-${page}`);
  const head = root.querySelector(".page-head, .planner-head");
  if (!head) return;
  const h1 = head.querySelector("h1");
  if (h1 && RB.splitText && !h1.dataset.split) {
    h1.dataset.split = "1";
    RB.splitText(h1, { splitType: "words", delay: 60, duration: 1.0, effect: "rise", trigger: "load" });
  }
  gsap.fromTo(head.querySelectorAll("[data-enter]"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08, delay: 0.15 });
}
async function route({ initial = false } = {}) {
  if (busy) return;
  const r = parseRoute(location.hash);
  if (r.page === currentPage) {
    if (r.page === "planner") planner.enter(r.view);
    return;
  }
  busy = true;
  const from = currentPage;
  currentPage = r.page;
  document.title = TITLES[r.page];
  menu?.close();
  if (animate && from && curtain) {
    await gsap.timeline().set(curtain, { display: "block" })
      .fromTo(curtain, { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.42, ease: "power3.inOut" }).then();
  }
  if (from) PAGES[from].leave();
  // Show only the target page (on first load the home page is visible in the markup).
  for (const name of Object.keys(PAGES)) $(`page-${name}`).hidden = name !== r.page;
  const toEl = $(`page-${r.page}`);
  scrollToY(0, { immediate: true });
  runtime.lenis?.resize?.();
  if (r.page === "planner") planner.enter(r.view, { initial });
  else PAGES[r.page].enter({ initial });
  setNavActive(r.page, initial);
  if (ST) ST.refresh();
  redrawCharts(toEl);
  if (animate && from && curtain) {
    gsap.timeline().fromTo(curtain, { scaleY: 1, transformOrigin: "50% 0%" }, { scaleY: 0, duration: 0.55, ease: "power3.inOut" })
      .set(curtain, { display: "none" });
    pageEntrance(r.page);
  }
  if (!initial) toEl.querySelector("h1")?.focus({ preventScroll: true });
  requestHeader();
  busy = false;
  // A link clicked mid-transition: follow it now.
  if (parseRoute(location.hash).page !== currentPage) route();
}
window.addEventListener("hashchange", () => route());

// ---------- resize ----------
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    redrawCharts($(`page-${currentPage}`));
    planner.resize();
    setNavActive(currentPage, true);
    requestHeader();
  }, 150);
});

// ---------- boot ----------
initPages();
document.documentElement.classList.remove("intro");
const start = parseRoute(location.hash);
route({ initial: true });
if (start.page === "home") homeIntro(); else pageEntrance(start.page);
document.fonts?.ready?.then(() => { setNavActive(currentPage, true); ST?.refresh(); });

// Glidepath Pro, as a demo of a business model. The planner stays free; Pro adds the odds map and
// the year-by-year plan. The checkout is a demo: it asks for no payment details and charges
// nothing. Pro switches on for this visit only and is never stored.
import { $, animate, el, gsap, rosette, runtime } from "./ui.js";

export const PRICES = { monthly: 6, yearly: 48 };
export const PRO_FEATURES = {
  map: { name: "Odds map", text: "Your chance of success for every combination of retirement age and savings rate, with the 85% line drawn on." },
  years: { name: "Year-by-year plan", text: "Every year of your plan in one table, from your first contribution to your last withdrawal, with a spreadsheet download." },
};

const state = { on: false, billing: "yearly" };
const listeners = new Set();
export const isPro = () => state.on;
export function onProChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setPro(on) {
  if (state.on === on) return;
  state.on = on;
  document.documentElement.classList.toggle("is-pro", on);
  const badge = $("pro-badge");
  if (badge) badge.hidden = !on;
  syncPricing();
  for (const fn of listeners) fn(on);
}

// ---------- prices ----------
function priceParts(billing) {
  return billing === "yearly"
    ? { amount: `$${PRICES.yearly}`, per: "a year", note: `$${PRICES.yearly / 12} a month, billed yearly` }
    : { amount: `$${PRICES.monthly}`, per: "a month", note: `$${PRICES.monthly * 12} a year, billed monthly` };
}
function syncPricing() {
  const p = priceParts(state.billing);
  document.querySelectorAll("[data-pro-amount]").forEach((n) => { n.textContent = p.amount; });
  document.querySelectorAll("[data-pro-per]").forEach((n) => { n.textContent = p.per; });
  document.querySelectorAll("[data-pro-note]").forEach((n) => { n.textContent = p.note; });
  document.querySelectorAll("[data-billing]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.billing === state.billing)));
  document.querySelectorAll(".pro-cta-off").forEach((n) => { n.hidden = state.on; });
  document.querySelectorAll(".pro-cta-on").forEach((n) => { n.hidden = !state.on; });
}
function setBilling(b) {
  state.billing = b;
  syncPricing();
  if (animate) gsap.fromTo("[data-pro-amount]", { yPercent: 30, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.35, ease: "power3.out" });
}

// ---------- the demo checkout ----------
let afterUnlock = null;
let sealBuilt = false;
function dialog() { return $("checkout"); }
export function openCheckout({ feature = null, then = null } = {}) {
  const d = dialog();
  if (!d) { setPro(true); then?.(); return; }
  afterUnlock = then;
  d.querySelector(".checkout-form").hidden = false;
  d.querySelector(".checkout-done").hidden = true;
  const lead = $("checkout-feature");
  lead.textContent = feature && PRO_FEATURES[feature]
    ? `${PRO_FEATURES[feature].name} is part of Glidepath Pro.`
    : "Pro adds two planning tools to the free planner.";
  for (const r of d.querySelectorAll("input[name=billing]")) r.checked = r.value === state.billing;
  syncPricing();
  runtime.lenis?.stop();
  d.showModal();
  if (animate) {
    gsap.fromTo(d, { autoAlpha: 0, y: 24, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" });
  }
  $("checkout-confirm").focus();
}
function closeCheckout() {
  const d = dialog();
  if (!d.open) return;
  const finish = () => { d.close(); };
  if (animate) gsap.to(d, { autoAlpha: 0, y: 16, duration: 0.25, ease: "power2.in", onComplete: finish });
  else finish();
}
function confirmCheckout() {
  const d = dialog();
  const picked = d.querySelector("input[name=billing]:checked");
  if (picked) state.billing = picked.value;
  setPro(true);
  d.querySelector(".checkout-form").hidden = true;
  const done = d.querySelector(".checkout-done");
  done.hidden = false;
  const seal = $("checkout-seal");
  if (!sealBuilt) { rosette(seal, { size: 200, rings: [[0.92, 0.045, 14, 12], [0.74, 0.05, 10, 10]] }); sealBuilt = true; }
  $("checkout-done-plan").textContent = `Pro (demo), ${priceParts(state.billing).amount} ${priceParts(state.billing).per}. Nothing was charged.`;
  if (animate) {
    const paths = seal.querySelectorAll("path");
    gsap.timeline()
      .fromTo(".checkout-stamp", { scale: 1.6, rotate: -14, autoAlpha: 0 }, { scale: 1, rotate: -6, autoAlpha: 1, duration: 0.5, ease: "back.out(2.2)" })
      .fromTo(paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut", stagger: 0.01 }, 0)
      .fromTo(".checkout-done > :not(.checkout-stamp)", { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06 }, 0.3);
  }
  $("checkout-continue").focus();
}

export function initPro() {
  const d = dialog();
  if (d) {
    $("checkout-confirm").addEventListener("click", confirmCheckout);
    $("checkout-cancel").addEventListener("click", closeCheckout);
    $("checkout-continue").addEventListener("click", () => {
      const then = afterUnlock;
      afterUnlock = null;
      closeCheckout();
      then?.();
    });
    d.addEventListener("cancel", (e) => { e.preventDefault(); closeCheckout(); });
    d.addEventListener("close", () => runtime.lenis?.start());
    d.addEventListener("click", (e) => { if (e.target === d) closeCheckout(); });
    d.querySelectorAll("input[name=billing]").forEach((r) => r.addEventListener("change", () => { state.billing = r.value; syncPricing(); }));
  }
  document.querySelectorAll("[data-billing]").forEach((b) => b.addEventListener("click", () => setBilling(b.dataset.billing)));
  document.addEventListener("click", (e) => {
    const unlock = e.target.closest("[data-unlock-pro]");
    if (unlock) {
      e.preventDefault();
      const feature = unlock.dataset.unlockPro || null;
      const target = unlock.dataset.then;
      openCheckout({ feature, then: target ? () => { location.hash = target; } : null });
      return;
    }
    if (e.target.closest("[data-pro-off]")) { e.preventDefault(); setPro(false); }
  });
  syncPricing();
}

// ---------- the pricing page ----------
export const pricing = {
  enter() {
    syncPricing();
    if (!animate) return;
    gsap.fromTo("#page-pricing .plan-card", { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.1, delay: 0.2 });
  },
  leave() {},
};

// A blurred stand-in for a locked view, drawn from a made-up pattern rather than real numbers.
export function lockPreview(kind) {
  const wrap = el("div", { class: `lock-preview lock-${kind}`, "aria-hidden": "true" });
  if (kind === "map") {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 11; c++) {
        const v = (c + (8 - r) * 1.2) / 20;
        const step = Math.max(0, Math.min(6, Math.floor(v * 7)));
        wrap.append(el("span", { class: "lp-cell", "data-step": step }));
      }
    }
  } else {
    for (let r = 0; r < 9; r++) {
      const row = el("div", { class: "lp-row" });
      for (let c = 0; c < 6; c++) row.append(el("span", { style: `width:${40 + ((r * 7 + c * 13) % 45)}%` }));
      wrap.append(row);
    }
  }
  return wrap;
}

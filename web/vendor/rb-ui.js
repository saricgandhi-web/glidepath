/*!
 * Magnet, SpotlightCard, ScrollVelocity, SplitFlapText, Counter, CircularText, ScrubField and
 * StaggeredMenu from React Bits (https://reactbits.dev, https://github.com/DavidHDev/react-bits),
 * ported from React to plain JavaScript for Glidepath. Each function takes a DOM element and
 * follows the original's behavior; Motion springs were replaced by small spring integrators or
 * GSAP tweens, and options the site doesn't use were dropped. Requires GSAP.
 *
 * MIT + Commons Clause License Condition v1.0
 *
 * Copyright (c) 2026 David Haz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * ## Commons Clause Restriction
 *
 * You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
 *
 * ## No Warranty
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function () {
  "use strict";
  const gsap = window.gsap;
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (v, b) => ((v % b) + b) % b;
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // A damped spring as an easing curve (Motion's "bounce" maps to damping ratio 1 - bounce).
  function springEase(bounce = 0.2) {
    const zeta = clamp(1 - bounce, 0.05, 1);
    const omega = 6.5 / zeta;
    const wd = omega * Math.sqrt(Math.max(1 - zeta * zeta, 1e-6));
    return (t) => {
      if (t >= 1) return 1;
      const e = Math.exp(-zeta * omega * t);
      return zeta >= 0.999 ? 1 - e * (1 + omega * t) : 1 - e * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    };
  }

  // =====================================================================================
  // Magnet: elements drift toward the pointer. One shared pointer field arbitrates which
  // magnet owns the pointer when several are in reach (exclusive mode).
  // =====================================================================================
  const smoothstep = (e0, e1, v) => {
    const t = clamp((v - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const registry = new Set();
  const field = { pointer: null, owner: null };
  let detachField = null;
  const reach = (rect, p) => {
    const dx = p.x - (rect.left + rect.width / 2);
    const dy = p.y - (rect.top + rect.height / 2);
    const outside = Math.hypot(Math.max(0, Math.abs(dx) - rect.width / 2), Math.max(0, Math.abs(dy) - rect.height / 2));
    return { dx, dy, outside };
  };
  function arbitrate() {
    let winner = null, nearest = Infinity, closest = Infinity;
    for (const entry of registry) {
      const s = entry.settings;
      let near = null;
      if (field.pointer && !entry.reduce) {
        near = reach(entry.wrapper.getBoundingClientRect(), field.pointer);
        if (near.outside > s.padding) near = null;
      }
      if (!s.exclusive) { if (near || entry.active) entry.wake(); continue; }
      if (!near) continue;
      const center = Math.hypot(near.dx, near.dy);
      if (near.outside < nearest || (near.outside === nearest && center < closest)) {
        winner = entry; nearest = near.outside; closest = center;
      }
    }
    const previous = field.owner;
    field.owner = winner;
    if (previous && previous !== winner) previous.wake();
    if (winner) winner.wake();
  }
  function attachField() {
    const onMove = (e) => { if (e.pointerType === "touch") return; field.pointer = { x: e.clientX, y: e.clientY }; arbitrate(); };
    const onLeave = () => { field.pointer = null; arbitrate(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", arbitrate, { passive: true, capture: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", arbitrate, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }

  function magnet(wrapper, opts = {}) {
    const inner = wrapper?.firstElementChild;
    if (!wrapper || !inner) return null;
    const s = {
      padding: Math.max(0, opts.padding ?? 100), strength: Math.max(0.1, opts.strength ?? 2), maxOffset: opts.maxOffset,
      exclusive: opts.exclusive ?? true, axis: opts.axis ?? "both", tilt: opts.tilt ?? 0, scale: opts.scale ?? 1,
      stiffness: opts.spring?.stiffness ?? 170, damping: opts.spring?.damping ?? 16, mass: opts.spring?.mass ?? 1,
    };
    inner.style.willChange = "transform";
    const isReduced = reduced();
    const current = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 1 };
    const velocity = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 0 };
    let active = false, raf = 0, last = 0;
    const solve = (target, dt) => {
      let resting = true;
      for (const k of Object.keys(current)) {
        const force = s.stiffness * (target[k] - current[k]) - s.damping * velocity[k];
        velocity[k] += (force / s.mass) * dt;
        current[k] += velocity[k] * dt;
        const eps = k === "scale" ? 0.001 : 0.05;
        if (Math.abs(target[k] - current[k]) > eps || Math.abs(velocity[k]) > eps) resting = false;
      }
      return resting;
    };
    const measure = () => {
      const target = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 1 };
      if (isReduced || !field.pointer) return { target, engaged: false };
      if (s.exclusive && field.owner !== entry) return { target, engaged: false };
      const rect = wrapper.getBoundingClientRect();
      const { dx, dy, outside } = reach(rect, field.pointer);
      if (outside > s.padding) return { target, engaged: false };
      const pull = s.padding > 0 ? 1 - smoothstep(s.padding * 0.5, s.padding, outside) : 1;
      let x = s.axis === "y" ? 0 : (dx / s.strength) * pull;
      let y = s.axis === "x" ? 0 : (dy / s.strength) * pull;
      if (s.maxOffset != null) {
        const len = Math.hypot(x, y);
        if (len > s.maxOffset) { x *= s.maxOffset / len; y *= s.maxOffset / len; }
      }
      const nx = clamp(dx / Math.max(rect.width / 2, 1), -1, 1), ny = clamp(dy / Math.max(rect.height / 2, 1), -1, 1);
      Object.assign(target, { x, y, tiltX: -ny * s.tilt * pull, tiltY: nx * s.tilt * pull, scale: 1 + (s.scale - 1) * pull });
      return { target, engaged: true };
    };
    const apply = () => {
      const { x, y, tiltX, tiltY, scale } = current;
      const turned = Math.abs(tiltX) > 0.01 || Math.abs(tiltY) > 0.01;
      inner.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` +
        (turned ? ` perspective(800px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)` : "") +
        (Math.abs(scale - 1) > 0.0005 ? ` scale(${scale.toFixed(4)})` : "");
    };
    const frame = (now) => {
      raf = 0;
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      const { target, engaged } = measure();
      if (engaged !== active) {
        active = engaged; entry.active = engaged;
        wrapper.toggleAttribute("data-magnet-active", engaged);
      }
      const steps = Math.ceil(dt / (1 / 120));
      let resting = true;
      for (let i = 0; i < steps; i++) resting = solve(target, dt / steps);
      if (resting) for (const k of Object.keys(current)) { current[k] = target[k]; velocity[k] = 0; }
      apply();
      if (!resting) raf = requestAnimationFrame(frame); else last = 0;
    };
    function wake() { if (!raf) raf = requestAnimationFrame(frame); }
    const entry = { wrapper, settings: s, reduce: isReduced, wake, active: false };
    registry.add(entry);
    if (!detachField) detachField = attachField();
    return {
      destroy() {
        cancelAnimationFrame(raf);
        registry.delete(entry);
        if (field.owner === entry) field.owner = null;
        if (!registry.size && detachField) { detachField(); detachField = null; }
        inner.style.transform = "";
      },
    };
  }

  // =====================================================================================
  // SpotlightCard: a soft light and a glowing rim that follow the pointer.
  // =====================================================================================
  const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
  const falloff = (color, softness) => {
    const soft = clamp(softness, 0, 1);
    const core = (1 - soft) ** 1.5 * 0.85;
    const stop = (alpha, at) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
    const list = [stop(1, 0)];
    for (let i = 0; i <= 14; i++) {
      const t = core + ((1 - core) * i) / 14;
      const g = (t - core) / (1 - core);
      const smooth = 1 - g * g * (3 - 2 * g);
      const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
      list.push(stop(smooth + (glow - smooth) * soft, t));
    }
    return list.join(", ");
  };

  function spotlight(root, opts = {}) {
    if (!root) return null;
    const color = opts.color ?? "#ffffff";
    const s = {
      fill: falloff(color, opts.softness ?? 0.7), edge: falloff(color, 1), size: Math.max(20, opts.size ?? 240),
      intensity: clamp(opts.intensity ?? 0.15, 0, 1), borderGlow: clamp(opts.borderGlow ?? 0.6, 0, 1),
      proximity: Math.max(0, opts.proximity ?? 80), smoothing: clamp(opts.smoothing ?? 0.3, 0, 1),
      flare: opts.flare ?? true, grain: clamp(opts.grain ?? 0, 0, 1),
    };
    root.classList.add("spotlight-card");
    const light = h("span", "spotlight-card__light"), noise = h("span", "spotlight-card__grain");
    const border = h("span", "spotlight-card__border"), edge = h("span", "spotlight-card__edge");
    noise.style.backgroundImage = NOISE;
    for (const n of [light, noise, border, edge]) n.setAttribute("aria-hidden", "true");
    root.prepend(light, noise);
    root.append(border, edge);
    const isReduced = reduced();
    const state = { x: 0, y: 0, presence: 0, flare: 0, pressed: false };
    const pointer = { x: 0, y: 0, active: false };
    let focus = null, raf = 0, last = 0, alive = true;
    const gradient = (size, x, y, stops) => `radial-gradient(circle ${size.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, ${stops})`;
    const paint = () => {
      const size = s.size * (1 + 0.2 * state.flare), boost = 1 + 0.7 * state.flare;
      light.style.background = gradient(size, state.x, state.y, s.fill);
      edge.style.background = gradient(size * 0.6, state.x, state.y, s.edge);
      light.style.opacity = String(Math.min(1, state.presence * s.intensity * boost));
      edge.style.opacity = String(Math.min(1, state.presence * s.borderGlow * boost));
      if (s.grain > 0) {
        const m = gradient(size, state.x, state.y, "#000 0%, transparent 100%");
        noise.style.webkitMaskImage = m; noise.style.maskImage = m;
      }
      noise.style.opacity = String(state.presence * s.grain);
    };
    const tick = (now) => {
      raf = 0;
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const rect = root.getBoundingClientRect();
      let tx = state.x, ty = state.y, target = 0;
      if (focus && root.contains(focus)) {
        const box = focus.getBoundingClientRect();
        tx = box.left + box.width / 2 - rect.left; ty = box.top + box.height / 2 - rect.top; target = 1;
      } else if (pointer.active) {
        tx = pointer.x - rect.left; ty = pointer.y - rect.top;
        const gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
        if (gap === 0) target = 1; else if (s.proximity > 0) target = Math.max(0, 1 - gap / s.proximity) ** 2;
      }
      if (state.presence < 0.02 && target > 0) { state.x = tx; state.y = ty; }
      const follow = isReduced || s.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + s.smoothing * 0.22));
      state.x += (tx - state.x) * follow; state.y += (ty - state.y) * follow;
      const fade = isReduced ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32));
      state.presence += (target - state.presence) * fade;
      if (Math.abs(target - state.presence) < 0.002) state.presence = target;
      const press = state.pressed && s.flare && !isReduced ? 1 : 0;
      state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
      if (Math.abs(press - state.flare) < 0.002) state.flare = press;
      paint();
      const moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
      if (moving || state.presence !== target || state.flare !== press) raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (raf || !alive) return; last = performance.now(); raf = requestAnimationFrame(tick); };
    const onMove = (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
      if (state.presence > 0 || s.proximity > 0 || root.contains(e.target)) wake();
    };
    const onOut = (e) => { if (e.relatedTarget) return; pointer.active = false; wake(); };
    const onDown = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; state.pressed = true; wake(); };
    const onUp = (e) => { if (e.pointerType !== "mouse") pointer.active = false; state.pressed = false; wake(); };
    const onFocusIn = (e) => { if (e.target instanceof Element && e.target.matches(":focus-visible")) { focus = e.target; wake(); } };
    const onFocusOut = (e) => { if (!root.contains(e.relatedTarget)) { focus = null; wake(); } };
    const onScroll = () => { if (pointer.active || state.presence > 0) wake(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerout", onOut);
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return {
      destroy() {
        alive = false; cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("scroll", onScroll, { capture: true });
        document.removeEventListener("pointerout", onOut);
        root.removeEventListener("pointerdown", onDown);
        root.removeEventListener("focusin", onFocusIn);
        root.removeEventListener("focusout", onFocusOut);
      },
    };
  }

  // =====================================================================================
  // ScrollVelocity: rows of text that drift sideways and speed up (and reverse) with
  // scroll velocity. Velocity is measured from the page's scroll position each frame.
  // =====================================================================================
  function scrollVelocity(root, opts = {}) {
    if (!root || !gsap) return null;
    const rows = opts.rows || [];
    const baseVelocity = opts.velocity ?? 100;
    const numCopies = opts.numCopies ?? 6;
    const [inLo, inHi] = opts.mapping?.input || [0, 1000];
    const [outLo, outHi] = opts.mapping?.output || [0, 5];
    const stiffness = opts.stiffness ?? 400, damping = opts.damping ?? 50;
    const skewWithVelocity = opts.skewWithVelocity ?? 0;
    const pauseOnHover = opts.pauseOnHover ?? false;
    const getY = opts.getScrollY || (() => window.scrollY);
    const isReduced = reduced();
    root.classList.add("scroll-velocity");
    let hovered = false;
    root.addEventListener("pointerenter", () => { hovered = true; });
    root.addEventListener("pointerleave", () => { hovered = false; });
    const tracks = rows.map((node, index) => {
      const parallax = h("div", "scroll-velocity__parallax");
      const scroller = h("div", "scroll-velocity__scroller");
      const copies = [];
      for (let i = 0; i < numCopies; i++) {
        const copy = h("span", "scroll-velocity__copy");
        copy.append(node.cloneNode(true));
        if (i > 0) copy.setAttribute("aria-hidden", "true");
        scroller.append(copy);
        copies.push(copy);
      }
      parallax.append(scroller);
      root.append(parallax);
      return { scroller, first: copies[0], base: 0, dir: 1, pace: 1, skew: 0, sign: index % 2 ? -1 : 1 };
    });
    // Spring-smoothed scroll velocity (px/s), like Motion's useSpring(useVelocity(scrollY)).
    let lastY = getY(), lastT = performance.now(), smooth = 0, smoothV = 0, raw = 0;
    const tick = () => {
      const now = performance.now();
      const dtMs = Math.max(now - lastT, 1), dt = Math.min(dtMs, 64) / 1000;
      const y = getY();
      raw = ((y - lastY) / dtMs) * 1000;
      lastY = y; lastT = now;
      const steps = Math.ceil(dt / (1 / 240));
      for (let i = 0; i < steps; i++) {
        const force = stiffness * (raw - smooth) - damping * smoothV;
        smoothV += force * (dt / steps);
        smooth += smoothV * (dt / steps);
      }
      const factor = outLo + ((smooth - inLo) / (inHi - inLo)) * (outHi - outLo);
      for (const t of tracks) {
        const width = t.first.offsetWidth;
        if (!width) continue;
        const targetPace = pauseOnHover && hovered ? 0 : 1;
        t.pace += (targetPace - t.pace) * (1 - Math.exp(-dtMs / 150));
        if (factor < 0) t.dir = -1; else if (factor > 0) t.dir = 1;
        let moveBy = t.dir * baseVelocity * t.sign * dt;
        moveBy += t.dir * moveBy * factor;
        t.base += moveBy * t.pace;
        const x = mod(t.base, width) - width;
        let transform = `translate3d(${x.toFixed(2)}px,0,0)`;
        if (skewWithVelocity) {
          const surge = Math.tanh(Math.abs(smooth) / 1600) * t.pace;
          const heading = Math.sign(moveBy) || 1;
          t.skew += (-heading * skewWithVelocity * surge - t.skew) * (1 - Math.exp(-dtMs / 110));
          transform += ` skewX(${t.skew.toFixed(3)}deg)`;
        }
        t.scroller.style.transform = transform;
      }
    };
    if (!isReduced) gsap.ticker.add(tick);
    return { destroy() { gsap.ticker.remove(tick); } };
  }

  // =====================================================================================
  // SplitFlapText: a split-flap display. set(text) flips each tile through random
  // characters to its target, cascading across the board.
  // =====================================================================================
  const CHARSETS = { alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", numeric: "0123456789" };
  function splitFlap(root, opts = {}) {
    if (!root) return null;
    const width = Math.max(1, opts.width ?? 4);
    const align = opts.align ?? "right";
    const flipMs = Math.max(40, (opts.flipDuration ?? 0.12) * 1000);
    const staggerMs = Math.max(0, (opts.stagger ?? 0.06) * 1000);
    const flips = Math.max(0, Math.floor(opts.flipsPerChar ?? 8));
    const glyphs = CHARSETS[opts.charset] || opts.charset || CHARSETS.numeric;
    const order = opts.order ?? "left";
    const depth = clamp(opts.depth ?? 0.5, 0, 1);
    const flat = Math.min(1, depth * 2), deep = Math.max(0, depth - 0.5) * 2;
    const r3 = (v) => Number(v.toFixed(3));
    root.classList.add("split-flap-text");
    const vars = {
      "--split-flap-flip-duration": `${flipMs / 1000}s`,
      "--split-flap-front-from": r3(1 + 0.08 * flat), "--split-flap-front-to": r3(1 - 0.48 * flat - 0.3 * deep),
      "--split-flap-back-from": r3(1 - 0.42 * flat - 0.3 * deep), "--split-flap-hinge": `calc(1px + ${r3(deep * 0.05)}em)`,
      "--split-flap-hinge-shade": r3(0.25 + 0.39 * flat + 0.21 * deep), "--split-flap-drop": r3(0.28 * flat + 0.2 * deep),
      "--split-flap-lift": r3(0.4 + 0.6 * flat + 0.7 * deep), "--split-flap-cast": r3(deep * 0.62),
      "--split-flap-edge": `${r3(deep * 0.035)}em`,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, String(v));
    const sr = h("span", "split-flap-text__sr");
    root.textContent = "";
    root.append(sr);
    const normalize = (text) => {
      const safe = String(text ?? "").slice(0, width);
      if (align === "right") return safe.padStart(width, " ");
      if (align === "center") return safe.padStart(safe.length + Math.floor((width - safe.length) / 2), " ").padEnd(width, " ");
      return safe.padEnd(width, " ");
    };
    const glyph = (c) => (c === " " ? " " : c);
    const tiles = Array.from({ length: width }, () => {
      const tile = h("span", "split-flap-text__tile");
      tile.setAttribute("aria-hidden", "true");
      root.append(tile);
      return { el: tile, current: " " };
    });
    const half = (cls, ch) => { const s = h("span", cls); s.append(h("span", "split-flap-text__char", glyph(ch))); return s; };
    const draw = (t, current, next, flipping) => {
      t.el.textContent = "";
      t.el.classList.toggle("is-flipping", flipping);
      t.el.append(half("split-flap-text__half split-flap-text__half--top", flipping ? next : current),
        half("split-flap-text__half split-flap-text__half--bottom", current));
      if (flipping) {
        if (deep > 0) t.el.append(h("span", "split-flap-text__shade split-flap-text__shade--top"), h("span", "split-flap-text__shade split-flap-text__shade--bottom"));
        t.el.append(half("split-flap-text__flap split-flap-text__flap--front", current), half("split-flap-text__flap split-flap-text__flap--back", next));
      }
    };
    tiles.forEach((t) => draw(t, " ", " ", false));
    let raf = 0;
    const sample = () => glyphs.charAt(Math.floor(Math.random() * glyphs.length)) || " ";
    const cascade = (i) => (order === "right" ? width - 1 - i : order === "center" ? Math.floor(Math.abs(i - (width - 1) / 2)) : i);
    function set(text, label) {
      const target = normalize(text);
      sr.textContent = label ?? String(text).trim();
      cancelAnimationFrame(raf);
      const plans = [];
      tiles.forEach((t, i) => {
        if (t.current === target[i]) return;
        if (reduced()) { t.current = target[i]; draw(t, t.current, t.current, false); return; }
        const seq = [];
        for (let k = 0; k < flips; k++) seq.push(sample());
        seq.push(target[i]);
        plans.push({ t, from: t.current, target: target[i], seq, start: cascade(i) * staggerMs, step: -1, done: false });
      });
      if (!plans.length) return 0;
      const started = performance.now();
      const frame = (now) => {
        const elapsed = now - started;
        let running = false;
        for (const p of plans) {
          const local = elapsed - p.start;
          if (local < 0) { running = true; continue; }
          const step = Math.floor(local / flipMs);
          if (step < p.seq.length) {
            running = true;
            if (step !== p.step) { p.step = step; draw(p.t, step === 0 ? p.from : p.seq[step - 1], p.seq[step], true); }
          } else if (!p.done) {
            p.done = true; p.t.current = p.target; draw(p.t, p.target, p.target, false);
          }
        }
        raf = running ? requestAnimationFrame(frame) : 0;
      };
      raf = requestAnimationFrame(frame);
      return plans.reduce((m, p) => Math.max(m, p.start + p.seq.length * flipMs), 0);
    }
    return { set, destroy() { cancelAnimationFrame(raf); } };
  }

  // =====================================================================================
  // Counter: each digit rolls on its own strip of numerals to the new value.
  // =====================================================================================
  function counter(root, opts = {}) {
    if (!root || !gsap) return null;
    const duration = opts.duration ?? 0.7, stagger = opts.stagger ?? 0.04;
    const ease = springEase(opts.bounce ?? 0.2);
    root.classList.add("counter");
    const sr = h("span", "counter__sr");
    const row = h("span", "counter__row");
    row.setAttribute("aria-hidden", "true");
    root.textContent = "";
    root.append(sr, row);
    let slots = new Map(); // key -> {el, kind, pos, numerals}
    let value = null;
    const makeDigit = (d) => {
      const el = h("span", "counter__digit");
      el.append(h("span", "counter__sizer", "0"));
      const win = h("span", "counter__window");
      const strip = h("span", "counter__strip");
      const numerals = [];
      for (let n = 0; n < 10; n++) { const s = h("span", "counter__numeral", String(n)); strip.append(s); numerals.push(s); }
      win.append(strip);
      el.append(win);
      const slot = { el, kind: "digit", pos: d, numerals, tween: null };
      paintDigit(slot);
      return slot;
    };
    const paintDigit = (slot) => {
      slot.numerals.forEach((n, i) => { n.style.transform = `translateY(${((mod(i - slot.pos + 5, 10) - 5) * 100).toFixed(3)}%)`; });
    };
    const keysFor = (text) => {
      const chars = [...text];
      const digitsTotal = chars.filter((c) => /\d/.test(c)).length;
      let place = digitsTotal;
      let sym = 0;
      return chars.map((c) => (/\d/.test(c) ? { key: `d${--place}`, kind: "digit", d: Number(c) } : { key: `s${sym++}-${c}`, kind: "symbol", c }));
    };
    function set(v, { instant = false } = {}) {
      const text = opts.format ? opts.format(v) : String(Math.round(v));
      sr.textContent = opts.label ? opts.label(v) : text;
      const plan = keysFor(text);
      const prev = value;
      value = v;
      const next = new Map();
      const order = [];
      for (const p of plan) {
        let slot = slots.get(p.key);
        if (slot && slot.kind !== p.kind) slot = null;
        if (!slot) {
          if (p.kind === "digit") {
            slot = makeDigit(instant || prev === null ? p.d : 0);
            if (!instant && prev !== null && gsap) gsap.fromTo(slot.el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
          } else {
            slot = { el: h("span", "counter__symbol", p.c), kind: "symbol" };
          }
        }
        next.set(p.key, slot);
        order.push({ slot, p });
      }
      for (const [k, slot] of slots) if (!next.has(k)) slot.el.remove();
      row.textContent = "";
      order.forEach(({ slot }) => row.append(slot.el));
      slots = next;
      let rank = 0;
      for (const { slot, p } of order.slice().reverse()) {
        if (p.kind !== "digit") continue;
        const from = slot.pos;
        let delta = mod(p.d - Math.round(from), 10);
        if (opts.direction === "down") delta = delta === 0 ? 0 : delta - 10;
        else if (opts.direction !== "up" && prev !== null && v < prev) delta = delta === 0 ? 0 : delta - 10;
        const to = Math.round(from) + delta;
        slot.tween?.kill();
        if (instant || reduced() || delta === 0) { slot.pos = p.d; paintDigit(slot); continue; }
        slot.tween = gsap.to(slot, { pos: to, duration, ease, delay: rank * stagger, onUpdate: () => paintDigit(slot),
          onComplete: () => { slot.pos = p.d; paintDigit(slot); } });
        rank++;
      }
    }
    if (opts.value !== undefined) set(opts.value, { instant: true });
    return { set, get value() { return value; } };
  }

  // =====================================================================================
  // CircularText: letters set around a ring that spins, speeds up on hover and can be flung.
  // =====================================================================================
  function circularText(root, opts = {}) {
    if (!root) return null;
    const text = opts.text ?? "";
    const spinDuration = opts.spinDuration ?? 20;
    const hoverSpeed = { slowDown: 0.5, speedUp: 4, pause: 0 }[opts.onHover ?? "speedUp"] ?? 1;
    const isReduced = reduced();
    root.classList.add("circular-text");
    const ring = h("div", "circular-text__ring");
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", opts.label ?? text);
    const letters = [...text];
    letters.forEach((ch, i) => {
      const l = h("span", "circular-text__letter");
      l.append(h("span", "", ch));
      l.style.transform = `rotate(${(360 / letters.length) * i}deg)`;
      l.setAttribute("aria-hidden", "true");
      ring.append(l);
    });
    root.prepend(ring);
    if (isReduced || !gsap) return { destroy() {} };
    const st = { rotation: 0, speed: 1, speedTarget: 1, speedV: 0, fling: 0, dragging: false, angle: null, travel: 0, samples: [] };
    const cruise = 360 / Math.max(spinDuration, 1);
    const tick = (time, deltaMs) => {
      const dt = Math.min(deltaMs, 100) / 1000;
      const force = 60 * (st.speedTarget - st.speed) - 18 * st.speedV;
      st.speedV += force * dt; st.speed += st.speedV * dt;
      if (!st.dragging) {
        st.fling *= Math.exp(-dt / 0.7);
        if (Math.abs(st.fling) < 1) st.fling = 0;
        st.rotation = (st.rotation + (cruise * st.speed + st.fling) * dt) % 360;
      }
      ring.style.transform = `rotate(${st.rotation.toFixed(2)}deg)`;
    };
    let running = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting === running) return;
      running = e.isIntersecting;
      if (running) gsap.ticker.add(tick); else gsap.ticker.remove(tick);
    });
    io.observe(root);
    const pointerAngle = (e) => {
      const r = root.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return Math.hypot(dx, dy) < r.width * 0.06 ? null : (Math.atan2(dy, dx) * 180) / Math.PI;
    };
    root.addEventListener("pointerenter", () => { st.speedTarget = hoverSpeed; });
    root.addEventListener("pointerleave", () => { st.speedTarget = 1; });
    if (opts.draggable) {
      root.style.touchAction = "none";
      root.style.cursor = "grab";
      root.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        Object.assign(st, { dragging: true, fling: 0, angle: pointerAngle(e), travel: 0, samples: [[e.timeStamp, 0]] });
        root.setPointerCapture?.(e.pointerId);
        root.style.cursor = "grabbing";
      });
      root.addEventListener("pointermove", (e) => {
        if (!st.dragging) return;
        const a = pointerAngle(e);
        if (a === null) return;
        if (st.angle !== null) {
          let d = a - st.angle;
          if (d > 180) d -= 360; if (d < -180) d += 360;
          st.travel += d; st.rotation = (st.rotation + d) % 360;
          st.samples.push([e.timeStamp, st.travel]);
          while (st.samples.length > 2 && e.timeStamp - st.samples[0][0] > 100) st.samples.shift();
        }
        st.angle = a;
      });
      const up = (e) => {
        if (!st.dragging) return;
        st.dragging = false;
        root.style.cursor = "grab";
        const [t0, s0] = st.samples[0];
        const tl = st.samples[st.samples.length - 1][0];
        const el = e.timeStamp - t0;
        const v = el > 0 && e.timeStamp - tl < 80 ? ((st.travel - s0) / el) * 1000 : 0;
        st.fling = clamp(v, -1440, 1440) - cruise * st.speed;
      };
      root.addEventListener("pointerup", up);
      root.addEventListener("pointercancel", up);
    }
    return { destroy() { io.disconnect(); gsap.ticker.remove(tick); } };
  }

  // =====================================================================================
  // ScrubField: a number you can drag sideways to change, type into, or step with the
  // arrow keys. Dragging past the limits stretches with a rubber band and springs back.
  // =====================================================================================
  function scrubField(root, opts = {}) {
    if (!root) return null;
    const min = opts.min ?? 0, max = opts.max ?? 100, step = opts.step ?? 1;
    const sensitivity = opts.sensitivity ?? 2;
    const coarse = opts.coarseMultiplier ?? 10, fine = opts.fineMultiplier ?? 0.1;
    const fmt = opts.format || ((v) => String(v));
    const parse = opts.parse || ((s) => parseFloat(String(s).replace(/[^\d.-]/g, "")));
    const reachSpan = ((opts.rubberReach ?? 8) / 100) * Math.max(max - min, Number.EPSILON);
    const bend = (raw) => (reachSpan ? Math.sign(raw) * reachSpan * Math.log1p(Math.abs(raw) / reachSpan) : 0);
    const unbend = (over) => (reachSpan ? Math.sign(over) * reachSpan * Math.expm1(Math.abs(over) / reachSpan) : 0);
    const toShown = (raw) => { const c = clamp(raw, min, max); return c + bend(raw - c); };
    const toRaw = (shown) => { const c = clamp(shown, min, max); return c + unbend(shown - c); };
    const snap = (v) => Math.round(v / step) * step;
    const isReduced = reduced();

    root.classList.add("scrub-field");
    root.textContent = "";
    const track = h("span", "scrub-field__track");
    const fill = h("span", "scrub-field__fill");
    track.append(fill);
    track.setAttribute("aria-hidden", "true");
    const id = opts.id || `scrub-${Math.random().toString(36).slice(2, 8)}`;
    const label = h("label", "scrub-field__handle", opts.label ?? "");
    label.htmlFor = id;
    const input = h("input", "scrub-field__input");
    Object.assign(input, { id, type: "text", inputMode: "decimal", autocomplete: "off" });
    input.setAttribute("role", "spinbutton");
    input.setAttribute("aria-valuemin", String(min));
    input.setAttribute("aria-valuemax", String(max));
    const ghost = h("span", "scrub-field__ghost");
    ghost.setAttribute("aria-hidden", "true");
    root.append(track, label, input, ghost);

    let value = clamp(opts.value ?? min, min, max);
    let display = value, typing = false, drag = null, moved = false, ret = null;
    const paint = () => {
      if (!typing) input.value = fmt(clamp(display, min, max));
      root.dataset.over = display < min || display > max ? "true" : "false";
      const lean = isReduced || !reachSpan ? 0 : clamp((display - clamp(display, min, max)) / reachSpan, -1, 1) * 4;
      root.style.transform = lean ? `translateX(${lean.toFixed(2)}px)` : "";
      fill.style.transform = `scaleX(${((clamp(display, min, max) - min) / Math.max(max - min, Number.EPSILON)).toFixed(4)})`;
      input.setAttribute("aria-valuenow", String(value));
      input.setAttribute("aria-valuetext", fmt(value));
    };
    const commit = (next, final) => {
      const v = clamp(snap(next), min, max);
      if (v === value && !final) return;
      const changed = v !== value;
      value = v;
      if (changed) opts.onChange?.(v);
      if (final) opts.onCommit?.(v);
    };
    const mult = (e) => (e.shiftKey ? coarse : e.altKey ? fine : 1);
    root.addEventListener("pointerdown", (e) => {
      if (drag || e.button !== 0 || typing) return;
      if (e.pointerType !== "touch") e.preventDefault();
      ret?.kill();
      moved = false;
      drag = { id: e.pointerId, x: e.clientX, raw: toRaw(display), m: mult(e), moved: false, before: value,
        slack: e.pointerType === "touch" ? 8 : 3, left: root.getBoundingClientRect().left };
      try { root.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    });
    root.addEventListener("pointermove", (e) => {
      const g = drag;
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved) {
        if (Math.abs(e.clientX - g.x) < g.slack) return;
        g.moved = true; moved = true; g.x = e.clientX;
        root.dataset.dragging = "true";
        document.documentElement.style.cursor = "ew-resize";
      }
      const m = mult(e);
      if (m !== g.m) { g.m = m; g.raw = toRaw(display); g.x = e.clientX; }
      const raw = g.raw + Math.round((e.clientX - g.x) / sensitivity) * step * m;
      display = toShown(raw);
      commit(clamp(raw, min, max), false);
      paint();
      const d = display - g.before;
      ghost.style.translate = `calc(${e.clientX - g.left}px - 50%) -100%`;
      ghost.textContent = (d < 0 ? "−" : "+") + (opts.formatDelta ? opts.formatDelta(Math.abs(d)) : fmt(Math.abs(d)));
    });
    const end = (cancel) => {
      const g = drag;
      if (!g) return;
      drag = null;
      root.dataset.dragging = "false";
      document.documentElement.style.cursor = "";
      if (cancel) { commit(g.before, true); display = value; paint(); return; }
      if (!g.moved) { input.focus(); return; }
      const bound = clamp(display, min, max);
      if (display !== bound && gsap && !isReduced) {
        const o = { v: display };
        ret = gsap.to(o, { v: bound, duration: 0.3, ease: "power3.out", onUpdate: () => { display = o.v; paint(); } });
      } else { display = bound; paint(); }
      if (value !== g.before) opts.onCommit?.(value);
    };
    root.addEventListener("pointerup", () => end(false));
    root.addEventListener("pointercancel", () => end(true));
    root.addEventListener("lostpointercapture", () => end(false));
    label.addEventListener("click", (e) => { if (moved) e.preventDefault(); });
    input.addEventListener("focus", () => { typing = true; root.dataset.typing = "true"; input.select(); });
    input.addEventListener("blur", () => {
      const n = parse(input.value);
      typing = false; root.dataset.typing = "false";
      if (Number.isFinite(n)) commit(n, true);
      display = value; paint();
    });
    input.addEventListener("keydown", (e) => {
      const deltas = { ArrowUp: step * mult(e), ArrowDown: -step * mult(e), PageUp: step * coarse, PageDown: -step * coarse };
      const d = deltas[e.key];
      if (d !== undefined || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const typed = parse(input.value);
        const from = Number.isFinite(typed) ? typed : value;
        typing = false;
        commit(d !== undefined ? from + d : e.key === "Home" ? min : max, true);
        display = value; paint();
        typing = document.activeElement === input;
      } else if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); typing = false; display = value; paint(); input.blur(); }
    });
    paint();
    return {
      set(v) { value = clamp(v, min, max); if (!drag) { display = value; paint(); } },
      get value() { return value; },
      input,
    };
  }

  // =====================================================================================
  // StaggeredMenu: colored layers sweep in, then the panel, then the links rise one by one.
  // =====================================================================================
  function staggeredMenu({ toggle, panel, layers = [], label, onOpen, onClose, position = "right" }) {
    if (!toggle || !panel || !gsap) return null;
    const off = position === "left" ? -100 : 100;
    const items = () => Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
    const numbered = () => Array.from(panel.querySelectorAll(".sm-panel-item"));
    const extras = () => Array.from(panel.querySelectorAll(".sm-extra"));
    // The stylesheet parks the panel off-screen with translateX(100%) for the no-JS case; GSAP reads
    // that as a pixel offset, so zero it and let xPercent alone position the panel.
    gsap.set([panel, ...layers], { x: 0, xPercent: off });
    let open = false, busy = false, tl = null, closeTween = null;
    const icon = toggle.querySelector(".sm-icon");
    const textInner = toggle.querySelector(".sm-toggle-textInner");
    const setLabel = (opening) => {
      if (!textInner) return;
      const seq = opening ? ["Menu", "Close", "Menu", "Close"] : ["Close", "Menu", "Close", "Menu"];
      textInner.textContent = "";
      seq.forEach((s) => textInner.append(h("span", "sm-toggle-line", s)));
      gsap.fromTo(textInner, { yPercent: 0 }, { yPercent: -((seq.length - 1) / seq.length) * 100, duration: 0.5 + seq.length * 0.07, ease: "power4.out" });
    };
    function playOpen() {
      if (busy) return;
      busy = true;
      tl?.kill(); closeTween?.kill();
      gsap.set(items(), { yPercent: 140, rotate: 10 });
      gsap.set(numbered(), { "--sm-num-opacity": 0 });
      gsap.set(extras(), { y: 25, opacity: 0 });
      tl = gsap.timeline({ onComplete: () => { busy = false; } });
      layers.forEach((l, i) => tl.fromTo(l, { xPercent: off }, { xPercent: 0, duration: 0.5, ease: "power4.out" }, i * 0.07));
      const at = (layers.length ? (layers.length - 1) * 0.07 + 0.08 : 0);
      tl.fromTo(panel, { xPercent: off }, { xPercent: 0, duration: 0.65, ease: "power4.out" }, at);
      tl.to(items(), { yPercent: 0, rotate: 0, duration: 1, ease: "power4.out", stagger: 0.1 }, at + 0.1);
      tl.to(numbered(), { "--sm-num-opacity": 1, duration: 0.6, ease: "power2.out", stagger: 0.08 }, at + 0.2);
      tl.to(extras(), { y: 0, opacity: 1, duration: 0.55, ease: "power3.out", stagger: 0.08 }, at + 0.3);
    }
    function playClose() {
      tl?.kill();
      busy = false;
      closeTween = gsap.to([...layers, panel], { xPercent: off, duration: 0.32, ease: "power3.in", overwrite: "auto" });
    }
    function set(next) {
      if (next === open) return;
      open = next;
      toggle.setAttribute("aria-expanded", String(open));
      panel.toggleAttribute("inert", !open);
      panel.setAttribute("aria-hidden", String(!open));
      document.documentElement.classList.toggle("menu-open", open);
      if (open) { onOpen?.(); playOpen(); } else { onClose?.(); playClose(); }
      if (icon) gsap.to(icon, open ? { rotate: 225, duration: 0.8, ease: "power4.out" } : { rotate: 0, duration: 0.35, ease: "power3.inOut" });
      setLabel(open);
      if (label) label.textContent = open ? "Close" : "Menu";
    }
    panel.toggleAttribute("inert", true);
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => set(!open));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { set(false); toggle.focus(); } });
    return { open: () => set(true), close: () => set(false), get isOpen() { return open; } };
  }

  window.ReactBits = window.ReactBits || {};
  Object.assign(window.ReactBits, { magnet, spotlight, scrollVelocity, splitFlap, counter, circularText, scrubField, staggeredMenu, springEase });
})();

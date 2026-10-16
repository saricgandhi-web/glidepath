/*!
 * SplitText, ScrollReveal and CountUp from React Bits (https://reactbits.dev,
 * https://github.com/DavidHDev/react-bits), ported from React to plain JavaScript for
 * Glidepath. The animation logic follows the originals; the React hooks were replaced by
 * functions that take a DOM element. Requires GSAP, ScrollTrigger and GSAP SplitText.
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
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

  // ---------------------------------------------------------------- SplitText
  const STIFFNESS = 180;
  const DAMPING = 19;
  const waveEase = (t) => 1 - Math.cos(t * Math.PI * 1.5) * Math.pow(1 - t, 1.2);

  const getEffect = (effect, em) => {
    switch (effect) {
      case "fade":
        return { from: { opacity: 0 }, to: { opacity: 1 }, ease: "power2.inOut" };
      case "blur":
        return {
          from: { opacity: 0, filter: `blur(${Math.round(em * 1.4) / 10}px)` },
          to: { opacity: 1, filter: "blur(0px)" },
          ease: "power2.out",
        };
      case "wave":
        return { from: { opacity: 0, y: em * 0.45 }, to: { opacity: 1, y: 0 }, ease: waveEase };
      default:
        return { from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 }, ease: "power3.out" };
    }
  };

  function splitText(el, opts = {}) {
    const {
      splitType = "chars", delay = 50, duration = 1.25, effect = "rise", mask = false,
      staggerFrom = "start", trigger = "load", hoverEffect = "none", accentColor = "", onComplete,
    } = opts;
    if (!el) return null;
    if (reduced() || !window.SplitText) {
      onComplete?.();
      return null;
    }
    gsap.registerPlugin(window.SplitText);
    const em = parseFloat(getComputedStyle(el).fontSize) || 16;
    const look = getEffect(effect, em);
    const unit = splitType.includes("chars") ? "chars" : splitType.includes("words") ? "words" : "lines";
    const order = gsap.utils.distribute({ each: delay / 1000, from: staggerFrom });
    const lift = em * 0.2;
    const springs = [];
    const pointer = { x: 0, y: 0, inside: false };
    let pieces = [];
    let movers = [];
    let centers = null;
    let revealed = false;
    let raf = 0;
    let last = 0;

    const reveal = () => {
      const tl = gsap.timeline({
        scrollTrigger: trigger === "view" ? { trigger: el, start: "top 90%", once: true } : undefined,
        onComplete: () => {
          revealed = true;
          onComplete?.();
        },
      });
      tl.fromTo(pieces, { ...look.from, willChange: "transform, opacity" },
        { ...look.to, duration, ease: look.ease, stagger: order, immediateRender: true }, 0);
      if (accentColor) {
        tl.fromTo(pieces, { color: accentColor },
          { color: getComputedStyle(el).color, duration: duration * 0.7, ease: "power1.inOut", stagger: order,
            immediateRender: true }, duration * 0.3);
      }
      tl.set(pieces, { clearProps: accentColor ? "transform,filter,willChange,color" : "transform,filter,willChange" });
      return tl;
    };

    const measure = () => {
      const box = el.getBoundingClientRect();
      centers = movers.map((node, i) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top - (springs[i]?.y || 0) };
      });
    };

    // hoverEffect "lift": letters near the pointer rise on a spring.
    const tick = (now) => {
      raf = 0;
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      const spots = hoverEffect === "lift" && pointer.inside && revealed ? centers : null;
      const radius = em * 1.15;
      let moving = false;
      movers.forEach((node, i) => {
        const spring = springs[i] || (springs[i] = { y: 0, v: 0 });
        const spot = spots?.[i];
        let target = 0;
        if (spot) {
          const dx = (spot.x - pointer.x) / radius;
          const dy = (spot.y - pointer.y) / (radius * 1.4);
          target = -lift * Math.exp(-(dx * dx + dy * dy) * 0.5);
        }
        spring.v += (STIFFNESS * (target - spring.y) - DAMPING * spring.v) * dt;
        spring.y += spring.v * dt;
        if (Math.abs(target - spring.y) < 0.02 && Math.abs(spring.v) < 0.05) {
          spring.y = target;
          spring.v = 0;
        } else {
          moving = true;
        }
        node.style.translate = Math.abs(spring.y) > 0.01 ? `0 ${spring.y.toFixed(2)}px` : "";
      });
      if (moving) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const locate = (e) => {
      const box = el.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
    };
    const onMove = (e) => {
      locate(e);
      pointer.inside = true;
      if (!revealed || hoverEffect !== "lift") return;
      if (!centers) measure();
      wake();
    };
    const onLeave = () => {
      pointer.inside = false;
      wake();
    };

    const instance = new window.SplitText(el, {
      type: splitType,
      smartWrap: true,
      mask: mask ? unit : undefined,
      linesClass: "split-line",
      wordsClass: "split-word",
      charsClass: "split-char",
      reduceWhiteSpace: false,
      onSplit(self) {
        pieces = [self[unit], self.chars, self.words, self.lines].find((list) => list && list.length) || [];
        movers = pieces;
        centers = null;
        springs.length = 0;
        if (revealed) return undefined;
        return reveal();
      },
    });
    el.style.visibility = "";
    if (hoverEffect !== "none") {
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
      window.addEventListener("resize", () => { centers = null; });
    }
    return instance;
  }

  // ------------------------------------------------------------- ScrollReveal
  const SCRUB_SPAN = 0.5;
  const RISE_MASK = "inset(-1em -1em -0.15em -1em)";
  const easeOut = (v) => 1 - Math.pow(1 - v, 3);

  const paintPiece = (piece, t, look) => {
    let reveal = t;
    let fadeIn = t;
    let motion = "";
    if (look.effect === "rise") {
      reveal = easeOut(t);
      fadeIn = clamp01(reveal * 1.25);
      if (reveal < 1) {
        motion = look.masked
          ? `translateY(${((1 - reveal) * 100).toFixed(2)}%) translateY(${((1 - reveal) * 0.2).toFixed(3)}em)`
          : `translateY(${((1 - reveal) * 0.8).toFixed(3)}em)`;
      }
    }
    const settle = clamp01(reveal);
    piece.style.opacity = t >= 1 ? "" : (look.baseOpacity + (1 - look.baseOpacity) * fadeIn).toFixed(3);
    piece.style.transform = motion;
    piece.style.filter = look.blur && settle < 1 ? `blur(${(look.blur * (1 - settle)).toFixed(2)}px)` : "";
  };

  // Splits an element's text into words and reveals them as it scrolls through the viewport.
  function scrollReveal(el, opts = {}) {
    const {
      enableBlur = true, baseOpacity = 0.1, baseRotation = 3, blurStrength = 4, stagger = 0.05,
      effect = "fade", wordAnimationEnd = "bottom 55%", rotationEnd = "bottom bottom",
    } = opts;
    if (!el) return;
    const text = el.textContent.trim();
    el.setAttribute("aria-label", text);
    const inner = document.createElement("span");
    inner.className = "scroll-reveal-text";
    inner.setAttribute("aria-hidden", "true");
    text.split(/(\s+)/).forEach((word) => {
      if (word.trim() === "") {
        inner.append(word);
        return;
      }
      const wrap = document.createElement("span");
      wrap.className = "scroll-reveal-word";
      const piece = document.createElement("span");
      piece.className = "scroll-reveal-piece";
      piece.textContent = word;
      wrap.append(piece);
      inner.append(wrap);
    });
    el.textContent = "";
    el.append(inner);
    if (reduced() || !window.ScrollTrigger) return;
    gsap.registerPlugin(window.ScrollTrigger);

    const wrappers = Array.from(el.querySelectorAll(".scroll-reveal-word"));
    const pieces = Array.from(el.querySelectorAll(".scroll-reveal-piece"));
    const look = { effect, masked: effect === "rise", baseOpacity, blur: enableBlur ? blurStrength : 0 };
    const last = pieces.map(() => -1);
    const state = { p: 0 };
    const total = SCRUB_SPAN + Math.max(0, pieces.length - 1) * stagger;
    const render = () => {
      const at = state.p * total;
      pieces.forEach((piece, i) => {
        const t = clamp01((at - i * stagger) / SCRUB_SPAN);
        if (t === last[i]) return;
        last[i] = t;
        paintPiece(piece, t, look);
      });
    };
    if (look.masked) wrappers.forEach((w) => { w.style.clipPath = RISE_MASK; });
    render();
    if (baseRotation) {
      gsap.fromTo(el, { transformOrigin: "0% 50%", rotate: baseRotation }, {
        ease: "none", rotate: 0,
        scrollTrigger: { trigger: el, start: "top bottom", end: `clamp(${rotationEnd})`, scrub: true },
      });
    }
    gsap.to(state, {
      p: 1, ease: "none", onUpdate: render,
      scrollTrigger: {
        trigger: el,
        start: () => `top bottom-=${0.2 * Math.min(el.offsetHeight, window.innerHeight)}`,
        end: `clamp(${wordAnimationEnd})`,
        scrub: true,
      },
    });
  }

  // ------------------------------------------------------------------ CountUp
  const makeSpring = (overshoot) => {
    const log = Math.log(Math.min(0.5, Math.max(0.001, overshoot)));
    const zeta = -log / Math.sqrt(Math.PI * Math.PI + log * log);
    const damped = Math.PI / 0.52;
    const natural = damped / Math.sqrt(1 - zeta * zeta);
    const raw = (t) =>
      1 - Math.exp(-zeta * natural * t) * (Math.cos(damped * t) + ((zeta * natural) / damped) * Math.sin(damped * t));
    const residual = 1 - raw(1);
    return (t) => (t >= 1 ? 1 : raw(t) + residual * t * t * t);
  };
  // cubic-bezier(0.33, 1, 0.68, 1), the original's "easeOut"
  const bezier = (x1, y1, x2, y2) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const d = (3 * ax * t + 2 * bx) * t + cx;
        if (Math.abs(d) < 1e-6) break;
        t -= (sx(t) - x) / d;
      }
      return sy(Math.min(1, Math.max(0, t)));
    };
  };
  const EASINGS = {
    linear: (t) => t,
    easeOut: bezier(0.33, 1, 0.68, 1),
    expo: (t) => (t >= 1 ? 1 : (1 - Math.pow(2, -10 * t)) / (1 - Math.pow(2, -10))),
    spring: makeSpring(0.06),
  };

  // Animates el's number from its current value to `to`. Repeated calls continue from the
  // value on screen, so a figure that updates while you type glides to the new number.
  function countUp(el, to, opts = {}) {
    const { duration = 1.2, easing = "spring", format = (v) => String(Math.round(v)), from } = opts;
    if (!el) return;
    const start = from ?? (Number.isFinite(el._rbValue) ? el._rbValue : to);
    el._rbTween?.kill();
    if (reduced() || start === to || duration <= 0) {
      el._rbValue = to;
      el.textContent = format(to);
      return;
    }
    const state = { v: start };
    el._rbTween = gsap.to(state, {
      v: to, duration, ease: EASINGS[easing] || EASINGS.easeOut,
      onUpdate: () => { el._rbValue = state.v; el.textContent = format(state.v); },
      onComplete: () => { el._rbValue = to; el.textContent = format(to); },
    });
  }

  window.ReactBits = window.ReactBits || {};
  Object.assign(window.ReactBits, { splitText, scrollReveal, countUp, easings: EASINGS });
})();

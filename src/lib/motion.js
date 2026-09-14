// =====================================================================
// Motion utilities — MD3 Expressive springs + choreographed reveals.
// Parameters here are the design spec for this app.
//
// MD3 Expressive springs are a SINGLE-overshoot cubic-bezier — the
// "overshoot"/bounce number is the curve's p1y control point
// (`cubic-bezier(0.38, bounce, 0.22, 1)`), per the repo's MD3 reference
// (docs/material-design-3-project). This overshoots once and settles,
// unlike a physics `linear()` curve that oscillates several times.
// =====================================================================

const REDUCED = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** MD3 Expressive spatial spring easing. `bounce` > 1 overshoots once. */
export function mdSpring(bounce = 1.3) {
  return `cubic-bezier(0.38, ${bounce}, 0.22, 1)`;
}

// Spec tokens.
export const SIDEBAR_SPRING = { duration: 660, easing: mdSpring(1.45) };
// Card reveal — "FINO directional" (docs/material-design-3-project/claude/
// card-reveal-FINO-directional.html): fade + scale 0.94→1 + a small
// translateY, on a settle spring, staggered, with the order + entry
// direction following navigation.
export const CARD_REVEAL = { duration: 800, bounce: 1.73, stagger: 10, shift: 14 };

// Direction the next reveal plays, set from navigation just before the cards
// mount: +1 = navigated "down" (or first load) → cards resolve bottom→top,
// entering from above; −1 = navigated "up" → top→bottom, entering from below.
let revealDir = 1;
export function setRevealDir(dir) {
  revealDir = dir < 0 ? -1 : 1;
}

/**
 * Card reveal — per-card fade + scale + directional slide with a settle
 * spring `cubic-bezier(0.34, bounce, 0.32, 1)`, staggered. The stagger order
 * and entry-offset sign follow the current `revealDir`. Returns a cleanup
 * that cancels in-flight animations.
 */
export function revealCards(elements) {
  if (!elements || !elements.length) return () => {};
  if (REDUCED()) {
    elements.forEach((el) => el && (el.style.opacity = '1'));
    return () => {};
  }
  const dir = revealDir;
  const easing = `cubic-bezier(0.34, ${CARD_REVEAL.bounce}, 0.32, 1)`;
  const dy = dir > 0 ? -CARD_REVEAL.shift : CARD_REVEAL.shift;
  const n = elements.length;
  const anims = [];
  elements.forEach((el, i) => {
    if (!el) return;
    const order = dir > 0 ? n - 1 - i : i;
    const a = el.animate(
      [
        { opacity: 0, transform: `scale(0.94) translateY(${dy}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: CARD_REVEAL.duration, delay: order * CARD_REVEAL.stagger, easing, fill: 'both' }
    );
    anims.push(a);
  });
  return () => anims.forEach((a) => a.cancel());
}

// ---------------------------------------------------------------------
// Theme transition — two-stage circular reveal (View Transitions API).
//   stage 1: 0 → 55%  (590ms, emphasized decelerate)
//   hold:    still at 55% (300ms, no bounce)
//   stage 2: 55% → 100% (250ms, emphasized accelerate)
// ---------------------------------------------------------------------
const THEME = {
  half: 0.55,
  d1: 590,
  pause: 300,
  d2: 250,
  ease1: 'cubic-bezier(0.05,0.7,0.1,1)', // emphasized decelerate
  ease2: 'cubic-bezier(0.3,0,0.8,0.15)', // emphasized accelerate
};

function clipCircle(p, geo) {
  return `circle(${(p * geo.r).toFixed(1)}px at ${geo.x.toFixed(1)}px ${geo.y.toFixed(1)}px)`;
}

/**
 * Animate a light/dark swap. `applyTheme` performs the DOM state change;
 * `originEl` seeds the circle's center.
 * @returns {Promise<void>}
 */
export function animateThemeSwitch(applyTheme, originEl) {
  const root = document.documentElement;
  const supportsVT = typeof document.startViewTransition === 'function';
  if (!supportsVT || REDUCED()) {
    applyTheme();
    return Promise.resolve();
  }

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  const r = originEl?.getBoundingClientRect?.();
  if (r && r.width) {
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const geo = { x, y, r: Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) };

  const t = document.startViewTransition(() => applyTheme());
  t.ready
    .then(() => {
      const total = THEME.d1 + THEME.pause + THEME.d2;
      const o1 = THEME.d1 / total;
      const o2 = (THEME.d1 + THEME.pause) / total;
      // reveal → hold still (linear) → finish fast. No bounce.
      const kf = [
        { clipPath: clipCircle(0, geo), offset: 0, easing: THEME.ease1 },
        { clipPath: clipCircle(THEME.half, geo), offset: o1, easing: 'linear' },
        { clipPath: clipCircle(THEME.half, geo), offset: o2, easing: THEME.ease2 },
        { clipPath: clipCircle(1, geo), offset: 1 },
      ];
      root.animate(kf, {
        duration: total,
        easing: 'linear',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)',
      });
    })
    .catch(() => {});

  return t.finished.catch(() => {});
}

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
export const CARD_REVEAL = { duration: 700, bounce: 1.75, stagger: 15 };

/**
 * Card reveal — MD3 "fade + spring": opacity 0→1 and scale 0.88→1 only
 * (no clip, no two-stage), on one duration with a per-index stagger.
 * Returns a cleanup that cancels in-flight animations.
 */
export function revealCards(elements) {
  if (!elements || !elements.length) return () => {};
  if (REDUCED()) {
    elements.forEach((el) => el && (el.style.opacity = '1'));
    return () => {};
  }
  const easing = mdSpring(CARD_REVEAL.bounce);
  const anims = [];
  elements.forEach((el, i) => {
    if (!el) return;
    const a = el.animate(
      [
        { opacity: 0, transform: 'scale(0.88)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: CARD_REVEAL.duration, delay: i * CARD_REVEAL.stagger, easing, fill: 'both' }
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

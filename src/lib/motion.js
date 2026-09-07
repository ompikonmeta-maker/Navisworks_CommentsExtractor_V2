// =====================================================================
// Motion utilities — MD3 Expressive spring easings + choreographed
// reveals. Parameters here are the design spec for this app.
// =====================================================================

const REDUCED = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Build a CSS `linear()` easing that approximates a damped spring whose
 * first peak overshoots the target by `overshoot`× (e.g. 1.45 = +45%).
 * Sampled across the motion so the property settles by the end.
 */
export function springLinear(overshoot = 1.3, samples = 48) {
  const os = Math.max(1.001, overshoot) - 1; // fractional overshoot
  const lnOs = Math.log(os);
  const zeta = -lnOs / Math.sqrt(Math.PI * Math.PI + lnOs * lnOs); // damping ratio
  const wn = 4 / zeta; // settle (~2%) near t=1 (normalized time)
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x =
      1 -
      Math.exp(-zeta * wn * t) *
        (Math.cos(wd * t) + ((zeta * wn) / wd) * Math.sin(wd * t));
    pts.push(Math.round(x * 10000) / 10000);
  }
  pts[pts.length - 1] = 1; // guarantee exact settle
  return `linear(${pts.join(',')})`;
}

// Precomputed easings for the spec.
export const SIDEBAR_SPRING = { duration: 660, easing: springLinear(1.45) };
export const CARD_REVEAL = { duration: 700, overshoot: 1.75, stagger: 15 };

/**
 * Card reveal — fade in with a spring-overshoot rise. Applied to a set of
 * elements, staggered by index. Returns a cleanup that cancels in-flight
 * animations.
 */
export function revealCards(elements, { start = 0 } = {}) {
  if (!elements || !elements.length) return () => {};
  const spring = springLinear(CARD_REVEAL.overshoot);
  const anims = [];
  if (REDUCED()) {
    elements.forEach((el) => el && (el.style.opacity = '1'));
    return () => {};
  }
  elements.forEach((el, i) => {
    if (!el) return;
    const delay = start + i * CARD_REVEAL.stagger;
    // Transform rides the spring (overshoot); opacity fades on a soft curve.
    const a = el.animate(
      [
        { opacity: 0, transform: 'translateY(14px) scale(0.98)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: CARD_REVEAL.duration, delay, easing: spring, fill: 'both' }
    );
    anims.push(a);
  });
  return () => anims.forEach((a) => a.cancel());
}

// ---------------------------------------------------------------------
// Theme transition — two-stage circular reveal with a spring hold.
//   stage 1: 0 → 55%  (590ms, emphasized decelerate)
//   pause:   spring wobble around 55% (300ms)
//   stage 2: 55% → 100% (250ms, emphasized accelerate)
// ---------------------------------------------------------------------
const THEME = {
  half: 0.55,
  d1: 590,
  pause: 300,
  d2: 250,
  ease1: 'cubic-bezier(0.05,0.7,0.1,1)',
  ease2: 'cubic-bezier(0.3,0,0.8,0.15)',
};

function clipCircle(p, geo) {
  return `circle(${(p * geo.r).toFixed(1)}px at ${geo.x.toFixed(1)}px ${geo.y.toFixed(1)}px)`;
}

/**
 * Animate a light/dark swap. `applyTheme` performs the actual DOM state
 * change; `originEl` seeds the circle's center.
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

      const kf = [
        { clipPath: clipCircle(0, geo), offset: 0, easing: THEME.ease1 },
        { clipPath: clipCircle(THEME.half, geo), offset: o1, easing: 'linear' },
      ];
      // Pause: damped spring wobble around the 55% radius.
      const wobbleSteps = 8;
      const amp = 0.06;
      for (let i = 1; i <= wobbleSteps; i++) {
        const u = i / wobbleSteps;
        const osc = amp * Math.exp(-3.2 * u) * Math.sin(2 * Math.PI * 1.5 * u);
        const p = THEME.half + osc * (1 - THEME.half);
        kf.push({
          clipPath: clipCircle(p, geo),
          offset: o1 + (o2 - o1) * u,
          easing: 'linear',
        });
      }
      kf.push({ clipPath: clipCircle(THEME.half, geo), offset: o2, easing: THEME.ease2 });
      kf.push({ clipPath: clipCircle(1, geo), offset: 1 });

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

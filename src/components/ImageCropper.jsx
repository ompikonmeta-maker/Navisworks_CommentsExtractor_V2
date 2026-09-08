import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';

// Output pixel sizes per aspect ratio — every upload is normalized to one of
// these so custom-resolution snapshots become uniform. 1:1 matches the
// Navisworks before images (512×512), scaled up for crisp export.
const OUT = { 1: [1000, 1000], 1.3333: [1200, 900], 1.7778: [1280, 720] };
const ASPECTS = [
  { ar: 1, label: '1:1 · square' },
  { ar: 1.3333, label: '4:3' },
  { ar: 1.7778, label: '16:9' },
];

// Modal crop / reposition dialog. Drag to move, slider to zoom, pick an aspect
// ratio; "Use photo" exports a uniform data URL via canvas. Ported from the
// approved mockup crop engine.
export default function ImageCropper({ src, onDone, onCancel }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  // Geometry lives in refs so pointer handlers stay cheap and don't re-render.
  const geo = useRef({ nat: { w: 0, h: 0 }, base: 1, scale: 1, ox: 0, oy: 0 });
  const [ar, setAr] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const touched = useRef(false); // true once the user zooms/drags — stop auto-fit

  const frameSize = () => {
    const r = frameRef.current.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const applyTransform = () => {
    const { ox, oy, scale } = geo.current;
    if (imgRef.current) imgRef.current.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
  };
  const clamp = () => {
    const f = frameSize();
    const g = geo.current;
    const sw = g.nat.w * g.scale;
    const sh = g.nat.h * g.scale;
    g.ox = Math.min(0, Math.max(f.w - sw, g.ox));
    g.oy = Math.min(0, Math.max(f.h - sh, g.oy));
  };
  const fitCover = () => {
    const f = frameSize();
    const g = geo.current;
    g.base = Math.max(f.w / g.nat.w, f.h / g.nat.h);
    g.scale = g.base;
    g.ox = (f.w - g.nat.w * g.scale) / 2;
    g.oy = (f.h - g.nat.h * g.scale) / 2;
    clamp();
    applyTransform();
    setZoom(1);
  };

  // Load the source image, then cover-fit it into the frame.
  useEffect(() => {
    const img = imgRef.current;
    const onLoad = () => {
      geo.current.nat = { w: img.naturalWidth, h: img.naturalHeight };
      img.style.width = `${img.naturalWidth}px`;
      img.style.height = `${img.naturalHeight}px`;
      setReady(true);
      requestAnimationFrame(fitCover);
    };
    img.addEventListener('load', onLoad);
    img.src = src;
    return () => img.removeEventListener('load', onLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Re-fit whenever the aspect ratio (and thus the frame) changes.
  useEffect(() => {
    if (ready) requestAnimationFrame(fitCover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar]);

  // Keep the image cover-fit while the frame size is still settling (entrance
  // layout, window resize) — but stop once the user has taken control.
  useEffect(() => {
    if (!ready) return undefined;
    const ro = new ResizeObserver(() => { if (!touched.current) fitCover(); });
    ro.observe(frameRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const onZoom = (val) => {
    touched.current = true;
    setZoom(val);
    const f = frameSize();
    const g = geo.current;
    const cx = f.w / 2;
    const cy = f.h / 2;
    const prev = g.scale;
    g.scale = g.base * val;
    const k = g.scale / prev;
    g.ox = cx - (cx - g.ox) * k;
    g.oy = cy - (cy - g.oy) * k;
    clamp();
    applyTransform();
  };

  const drag = useRef({ on: false, x: 0, y: 0 });
  const onDown = (e) => {
    touched.current = true;
    drag.current = { on: true, x: e.clientX, y: e.clientY };
    setDragging(true);
    frameRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current.on) return;
    const g = geo.current;
    g.ox += e.clientX - drag.current.x;
    g.oy += e.clientY - drag.current.y;
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
    clamp();
    applyTransform();
  };
  const onUp = () => {
    drag.current.on = false;
    setDragging(false);
  };

  const use = () => {
    const f = frameSize();
    const g = geo.current;
    const [OW, OH] = OUT[ar];
    const sx = -g.ox / g.scale;
    const sy = -g.oy / g.scale;
    const sw = f.w / g.scale;
    const sh = f.h / g.scale;
    const c = document.createElement('canvas');
    c.width = OW;
    c.height = OH;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, OW, OH);
    onDone(c.toDataURL('image/jpeg', 0.9));
  };

  const [ow, oh] = OUT[ar];

  return (
    <div data-drawer className="crop-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="crop-card" role="dialog" aria-modal="true" aria-label="Crop photo">
        <div className="crop-top">
          <h3>Reposition &amp; crop</h3>
          <p>Drag to move, slide to zoom. The frame is the exact area saved.</p>
        </div>
        <div className="crop-stage">
          <div
            ref={frameRef}
            className={`crop-frame ${dragging ? 'drag' : ''}`}
            style={{ '--ar': ar }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <img ref={imgRef} alt="" />
            <div className="crop-grid" />
          </div>
          <div className="crop-controls">
            <ZoomIcon out />
            <input
              type="range"
              className="crop-range"
              min="1"
              max="4"
              step="0.01"
              value={zoom}
              onChange={(e) => onZoom(parseFloat(e.target.value))}
              aria-label="Zoom"
            />
            <ZoomIcon />
          </div>
          <div className="crop-aspects" role="group" aria-label="Aspect ratio">
            {ASPECTS.map((a) => (
              <button key={a.ar} type="button" className={ar === a.ar ? 'on' : ''} onClick={() => setAr(a.ar)}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="crop-note flex items-center justify-between">
            <span>Output: {ow} × {oh} px</span>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => { touched.current = false; fitCover(); }}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="crop-foot">
          <Button variant="text" onClick={onCancel}>Cancel</Button>
          <Button onClick={use}>Use photo</Button>
        </div>
      </div>
    </div>
  );
}

// Inline SVG magnifier (+ / −) so the crop dialog needs no icon-font glyphs.
function ZoomIcon({ out = false }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {!out && <line x1="11" y1="8" x2="11" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

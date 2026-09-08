import { useRef, useState, useCallback } from 'react';

// Drag-to-reveal before/after comparison slider. `before` and `after` are
// image data URLs. The top layer (before) is clipped by a draggable handle.
export default function BeforeAfter({ before, after }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(50); // percent revealed of the "after" side
  const draggingRef = useRef(false);

  const moveTo = useCallback((clientX) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    setPos(p);
  }, []);

  const onDown = (e) => {
    draggingRef.current = true;
    boxRef.current?.setPointerCapture?.(e.pointerId);
    moveTo(e.clientX);
  };
  const onMove = (e) => {
    if (draggingRef.current) moveTo(e.clientX);
  };
  const onUp = () => {
    draggingRef.current = false;
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 4));
    if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 4));
  };

  return (
    <div
      ref={boxRef}
      className="ba-compare"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="slider"
      aria-label="Before / after comparison"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <img src={after} alt="After" className="ba-img" draggable="false" />
      <img
        src={before}
        alt="Before"
        className="ba-img ba-top"
        draggable="false"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <span className="ba-tag ba-tag-before">Before</span>
      <span className="ba-tag ba-tag-after">After</span>
      <div className="ba-handle" style={{ left: `${pos}%` }}>
        <span className="ba-knob">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M8 7 3 12l5 5v-3h8v3l5-5-5-5v3H8z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

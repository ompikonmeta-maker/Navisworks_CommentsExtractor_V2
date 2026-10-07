import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

// Animated lightbox. Enlarges a thumbnail to a centered full view using a FLIP
// transition: the image starts at the tapped thumbnail's on-screen rect, then
// springs to its target rect. Closing plays it in reverse back to the source.
export default function Lightbox({ src, alt, from, onClose }) {
  const imgRef = useRef(null);
  const [shown, setShown] = useState(false); // drives scrim fade + close button
  const [closing, setClosing] = useState(false);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Compute the centered target rect (contain within the viewport).
  const target = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw * 0.92;
    const maxH = vh * 0.9;
    const nw = imgRef.current?.naturalWidth || from.width;
    const nh = imgRef.current?.naturalHeight || from.height;
    const scale = Math.min(maxW / nw, maxH / nh, 1);
    const w = Math.max(nw * scale, Math.min(maxW, 320));
    const r = nh / nw;
    const fw = Math.min(w, maxW);
    const fh = Math.min(fw * r, maxH);
    return { w: fw, h: fh, x: (vw - fw) / 2, y: (vh - fh) / 2 };
  };

  const place = (rect) => {
    const img = imgRef.current;
    if (!img) return;
    img.style.width = `${rect.w}px`;
    img.style.height = `${rect.h}px`;
    img.style.left = `${rect.x}px`;
    img.style.top = `${rect.y}px`;
  };

  // Start at the thumbnail rect, then animate to the centered target.
  useLayoutEffect(() => {
    place(from);
    const to = target();
    if (reduce) {
      place(to);
      setShown(true);
      return;
    }
    requestAnimationFrame(() => {
      const img = imgRef.current;
      if (!img) return;
      img.style.transition = 'width 360ms cubic-bezier(0.05,0.7,0.1,1), height 360ms cubic-bezier(0.05,0.7,0.1,1), left 360ms cubic-bezier(0.05,0.7,0.1,1), top 360ms cubic-bezier(0.05,0.7,0.1,1)';
      place(to);
      setShown(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setShown(false);
    if (reduce) return onClose();
    place(from);
    setTimeout(onClose, 300);
    return undefined;
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  return (
    <div data-drawer className={`lb-scrim ${shown ? 'shown' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <button className="lb-close" onClick={close} aria-label="Close">
        <Icon name="close" />
      </button>
      <img ref={imgRef} className="lb-img" src={src} alt={alt} onClick={close} />
    </div>
  );
}

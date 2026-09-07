import { useRef, useLayoutEffect } from 'react';
import { revealCards } from '../lib/motion.js';

// Wraps a group of cards and plays the staggered fade-in-with-overshoot
// reveal on mount (and whenever `deps` change — e.g. data loaded or route
// switched). Animates its direct element children in document order.
export default function Reveal({ children, className = '', deps = [], as: Tag = 'div' }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const nodes = Array.from(ref.current.children);
    return revealCards(nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}

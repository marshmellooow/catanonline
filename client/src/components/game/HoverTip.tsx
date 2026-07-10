import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover-Tooltip via Portal (fix positioniert, damit `overflow`-Container ihn nicht abschneiden).
 * Der Wrapper-Span fängt Hover auch, wenn das Kind ein deaktivierter Button ist.
 */
export function HoverTip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = () => ref.current && setRect(ref.current.getBoundingClientRect());
  const hide = () => setRect(null);
  return (
    <span ref={ref} className={`hovertip-wrap${className ? ' ' + className : ''}`} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {rect &&
        createPortal(
          <div
            className="hover-tip"
            style={{ position: 'fixed', left: rect.left + rect.width / 2, top: rect.top - 8, transform: 'translate(-50%, -100%)' }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}

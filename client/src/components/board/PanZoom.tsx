import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2 } from '../../icons';

const MIN = 1;
const MAX = 5;
const TAP_SLOP = 10; // px Bewegung, ab der aus einem Tap eine Geste (Pan) wird

/**
 * Pinch-Zoom + Pan für das Spielbrett (v. a. große Karten auf Mobil bedienbar).
 *
 * Der Zoom wird **im SVG** angewandt: PanZoom setzt imperativ ein `transform` auf die
 * Zoom-Ebene (`<g data-zoom-layer>` in `Board.tsx`) — nicht per CSS auf einem Wrapper.
 * Das ist der Unterschied zwischen scharf und pixelig: ein CSS-`transform` (zumal mit
 * `will-change`) legt den Inhalt auf eine Compositor-Ebene, die einmal gerastert und
 * danach als Textur skaliert wird → beim Zoomen weich, und beim späteren Neurastern
 * springt der Text auf die Pixelkante. Ein SVG-`transform` ist dagegen Teil der
 * Geometrie: der Browser zeichnet die Pfade bei jeder Zoomstufe neu.
 *
 * Die Geste rechnet in Bildschirm-Pixeln, das SVG in viewBox-Einheiten — `screenToSvg`
 * rechnet einmal pro Frame über `getScreenCTM()` um (berücksichtigt auch das
 * Letterboxing von `preserveAspectRatio`).
 *
 * Tap-to-Place bleibt erhalten: `preventDefault` passiert NUR bei echter Geste
 * (Pinch oder Pan über TAP_SLOP), nie bei einem sauberen Tap — dessen `click`
 * erreicht dann das SVG-Element und platziert wie gewohnt. Der Browser rechnet das
 * SVG-Transform beim Hit-Test mit, d. h. im gezoomten Zustand trifft man die Ecke,
 * die visuell unter dem Finger liegt.
 */
export function PanZoom({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const raf = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  const g = useRef({
    single: false, // ein Finger unten
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    panning: false, // Schwelle überschritten → wir pannen (unterdrückt den Tap)
    pinching: false,
    startDist: 0,
    startScale: 1,
    focalCX: 0, // Inhaltspunkt unter dem Pinch-/Wheel-Fokus (bleibt fix)
    focalCY: 0,
  });

  /** Zoom-Ebene im SVG (dort wird transformiert, siehe Board.tsx). */
  const layerOf = (): SVGGElement | null => contentRef.current?.querySelector('svg [data-zoom-layer]') ?? null;
  const svgOf = (): SVGSVGElement | null => contentRef.current?.querySelector('svg') ?? null;

  /**
   * Setzt {scale,tx,ty} (Bildschirm-Pixel) als SVG-Transform auf die Zoom-Ebene.
   * Herleitung: das SVG bildet Nutzer-Einheiten mit Faktor k und Ursprung o auf den
   * Container ab (o enthält das Letterboxing von `preserveAspectRatio`). Gesucht ist
   * das SVG-Transform, das visuell dasselbe tut wie ein CSS `translate(t) scale(s)`:
   *   k·(s_svg·p + t_svg) + o  ==  s·(k·p + o) + t
   * ⇒ s_svg = s  und  t_svg = ((s−1)·o + t) / k
   */
  const writeTransform = () => {
    const layer = layerOf();
    const svg = svgOf();
    const c = containerRef.current;
    if (!layer || !svg || !c) return;
    const ctm = svg.getScreenCTM();
    if (!ctm || !ctm.a) return;
    const cr = c.getBoundingClientRect();
    const k = ctm.a;
    const ox = ctm.e - cr.left;
    const oy = ctm.f - cr.top;
    const { scale, tx, ty } = view.current;
    const sx = ((scale - 1) * ox + tx) / k;
    const sy = ((scale - 1) * oy + ty) / k;
    layer.setAttribute('transform', `translate(${sx} ${sy}) scale(${scale})`);
    c.dispatchEvent(new Event('catan:board-transform'));
  };

  const apply = (animate = false) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(raf.current);
    if (!animate || reduce) {
      writeTransform();
      return;
    }
    // Reset weich: das SVG-`transform`-Attribut lässt sich nicht per CSS-Transition
    // animieren (es ist kein CSS-Wert) → kurzer eigener Tween über rAF.
    const from = { ...view.current };
    const to = { scale: 1, tx: 0, ty: 0 };
    const t0 = performance.now();
    const D = 250;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / D);
      const e = 1 - (1 - p) * (1 - p); // ease-out
      view.current.scale = from.scale + (to.scale - from.scale) * e;
      view.current.tx = from.tx + (to.tx - from.tx) * e;
      view.current.ty = from.ty + (to.ty - from.ty) * e;
      writeTransform();
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const clamp = () => {
    const c = containerRef.current;
    if (!c) return;
    const v = view.current;
    v.scale = Math.min(MAX, Math.max(MIN, v.scale));
    if (v.scale <= 1.001) {
      v.scale = 1;
      v.tx = 0;
      v.ty = 0;
      return;
    }
    const W = c.clientWidth;
    const H = c.clientHeight;
    // Inhalt darf den Sichtbereich nicht als Lücke freigeben
    v.tx = Math.min(0, Math.max(W - W * v.scale, v.tx));
    v.ty = Math.min(0, Math.max(H - H * v.scale, v.ty));
  };

  const reset = () => {
    // Zielwerte NICHT vorher setzen — apply(true) tweent von hier nach 1/0/0.
    apply(true);
    setZoomed(false);
  };

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    const rel = (clientX: number, clientY: number) => {
      const r = c.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midRel = (t: TouchList) => rel((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);

    // Fokus-erhaltendes Zoomen: Inhaltspunkt unter (px,py) bleibt fix.
    const zoomAround = (px: number, py: number, newScale: number) => {
      const v = view.current;
      const focalCX = (px - v.tx) / v.scale;
      const focalCY = (py - v.ty) / v.scale;
      v.scale = newScale;
      v.tx = px - newScale * focalCX;
      v.ty = py - newScale * focalCY;
      clamp();
      apply();
    };

    const onStart = (e: TouchEvent) => {
      const st = g.current;
      if (e.touches.length === 1) {
        st.single = true;
        st.panning = false;
        st.pinching = false;
        st.startX = st.lastX = e.touches[0].clientX;
        st.startY = st.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        st.single = false;
        st.pinching = true;
        st.startDist = dist(e.touches) || 1;
        st.startScale = view.current.scale;
        const m = midRel(e.touches);
        st.focalCX = (m.x - view.current.tx) / view.current.scale;
        st.focalCY = (m.y - view.current.ty) / view.current.scale;
        e.preventDefault(); // Pinch = Geste, kein Tap
      }
    };

    const onMove = (e: TouchEvent) => {
      const st = g.current;
      const v = view.current;
      if (st.pinching && e.touches.length === 2) {
        e.preventDefault();
        const ratio = dist(e.touches) / st.startDist;
        const newScale = Math.min(MAX, Math.max(MIN, st.startScale * ratio));
        const m = midRel(e.touches);
        v.scale = newScale;
        v.tx = m.x - newScale * st.focalCX;
        v.ty = m.y - newScale * st.focalCY;
        clamp();
        apply();
        return;
      }
      if (st.single && e.touches.length === 1) {
        const t = e.touches[0];
        if (!st.panning) {
          if (Math.hypot(t.clientX - st.startX, t.clientY - st.startY) > TAP_SLOP && v.scale > 1) {
            st.panning = true; // ab jetzt Pan (unterdrückt den Tap)
          }
        }
        if (st.panning) {
          e.preventDefault();
          v.tx += t.clientX - st.lastX;
          v.ty += t.clientY - st.lastY;
          clamp();
          apply();
        }
        st.lastX = t.clientX;
        st.lastY = t.clientY;
      }
    };

    const onEnd = (e: TouchEvent) => {
      const st = g.current;
      if (e.touches.length === 0) {
        st.single = false;
        st.pinching = false;
        st.panning = false;
        setZoomed(view.current.scale > 1.001);
      } else if (e.touches.length === 1) {
        // Von Pinch auf einen Finger: Pan-Basis neu setzen, ohne Sprung
        st.single = true;
        st.pinching = false;
        st.panning = false;
        st.startX = st.lastX = e.touches[0].clientX;
        st.startY = st.lastY = e.touches[0].clientY;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.min(MAX, Math.max(MIN, view.current.scale * factor));
      zoomAround(p.x, p.y, newScale);
      setZoomed(view.current.scale > 1.001);
    };

    c.addEventListener('touchstart', onStart, { passive: false });
    c.addEventListener('touchmove', onMove, { passive: false });
    c.addEventListener('touchend', onEnd, { passive: false });
    c.addEventListener('touchcancel', onEnd, { passive: false });
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf.current);
      c.removeEventListener('touchstart', onStart);
      c.removeEventListener('touchmove', onMove);
      c.removeEventListener('touchend', onEnd);
      c.removeEventListener('touchcancel', onEnd);
      c.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={containerRef} className="panzoom">
      <div ref={contentRef} className="panzoom-content">
        {children}
      </div>
      {zoomed && (
        <button type="button" className="board-fit-btn" onClick={reset} title="Ansicht zurücksetzen" aria-label="Zoom zurücksetzen">
          <Maximize2 size={18} />
        </button>
      )}
    </div>
  );
}

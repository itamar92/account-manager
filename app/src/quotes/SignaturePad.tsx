import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface SignaturePadHandle {
  /** The signature as a transparent PNG, or null while nothing has been drawn. */
  toDataURL: () => string | null;
  clear: () => void;
}

const INK = '#1d1a2e';
const LINE_WIDTH = 2.6; // in CSS pixels, whatever the screen's density

/**
 * A box to sign in with a finger, a stylus or a mouse.
 *
 * Pointer Events, so a phone, a tablet and a computer are one code path, and `touch-action:
 * none`, so a finger drawing a signature draws it rather than scrolling the page. The canvas is
 * sized in the screen's own pixels (devicePixelRatio), so the ink is sharp on a phone rather than
 * a blur blown up from a quarter of the resolution.
 *
 * Every point is mapped through the canvas's current size, so a phone turned on its side in the
 * middle of signing keeps drawing where the finger is.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, {
  onChange?: (hasInk: boolean) => void;
  className?: string;
}>(function SignaturePad({ onChange, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const size = () => {
      // Resizing a canvas wipes it, so a signature already drawn keeps the size it was drawn at.
      if (inked.current) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pointOf = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    return { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio, ratio };
  };

  const stroke = (to: { x: number; y: number; ratio: number }) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    const from = last.current ?? to;
    ctx.strokeStyle = INK;
    ctx.lineWidth = LINE_WIDTH * to.ratio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    // A tap is a dot: a line from a point to itself draws nothing, so it is nudged.
    ctx.lineTo(to.x + (from === to ? 0.01 : 0), to.y);
    ctx.stroke();
    last.current = to;
    if (!inked.current) {
      inked.current = true;
      onChange?.(true);
    }
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = null;
    stroke(pointOf(e));
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    // The events the browser merged between two frames: without them a fast stroke is a polygon.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) stroke(pointOf(ev));
  };

  const up = () => { last.current = null; };

  useImperativeHandle(ref, () => ({
    toDataURL: () => (inked.current ? canvasRef.current!.toDataURL('image/png') : null),
    clear: () => {
      const canvas = canvasRef.current!;
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      inked.current = false;
      last.current = null;
      onChange?.(false);
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      aria-label="מסגרת לחתימה"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ touchAction: 'none' }}
      className={`block w-full h-44 bg-surface border-2 border-dashed border-line-strong rounded-xl cursor-crosshair ${className ?? ''}`}
    />
  );
});

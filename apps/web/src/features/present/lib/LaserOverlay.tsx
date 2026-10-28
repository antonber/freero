// Draws every laser trail on this screen (mine at once, others' from presence) and fades them.
// A canvas in screen space, redrawn each frame only while a trail is still visible.
import { useEffect, useRef } from 'react';
import { usePeers, type Editor } from '@engine';
import { EMPTY_TRAIL, FADE_MS, mergeTrail, myTrail, onMyTrail, readLaser, type Trail } from './laser';
import { readExt } from './model';

export function LaserOverlay({ editor }: { editor: Editor }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const trails = useRef(new Map<number, { color: string; trail: Trail }>());
  const raf = useRef(0);
  const peers = usePeers();

  const draw = () => {
    raf.current = 0;
    const c = canvas.current;
    if (!c) return;
    const { width, height } = editor.getViewportSize();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const now = performance.now();
    const all: Array<{ color: string; trail: Trail }> = [...trails.current.values(), { color: editor.user.color, trail: myTrail(editor) }];
    let alive = false;
    for (const { color, trail } of all) {
      const pts = trail.pts.filter((p) => now - p.at < FADE_MS);
      if (!pts.length) continue;
      alive = true;
      const screen = pts.map((p) => ({ ...editor.worldToScreen(p), life: 1 - (now - p.at) / FADE_MS }));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < screen.length; i++) {
        const a = screen[i - 1];
        const b = screen[i];
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 + 4 * b.life;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const head = screen[screen.length - 1];
      ctx.globalAlpha = Math.max(0, head.life);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (alive) raf.current = requestAnimationFrame(draw);
  };
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  // Others' points as they arrive (presence re-sends seen points: mergeTrail keeps only new ones).
  useEffect(() => {
    const now = performance.now();
    const seen = new Set<number>();
    for (const p of peers) {
      const laser = readLaser(readExt(p).laser);
      const prev = trails.current.get(p.clientId);
      if (!laser && !prev) continue;
      seen.add(p.clientId);
      trails.current.set(p.clientId, { color: p.user?.color ?? '#e5484d', trail: mergeTrail(prev?.trail ?? EMPTY_TRAIL, laser, now) });
    }
    for (const id of [...trails.current.keys()]) if (!seen.has(id)) trails.current.delete(id);
    schedule();
  });

  useEffect(() => {
    const offMine = onMyTrail(editor, schedule);
    const offCam = editor.on('camera', schedule);
    return () => {
      offMine();
      offCam();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return <canvas ref={canvas} className="fr-present-laser" aria-hidden />;
}

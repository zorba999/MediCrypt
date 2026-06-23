"use client";

import { useEffect, useRef } from "react";

/** Subtle drifting particle field with proximity links — a quiet "secure network" feel. */
export function BgCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cv = ref.current as HTMLCanvasElement;
    const c = cv.getContext("2d") as CanvasRenderingContext2D;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const COUNT = 64;
    const pts: { x: number; y: number; vx: number; vy: number }[] = [];

    function resize() {
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      pts.length = 0;
      for (let i = 0; i < COUNT; i++) {
        pts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
        });
      }
    }

    function themeColor() {
      const light =
        document.documentElement.getAttribute("data-theme") === "light";
      return light ? "64, 80, 140" : "120, 170, 230";
    }

    function tick() {
      c.clearRect(0, 0, w, h);
      const rgb = themeColor();
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 130 * 130) {
            const o = (1 - d2 / (130 * 130)) * 0.5;
            c.strokeStyle = `rgba(${rgb}, ${o})`;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(b.x, b.y);
            c.stroke();
          }
        }
        c.fillStyle = `rgba(${rgb}, 0.7)`;
        c.beginPath();
        c.arc(a.x, a.y, 1.5, 0, Math.PI * 2);
        c.fill();
      }
      raf = requestAnimationFrame(tick);
    }

    resize();
    seed();
    tick();
    const onResize = () => {
      resize();
      seed();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className="bg-canvas" aria-hidden />;
}

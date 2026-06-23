"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&$@/<>*";

/**
 * Reveals `text` with a decryption-style scramble: glyphs churn, then resolve
 * left-to-right into the real characters. Used for the "decrypting" moment.
 */
export function ScrambleText({
  text,
  duration = 1400,
  onDone,
  className,
}: {
  text: string;
  duration?: number;
  onDone?: () => void;
  className?: string;
}) {
  const [out, setOut] = useState("");
  const [scrambling, setScrambling] = useState(true);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const len = text.length;

    function frame(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const revealed = Math.floor(t * len);
      let s = "";
      for (let i = 0; i < len; i++) {
        if (i < revealed || text[i] === " ") s += text[i];
        else s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setOut(s);
      if (t < 1) {
        raf.current = requestAnimationFrame(frame);
      } else {
        setOut(text);
        setScrambling(false);
        onDone?.();
      }
    }
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, duration]);

  return (
    <p className={`${className || ""} ${scrambling ? "scrambling" : ""}`}>{out}</p>
  );
}

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 to `value` over `duration` ms using easeOutCubic.
 * Returns a formatted string (with optional prefix/suffix and decimals).
 */
export function useCountUp(
  value: number,
  opts: { duration?: number; decimals?: number; prefix?: string; suffix?: string } = {}
) {
  const { duration = 900, decimals = 0, prefix = "", suffix = "" } = opts;
  const [n, setN] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = n;
    startRef.current = null;
    let raf = 0;
    const step = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(fromRef.current + (value - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const formatted =
    decimals > 0
      ? n.toFixed(decimals)
      : Math.round(n).toLocaleString();
  return `${prefix}${formatted}${suffix}`;
}

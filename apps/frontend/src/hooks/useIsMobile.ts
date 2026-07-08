import { useEffect, useState } from 'react';

/**
 * True below Tailwind's `sm` breakpoint (640px). Used where a component
 * can't respond to CSS breakpoints alone — e.g. Recharts props like
 * `<YAxis width>`, which take a plain number, not a className.
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}

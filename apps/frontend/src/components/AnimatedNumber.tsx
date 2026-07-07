import { useEffect, useRef } from 'react';
import { animate, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { motion } from 'motion/react';

interface AnimatedNumberProps {
  /** The already-formatted target string (e.g. "$1.2 M", "1,204"). */
  value: string;
  className?: string;
}

/**
 * Counts up from the previous value to the new one whenever `value` changes
 * (filter applied, page loaded). Parses the leading numeric run out of an
 * already-formatted string and re-inserts it, so it works with any of
 * utils/format.ts's currency/number formatters without re-implementing them.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const parsed = parseLeadingNumber(value);
  const motionValue = useMotionValue(parsed?.number ?? 0);
  const rounded = useTransform(motionValue, (v) => formatWith(v, parsed));
  const prevRef = useRef<string>(value);

  useEffect(() => {
    if (!parsed) return;
    if (reducedMotion) {
      motionValue.set(parsed.number);
      return;
    }
    const controls = animate(motionValue, parsed.number, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
    });
    prevRef.current = value;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!parsed) return <span className={className}>{value}</span>;
  return <motion.span className={className}>{rounded}</motion.span>;
}

interface ParsedNumber {
  prefix: string;
  number: number;
  suffix: string;
  decimals: number;
}

/** Split "‑$1,204.5 M" into prefix "‑$", number 1204.5, suffix " M". */
function parseLeadingNumber(value: string): ParsedNumber | null {
  const match = value.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, prefix, numStr, suffix] = match;
  const number = Number(numStr!.replace(/,/g, ''));
  if (Number.isNaN(number)) return null;
  const decimals = numStr!.includes('.') ? numStr!.split('.')[1]!.length : 0;
  return { prefix: prefix ?? '', number, suffix: suffix ?? '', decimals };
}

function formatWith(v: number, parsed: ParsedNumber | null): string {
  if (!parsed) return String(v);
  const body = parsed.decimals > 0 ? v.toFixed(parsed.decimals) : Math.round(v).toLocaleString('es-MX');
  return `${parsed.prefix}${body}${parsed.suffix}`;
}

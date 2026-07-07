import type { Transition, Variants } from 'motion/react';

/**
 * Shared motion language for the portal: content "comes into view" the way a
 * public record becomes visible on request — quick, confident, no bounce.
 * Every animated surface in the app should reuse these instead of inventing
 * bespoke easing/durations, so the motion reads as one deliberate language
 * rather than scattered effects.
 */

/** Crisp, institutional easing — reveals, never bounces. */
export const REVEAL_EASE = [0.16, 1, 0.3, 1] as const;

export const revealTransition: Transition = {
  duration: 0.32,
  ease: REVEAL_EASE,
};

/** A single element rising into place. */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: revealTransition },
};

/** Parent wrapper for a list whose children use `staggerItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

/** Row/card-level child of `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: REVEAL_EASE } },
};

/** Slide-over drawer (VigenteDetailPanel and similar). */
export const drawerVariants: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: { duration: 0.34, ease: REVEAL_EASE } },
  exit: { x: '100%', transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
};

/** Full-page content transition, keyed by route in Layout. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: REVEAL_EASE } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

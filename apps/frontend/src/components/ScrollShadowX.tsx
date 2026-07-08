import { type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Horizontal-scroll wrapper that shows a soft edge shadow only on the side(s)
 * that actually have more content to scroll to — pure CSS (no scroll
 * listener): two gradients scroll WITH the content to mask the shadow near
 * each end, two more stay fixed to the viewport to actually draw it. When a
 * table fits without scrolling, both cover gradients overlap the full width
 * and the shadows never appear.
 *
 * Assumes a white background behind the scroll area (every table in the
 * portal sits on a Card, which is white) — pass `bg` to override.
 */
export function ScrollShadowX({ children, className, bg = 'white' }: { children: ReactNode; className?: string; bg?: string }) {
  return (
    <div
      className={clsx('overflow-x-auto', className)}
      style={{
        backgroundImage: `linear-gradient(to right, ${bg}, ${bg}),
          linear-gradient(to left, ${bg}, ${bg}),
          linear-gradient(to right, rgba(15,23,42,0.12), rgba(15,23,42,0)),
          linear-gradient(to left, rgba(15,23,42,0.12), rgba(15,23,42,0))`,
        backgroundRepeat: 'no-repeat',
        backgroundColor: bg,
        backgroundSize: '32px 100%, 32px 100%, 12px 100%, 12px 100%',
        backgroundPosition: 'left center, right center, left center, right center',
        backgroundAttachment: 'local, local, scroll, scroll',
      }}
    >
      {children}
    </div>
  );
}

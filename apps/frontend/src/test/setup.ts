import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup between tests so each test starts with a fresh DOM.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia; Layout/etc. don't use it directly but
// recharts ResponsiveContainer reads window dimensions. Provide stubs.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// ResponsiveContainer reads clientWidth/Height from its parent; default to
// non-zero values so the charts render deterministically.
if (!Element.prototype.getBoundingClientRect) {
  Element.prototype.getBoundingClientRect = () => ({ width: 600, height: 320, top: 0, left: 0, right: 600, bottom: 320, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

// ResizeObserver is used by recharts; jsdom doesn't ship it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

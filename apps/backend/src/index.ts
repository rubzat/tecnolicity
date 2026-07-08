import { pathToFileURL } from 'node:url';
import { startServer } from './presentation/server.js';

// Only start listening when executed directly (not when imported by tests).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  startServer().catch((err: unknown) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

export { createApp } from './presentation/server.js';

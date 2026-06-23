import { pathToFileURL } from 'node:url';
import { startServer } from './presentation/server.js';

// Only start listening when executed directly (not when imported by tests).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  startServer();
}

export { createApp } from './presentation/server.js';

// Entry point: `npm start`
import { createApp } from './app.js';

const app = await createApp();
await app.start();

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => app.log.error('unhandled rejection', err instanceof Error ? err : new Error(String(err))));

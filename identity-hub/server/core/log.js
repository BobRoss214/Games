// Minimal log. It never writes request data, addresses, numbers, or IP addresses.
// Only short operational messages and server errors.
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function createLog(config) {
  const level = LEVELS[config.logLevel] ?? 3;
  const out = (name, min) => (msg, detail) => {
    if (level < min) return;
    const line = `${new Date().toISOString().slice(0, 19)}Z ${name} ${msg}`;
    if (detail instanceof Error) console.error(line + ': ' + (detail.stack || detail.message));
    else if (detail !== undefined) console.error(line + ' ' + JSON.stringify(detail));
    else console.error(line);
  };
  return { error: out('ERROR', 1), warn: out('WARN', 2), info: out('INFO', 3), debug: out('DEBUG', 4) };
}

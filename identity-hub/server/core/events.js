// Live updates to open browser tabs (server-sent events).
// An event says only "something changed" and its kind. It carries no content.
const MAX_STREAMS_PER_ACCOUNT = 6;

export function createEvents() {
  const subs = new Map(); // accountId -> Set<res>
  const heartbeat = setInterval(() => {
    for (const set of subs.values()) for (const res of set) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  return {
    // Starts an event stream on the response. Returns false if the account has too many streams.
    subscribe(accountId, req, res) {
      let set = subs.get(accountId);
      if (!set) { set = new Set(); subs.set(accountId, set); }
      if (set.size >= MAX_STREAMS_PER_ACCOUNT) return false;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 5000\n\n');
      set.add(res);
      req.on('close', () => {
        set.delete(res);
        if (set.size === 0) subs.delete(accountId);
      });
      return true;
    },
    // type: "mail" | "text" | "call" | "balance" | "number" | "aliases" | "mailbox" | "phones"
    publish(accountId, type, data = {}) {
      const set = subs.get(accountId);
      if (!set) return;
      const frame = `event: change\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      for (const res of set) res.write(frame);
    },
    closeAccount(accountId) {
      const set = subs.get(accountId);
      if (set) for (const res of set) res.end();
      subs.delete(accountId);
    },
    stop() {
      clearInterval(heartbeat);
      for (const set of subs.values()) for (const res of set) res.end();
      subs.clear();
    },
  };
}

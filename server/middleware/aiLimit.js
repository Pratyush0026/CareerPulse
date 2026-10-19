// Guards the expensive AI endpoints: one AI request per user at a time, and a cap per
// time window. In memory is enough for a single-server app.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 15;

const inFlight = new Set();
const history = new Map();

export default function aiLimit(req, res, next) {
  const key = String(req.userId);
  const now = Date.now();
  const recent = (history.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (inFlight.has(key)) {
    return res.status(409).json({ error: 'Another AI request is still running. Please wait for it to finish.', code: 'AI_BUSY' });
  }
  if (recent.length >= MAX_PER_WINDOW) {
    const retryIn = Math.ceil((WINDOW_MS - (now - recent[0])) / 60000);
    return res.status(429).json({ error: `Too many AI requests. Try again in about ${retryIn} min.`, code: 'AI_RATE_LIMIT' });
  }

  recent.push(now);
  history.set(key, recent);
  inFlight.add(key);
  res.on('close', () => inFlight.delete(key));
  next();
}

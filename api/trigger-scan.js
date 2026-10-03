import { getLatestRun, runAgeMs, dispatchScan } from '../lib/github.js';

// Manual "Scan Now" endpoint. Unauthenticated by design (the button lives in a
// public page), so abuse is bounded by a server-side cooldown instead: refuse
// while a run is queued/in progress or if the last run started < 30 min ago.
const COOLDOWN_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return res.status(500).json({ error: 'GitHub PAT is missing on the server.' });
  }

  try {
    const run = await getLatestRun(token);
    if (run && run.status !== 'completed') {
      return res.status(429).json({ error: `A scan is already ${run.status.replace('_', ' ')}.` });
    }
    if (run && runAgeMs(run) < COOLDOWN_MS) {
      const waitMin = Math.ceil((COOLDOWN_MS - runAgeMs(run)) / 60000);
      res.setHeader('Retry-After', String(waitMin * 60));
      return res.status(429).json({ error: `A scan ran recently. Try again in ${waitMin} min.` });
    }

    await dispatchScan(token);
    return res.status(200).json({ success: true, message: 'Scan triggered successfully.' });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

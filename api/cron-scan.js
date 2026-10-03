import { getLatestRun, runAgeMs, dispatchScan } from '../lib/github.js';

// Backup trigger invoked by Vercel Cron (see vercel.json) a few hours after
// GitHub's own schedule. GitHub sometimes drops scheduled runs; if no run has
// started in the last 6 hours, this dispatches one. Otherwise it's a no-op.
const RECENT_RUN_MS = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  // If it isn't set, the endpoint is still safe: it is idempotent.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return res.status(500).json({ error: 'GitHub PAT is missing on the server.' });
  }

  try {
    const run = await getLatestRun(token);
    if (run && (run.status !== 'completed' || runAgeMs(run) < RECENT_RUN_MS)) {
      return res.status(200).json({ dispatched: false, reason: 'Recent run exists', run: run.html_url });
    }
    await dispatchScan(token);
    return res.status(200).json({ dispatched: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

import { getLatestRun, runAgeMs, dispatchScan } from '../lib/github.js';

// Scheduled scan trigger. Callers:
//   - cron-job.org, weekdays 22:15 UTC (primary; ~1h15 after the close), and
//   - Vercel Cron (vercel.json), 02:30 UTC Tue-Sat (backup).
// GitHub's own schedule in daily-scan.yml is a second backup.
//
// Requires `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it
// automatically once CRON_SECRET is set; cron-job.org sends it as a custom
// header). Does nothing while a scan is queued/running or if one succeeded in
// the last 6 hours; a failed run is retried. The screener itself also skips
// when the latest session is already scanned (e.g. market holidays).
const RECENT_RUN_MS = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured on the server.' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return res.status(500).json({ error: 'GitHub PAT is missing on the server.' });
  }

  try {
    const run = await getLatestRun(token);
    if (run && run.status !== 'completed') {
      return res.status(200).json({ dispatched: false, reason: `Scan ${run.status}`, run: run.html_url });
    }
    if (run && run.conclusion === 'success' && runAgeMs(run) < RECENT_RUN_MS) {
      return res.status(200).json({ dispatched: false, reason: 'Recent successful scan', run: run.html_url });
    }
    await dispatchScan(token);
    return res.status(200).json({ dispatched: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

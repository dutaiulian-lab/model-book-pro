import { getLatestRun } from '../lib/github.js';

// Latest scan workflow run, for the dashboard's status badge. Every open tab
// polls this, and each uncached call spends GitHub API quota on the PAT that
// /api/cron-scan also needs, so responses are cached at the edge for 15s.
export default async function handler(req, res) {
  // Errors must never be cached, or a transient GitHub failure would stick.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return res.status(500).json({ error: 'GitHub PAT is missing on the server.' });
  }

  try {
    const run = await getLatestRun(token);
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    if (!run) return res.status(200).json({ success: true, status: 'unknown' });
    return res.status(200).json({
      success: true,
      status: run.status, // e.g. "in_progress", "completed", "queued"
      conclusion: run.conclusion, // e.g. "success", "failure"
      updated_at: run.updated_at,
      url: run.html_url,
    });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

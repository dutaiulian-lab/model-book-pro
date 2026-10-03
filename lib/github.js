// Shared GitHub Actions helpers for the /api functions.
const REPO = 'dutaiulian-lab/model-book-pro';
const WORKFLOW = 'daily-scan.yml';
const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;

function headers(token) {
  return {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`,
    'User-Agent': 'Model-Book-Pro',
  };
}

/** Returns the most recent workflow run, or null if there are none. */
export async function getLatestRun(token) {
  const res = await fetch(`${API}/runs?per_page=1`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub runs lookup failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.workflow_runs?.[0] ?? null;
}

/** Milliseconds since the run started (falls back to created_at). */
export function runAgeMs(run) {
  return Date.now() - new Date(run.run_started_at || run.created_at).getTime();
}

/** Dispatches the scan workflow on main. Throws on failure. */
export async function dispatchScan(token) {
  const res = await fetch(`${API}/dispatches`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return res.status(500).json({ error: 'GitHub PAT is missing on the server.' });
  }

  try {
    const response = await fetch(
      'https://api.github.com/repos/dutaiulian-lab/model-book-pro/actions/workflows/daily-scan.yml/runs?per_page=1',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${token}`,
          'User-Agent': 'Model-Book-Pro-Status'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.workflow_runs && data.workflow_runs.length > 0) {
        const run = data.workflow_runs[0];
        return res.status(200).json({ 
            success: true, 
            status: run.status, // e.g. "in_progress", "completed", "queued"
            conclusion: run.conclusion, // e.g. "success", "failure"
            updated_at: run.updated_at,
            url: run.html_url
        });
      } else {
        return res.status(200).json({ success: true, status: 'unknown' });
      }
    } else {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

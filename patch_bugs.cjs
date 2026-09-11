const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// Fix destructuring
code = code.replace(
  'const { timestamp, total_scanned, matches } = data;',
  'const { timestamp, total_scanned } = data;\n  const matches = data?.matches || [];'
);

// Fix auto-refresh
code = code.replace(
  `// Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (data.status === 'completed' && data.conclusion === 'success') {
             // Stop polling
             if (interval) clearInterval(interval);
          }`,
  `// Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (data.status === 'completed' && data.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }`
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

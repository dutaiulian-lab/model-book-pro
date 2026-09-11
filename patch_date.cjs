const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

code = code.replace(
  "new Date(timestamp).toLocaleString(undefined, { hour12: false })",
  "new Date(timestamp).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })"
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

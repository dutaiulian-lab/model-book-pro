const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

code = code.replace(
  'new Date(timestamp).toLocaleString()',
  'new Date(timestamp).toLocaleString(undefined, { hour12: false })'
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

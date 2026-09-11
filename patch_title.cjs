const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

code = code.replace(/Last Daily Scan/g, 'Last Scan');
code = code.replace(/LAST DAILY SCAN/g, 'LAST SCAN');

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

code = code.replace(
  '<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">',
  '<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">'
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

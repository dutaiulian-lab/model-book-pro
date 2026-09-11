const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// Replace the handleClickOutside logic
code = code.replace(
  `if (gridRef.current && !gridRef.current.contains(event.target)) {`,
  `if (!event.target.closest('[data-screener-card="true"]')) {`
);

// We no longer need gridRef on the grid container
code = code.replace(
  '<div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">',
  '<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">'
);

// Add the data attribute to the card container
// The card starts with: <div key={idx} className="bg-card border border-border/80...
code = code.replace(
  'className="bg-card border border-border/80 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-primary/50 transition-all flex flex-col"',
  'data-screener-card="true" className="bg-card border border-border/80 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-primary/50 transition-all flex flex-col"'
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

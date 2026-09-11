const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

const targetDetails = `<div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-4 h-4"/> EPS Growth (YoY)</span>`;

const newDetails = `<div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Short Interest</span>
                    <span className="font-mono text-foreground/80">{((match.short_percent || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Shares Float</span>
                    <span className="font-mono text-foreground/80">{match.float_shares ? (match.float_shares / 1000000).toFixed(1) + 'M' : 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><BarChart3 className="w-4 h-4"/> EPS Growth (YoY)</span>`;

code = code.replace(targetDetails, newDetails);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

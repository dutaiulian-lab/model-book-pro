const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// Insert badges under price
const targetHeader = `<div className="text-[10px] uppercase font-bold text-muted-foreground pb-1">Live</div>
                    </div>
                  </div>`;
const newHeader = `<div className="text-[10px] uppercase font-bold text-muted-foreground pb-1">Live</div>
                    </div>
                    {match.sector && match.sector !== "Unknown" && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                            <span className="bg-muted text-muted-foreground text-[9px] font-bold uppercase px-2 py-0.5 rounded">{match.sector}</span>
                            {match.float_shares > 0 && match.float_shares < 50000000 && (
                                <span className="bg-purple-500/10 text-purple-500 text-[9px] font-bold uppercase px-2 py-0.5 rounded">⚡ Low Float</span>
                            )}
                            {match.short_percent >= 0.10 && (
                                <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold uppercase px-2 py-0.5 rounded">🔥 High Short</span>
                            )}
                        </div>
                    )}
                  </div>`;
code = code.replace(targetHeader, newHeader);

// Insert Short Interest and Float into expanded details
const targetDetails = `<div className="flex justify-between items-center text-sm border-b border-border/30 pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> EPS Growth (YoY)</span>`;

const newDetails = `<div className="flex justify-between items-center text-sm border-b border-border/30 pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Short Interest</span>
                    <span className="font-mono text-foreground/80">{((match.short_percent || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-border/30 pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Target className="w-4 h-4"/> Shares Float</span>
                    <span className="font-mono text-foreground/80">{match.float_shares ? (match.float_shares / 1000000).toFixed(1) + 'M' : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-border/30 pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> EPS Growth (YoY)</span>`;
code = code.replace(targetDetails, newDetails);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

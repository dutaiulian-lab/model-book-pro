const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

const targetBlock = `<div className="mt-5 p-3 rounded-xl bg-muted/20 border border-border/50 shrink-0">
                  <div className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1 mb-1.5">
                    <ShieldCheck className="w-3 h-3" /> Trading Plan
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed">
                    Set entry trigger slightly above yesterday's high. Set hard stop-loss at exactly <strong>\${ema21.toFixed(2)}</strong>.
                  </p>
                </div>`;

code = code.replace(targetBlock, '');

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

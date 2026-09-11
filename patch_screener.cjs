const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// 1. Add scanning state
code = code.replace(
  'const [copied, setCopied] = useState(false);',
  'const [copied, setCopied] = useState(false);\n  const [isScanning, setIsScanning] = useState(false);'
);

// 2. Add triggerScan function
const triggerScanFunc = `
  const triggerScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/trigger-scan', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        alert("Failed to trigger scan: " + result.error);
      } else {
        alert("Scan triggered successfully! The background job will take a few minutes to complete. The page will auto-refresh when new data is available (if you reload in a few minutes).");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setIsScanning(false);
  };
`;
code = code.replace(
  'const toggleCard = (ticker) => setExpandedCards(prev => ({...prev, [ticker]: !prev[ticker]}));',
  'const toggleCard = (ticker) => setExpandedCards(prev => ({...prev, [ticker]: !prev[ticker]}));\n' + triggerScanFunc
);

// 3. Cache bust fetch
code = code.replace(
  "fetch('/market-state.json')",
  "fetch(`/market-state.json?t=${Date.now()}`)"
);

// 4. Add Scan Now button in HUD stats (next to Last Daily Scan)
const hudStatsTarget = `          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Last Daily Scan</div>`;
const newHudStats = `          <div className="text-muted-foreground text-xs font-black uppercase tracking-wider mb-2 flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Last Daily Scan</span>
            <button 
              onClick={triggerScan} 
              disabled={isScanning}
              className="bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1 rounded-md text-[10px] tracking-wider transition-colors disabled:opacity-50"
            >
              {isScanning ? 'TRIGGERING...' : 'SCAN NOW'}
            </button>
          </div>`;
code = code.replace(hudStatsTarget, newHudStats);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// Add scanStatus state
code = code.replace(
  'const [isScanning, setIsScanning] = useState(false);',
  `const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);

  useEffect(() => {
    let interval;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scan-status');
        const data = await res.json();
        if (data.success) {
          setScanStatus(data);
          // Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (data.status === 'completed' && data.conclusion === 'success') {
             // Stop polling
             if (interval) clearInterval(interval);
          }
        }
      } catch(e) {}
    };
    
    checkStatus();
    interval = setInterval(checkStatus, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);`
);

// Update triggerScan function to not just alert, but start polling immediately
code = code.replace(
  `alert("Scan triggered successfully! The background job will take a few minutes to complete. The page will auto-refresh when new data is available (if you reload in a few minutes).");`,
  `setScanStatus({ status: 'queued' });`
);


// Update the UI in the HUD Stats
const hudStatsTarget = `<span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Last Daily Scan</span>`;
const newHudStats = `<span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5"/> Last Daily Scan
              {scanStatus && scanStatus.status === 'in_progress' && <span className="ml-2 text-emerald-400 animate-pulse text-[9px]">⚙️ SCANNING...</span>}
              {scanStatus && scanStatus.status === 'queued' && <span className="ml-2 text-yellow-400 text-[9px]">⏳ QUEUED</span>}
              {scanStatus && scanStatus.status === 'completed' && scanStatus.conclusion === 'failure' && <span className="ml-2 text-rose-500 text-[9px]">⚠️ FAILED</span>}
            </span>`;
            
code = code.replace(hudStatsTarget, newHudStats);

// Disable the button while scanning, or show "SCANNING"
code = code.replace(
  `disabled={isScanning}`,
  `disabled={isScanning || (scanStatus && (scanStatus.status === 'in_progress' || scanStatus.status === 'queued'))}`
);
code = code.replace(
  `{isScanning ? 'TRIGGERING...' : 'SCAN NOW'}`,
  `{isScanning || (scanStatus && (scanStatus.status === 'in_progress' || scanStatus.status === 'queued')) ? 'RUNNING...' : 'SCAN NOW'}`
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

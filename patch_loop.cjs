const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

const targetLoop = `useEffect(() => {
    let interval;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scan-status');
        const data = await res.json();
        if (data.success) {
          setScanStatus(data);
          // Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (data.status === 'completed' && data.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }
        }
      } catch(e) {}
    };
    
    checkStatus();
    interval = setInterval(checkStatus, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);`;

const newLoop = `useEffect(() => {
    let interval;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scan-status');
        const data = await res.json();
        if (data.success) {
          setScanStatus(data);
          // Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (isScanning && data.status === 'completed' && data.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }
        }
      } catch(e) {}
    };
    
    checkStatus();
    interval = setInterval(checkStatus, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [isScanning]);`;

code = code.replace(targetLoop, newLoop);
fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

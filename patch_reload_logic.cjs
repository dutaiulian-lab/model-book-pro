const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

const targetState = `const [scanStatus, setScanStatus] = useState(null);`;
const newState = `const [scanStatus, setScanStatus] = useState(null);\n  const [hasSeenInProgress, setHasSeenInProgress] = useState(false);`;
code = code.replace(targetState, newState);

const targetLoop = `// Auto-refresh the page if a scan just completed successfully and we were previously tracking it
          if (isScanning && data.status === 'completed' && data.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }`;

const newLoop = `if (data.status === 'in_progress' || data.status === 'queued') {
            setHasSeenInProgress(true);
          }
          // Auto-refresh the page if a scan just completed successfully and we actually saw it running
          if (isScanning && hasSeenInProgress && data.status === 'completed' && data.conclusion === 'success') {
             if (interval) clearInterval(interval);
             setTimeout(() => window.location.reload(), 1500);
          }`;
code = code.replace(targetLoop, newLoop);

const targetDeps = `}, [isScanning]);`;
const newDeps = `}, [isScanning, hasSeenInProgress]);`;
code = code.replace(targetDeps, newDeps);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);

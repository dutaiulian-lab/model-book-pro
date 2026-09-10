import React from 'react';
import ScreenerDashboard from './components/ScreenerDashboard';
import { Target, Activity, ShieldAlert } from 'lucide-react';

function App() {
  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground flex items-center gap-3">
            <Target className="text-primary w-8 h-8" />
            Model Book Pro
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Institutional Swing Trading Engine &bull; Minimum Risk Entries</p>
        </div>
        <div className="flex gap-4 text-xs font-mono">
          <div className="bg-card border border-border px-3 py-1.5 rounded-lg flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            <span className="text-emerald-500">Live Scanner Active</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        <ScreenerDashboard />
      </main>
    </div>
  );
}

export default App;

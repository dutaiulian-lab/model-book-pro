import React, { useState, useEffect } from 'react';
import ScreenerDashboard from './components/ScreenerDashboard';
import { Target, Activity, ShieldAlert, Sun, Moon } from 'lucide-react';

function App() {

  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("theme") !== "light";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

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
            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-500">Live Scanner Active</span>
          </div>
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-1.5 rounded-lg bg-card hover:bg-muted border border-border text-foreground transition-all cursor-pointer flex items-center justify-center"
            title="Toggle Theme"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-600" />}
          </button>
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

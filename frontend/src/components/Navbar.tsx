import React, { useEffect, useState } from 'react';
import {
  Activity,
  Layers,
  Cpu,
  Smartphone,
  Monitor,
  Key,
} from 'lucide-react';

interface NavbarProps {
  onOpenStats: () => void;
  onOpenProviders: () => void;
  onOpenKeys: () => void;
  onReset: () => void;
  viewMode: 'mobile' | 'desktop';
  setViewMode: (mode: 'mobile' | 'desktop') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenStats,
  onOpenProviders,
  onOpenKeys,
  onReset,
  viewMode,
  setViewMode,
}) => {
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/health')
      .then((res) => {
        if (res.ok) setBackendHealthy(true);
        else setBackendHealthy(false);
      })
      .catch(() => setBackendHealthy(false));
  }, []);

  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-slate-800/80 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <button
          onClick={onReset}
          className="flex items-center gap-2.5 text-left group focus:outline-none"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-mesh-accent via-cyan-400 to-mesh-purple p-0.5 shadow-lg shadow-mesh-accent/20">
            <div className="w-full h-full bg-mesh-dark rounded-[7px] flex items-center justify-center">
              <Cpu className="w-4 h-4 text-mesh-accent" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base tracking-tight text-white group-hover:text-mesh-accent transition-colors">
                Model<span className="text-mesh-accent">Mesh</span>
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-mesh-accent/10 text-mesh-accent border border-mesh-accent/30">
                Phase 1
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono hidden sm:block">
              Universal AI Workload Router
            </p>
          </div>
        </button>

        {/* Center/Right Actions */}
        <div className="flex items-center gap-2">
          {/* Health Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] font-mono">
            <div
              className={`w-2 h-2 rounded-full ${
                backendHealthy === true
                  ? 'bg-emerald-400 animate-pulse'
                  : backendHealthy === false
                  ? 'bg-rose-400'
                  : 'bg-amber-400'
              }`}
            />
            <span className="text-slate-300">
              {backendHealthy === true ? 'Core Engine Online' : 'Engine Connecting...'}
            </span>
          </div>

          {/* Mode Switcher (Mobile vs Desktop Studio) */}
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('mobile')}
              title="Mobile Phone View"
              className={`px-2 py-1 rounded-md text-xs font-mono flex items-center gap-1 transition-all ${
                viewMode === 'mobile'
                  ? 'bg-mesh-accent text-black font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Phone</span>
            </button>
            <button
              onClick={() => setViewMode('desktop')}
              title="Laptop / Desktop Studio View"
              className={`px-2 py-1 rounded-md text-xs font-mono flex items-center gap-1 transition-all ${
                viewMode === 'desktop'
                  ? 'bg-mesh-accent text-black font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Studio</span>
            </button>
          </div>

          {/* Key Vault, Models & Stats Buttons */}
          <button
            onClick={onOpenKeys}
            title="Provider Key Vault"
            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-750 border border-slate-700/60 text-slate-300 hover:text-white transition-all active:scale-95 text-xs flex items-center gap-1"
          >
            <Key className="w-4 h-4 text-amber-400" />
            <span className="hidden lg:inline font-mono text-[11px]">Vault</span>
          </button>
          <button
            onClick={onOpenProviders}
            title="Provider & Model Catalog"
            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-750 border border-slate-700/60 text-slate-300 hover:text-white transition-all active:scale-95 text-xs flex items-center gap-1"
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="hidden lg:inline font-mono text-[11px]">Models</span>
          </button>
          <button
            onClick={onOpenStats}
            title="Telemetry & Stats"
            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-750 border border-slate-700/60 text-slate-300 hover:text-white transition-all active:scale-95 text-xs flex items-center gap-1"
          >
            <Activity className="w-4 h-4 text-mesh-purple" />
            <span className="hidden lg:inline font-mono text-[11px]">Stats</span>
          </button>
        </div>
      </div>
    </header>
  );
};

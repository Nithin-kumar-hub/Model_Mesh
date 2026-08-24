import React, { useEffect, useState } from 'react';
import { X, Activity, RefreshCw } from 'lucide-react';
import { fetchHistory, fetchStats } from '../lib/api';
import { TelemetryStats } from '../types';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([fetchStats(), fetchHistory()]);
      setStats(s);
      setHistory(h);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md max-h-[85vh] rounded-2xl glass-panel-glow border-slate-700 bg-slate-900/95 overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-mesh-purple" />
            <h3 className="font-bold text-sm text-white">Telemetry & Performance</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Key Metrics Grid */}
          {stats && (
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  Total Executions
                </span>
                <div className="text-xl font-extrabold text-white font-mono mt-0.5">
                  {stats.total_executions}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  Success Rate
                </span>
                <div className="text-xl font-extrabold text-emerald-400 font-mono mt-0.5">
                  {Math.round(stats.success_rate * 100)}%
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  Avg Latency
                </span>
                <div className="text-xl font-extrabold text-mesh-accent font-mono mt-0.5">
                  {stats.avg_latency_ms} ms
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  Failovers
                </span>
                <div className="text-xl font-extrabold text-amber-400 font-mono mt-0.5">
                  {stats.failover_count}
                </div>
              </div>
            </div>
          )}

          {/* Recent History */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-slate-400 tracking-wider">
              Recent Task History
            </div>
            {history.length === 0 ? (
              <div className="text-center py-6 text-slate-500 font-mono">
                No executions recorded yet.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {history.map((h, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-[11px] font-mono"
                  >
                    <div>
                      <div className="font-bold text-slate-200">
                        {h.model_ref || 'unassigned'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {h.modality} · {h.strategy}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-300 font-bold">{h.latency_ms}ms</div>
                      <span
                        className={`text-[9px] uppercase px-1 rounded ${
                          h.status === 'success'
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-rose-400 bg-rose-500/10'
                        }`}
                      >
                        {h.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

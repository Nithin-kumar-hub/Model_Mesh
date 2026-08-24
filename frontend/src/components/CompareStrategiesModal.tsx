import React from 'react';
import { X, Scale, Zap, Crown, CheckCircle2, ArrowRight } from 'lucide-react';
import { CompareStrategiesResult, Strategy } from '../types';

interface CompareStrategiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: CompareStrategiesResult | null;
  onSelectStrategy: (strat: Strategy) => void;
}

export const CompareStrategiesModal: React.FC<CompareStrategiesModalProps> = ({
  isOpen,
  onClose,
  data,
  onSelectStrategy,
}) => {
  if (!isOpen || !data) return null;

  const strategies: {
    id: Strategy;
    plan: any;
    name: string;
    icon: any;
    accent: string;
    border: string;
    tag: string;
  }[] = [
    {
      id: 'draft',
      plan: data.draft,
      name: 'Draft Strategy',
      icon: Zap,
      accent: 'text-amber-400',
      border: 'border-amber-400/40 hover:border-amber-400',
      tag: 'Fastest & Cheapest',
    },
    {
      id: 'balanced',
      plan: data.balanced,
      name: 'Balanced Strategy',
      icon: Scale,
      accent: 'text-mesh-accent',
      border: 'border-mesh-accent/40 hover:border-mesh-accent',
      tag: 'Optimal Balance',
    },
    {
      id: 'premium',
      plan: data.premium,
      name: 'Premium Strategy',
      icon: Crown,
      accent: 'text-purple-400',
      border: 'border-purple-400/40 hover:border-purple-400',
      tag: 'Deep Reasoning',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl glass-panel-glow border-slate-700 bg-slate-900/95 overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-mesh-accent" />
            <div>
              <h3 className="font-bold text-sm text-white">
                Multi-Strategy Comparison Matrix (Same Task)
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                Observe how ModelMesh tailors model choice, score, cost, and latency per objective
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {strategies.map((s) => {
              const Icon = s.icon;
              const selected = s.plan.selected;
              return (
                <div
                  key={s.id}
                  className={`p-4 rounded-2xl glass-panel border ${s.border} flex flex-col justify-between space-y-3 bg-slate-950/70 transition-all`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-extrabold flex items-center gap-1.5 ${s.accent}`}>
                        <Icon className="w-4 h-4" /> {s.name}
                      </span>
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {s.tag}
                      </span>
                    </div>

                    {/* Selected Model */}
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] font-mono text-slate-500 uppercase">Recommended Model</div>
                      <div className="text-sm font-extrabold text-white font-mono truncate">
                        {selected.model_id}
                      </div>
                      <div className="text-[11px] text-mesh-accent font-mono">
                        {selected.provider_id}
                      </div>
                    </div>

                    {/* Metrics Strip */}
                    <div className="grid grid-cols-2 gap-1.5 text-center font-mono text-xs">
                      <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-850">
                        <div className="text-[9px] text-slate-500 uppercase">Score</div>
                        <div className="font-bold text-white">{Math.round(selected.score * 100)}%</div>
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-850">
                        <div className="text-[9px] text-slate-500 uppercase">Est. Latency</div>
                        <div className="font-bold text-cyan-400">
                          {selected.estimated_latency_ms ? `${selected.estimated_latency_ms}ms` : 'Fast'}
                        </div>
                      </div>
                    </div>

                    {/* Reasons */}
                    <div className="space-y-1 pt-1 border-t border-slate-850">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Key Factors:</div>
                      {selected.reasons.slice(0, 3).map((r: string, i: number) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="capitalize">{r.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onSelectStrategy(s.id);
                      onClose();
                    }}
                    className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 text-black bg-gradient-to-r from-mesh-accent to-cyan-400 shadow active:scale-95 transition-all`}
                  >
                    <span>Adopt {s.name.split(' ')[0]} Route</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

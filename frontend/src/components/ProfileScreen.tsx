import React from 'react';
import {
  Brain,
  Layers,
  Gauge,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { Classification, WorkloadProfile, Strategy } from '../types';

interface ProfileScreenProps {
  classification: Classification;
  profile: WorkloadProfile;
  strategy: Strategy;
  onNext: () => void;
  onBack: () => void;
  isLoading: boolean;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  classification,
  profile,
  strategy,
  onNext,
  onBack,
  isLoading,
}) => {
  const isCode = classification.modality === 'code';
  const confidencePercent = Math.round(profile.confidence * 100);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-mesh-accent flex items-center gap-1">
            <Brain className="w-3 h-3" /> Step 1: Workload Understanding
          </span>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Task Profile & Token Heuristics
          </h2>
        </div>
        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
          Strategy: <span className="text-mesh-accent font-bold">{strategy}</span>
        </span>
      </div>

      {/* Classification Card */}
      <div className="p-4 rounded-2xl glass-panel-glow border-mesh-accent/30 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-md border ${
                isCode
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                  : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              }`}
            >
              {classification.modality}
            </span>
            <span className="text-xs font-mono text-slate-300 capitalize">
              {classification.task_type.replace('_', ' ')}
            </span>
          </div>

          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800/80 text-amber-300 border border-amber-400/20 uppercase font-semibold">
            {classification.complexity}
          </span>
        </div>

        {/* Detected Signals */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            Detected Signals:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {classification.signals.map((sig, idx) => (
              <span
                key={idx}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800 text-slate-400"
              >
                {sig}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Token Range Grid (BEST / EXPECTED / WORST) */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-mono uppercase text-slate-400 flex items-center justify-between">
          <span>Estimated Compute Envelope</span>
          <span className="text-[10px] text-amber-400 font-mono">ESTIMATED</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Best Case */}
          <div className="p-3 rounded-xl glass-panel border border-slate-800/80 text-center space-y-0.5">
            <div className="text-[9px] font-mono uppercase text-slate-400">
              Best Case
            </div>
            <div className="text-base font-extrabold text-emerald-400 font-mono">
              {profile.estimated_total_tokens.best.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-500 font-mono">tokens</div>
          </div>

          {/* Expected Case */}
          <div className="p-3 rounded-xl glass-panel-glow border-mesh-accent/40 text-center space-y-0.5 bg-slate-900/90">
            <div className="text-[9px] font-mono uppercase text-mesh-accent font-bold">
              Expected
            </div>
            <div className="text-lg font-extrabold text-white font-mono">
              {profile.estimated_total_tokens.expected.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-400 font-mono">tokens</div>
          </div>

          {/* Worst Case */}
          <div className="p-3 rounded-xl glass-panel border border-slate-800/80 text-center space-y-0.5">
            <div className="text-[9px] font-mono uppercase text-slate-400">
              Worst Case
            </div>
            <div className="text-base font-extrabold text-purple-400 font-mono">
              {profile.estimated_total_tokens.worst.toLocaleString()}
            </div>
            <div className="text-[9px] text-slate-500 font-mono">tokens</div>
          </div>
        </div>
      </div>

      {/* Context & Confidence Bars */}
      <div className="p-3.5 rounded-xl glass-panel border border-slate-800 space-y-3">
        {/* Context Requirement */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-mesh-accent" />
              Minimum Context Window
            </span>
            <span className="font-mono font-bold text-white">
              {profile.required_context_tokens.toLocaleString()} tokens
            </span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-mesh-accent to-mesh-purple h-full rounded-full transition-all"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(10, (profile.required_context_tokens / 32768) * 100)
                )}%`,
              }}
            />
          </div>
        </div>

        {/* Confidence */}
        <div className="space-y-1 pt-1 border-t border-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
              Profiler Confidence
            </span>
            <span className="font-mono font-bold text-emerald-400">
              {confidencePercent}%
            </span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all"
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Nav actions */}
      <div className="pt-2 flex gap-2.5">
        <button
          onClick={onBack}
          className="py-3 px-4 rounded-xl glass-panel hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs transition-all active:scale-95"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          id="btn-find-route"
          disabled={isLoading}
          onClick={onNext}
          className="flex-1 py-3.5 px-4 rounded-xl bg-gradient-to-r from-mesh-accent via-cyan-400 to-mesh-purple text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-mesh-accent/20 active:scale-98"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <>
              <span>Find Best Route</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

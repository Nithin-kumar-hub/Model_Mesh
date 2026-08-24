import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { RoutePlan } from '../types';

interface RecommendationScreenProps {
  plan: RoutePlan;
  onExecute: () => void;
  onBack: () => void;
  isLoading: boolean;
}

export const RecommendationScreen: React.FC<RecommendationScreenProps> = ({
  plan,
  onExecute,
  onBack,
  isLoading,
}) => {
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const selected = plan.selected;
  const scorePercent = Math.round(selected.score * 100);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-mesh-accent flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Step 2: Optimal AI Route
          </span>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Recommended Provider & Model
          </h2>
        </div>
        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-mesh-accent/10 border border-mesh-accent/30 text-mesh-accent font-bold">
          {plan.strategy}
        </span>
      </div>

      {/* Selected Route Hero Card */}
      <div className="p-4 rounded-2xl glass-panel-glow border-mesh-accent/50 space-y-3 relative overflow-hidden">
        {/* Score Badge */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Rank #1 Choice
            </span>
            <div className="text-lg font-extrabold text-white mt-0.5">
              {selected.model_id}
            </div>
            <div className="text-xs text-mesh-accent font-mono">
              Provider: {selected.provider_id}
            </div>
          </div>

          <div className="text-right">
            <div className="inline-flex flex-col items-center justify-center p-2 rounded-xl bg-mesh-accent/10 border border-mesh-accent/40 shadow-inner">
              <span className="text-xs font-mono text-slate-400">Match Score</span>
              <span className="text-xl font-extrabold text-mesh-accent font-mono">
                {scorePercent}%
              </span>
            </div>
          </div>
        </div>

        {/* Key Reasons Checklist */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Why ModelMesh selected this route:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {selected.reasons.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 text-xs text-slate-200"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="capitalize">{r.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Score Breakdown Bars (Toggleable) */}
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="w-full pt-2 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 border-t border-slate-800/60"
        >
          <span className="font-mono text-[11px]">
            {showDetails ? 'Hide' : 'Show'} Factor Weights & Scoring Breakdown
          </span>
          {showDetails ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        {showDetails && (
          <div className="space-y-2 pt-2 border-t border-slate-800/60 animate-fadeIn">
            {Object.entries(selected.score_breakdown).map(([factor, val]) => (
              <div key={factor} className="space-y-0.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400 capitalize">{factor}</span>
                  <span className="font-mono text-slate-200">
                    {Math.round(val * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                  <div
                    className="bg-mesh-accent h-full rounded-full"
                    style={{ width: `${val * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fallback Plan */}
      <div className="p-3.5 rounded-xl glass-panel border border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            Automatic Fallback Hierarchy
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {plan.candidates.length - 1} Standby routes
          </span>
        </div>

        <div className="space-y-1.5">
          {plan.candidates.slice(1, 3).map((candidate, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-500">
                  #{candidate.rank}
                </span>
                <span className="text-slate-300 font-medium font-mono">
                  {candidate.model_ref}
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {Math.round(candidate.score * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-2 flex gap-2.5">
        <button
          onClick={onBack}
          className="py-3 px-4 rounded-xl glass-panel hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs transition-all active:scale-95"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          id="btn-execute"
          disabled={isLoading}
          onClick={onExecute}
          className="flex-1 py-3.5 px-4 rounded-xl bg-gradient-to-r from-mesh-accent via-cyan-400 to-mesh-purple text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-mesh-accent/20 active:scale-98"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <>
              <span>Execute Task Now</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

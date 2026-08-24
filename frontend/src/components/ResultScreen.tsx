import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  RotateCcw,
  Clock,
  Coins,
  Cpu,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ExecutionResult } from '../types';

interface ResultScreenProps {
  result: ExecutionResult;
  onReset: () => void;
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  result,
  onReset,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = () => {
    if (result.output_text) {
      navigator.clipboard.writeText(result.output_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isSuccess = result.status === 'success';

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Failover Notice Banner if failover happened */}
      {result.failover_occurred && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-2.5 shadow-lg shadow-amber-500/5">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <div className="font-bold text-amber-200">
              Automatic Recovery Activated
            </div>
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              Primary provider experienced an issue. ModelMesh seamlessly failed over to{' '}
              <span className="font-mono font-bold text-amber-200">{result.model_ref}</span>{' '}
              without interrupting your workflow.
            </p>
          </div>
        </div>
      )}

      {/* Hero Execution Header */}
      <div className="p-4 rounded-2xl glass-panel-glow border-mesh-accent/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
            )}
            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Executed Via
              </span>
              <div className="text-sm font-bold text-white font-mono">
                {result.model_ref || 'None'}
              </div>
            </div>
          </div>

          <span
            className={`text-xs font-mono uppercase px-2.5 py-1 rounded-md font-bold border ${
              isSuccess
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
          >
            {result.status}
          </span>
        </div>

        {/* Telemetry Metrics Strip */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80">
          <div className="p-2 rounded-lg bg-slate-900/60 text-center">
            <div className="text-[9px] font-mono uppercase text-slate-400 flex items-center justify-center gap-1">
              <Clock className="w-2.5 h-2.5 text-cyan-400" /> Latency
            </div>
            <div className="text-xs font-mono font-bold text-white mt-0.5">
              {result.latency_ms} ms
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-900/60 text-center">
            <div className="text-[9px] font-mono uppercase text-slate-400 flex items-center justify-center gap-1">
              <Coins className="w-2.5 h-2.5 text-mesh-purple" /> Total Tokens
            </div>
            <div className="text-xs font-mono font-bold text-white mt-0.5">
              {result.usage.total_tokens}
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-900/60 text-center">
            <div className="text-[9px] font-mono uppercase text-slate-400 flex items-center justify-center gap-1">
              <Cpu className="w-2.5 h-2.5 text-amber-400" /> Failovers
            </div>
            <div className="text-xs font-mono font-bold text-white mt-0.5">
              {result.failovers}
            </div>
          </div>
        </div>
      </div>

      {/* Output Content Card */}
      <div className="p-4 rounded-2xl glass-panel border border-slate-800 space-y-2 relative">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-mesh-accent" /> AI Response
          </span>
          <button
            onClick={handleCopy}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> Copy
              </>
            )}
          </button>
        </div>

        <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 max-h-72 overflow-y-auto text-xs text-slate-100 font-mono leading-relaxed whitespace-pre-wrap selection:bg-mesh-accent/30">
          {result.output_text || result.error_message || 'No output produced.'}
        </div>
      </div>

      {/* Execution Attempt Trail */}
      {result.attempts && result.attempts.length > 0 && (
        <div className="p-3.5 rounded-xl glass-panel border border-slate-800 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Execution Attempt Trail ({result.attempts.length})
          </div>
          <div className="space-y-1.5">
            {result.attempts.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">#{idx + 1}</span>
                  <span className="text-slate-200">{att.model_ref}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">
                    {att.latency_ms}ms
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
                      att.status === 'success'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {att.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Restart action */}
      <div className="pt-2">
        <button
          id="btn-new-task"
          onClick={onReset}
          className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-mesh-accent via-cyan-400 to-mesh-purple text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-mesh-accent/20 active:scale-98"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Start New Task</span>
        </button>
      </div>
    </div>
  );
};

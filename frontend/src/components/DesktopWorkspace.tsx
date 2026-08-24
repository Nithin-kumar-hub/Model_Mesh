import React, { useState } from 'react';
import {
  Zap,
  Scale,
  Crown,
  Sparkles,
  ArrowRight,
  Code2,
  FileText,
  Play,
  RotateCcw,
  Brain,
  Layers,
  CheckCircle2,
  ShieldCheck,
  Cpu,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import {
  Classification,
  ExecutionResult,
  LifecycleState,
  RoutePlan,
  Strategy,
  WorkloadProfile,
} from '../types';

interface DesktopWorkspaceProps {
  inputText: string;
  setInputText: (val: string) => void;
  strategy: Strategy;
  setStrategy: (val: Strategy) => void;
  classification: Classification | null;
  profile: WorkloadProfile | null;
  plan: RoutePlan | null;
  result: ExecutionResult | null;
  lifecycleState: LifecycleState;
  simulateFault: string;
  setSimulateFault: (val: string) => void;
  isLoading: boolean;
  onAnalyzeAndRoute: () => void;
  onCompareStrategies: () => void;
  onExecute: () => void;
  onReset: () => void;
}

const SAMPLE_PROMPTS = [
  {
    icon: Code2,
    label: 'Debug Java NPE',
    text: 'Debug this Java NullPointerException in the UserService:\n```java\npublic User getUser(String id) {\n    return userCache.get(id).getName().trim();\n}\n```',
  },
  {
    icon: FileText,
    label: 'Summarize Architecture',
    text: 'Summarize the core architectural benefits of phone-first AI routing compared to monolithic cloud routers in 3 concise bullet points with focus on latency and failover resilience.',
  },
  {
    icon: Code2,
    label: 'Python Anagram Algorithm',
    text: 'Write an efficient Python function to group all anagrams from a list of strings with optimal space and time complexity.',
  },
  {
    icon: FileText,
    label: 'Explain Concept',
    text: 'Explain how dependency injection decouples services in distributed cloud systems with a concrete analogy.',
  },
];

export const DesktopWorkspace: React.FC<DesktopWorkspaceProps> = ({
  inputText,
  setInputText,
  strategy,
  setStrategy,
  classification,
  profile,
  plan,
  result,
  lifecycleState,
  simulateFault,
  setSimulateFault,
  isLoading,
  onAnalyzeAndRoute,
  onCompareStrategies,
  onExecute,
  onReset,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [showAllCandidates, setShowAllCandidates] = useState<boolean>(false);

  const handleCopy = () => {
    if (result?.output_text) {
      navigator.clipboard.writeText(result.output_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const strategies: {
    id: Strategy;
    name: string;
    icon: any;
    desc: string;
    badge: string;
    accent: string;
  }[] = [
    {
      id: 'draft',
      name: 'Draft',
      icon: Zap,
      desc: 'Lowest latency & token cost',
      badge: 'Fast',
      accent: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
    },
    {
      id: 'balanced',
      name: 'Balanced',
      icon: Scale,
      desc: 'Optimal quality & cost balance',
      badge: 'Balanced',
      accent: 'text-mesh-accent border-mesh-accent/40 bg-mesh-accent/10',
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: Crown,
      desc: 'Deep reasoning & top-tier models',
      badge: 'Deep',
      accent: 'text-purple-400 border-purple-400/40 bg-purple-400/10',
    },
  ];

  const estimatedTokens = Math.max(1, Math.round(inputText.length / 3.8));

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
      {/* ================================================================= */}
      {/* LEFT COLUMN: Input, Strategy & Benchmarks (lg:col-span-5) */}
      {/* ================================================================= */}
      <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
        <div className="space-y-4">
          {/* Section Header with Live Lifecycle State */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-mesh-accent flex items-center gap-1.5 font-bold">
              <Sparkles className="w-3.5 h-3.5" /> 1. Task Definition
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-cyan-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                {lifecycleState}
              </span>
              {inputText && (
                <button
                  onClick={() => setInputText('')}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Prompt Composer */}
          <div className="p-4 rounded-2xl glass-panel-glow border-slate-700/80 space-y-3">
            <textarea
              id="desktop-prompt"
              rows={7}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter your AI prompt, coding task, or question here..."
              className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none font-sans leading-relaxed"
            />
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400 font-mono">
              <span>{inputText.length.toLocaleString()} characters</span>
              <span className="text-mesh-accent">~{estimatedTokens.toLocaleString()} input tokens</span>
            </div>
          </div>

          {/* Strategy Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Scale className="w-3 h-3 text-cyan-400" />
                Routing Objective
              </label>
              <button
                type="button"
                disabled={!inputText.trim() || isLoading}
                onClick={onCompareStrategies}
                className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 underline flex items-center gap-1 disabled:opacity-30"
              >
                <Sliders className="w-3 h-3" /> Compare All 3 Strategies
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {strategies.map((s) => {
                const Icon = s.icon;
                const isSelected = strategy === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStrategy(s.id)}
                    className={`p-3 rounded-xl border text-left transition-all duration-200 active:scale-95 flex flex-col justify-between ${
                      isSelected
                        ? 'glass-panel-glow border-mesh-accent bg-slate-900/90'
                        : 'glass-panel border-slate-800 hover:border-slate-700 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <Icon
                        className={`w-4 h-4 ${
                          isSelected ? 'text-mesh-accent' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                          isSelected ? s.accent : 'text-slate-500 border-slate-800'
                        }`}
                      >
                        {s.badge}
                      </span>
                    </div>
                    <div>
                      <div className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {s.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                        {s.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fault Simulation Playground */}
          <div className="p-3 rounded-xl glass-panel border border-slate-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 text-slate-400">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Simulate Provider Fault:</span>
            </div>
            <select
              value={simulateFault}
              onChange={(e) => setSimulateFault(e.target.value)}
              className="p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none"
            >
              <option value="">None (Standard Execution)</option>
              <option value="rate_limit">Rate Limit Primary (429)</option>
              <option value="timeout">Timeout Primary (504)</option>
            </select>
          </div>

          {/* Benchmark Quick Chips */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Benchmark Scenarios:
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SAMPLE_PROMPTS.map((sample, idx) => {
                const Icon = sample.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setInputText(sample.text)}
                    className="p-2 rounded-lg glass-panel hover:bg-slate-800/80 border border-slate-800 text-left text-xs text-slate-300 hover:text-mesh-accent flex items-center gap-2 transition-all"
                  >
                    <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{sample.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="pt-3 flex gap-2">
          <button
            id="btn-desktop-analyze"
            disabled={!inputText.trim() || isLoading}
            onClick={onAnalyzeAndRoute}
            className="flex-1 py-3.5 px-4 rounded-xl bg-gradient-to-r from-mesh-accent via-cyan-400 to-mesh-purple text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-mesh-accent/20 hover:shadow-mesh-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-98"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                <span>Analyze & Route Workload</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {plan && !result && (
            <button
              id="btn-desktop-execute"
              disabled={isLoading}
              onClick={onExecute}
              className="py-3.5 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-98 transition-all"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Execute</span>
            </button>
          )}

          {(plan || result) && (
            <button
              onClick={onReset}
              title="Reset and start new task"
              className="py-3.5 px-4 rounded-xl glass-panel hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-all active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* RIGHT COLUMN: Studio Intelligence & Output (lg:col-span-7) */}
      {/* ================================================================= */}
      <div className="lg:col-span-7 space-y-4">
        {/* Top Intelligence Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Workload Profile */}
          <div className="p-4 rounded-2xl glass-panel border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-mesh-accent" /> Workload Profile
              </span>
              {classification && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-300 uppercase font-semibold">
                  {classification.complexity}
                </span>
              )}
            </div>

            {classification && profile ? (
              <div className="space-y-3 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-md border ${
                      classification.modality === 'code'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                    }`}
                  >
                    {classification.modality}
                  </span>
                  <span className="text-xs font-mono text-slate-300 capitalize">
                    {classification.task_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 ml-auto">
                    {Math.round(profile.confidence * 100)}% conf
                  </span>
                </div>

                {/* Token Envelopes */}
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
                    <div className="text-[9px] text-slate-400 uppercase font-mono">Best</div>
                    <div className="text-xs font-mono font-bold text-emerald-400">
                      {profile.estimated_total_tokens.best.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/90 border border-mesh-accent/40">
                    <div className="text-[9px] text-mesh-accent uppercase font-mono font-bold">Expected</div>
                    <div className="text-sm font-mono font-extrabold text-white">
                      {profile.estimated_total_tokens.expected.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
                    <div className="text-[9px] text-slate-400 uppercase font-mono">Worst</div>
                    <div className="text-xs font-mono font-bold text-purple-400">
                      {profile.estimated_total_tokens.worst.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-850">
                  <span>Req. Context: {profile.required_context_tokens.toLocaleString()} tokens</span>
                  <span className="text-[10px] text-amber-400">ESTIMATE</span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 font-mono text-xs">
                Awaiting task analysis...
              </div>
            )}
          </div>

          {/* Card 2: Recommended Model Choice */}
          <div className="p-4 rounded-2xl glass-panel-glow border-mesh-accent/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-mesh-accent flex items-center gap-1.5 font-bold">
                <Sparkles className="w-3.5 h-3.5" /> Optimal AI Route
              </span>
              {plan && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-mesh-accent/10 border border-mesh-accent/30 text-mesh-accent font-bold">
                  {Math.round(plan.selected.score * 100)}% Match
                </span>
              )}
            </div>

            {plan ? (
              <div className="space-y-3 animate-fadeIn">
                <div>
                  <div className="text-sm font-extrabold text-white font-mono">
                    {plan.selected.model_id}
                  </div>
                  <div className="text-xs text-mesh-accent font-mono">
                    Provider: {plan.selected.provider_id}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-mono uppercase text-slate-400">
                    Why ModelMesh chose this route:
                  </div>
                  <div className="space-y-1">
                    {plan.selected.reasons.slice(0, 3).map((r, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-slate-300">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="capitalize">{r.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {!result && (
                  <button
                    onClick={onExecute}
                    disabled={isLoading}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-98 transition-all"
                  >
                    <Play className="w-3 h-3" />
                    <span>Run Task on {plan.selected.provider_id}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 font-mono text-xs">
                Route will be scored after profiling.
              </div>
            )}
          </div>
        </div>

        {/* Candidate Evaluation Table (Multi-Model Comparison) */}
        {plan && (
          <div className="p-4 rounded-2xl glass-panel border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" /> Multi-Model Comparison & Standby Fallbacks
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {plan.candidates.length} evaluated
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                    <th className="pb-2 font-normal">Rank</th>
                    <th className="pb-2 font-normal">Model Reference</th>
                    <th className="pb-2 font-normal">Quality</th>
                    <th className="pb-2 font-normal">Efficiency</th>
                    <th className="pb-2 font-normal">Latency</th>
                    <th className="pb-2 font-normal text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {plan.candidates.map((c, i) => (
                    <tr
                      key={c.model_ref}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        i === 0 ? 'bg-mesh-accent/5 font-semibold text-white' : 'text-slate-300'
                      }`}
                    >
                      <td className="py-2">
                        {i === 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-mesh-accent/20 text-mesh-accent text-[10px] font-bold">
                            #1 BEST
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">#{c.rank}</span>
                        )}
                      </td>
                      <td className="py-2">
                        <span>{c.model_ref}</span>
                        {c.is_mock && <span className="ml-1.5 text-[9px] text-slate-500 font-mono">[MOCK]</span>}
                      </td>
                      <td className="py-2 text-slate-400">{Math.round((c.score_breakdown.quality || 0) * 100)}%</td>
                      <td className="py-2 text-slate-400">{Math.round((c.score_breakdown.efficiency || 0) * 100)}%</td>
                      <td className="py-2 text-slate-400">{Math.round((c.score_breakdown.latency || 0) * 100)}%</td>
                      <td className="py-2 text-right font-bold text-mesh-accent">{Math.round(c.score * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Rejection Log */}
            {plan.rejected.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80">
                <button
                  onClick={() => setShowAllCandidates(!showAllCandidates)}
                  className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full font-mono"
                >
                  <span>Rejected Candidates ({plan.rejected.length} filtered out in Stage 1)</span>
                  {showAllCandidates ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showAllCandidates && (
                  <div className="mt-2 space-y-1.5 animate-fadeIn">
                    {plan.rejected.map((r, i) => (
                      <div
                        key={i}
                        className="p-2 rounded-lg bg-rose-500/5 border border-rose-500/20 text-xs font-mono flex items-center justify-between text-rose-300"
                      >
                        <span>{r.model_ref}</span>
                        <span className="text-[10px] uppercase font-bold text-rose-400">{r.reason_code}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Execution Output Console */}
        <div className="p-4 rounded-2xl glass-panel border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-mesh-purple" /> Execution Console & Telemetry
            </span>
            {result && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono px-2 py-1 rounded bg-slate-800 border border-slate-700 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <span
                  className={`text-xs font-mono uppercase px-2 py-0.5 rounded font-bold border ${
                    result.status === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}
                >
                  {result.status}
                </span>
              </div>
            )}
          </div>

          {result ? (
            <div className="space-y-3 animate-fadeIn">
              {/* Failover Alert */}
              {result.failover_occurred && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-2 text-xs">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Failover Activated:</strong> Automatically recovered and finished on{' '}
                    <span className="font-mono font-bold text-amber-200">{result.model_ref}</span>.
                  </span>
                </div>
              )}

              {/* Output Content */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-80 overflow-y-auto text-xs text-slate-100 font-mono leading-relaxed whitespace-pre-wrap selection:bg-mesh-accent/30">
                {result.output_text || result.error_message}
              </div>

              {/* Metrics Strip */}
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-center font-mono">
                <div className="p-2 rounded-lg bg-slate-900/60">
                  <div className="text-[9px] text-slate-400 uppercase">Provider</div>
                  <div className="text-xs font-bold text-white mt-0.5">{result.provider_id}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/60">
                  <div className="text-[9px] text-slate-400 uppercase">Latency</div>
                  <div className="text-xs font-bold text-cyan-400 mt-0.5">{result.latency_ms} ms</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/60">
                  <div className="text-[9px] text-slate-400 uppercase">Tokens</div>
                  <div className="text-xs font-bold text-purple-400 mt-0.5">{result.usage.total_tokens}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/60">
                  <div className="text-[9px] text-slate-400 uppercase">Attempts</div>
                  <div className="text-xs font-bold text-amber-400 mt-0.5">{result.attempts.length}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 font-mono text-xs">
              Execute a route to view real-time response, latency, and failover telemetry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

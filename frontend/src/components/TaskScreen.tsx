import React from 'react';
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
  ShieldAlert,
} from 'lucide-react';
import { Strategy } from '../types';

interface TaskScreenProps {
  inputText: string;
  setInputText: (val: string) => void;
  strategy: Strategy;
  setStrategy: (val: Strategy) => void;
  onAnalyze: () => void;
  onFastExecute: () => void;
  onCompareStrategies: () => void;
  simulateFault: string;
  setSimulateFault: (val: string) => void;
  isLoading: boolean;
}

const SAMPLE_PROMPTS = [
  {
    icon: Code2,
    label: 'Debug Java NPE',
    text: 'Debug this Java NullPointerException in the UserService:\n```java\npublic User getUser(String id) {\n    return userCache.get(id).getName().trim();\n}\n```',
  },
  {
    icon: FileText,
    label: 'Summarize Text',
    text: 'Summarize the core architectural benefits of phone-first AI routing compared to monolithic cloud routers in 3 concise bullet points.',
  },
  {
    icon: Code2,
    label: 'Python Algorithm',
    text: 'Write an efficient Python function to find all anagrams in a list of words with optimal time complexity.',
  },
  {
    icon: FileText,
    label: 'Explain Concept',
    text: 'Explain how dependency injection reduces coupling in microservices architecture with a simple analogy.',
  },
];

export const TaskScreen: React.FC<TaskScreenProps> = ({
  inputText,
  setInputText,
  strategy,
  setStrategy,
  onAnalyze,
  onFastExecute,
  onCompareStrategies,
  simulateFault,
  setSimulateFault,
  isLoading,
}) => {
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
      desc: 'Best blend of quality & cost',
      badge: 'Optimal',
      accent: 'text-mesh-accent border-mesh-accent/40 bg-mesh-accent/10',
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: Crown,
      desc: 'Highest reasoning & quality',
      badge: 'Deep',
      accent: 'text-purple-400 border-purple-400/40 bg-purple-400/10',
    },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Hero Header */}
      <div className="text-center space-y-1.5 pt-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Where should your task run?
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-xs sm:max-w-sm mx-auto">
          ModelMesh understands your workload, estimates tokens, and routes dynamically with automatic failover.
        </p>
      </div>

      {/* Strategy Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-mesh-accent" />
            1. Select Execution Objective
          </label>
          <button
            type="button"
            disabled={!inputText.trim() || isLoading}
            onClick={onCompareStrategies}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 underline disabled:opacity-30"
          >
            Compare All 3 Strategies
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
                <div className="flex items-center justify-between w-full mb-1.5">
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
                  <div
                    className={`text-xs font-bold ${
                      isSelected ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    {s.name}
                  </div>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5 line-clamp-2">
                    {s.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Task Composer */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="task-prompt"
            className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5"
          >
            <Code2 className="w-3 h-3 text-mesh-accent" />
            2. Enter Task or Prompt
          </label>
          {inputText && (
            <button
              onClick={() => setInputText('')}
              className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 font-mono"
            >
              <RotateCcw className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        <div className="rounded-2xl glass-panel border border-slate-800 focus-within:border-mesh-accent/60 transition-colors p-3">
          <textarea
            id="task-prompt"
            rows={5}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type or paste any prompt... (e.g. Debug this Java code, summarize text, write a function)"
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none font-sans leading-relaxed"
          />
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 font-mono">
            <span>{inputText.length.toLocaleString()} characters</span>
            <span className="text-mesh-accent">~{Math.max(1, Math.round(inputText.length / 3.8))} input tokens</span>
          </div>
        </div>
      </div>

      {/* Fault Simulation Playground */}
      <div className="p-2.5 rounded-xl glass-panel border border-slate-800 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-1.5 text-slate-400">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span>Simulate Provider Fault:</span>
        </div>
        <select
          value={simulateFault}
          onChange={(e) => setSimulateFault(e.target.value)}
          className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none"
        >
          <option value="">None (Standard Execution)</option>
          <option value="rate_limit">Rate Limit Primary (429)</option>
          <option value="timeout">Timeout Primary (504)</option>
        </select>
      </div>

      {/* Sample Prompts Chips */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
          Benchmark Prompts:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_PROMPTS.map((sample, idx) => {
            const Icon = sample.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setInputText(sample.text)}
                className="px-2.5 py-1 rounded-lg glass-panel hover:bg-slate-800/60 border border-slate-800 text-[11px] text-slate-300 hover:text-mesh-accent flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Icon className="w-3 h-3 text-slate-400" />
                <span>{sample.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
        <button
          id="btn-analyze"
          disabled={!inputText.trim() || isLoading}
          onClick={onAnalyze}
          className="flex-1 py-3.5 px-4 rounded-xl bg-gradient-to-r from-mesh-accent via-cyan-400 to-mesh-purple text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-mesh-accent/20 hover:shadow-mesh-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-98"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <>
              <span>Analyze & Route</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <button
          id="btn-fast-run"
          disabled={!inputText.trim() || isLoading}
          onClick={onFastExecute}
          className="py-3.5 px-4 rounded-xl glass-panel hover:bg-slate-800/80 border border-slate-700 text-slate-200 hover:text-white font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-98"
        >
          <Play className="w-3.5 h-3.5 text-mesh-accent" />
          <span>Direct Run</span>
        </button>
      </div>
    </div>
  );
};

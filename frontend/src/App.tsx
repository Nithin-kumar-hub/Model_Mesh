import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { TaskScreen } from './components/TaskScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { RecommendationScreen } from './components/RecommendationScreen';
import { ResultScreen } from './components/ResultScreen';
import { DesktopWorkspace } from './components/DesktopWorkspace';
import { StatsModal } from './components/StatsModal';
import { ProvidersModal } from './components/ProvidersModal';
import {
  Classification,
  ExecutionResult,
  RoutePlan,
  Strategy,
  WorkloadProfile,
} from './types';
import { executeTask, profileTask, routeTask } from './lib/api';

type Screen = 'task' | 'profile' | 'recommendation' | 'result';
type ViewMode = 'mobile' | 'desktop';

export const App: React.FC = () => {
  // Adaptive mode: default to desktop on >=1024px, mobile on <1024px
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024 ? 'desktop' : 'mobile';
    }
    return 'desktop';
  });

  const [currentScreen, setCurrentScreen] = useState<Screen>('task');
  const [inputText, setInputText] = useState<string>('');
  const [strategy, setStrategy] = useState<Strategy>('balanced');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pipeline state
  const [classification, setClassification] = useState<Classification | null>(null);
  const [profile, setProfile] = useState<WorkloadProfile | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);

  // Modals
  const [statsOpen, setStatsOpen] = useState<boolean>(false);
  const [providersOpen, setProvidersOpen] = useState<boolean>(false);

  // Step 1: Analyze (Classify + Profile)
  const handleAnalyze = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await profileTask(inputText);
      setClassification(data.classification);
      setProfile(data.profile);
      setCurrentScreen('profile');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to profile task');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Route
  const handleRoute = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const routePlan = await routeTask(inputText, strategy);
      setPlan(routePlan);
      setCurrentScreen('recommendation');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to route task');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Execute
  const handleExecute = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const execResult = await executeTask(inputText, strategy);
      setResult(execResult);
      setCurrentScreen('result');
    } catch (err: any) {
      setErrorMessage(err.message || 'Execution failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Desktop Studio 1-Click "Analyze & Route"
  const handleAnalyzeAndRoute = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [profileData, routePlan] = await Promise.all([
        profileTask(inputText),
        routeTask(inputText, strategy),
      ]);
      setClassification(profileData.classification);
      setProfile(profileData.profile);
      setPlan(routePlan);
    } catch (err: any) {
      setErrorMessage(err.message || 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Reset flow
  const handleReset = () => {
    setCurrentScreen('task');
    setInputText('');
    setClassification(null);
    setProfile(null);
    setPlan(null);
    setResult(null);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-mesh-dark text-slate-100 flex flex-col font-sans">
      <Navbar
        onOpenStats={() => setStatsOpen(true)}
        onOpenProviders={() => setProvidersOpen(true)}
        onReset={handleReset}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      {/* Error Alert */}
      {errorMessage && (
        <div className="max-w-md lg:max-w-7xl mx-auto px-4 mt-4 w-full">
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between animate-fadeIn">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 font-bold px-1.5 py-0.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main View: Switch between Mobile Phone View and Desktop Studio */}
      <main className="flex-1 w-full flex flex-col">
        {viewMode === 'desktop' ? (
          /* ============================================================= */
          /* DESKTOP STUDIO WORKSPACE (Multi-column responsive layout) */
          /* ============================================================= */
          <DesktopWorkspace
            inputText={inputText}
            setInputText={setInputText}
            strategy={strategy}
            setStrategy={setStrategy}
            classification={classification}
            profile={profile}
            plan={plan}
            result={result}
            isLoading={isLoading}
            onAnalyzeAndRoute={handleAnalyzeAndRoute}
            onExecute={handleExecute}
            onReset={handleReset}
          />
        ) : (
          /* ============================================================= */
          /* MOBILE PHONE WORKSPACE (Touch-first stepped flow) */
          /* ============================================================= */
          <div className="w-full max-w-md mx-auto px-4 py-4 sm:py-6 flex flex-col flex-1">
            {/* Step Indicator for mobile multi-step flow */}
            {currentScreen !== 'task' && (
              <div className="mb-4 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span
                  className={`transition-colors ${
                    currentScreen === 'profile' ? 'text-mesh-accent font-bold' : ''
                  }`}
                >
                  1. Profile
                </span>
                <span>→</span>
                <span
                  className={`transition-colors ${
                    currentScreen === 'recommendation'
                      ? 'text-mesh-accent font-bold'
                      : ''
                  }`}
                >
                  2. Route
                </span>
                <span>→</span>
                <span
                  className={`transition-colors ${
                    currentScreen === 'result' ? 'text-mesh-accent font-bold' : ''
                  }`}
                >
                  3. Result
                </span>
              </div>
            )}

            {/* Active Screen */}
            <div className="flex-1">
              {currentScreen === 'task' && (
                <TaskScreen
                  inputText={inputText}
                  setInputText={setInputText}
                  strategy={strategy}
                  setStrategy={setStrategy}
                  onAnalyze={handleAnalyze}
                  onFastExecute={handleExecute}
                  isLoading={isLoading}
                />
              )}

              {currentScreen === 'profile' && classification && profile && (
                <ProfileScreen
                  classification={classification}
                  profile={profile}
                  strategy={strategy}
                  onNext={handleRoute}
                  onBack={() => setCurrentScreen('task')}
                  isLoading={isLoading}
                />
              )}

              {currentScreen === 'recommendation' && plan && (
                <RecommendationScreen
                  plan={plan}
                  onExecute={handleExecute}
                  onBack={() => setCurrentScreen('profile')}
                  isLoading={isLoading}
                />
              )}

              {currentScreen === 'result' && result && (
                <ResultScreen result={result} onReset={handleReset} />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-900/80 py-3 text-center text-[10px] text-slate-500 font-mono">
        ModelMesh · iQOO City Battle 2026 · Phone-First AI Router · Responsive Mobile & Desktop Studio
      </footer>

      {/* Modals */}
      <StatsModal isOpen={statsOpen} onClose={() => setStatsOpen(false)} />
      <ProvidersModal
        isOpen={providersOpen}
        onClose={() => setProvidersOpen(false)}
      />
    </div>
  );
};

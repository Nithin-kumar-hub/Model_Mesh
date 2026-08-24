import React, { useEffect, useState } from 'react';
import { X, Layers, Cpu } from 'lucide-react';
import { fetchProviders } from '../lib/api';
import { Provider } from '../types';

interface ProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProvidersModal: React.FC<ProvidersModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [providers, setProviders] = useState<Provider[]>([]);

  const loadData = async () => {
    try {
      const data = await fetchProviders();
      setProviders(data);
    } catch (e) {
      console.error(e);
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
            <Layers className="w-4 h-4 text-mesh-accent" />
            <h3 className="font-bold text-sm text-white">
              Provider & Model Registry
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs font-sans">
          {providers.map((p) => (
            <div
              key={p.id}
              className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-slate-200">{p.display_name}</span>
                </div>
                <span
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                    p.is_mock
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}
                >
                  {p.is_mock ? 'Mock Adapter' : 'Live Provider'}
                </span>
              </div>

              {/* Models */}
              <div className="space-y-1 pt-1 border-t border-slate-850">
                {p.models.map((m) => (
                  <div
                    key={m.id}
                    className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 text-[11px] font-mono flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-slate-300">
                        {m.display_name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Context: {(m.context_window / 1024).toFixed(0)}k · Quality:{' '}
                        {Math.round(m.quality_prior * 100)}%
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {m.modalities.map((mod) => (
                        <span
                          key={mod}
                          className="text-[9px] uppercase px-1 py-0.5 rounded bg-slate-800 text-slate-400"
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

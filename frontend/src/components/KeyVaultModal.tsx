import React, { useEffect, useState } from 'react';
import { X, Key, Shield, Plus, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { addKey, fetchKeys } from '../lib/api';
import { ApiKeyItem } from '../types';

interface KeyVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyVaultModal: React.FC<KeyVaultModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [providerId, setProviderId] = useState<string>('groq');
  const [label, setLabel] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [priority, setPriority] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchKeys();
      setKeys(data);
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

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim() || !label.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      await addKey(providerId, label, secret, priority);
      setMsg('Key registered successfully (stored as fingerprint)!');
      setLabel('');
      setSecret('');
      setShowAddForm(false);
      await loadData();
    } catch (err: any) {
      setMsg(`Error: ${err.message || 'Failed to add key'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md max-h-[85vh] rounded-2xl glass-panel-glow border-slate-700 bg-slate-900/95 overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" />
            <div>
              <h3 className="font-bold text-sm text-white">Provider Key Vault</h3>
              <p className="text-[10px] text-slate-400 font-mono">
                Fingerprint IDs only — raw secrets are never stored or logged
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
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
          {msg && (
            <div className="p-2.5 rounded-lg bg-slate-950 border border-mesh-accent/30 text-[11px] text-mesh-accent font-mono">
              {msg}
            </div>
          )}

          {/* Key List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase text-slate-400">
                Active & Monitored Keys ({keys.length})
              </span>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="text-[11px] font-mono text-mesh-accent hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Key
              </button>
            </div>

            {/* Add Key Form */}
            {showAddForm && (
              <form
                onSubmit={handleAddKey}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 animate-fadeIn font-mono"
              >
                <div className="text-[11px] text-slate-300 font-bold">Register API Key</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Provider</label>
                    <select
                      value={providerId}
                      onChange={(e) => setProviderId(e.target.value)}
                      className="w-full mt-0.5 p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs"
                    >
                      <option value="groq">Groq</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Label</label>
                    <input
                      type="text"
                      placeholder="e.g. personal-groq"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="w-full mt-0.5 p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 uppercase">Secret Key</label>
                  <input
                    type="password"
                    placeholder="gsk_... or sk-or-..."
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="w-full mt-0.5 p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-2.5 py-1 rounded bg-slate-800 text-slate-400 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-3 py-1 rounded bg-mesh-accent text-black font-bold text-xs shadow"
                  >
                    Register Key
                  </button>
                </div>
              </form>
            )}

            {keys.length === 0 ? (
              <div className="text-center py-6 text-slate-500 font-mono text-xs">
                No keys registered. Mock providers are used by default.
              </div>
            ) : (
              <div className="space-y-1.5">
                {keys.map((k, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-200">{k.label}</span>
                        <span className="text-[10px] text-slate-500 uppercase">({k.provider_id})</span>
                      </div>
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold border ${
                          k.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : k.status === 'rate_limited'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {k.is_in_cooldown ? 'COOLDOWN' : k.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                      <span>Mask: {k.mask}</span>
                      <span>Fingerprint: {k.fingerprint.slice(0, 10)}...</span>
                      <span>Priority: #{k.priority}</span>
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

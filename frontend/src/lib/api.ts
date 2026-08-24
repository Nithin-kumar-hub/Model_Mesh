import {
  ApiKeyItem,
  Classification,
  CompareStrategiesResult,
  ExecutionResult,
  Provider,
  RoutePlan,
  Strategy,
  TelemetryStats,
  WorkloadProfile,
} from '../types';

const API_BASE = '/api';

export async function classifyTask(inputText: string): Promise<Classification> {
  const res = await fetch(`${API_BASE}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_text: inputText }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function profileTask(inputText: string): Promise<{
  classification: Classification;
  profile: WorkloadProfile;
}> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_text: inputText }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function routeTask(
  inputText: string,
  strategy: Strategy
): Promise<RoutePlan> {
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_text: inputText, strategy }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function compareStrategies(
  inputText: string
): Promise<CompareStrategiesResult> {
  const res = await fetch(`${API_BASE}/compare-strategies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_text: inputText }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function executeTask(
  inputText: string,
  strategy: Strategy,
  simulateFault?: string
): Promise<ExecutionResult> {
  const res = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_text: inputText,
      strategy,
      simulate_fault: simulateFault || undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/providers`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchStats(): Promise<TelemetryStats> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchHistory(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/history?limit=15`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchKeys(): Promise<ApiKeyItem[]> {
  const res = await fetch(`${API_BASE}/keys`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addKey(
  provider_id: string,
  label: string,
  secret: string,
  priority = 100,
  quota_limit?: number
): Promise<ApiKeyItem> {
  const res = await fetch(`${API_BASE}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider_id,
      label,
      secret,
      priority,
      quota_limit: quota_limit || undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

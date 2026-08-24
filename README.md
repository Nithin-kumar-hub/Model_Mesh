# ModelMesh

**Universal AI workload router — Phase 1 core (text + code).**

Give ModelMesh a task. It classifies the workload, profiles the resource requirement,
filters to compatible provider/models, scores routes under a chosen strategy
(**Draft / Balanced / Premium**), executes through a provider adapter, recovers from
key/provider failures, records telemetry, and **explains why it chose the route** — all
designed mobile-first.

> Built for **iQOO City Battle 2026** (Bengaluru), phone-first. Phase 1 is the reusable
> routing engine plus a minimal mobile UI. Phase 2 (onsite) extends it to multimodal and
> device-native features **without rewriting the core**.

## Core pipeline

```
TASK → CLASSIFY → PROFILE → FILTER → SCORE → ROUTE → EXECUTE → FAILOVER → RESULT → TELEMETRY
```

## Architecture

- **`backend/`** — Python. The **routing core is pure standard library** (dataclasses + enums),
  so it runs and tests with zero third-party installs. **FastAPI + Pydantic** are a thin transport
  edge, and **LiteLLM** is the real-provider adapter edge (Groq, OpenRouter). Deterministic **mock
  providers** make routing/failover fully demonstrable offline.
- **`frontend/`** — mobile-first PWA (React + TypeScript + Tailwind + Vite). *(added in milestone M9)*

```
backend/
  app/
    config.py         # stdlib settings (env/.env); secrets never logged
    domain/           # Task, Classification, WorkloadProfile, Provider, Model, Key, Route, Execution, Usage, enums, errors
    classifier/ profiler/ registry/ routing/ keys/ adapters/ execution/ telemetry/
    api/  main.py      # FastAPI edge (thin controllers)
  tests/ unit|integration|e2e|api
```

## Backend — setup & run (on a machine with internet)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env        # optionally add GROQ_API_KEY / OPENROUTER_API_KEY
uvicorn app.main:app --reload
```

### Tests

```bash
# Full suite (needs deps installed): pytest
pytest

# Core-only suite — pure stdlib, no dependencies required:
python -m unittest discover -s tests -p 'test_*.py' -t .
```

## Providers & keys

- **No keys** → deterministic **MOCK** providers (a fully functional demo; all mock values are labelled `MOCK`).
- **With `GROQ_API_KEY` and/or `OPENROUTER_API_KEY`** → real execution via LiteLLM.
- Keys are read from `.env` (git-ignored) and are **never logged, returned by the API, or committed**.

## No fabrication

Mock outputs are labelled `MOCK`; profiler numbers are **estimates**, not billing; only real adapter
responses are real. Device/on-device claims are out of Phase 1 scope.

## Status

Phase 1 is in progress. See [`PROGRESS_LOG.md`](./PROGRESS_LOG.md) for the live checkpoint,
milestone status, and an append-only build log (used to resume cleanly if work is interrupted).

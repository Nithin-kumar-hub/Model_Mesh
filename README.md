# ModelMesh — Universal AI Workload Router

> **Phone-first AI routing system built for the iQOO City Battle 2026 (Bengaluru).**

ModelMesh understands an AI workload, estimates its token requirements, evaluates compatible providers, selects the best route under the user's objective (Draft / Balanced / Premium), executes the task, and automatically recovers from provider failures through key rotation and fallback failover.

---

## Architecture

```text
User Input (Mobile PWA)
        ↓
Task Classifier (Modality, Task Type, Complexity, Confidence)
        ↓
Workload Profiler (Token Range Heuristics: Best / Expected / Worst, Context Window)
        ↓
Capability Filter (Hard Stage 1: Modality, Context Window, Provider Health, Key Availability)
        ↓
Scoring Engine (Stage 2: Strategy Weights for Quality, Efficiency, Latency, Reliability, Quota)
        ↓
Best Route Selection + Fallback Hierarchy
        ↓
Execution Engine + Key Manager (Priority, Cooldown, Quota Tracking)
        ↓
Provider Adapters (Deterministic Mocks + LiteLLM for Groq & OpenRouter)
        ↓
Automatic Recovery (Bounded Retries on Transient Errors + Multi-Hop Failover)
        ↓
Result + Telemetry Recording (Usage, Latency, Failover Status, Explainability Reasons)
```

---

## Phase 1 Scope & Features

- **Modality Scope:** Text and Code tasks (extensible to multimodal in Phase 2).
- **Task Classification:** Deterministic rule-based classifier detecting code fences, language keywords, verbs, complexity indicators, and confidence scoring.
- **Workload Profiling:** Provider-independent token estimation producing ordered token envelopes (best, expected, worst), context window requirements, and heuristic confidence.
- **Data-Driven Provider Registry:**
  - 7 Deterministic Mock Providers (`mock_fast`, `mock_quality`, `mock_code`, `mock_rate_limited`, `mock_exhausted`, `mock_timeout`, `mock_unavailable`).
  - Real Provider Metadata (`groq`, `openrouter`) with published pricing, context limits, quality priors, and LiteLLM IDs.
- **Two-Stage Routing Engine:**
  - **Stage 1 (Hard Filtering):** Filters out candidates with unsupported modalities, insufficient context windows, unhealthy providers, or missing keys. Produces explicit `RejectedCandidate` entries with machine reason codes and human-readable explanations.
  - **Stage 2 (Strategy Scoring):** Multi-factor scoring across Quality, Efficiency, Latency, Reliability, and Key Quota Health.
    - **Draft Strategy:** Prioritizes low latency and cost efficiency.
    - **Balanced Strategy:** Balances quality, reliability, and token efficiency.
    - **Premium Strategy:** Prioritizes deep reasoning and top-tier model quality.
- **Key Manager & Security:**
  - Keys store **zero raw secrets** in memory or domain models (environment variable names + one-way SHA-256 fingerprints + display masks only).
  - Health tracking, cooldown timers on rate limits, and quota exhaustion markers.
- **Execution & Failover Engine:**
  - Bounded retry loops for transient errors (`TIMEOUT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`).
  - Multi-hop failover to ranked fallback candidates on recoverable errors.
  - Execution attempt trail recording latency, status, and error codes per attempt.
- **Telemetry Store:**
  - In-memory execution analytics tracking total tasks, success rate, actual vs estimated tokens, average latency, and failovers.
- **Mobile-First PWA Frontend:**
  - Designed for **360px, 390px, and 430px** portrait mobile viewports.
  - 4 core screens: **Task Composer** → **Workload Profile** → **Route Recommendation** → **Result & Telemetry**.
  - Real-time **Telemetry Stats** drawer and **Model Registry** inspector.

---

## Quickstart & Running Locally

### Prerequisites
- Python 3.10+
- Node.js 18+ and npm

### 1. Backend Setup & Run

```bash
cd backend

# (Optional) Set up virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend will start at `http://localhost:8000`. API documentation is available at `http://localhost:8000/docs`.

### 2. Frontend Setup & Run

```bash
cd frontend

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```

The frontend will start at `http://localhost:5173`. Open in a browser (or mobile device via local network).

---

## Running Test Suites

### Backend Unit, API, Integration, and E2E Tests

The backend test suite is pure Python standard library compatible:

```bash
cd backend
python -m unittest discover -s tests -p "test_*.py" -t . -v
```

**Result:** `185 tests passing, 0 failures, 0 errors`.

Test breakdown:
- `tests/unit/test_domain.py` (26 tests) — dataclasses, enums, error taxonomy, key security.
- `tests/unit/test_classifier.py` (29 tests) — modality, task types, complexity, confidence.
- `tests/unit/test_profiler.py` (18 tests) — text and code token estimation, ranges, context fit.
- `tests/unit/test_registry.py` (18 tests) — catalog lookup, modality queries, mock/real specs.
- `tests/unit/test_filter.py` (11 tests) — capability, context window, and key filtering.
- `tests/unit/test_scorer.py` (16 tests) — Draft / Balanced / Premium strategies and ranking.
- `tests/unit/test_key_manager.py` (14 tests) — priority selection, cooldown, failure tracking.
- `tests/unit/test_adapters.py` (13 tests) — 7 mock behaviors, error normalizer.
- `tests/unit/test_execution.py` (4 tests) — route execution, retries, key updates.
- `tests/unit/test_failover.py` (4 tests) — multi-hop failovers, all-route fail recovery.
- `tests/unit/test_telemetry.py` (4 tests) — execution metrics, history, stats.
- `tests/unit/test_config.py` (4 tests) — settings parsing, safety.
- `tests/unit/test_smoke.py` (2 tests) — stdlib import smoke tests.
- `tests/api/test_endpoints.py` (9 tests) — FastAPI endpoints, schemas, validation.
- `tests/api/test_health.py` (2 tests) — health probe and secret leak checks.
- `tests/integration/test_pipeline.py` (4 tests) — classifier → profiler → router → executor.
- `tests/e2e/test_full_flow.py` (3 tests) — full happy path, automatic failover, and strategy differentiation.

### Frontend Production Build Verification

```bash
cd frontend
npm run build
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/classify` | Determine modality, task type, complexity, and confidence signals |
| `POST` | `/profile` | Profile token bounds (best/expected/worst) and context requirement |
| `POST` | `/route` | Two-stage candidate filtering and strategy-based scoring |
| `POST` | `/execute` | Full pipeline: Classify → Profile → Route → Execute → Telemetry |
| `GET` | `/providers` | List registered providers and models |
| `GET` | `/stats` | Aggregated routing metrics, success rate, and token usage |
| `GET` | `/history` | Recent task execution log |
| `GET` | `/health` | Service health and real-provider key status |

---

## Phase 2 Onsite Extension Plan (30-Hour Hackathon)

ModelMesh Phase 1 established the stable, testable, explainable routing core. During the 30-hour onsite hackathon, Phase 2 will plug into this core to add:

1. **Multimodal Task Profiling:** `PdfProfiler`, `ImageProfiler`, `AudioProfiler`, `VideoProfiler`.
2. **Phone-Native Inputs:** Camera capture, voice/microphone input, local file picker.
3. **On-Device AI Path:** Local rule-based classifier → verified on-device NPU model → cloud fallback.
4. **QR Key Scanner:** Instant onboarding of provider keys via camera QR scanning into the Key Manager.
5. **Office Kit Integration:** Seamless phone-to-laptop bridging and workflow continuity.
6. **Live Telemetry Dashboard:** Real-time token burn rate, cost savings, and routing distribution charts.

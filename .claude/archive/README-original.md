# ModelMesh 🔥

> **AI Workload Planner & Orchestrator** — not just a model router.

ModelMesh is a mobile-first AI operating system that intelligently decomposes, optimizes, routes, executes, and verifies AI workloads across multiple providers — all from your phone.

---

## What makes it different

| Feature | Typical AI App | ModelMesh |
|---------|---------------|-----------|
| Input | Text | Text, Image, PDF, Camera, QR, Audio, Video, Code |
| Task handling | One model, one shot | Decompose → parallel specialist agents |
| Context | Full context to every call | Per-subtask context slicing |
| Token usage | Unoptimized | 3-layer optimization (global → subtask → output) |
| Failures | Task fails | Retry → key rotate → model fallback → re-plan |
| Results | Raw model output | Aggregated, deduplicated, conflict-resolved, verified |
| Learning | None | Calibration loop: estimate → actual → improve |

---

## Architecture at a glance

```
Input → Classify → Enhance → Optimize → Decompose into DAG
→ Plan (draft/balanced/premium) → Schedule (parallel/sequential)
→ Execute via best model for each subtask
→ Fail gracefully per-subtask, not globally
→ Aggregate → Verify → Output
→ Telemetry → Calibration → Better next time
```

---

## Quick Start

```bash
# Prerequisites: Node.js 20, pnpm 8, Docker
git clone https://github.com/you/modelmesh
cd modelmesh

cp .env.example .env
# Add your API keys to .env

docker compose up -d  # starts Postgres + Redis

pnpm install
pnpm prisma migrate dev
pnpm dev
```

---

## Project Structure

```
apps/api/          ← Node.js + TypeScript backend
apps/android/      ← Android (Kotlin + Jetpack Compose)
docs/              ← Full system documentation
```

---

## Documentation

| Doc | What it covers |
|-----|---------------|
| [Architecture](docs/01-ARCHITECTURE.md) | Full system flow |
| [Tech Stack](docs/02-TECH-STACK.md) | Why each technology |
| [System Design](docs/03-SYSTEM-DESIGN.md) | Component deep-dives |
| [API Spec](docs/04-API-SPEC.md) | REST + WebSocket API |
| [Data Models](docs/05-DATA-MODELS.md) | Database schema + types |
| [Orchestration](docs/06-ORCHESTRATION-ENGINE.md) | DAG engine design |
| [Providers](docs/07-PROVIDER-ADAPTERS.md) | AI provider integration |
| [Token Intelligence](docs/08-TOKEN-INTELLIGENCE.md) | Optimization system |
| [Agent Roles](docs/09-AGENT-ROLES.md) | Capability-based routing |
| [Android App](docs/10-MOBILE-ANDROID.md) | Mobile implementation |
| [Telemetry](docs/11-TELEMETRY.md) | Metrics + calibration loop |
| [Testing](docs/12-TESTING.md) | Test strategy |
| [Deployment](docs/13-DEPLOYMENT.md) | Production setup |
| [Phase Plan](docs/14-PHASE-PLAN.md) | Build roadmap |
| [Demo Guide](docs/15-DEMO-GUIDE.md) | Hackathon demo prep |

---

## Built for iQOO AI Hackathon

- Phone-first architecture
- On-device preprocessing via ML Kit
- Hardware-aware routing (NPU/GPU hints)
- Office Kit integration ready
- Real-time execution trace for demo impact

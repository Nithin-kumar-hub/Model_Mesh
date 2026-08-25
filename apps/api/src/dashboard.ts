export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neural Forge — AI Workload Orchestrator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #06080f;
      --bg-surface: rgba(12, 17, 30, 0.85);
      --bg-surface-hover: rgba(18, 26, 46, 0.92);
      --bg-elevated: rgba(22, 30, 52, 0.9);
      --border-subtle: rgba(255, 255, 255, 0.06);
      --border-interactive: rgba(255, 255, 255, 0.12);
      --accent-primary: #8b5cf6;
      --accent-primary-glow: rgba(139, 92, 246, 0.35);
      --accent-secondary: #06b6d4;
      --accent-secondary-glow: rgba(6, 182, 212, 0.25);
      --accent-success: #10b981;
      --accent-warning: #f59e0b;
      --accent-danger: #ef4444;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --font-sans: 'Inter', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
      --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
      --shadow-glow: 0 0 40px var(--accent-primary-glow);
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
      --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html { scroll-behavior: smooth; }

    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* ─── Animated Background ─────────────────────────────────── */
    .bg-effects {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .bg-effects .orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(120px);
      animation: float 20s ease-in-out infinite;
    }
    .bg-effects .orb-1 {
      width: 600px; height: 600px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.15), transparent 70%);
      top: -10%; left: -5%;
      animation-delay: 0s;
    }
    .bg-effects .orb-2 {
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(6, 182, 212, 0.12), transparent 70%);
      bottom: -10%; right: -5%;
      animation-delay: -7s;
    }
    .bg-effects .orb-3 {
      width: 400px; height: 400px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.08), transparent 70%);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      animation-delay: -14s;
    }
    .bg-effects .grid-overlay {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 64px 64px;
      mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
    }

    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(30px, -40px) scale(1.05); }
      66% { transform: translate(-20px, 30px) scale(0.95); }
    }

    /* ─── Header / Navbar ─────────────────────────────────────── */
    .navbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      height: 64px;
      background: rgba(6, 8, 15, 0.75);
      backdrop-filter: blur(20px) saturate(1.5);
      border-bottom: 1px solid var(--border-subtle);
    }
    .navbar-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .navbar-logo {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      display: flex; align-items: center; justify-content: center;
      font-size: 1.15rem;
      box-shadow: 0 0 20px var(--accent-primary-glow);
    }
    .navbar-title {
      font-size: 1.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #e2e8f0, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .navbar-tag {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.3);
      color: #c4b5fd;
    }
    .navbar-status {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent-success);
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent-success);
      box-shadow: 0 0 8px var(--accent-success);
      animation: blink 2s ease-in-out infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ─── Layout ──────────────────────────────────────────────── */
    .app-container {
      position: relative;
      z-index: 1;
      max-width: 1440px;
      margin: 0 auto;
      padding: 1.75rem 2rem 3rem;
    }
    .layout-grid {
      display: grid;
      grid-template-columns: 400px 1fr;
      gap: 1.75rem;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .layout-grid { grid-template-columns: 1fr; }
    }

    /* ─── Cards ───────────────────────────────────────────────── */
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      backdrop-filter: blur(24px);
      box-shadow: var(--shadow-card);
      overflow: hidden;
      transition: border-color var(--transition-smooth);
    }
    .card:hover {
      border-color: var(--border-interactive);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.15rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }
    .card-header-title {
      font-size: 0.95rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card-header-title .icon {
      font-size: 1.1rem;
    }
    .card-body { padding: 1.5rem; }

    /* ─── Form Controls ───────────────────────────────────────── */
    .form-stack { display: flex; flex-direction: column; gap: 1.15rem; }

    .field-label {
      display: block;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }

    .select-wrap {
      position: relative;
    }
    .select-wrap select {
      appearance: none;
      width: 100%;
      background: rgba(8, 12, 24, 0.7);
      border: 1px solid var(--border-interactive);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      padding: 0.7rem 2.5rem 0.7rem 0.85rem;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .select-wrap::after {
      content: '▾';
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 0.85rem;
      pointer-events: none;
    }
    .select-wrap select:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-primary-glow);
    }

    textarea {
      width: 100%;
      min-height: 200px;
      resize: vertical;
      background: rgba(8, 12, 24, 0.7);
      border: 1px solid var(--border-interactive);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.7;
      padding: 0.85rem;
      transition: all var(--transition-fast);
    }
    textarea::placeholder { color: var(--text-muted); }
    textarea:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-primary-glow);
    }

    /* ─── Quick Templates ─────────────────────────────────────── */
    .templates-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .template-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      border-radius: 999px;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .template-chip:hover {
      background: rgba(139, 92, 246, 0.12);
      border-color: rgba(139, 92, 246, 0.3);
      color: #e2e8f0;
      transform: translateY(-1px);
    }

    /* ─── Primary Button ──────────────────────────────────────── */
    .btn-submit {
      position: relative;
      width: 100%;
      padding: 0.9rem;
      font-family: var(--font-sans);
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #7c3aed, #6366f1);
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all var(--transition-smooth);
      box-shadow: 0 4px 20px rgba(124, 58, 237, 0.35);
      overflow: hidden;
    }
    .btn-submit::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, transparent, rgba(255,255,255,0.15), transparent);
      transform: translateX(-100%);
      transition: transform 0.6s ease;
    }
    .btn-submit:hover::before { transform: translateX(100%); }
    .btn-submit:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(124, 58, 237, 0.5);
    }
    .btn-submit:active { transform: translateY(0); }
    .btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .btn-submit:disabled::before { display: none; }

    /* ─── Right Column ────────────────────────────────────────── */
    .results-stack { display: flex; flex-direction: column; gap: 1.5rem; }

    /* ─── Pipeline Stage Visualizer ───────────────────────────── */
    .pipeline-bar {
      display: flex;
      gap: 2px;
      padding: 0.75rem 1.5rem;
      overflow-x: auto;
    }
    .pipeline-stage {
      flex: 1;
      min-width: 24px;
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.06);
      transition: background var(--transition-smooth), box-shadow var(--transition-smooth);
      position: relative;
    }
    .pipeline-stage.active {
      background: var(--accent-primary);
      box-shadow: 0 0 10px var(--accent-primary-glow);
      animation: stagePulse 1s ease-in-out infinite;
    }
    .pipeline-stage.done {
      background: var(--accent-success);
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.3);
    }
    .pipeline-stage.error {
      background: var(--accent-danger);
    }
    .pipeline-stage .stage-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-interactive);
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-secondary);
      white-space: nowrap;
      z-index: 10;
    }
    .pipeline-stage:hover .stage-tooltip { display: block; }

    @keyframes stagePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* ─── Metrics ─────────────────────────────────────────────── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.75rem;
    }
    @media (max-width: 800px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .metric-tile {
      background: rgba(8, 12, 24, 0.5);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      transition: all var(--transition-smooth);
    }
    .metric-tile:hover {
      border-color: var(--border-interactive);
      background: rgba(14, 20, 38, 0.6);
    }
    .metric-tile .val {
      font-size: 1.65rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
    }
    .metric-tile .lbl {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
    }
    .color-cyan { color: var(--accent-secondary); }
    .color-green { color: var(--accent-success); }
    .color-purple { color: var(--accent-primary); }
    .color-amber { color: var(--accent-warning); }

    /* ─── DAG View ────────────────────────────────────────────── */
    .dag-wrapper { display: flex; flex-direction: column; gap: 1rem; }

    .dag-batch {
      position: relative;
      background: rgba(8, 12, 24, 0.4);
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: var(--radius-md);
      padding: 1rem;
    }
    .dag-batch-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .dag-batch-num {
      width: 22px; height: 22px;
      border-radius: 6px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.3);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem;
      font-weight: 800;
      color: #c4b5fd;
    }
    .dag-batch-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .dag-batch-count {
      font-size: 0.68rem;
      color: var(--text-muted);
      margin-left: auto;
    }

    .subtask-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.65rem;
    }
    .subtask-tile {
      background: rgba(20, 28, 50, 0.7);
      border: 1px solid var(--border-subtle);
      border-left: 3px solid var(--accent-primary);
      border-radius: var(--radius-sm);
      padding: 0.75rem 0.85rem;
      transition: all var(--transition-fast);
    }
    .subtask-tile:hover {
      border-color: var(--border-interactive);
      transform: translateY(-1px);
    }
    .subtask-tile .role-name {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.3rem;
    }
    .subtask-tile .model-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: var(--text-muted);
    }

    /* Connector arrow between batches */
    .dag-connector {
      display: flex;
      justify-content: center;
      color: rgba(255, 255, 255, 0.15);
      font-size: 1rem;
      line-height: 1;
    }

    /* ─── Trace Log ───────────────────────────────────────────── */
    .trace-scroll {
      max-height: 220px;
      overflow-y: auto;
      background: rgba(4, 6, 14, 0.8);
      border-radius: var(--radius-md);
      padding: 0.85rem;
      font-family: var(--font-mono);
      font-size: 0.77rem;
      line-height: 1.8;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    .trace-scroll::-webkit-scrollbar { width: 5px; }
    .trace-scroll::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
    }
    .trace-entry {
      display: flex;
      gap: 0.6rem;
      align-items: baseline;
    }
    .trace-entry .ts {
      color: var(--text-muted);
      font-size: 0.7rem;
      min-width: 52px;
      flex-shrink: 0;
    }
    .trace-entry .stage {
      color: var(--accent-primary);
      font-weight: 700;
      min-width: 80px;
      flex-shrink: 0;
    }
    .trace-entry .msg { color: var(--text-secondary); }

    /* ─── Output Box ──────────────────────────────────────────── */
    .output-pane {
      background: rgba(4, 6, 14, 0.8);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      font-family: var(--font-sans);
      font-size: 0.9rem;
      line-height: 1.7;
      white-space: pre-wrap;
      max-height: 420px;
      overflow-y: auto;
      color: var(--text-secondary);
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    .output-pane::-webkit-scrollbar { width: 5px; }
    .output-pane::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
    }

    /* ─── Breakdown Table ─────────────────────────────────────── */
    .route-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .route-table th {
      text-align: left;
      padding: 0.6rem 0.85rem;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
    }
    .route-table td {
      padding: 0.6rem 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
    }
    .route-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* ─── Badge ───────────────────────────────────────────────── */
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-radius: 6px;
    }
    .badge-ready {
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.25);
    }
    .badge-processing {
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.25);
    }
    .badge-completed {
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .badge-failed {
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.25);
    }

    /* ─── Empty States ────────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 2rem 1rem;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    .empty-state .empty-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      opacity: 0.4;
    }

    /* ─── Footer ──────────────────────────────────────────────── */
    .app-footer {
      text-align: center;
      padding: 2rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border-subtle);
      margin-top: 2rem;
    }
    .app-footer a {
      color: var(--accent-primary);
      text-decoration: none;
    }

    /* ─── Animations ──────────────────────────────────────────── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-in {
      animation: fadeUp 0.5s ease-out forwards;
    }
    .delay-1 { animation-delay: 0.05s; }
    .delay-2 { animation-delay: 0.1s; }
    .delay-3 { animation-delay: 0.15s; }
    .delay-4 { animation-delay: 0.2s; }
    .delay-5 { animation-delay: 0.25s; }
  </style>
</head>
<body>

  <!-- Animated Background -->
  <div class="bg-effects">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
    <div class="grid-overlay"></div>
  </div>

  <!-- Navbar -->
  <nav class="navbar">
    <div class="navbar-brand">
      <div class="navbar-logo">🔮</div>
      <span class="navbar-title">Neural Forge</span>
      <span class="navbar-tag">Orchestrator</span>
    </div>
    <div class="navbar-status">
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span id="api-status">Online</span>
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <div class="app-container">
    <div class="layout-grid">

      <!-- ─── Left: Task Submission ──────────────────────────── -->
      <div style="display:flex;flex-direction:column;gap:1.5rem;">

        <div class="card animate-in delay-1">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">⚡</span> Submit Workload</span>
          </div>
          <div class="card-body">
            <div class="form-stack">

              <div>
                <span class="field-label">Quick Templates</span>
                <div class="templates-row">
                  <button class="template-chip" onclick="loadTemplate('code')">🔍 Code Review</button>
                  <button class="template-chip" onclick="loadTemplate('math')">🧮 Multi-step Math</button>
                  <button class="template-chip" onclick="loadTemplate('qa')">💬 Simple Q&A</button>
                  <button class="template-chip" onclick="loadTemplate('security')">🛡️ Security Audit</button>
                </div>
              </div>

              <div>
                <span class="field-label">Task Modality</span>
                <div class="select-wrap">
                  <select id="task-type">
                    <option value="code">Code Review / Analysis</option>
                    <option value="text">General Text / Reasoning</option>
                    <option value="multipart">Multimodal Workload</option>
                  </select>
                </div>
              </div>

              <div>
                <span class="field-label">Execution Strategy</span>
                <div class="select-wrap">
                  <select id="strategy">
                    <option value="balanced" selected>⚖️ Balanced — Optimal cost & latency</option>
                    <option value="draft">⚡ Draft — Fastest, minimal compute</option>
                    <option value="premium">💎 Premium — Maximum verification</option>
                  </select>
                </div>
              </div>

              <div>
                <span class="field-label">Prompt / Directive / Code</span>
                <textarea id="input-text" placeholder="Enter your prompt, paste code, or describe the task..."></textarea>
              </div>

              <button id="submit-btn" class="btn-submit" onclick="submitWorkload()">
                <span>⚡</span>
                <span>Run Workload Graph</span>
              </button>

            </div>
          </div>
        </div>

      </div>

      <!-- ─── Right: Results & Telemetry ─────────────────────── -->
      <div class="results-stack">

        <!-- Pipeline Progress -->
        <div class="card animate-in delay-2">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">🔄</span> Pipeline Progress</span>
            <span id="task-status-badge" class="status-badge badge-ready">Ready</span>
          </div>
          <div class="pipeline-bar" id="pipeline-bar"></div>
          <div class="card-body" style="padding-top:0.5rem;">
            <div class="metrics-grid">
              <div class="metric-tile">
                <span id="metric-latency" class="val color-cyan">—</span>
                <span class="lbl">Exec Time</span>
              </div>
              <div class="metric-tile">
                <span id="metric-savings" class="val color-green">—</span>
                <span class="lbl">Context Saved</span>
              </div>
              <div class="metric-tile">
                <span id="metric-tokens" class="val color-amber">—</span>
                <span class="lbl">Tokens Used</span>
              </div>
              <div class="metric-tile">
                <span id="metric-confidence" class="val color-purple">—</span>
                <span class="lbl">Confidence</span>
              </div>
            </div>
          </div>
        </div>

        <!-- DAG View -->
        <div class="card animate-in delay-3">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">🔀</span> Task Decomposition Graph</span>
          </div>
          <div class="card-body">
            <div id="dag-view" class="dag-wrapper">
              <div class="empty-state">
                <div class="empty-icon">◇</div>
                Submit a workload to visualize the subtask dependency graph and model routing.
              </div>
            </div>
          </div>
        </div>

        <!-- Execution Trace -->
        <div class="card animate-in delay-4">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">📡</span> Execution Trace</span>
          </div>
          <div class="card-body">
            <div id="trace-log" class="trace-scroll">
              <div class="trace-entry">
                <span class="ts">[0ms]</span>
                <span class="stage">idle</span>
                <span class="msg">Waiting for workload submission…</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Verified Result -->
        <div class="card animate-in delay-5">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">✅</span> Verified Result</span>
          </div>
          <div class="card-body">
            <div id="output-view" class="output-pane">Synthesized result will appear here after subtask aggregation and verification…</div>
          </div>
        </div>

        <!-- Model Routing Breakdown -->
        <div class="card animate-in delay-5">
          <div class="card-header">
            <span class="card-header-title"><span class="icon">🤖</span> Model Routing Breakdown</span>
          </div>
          <div class="card-body" style="padding-top:0;">
            <table class="route-table">
              <thead>
                <tr>
                  <th>Subtask</th>
                  <th>Assigned Model</th>
                  <th>In Tokens</th>
                  <th>Out Tokens</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody id="breakdown-body">
                <tr>
                  <td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No active execution</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  </div>

  <footer class="app-footer">
    Neural Forge v0.1.0 — AI Workload Planner &amp; Orchestrator &nbsp;·&nbsp; Built for the iQOO AI Hackathon
  </footer>

  <script>
    // ─── Constants ────────────────────────────────────────────
    var API_KEY = "dev-secret-change-me";

    var PIPELINE_STAGES = [
      "safety", "classify", "enhance", "optimize", "decompose",
      "profile", "slice", "plan", "schedule", "route",
      "execute", "recover", "aggregate", "verify", "telemetry"
    ];

    var templates = {
      code: "public class DataProcessor {\\n  public static void process(List<String> items) {\\n    for (int i = 0; i < items.size(); i++) {\\n      System.out.println(items.get(i));\\n    }\\n  }\\n}",
      math: "A train leaves Station A at 60 mph. Another train leaves Station B towards A at 80 mph. The stations are 280 miles apart. When will they meet and how far has each traveled?",
      qa: "What are the primary advantages of asynchronous task graphs over monolithic LLM routing?",
      security: "Review this authentication handler for vulnerabilities:\\n\\napp.post('/login', (req, res) => {\\n  const { username, password } = req.body;\\n  const user = db.query('SELECT * FROM users WHERE name = \\\\'' + username + '\\\\' AND pass = \\\\'' + password + '\\\\'');\\n  if (user) res.json({ token: jwt.sign({ id: user.id }) });\\n});"
    };

    // ─── Initialize Pipeline Bar ─────────────────────────────
    (function initPipeline() {
      var bar = document.getElementById('pipeline-bar');
      PIPELINE_STAGES.forEach(function(name) {
        var el = document.createElement('div');
        el.className = 'pipeline-stage';
        el.setAttribute('data-stage', name);
        el.innerHTML = '<span class="stage-tooltip">' + name + '</span>';
        bar.appendChild(el);
      });
    })();

    function resetPipeline() {
      PIPELINE_STAGES.forEach(function(name) {
        var el = document.querySelector('.pipeline-stage[data-stage="' + name + '"]');
        if (el) el.className = 'pipeline-stage';
      });
    }

    function activateStage(name) {
      var el = document.querySelector('.pipeline-stage[data-stage="' + name + '"]');
      if (el && !el.classList.contains('done')) {
        // Mark previous active as done
        document.querySelectorAll('.pipeline-stage.active').forEach(function(p) {
          p.classList.remove('active');
          p.classList.add('done');
        });
        el.classList.add('active');
      }
    }

    function completeAllStages() {
      document.querySelectorAll('.pipeline-stage').forEach(function(el) {
        el.classList.remove('active');
        el.classList.add('done');
      });
    }

    // ─── Templates ───────────────────────────────────────────
    function loadTemplate(type) {
      var t = templates[type] || "";
      document.getElementById('input-text').value = t.replace(/\\\\n/g, '\\n');
      if (type === 'code' || type === 'security') {
        document.getElementById('task-type').value = 'code';
      } else {
        document.getElementById('task-type').value = 'text';
      }
    }

    // ─── Submit ──────────────────────────────────────────────
    function submitWorkload() {
      var btn = document.getElementById('submit-btn');
      var text = document.getElementById('input-text').value.trim();
      var type = document.getElementById('task-type').value;
      var strategy = document.getElementById('strategy').value;

      if (!text) { alert("Please enter a prompt or code first."); return; }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner">⏳</span><span>Orchestrating…</span>';

      resetPipeline();
      setBadge('processing');

      fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ input: { type: type, text: text }, strategy: strategy })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.error) throw new Error(data.error.message);
        pollTask(data.taskId);
      })
      .catch(function(err) {
        alert("Error: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<span>⚡</span><span>Run Workload Graph</span>';
        setBadge('ready');
      });
    }

    // ─── Poll ────────────────────────────────────────────────
    function pollTask(taskId) {
      var traceLog = document.getElementById('trace-log');
      var seenStages = {};

      var interval = setInterval(function() {
        fetch('/api/v1/tasks/' + taskId, { headers: { 'X-API-Key': API_KEY } })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          // Fetch trace events
          fetch('/api/v1/tasks/' + taskId + '/trace', { headers: { 'X-API-Key': API_KEY } })
          .then(function(tRes) { return tRes.json(); })
          .then(function(traceData) {
            if (traceData.events) {
              traceLog.innerHTML = traceData.events.map(function(e) {
                // Activate pipeline stage
                var stageName = (e.event || '').replace(/^stage:/, '');
                if (PIPELINE_STAGES.indexOf(stageName) >= 0 && !seenStages[stageName]) {
                  seenStages[stageName] = true;
                  activateStage(stageName);
                }

                var payload = e.payload ? JSON.stringify(e.payload).substring(0, 120) : '';
                return '<div class="trace-entry">' +
                  '<span class="ts">[' + (e.ts || 0) + 'ms]</span> ' +
                  '<span class="stage">' + (e.event || '') + '</span> ' +
                  '<span class="msg">' + payload + '</span>' +
                  '</div>';
              }).join('');
              traceLog.scrollTop = traceLog.scrollHeight;
            }

            if (data.status === 'completed' || data.status === 'failed') {
              clearInterval(interval);
              completeAllStages();
              renderResults(data);

              var btn = document.getElementById('submit-btn');
              btn.disabled = false;
              btn.innerHTML = '<span>⚡</span><span>Run Workload Graph</span>';

              setBadge(data.status === 'completed' ? 'completed' : 'failed');
            }
          });
        });
      }, 300);
    }

    // ─── Badge Helper ────────────────────────────────────────
    function setBadge(state) {
      var badge = document.getElementById('task-status-badge');
      badge.className = 'status-badge badge-' + state;
      badge.innerText = state.charAt(0).toUpperCase() + state.slice(1);
    }

    // ─── Render Results ──────────────────────────────────────
    function renderResults(data) {
      var t = data.telemetry || {};
      document.getElementById('metric-latency').innerText = (t.totalMs || 0) + " ms";
      document.getElementById('metric-savings').innerText = (t.savingsPercent || 0) + "%";
      document.getElementById('metric-tokens').innerText = formatNumber(t.actualTokens || 0);
      document.getElementById('metric-confidence').innerText =
        data.result && data.result.confidence ? (data.result.confidence * 100).toFixed(0) + "%" : "—";

      document.getElementById('output-view').innerText =
        (data.result && data.result.output) ? data.result.output : "No output generated.";

      // DAG
      var dagView = document.getElementById('dag-view');
      if (data.plan && data.plan.parallelGroups && data.plan.parallelGroups.length > 0) {
        var html = '';
        data.plan.parallelGroups.forEach(function(group, idx) {
          if (idx > 0) {
            html += '<div class="dag-connector">↓</div>';
          }
          html += '<div class="dag-batch">' +
            '<div class="dag-batch-header">' +
              '<span class="dag-batch-num">' + (idx + 1) + '</span>' +
              '<span class="dag-batch-label">Execution Batch</span>' +
              '<span class="dag-batch-count">' + group.length + ' subtask' + (group.length > 1 ? 's' : '') + ' (parallel)</span>' +
            '</div>' +
            '<div class="subtask-grid">';

          group.forEach(function(nodeId) {
            var sub = (data.subtasks || []).find(function(s) { return s.id === nodeId; }) || {};
            var borderColors = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
            var color = borderColors[idx % borderColors.length];
            html += '<div class="subtask-tile" style="border-left-color:' + color + '">' +
              '<div class="role-name">' + escapeHtml(sub.role || nodeId) + '</div>' +
              '<div class="model-info">' +
                '<span>' + escapeHtml(sub.model || 'auto') + '</span>' +
                '<span>' + (sub.latencyMs || 0) + 'ms</span>' +
              '</div>' +
            '</div>';
          });

          html += '</div></div>';
        });
        dagView.innerHTML = html;
      }

      // Breakdown
      var tbody = document.getElementById('breakdown-body');
      if (t.providerBreakdown && t.providerBreakdown.length > 0) {
        tbody.innerHTML = t.providerBreakdown.map(function(b) {
          return '<tr>' +
            '<td><strong>' + escapeHtml(b.subtask) + '</strong></td>' +
            '<td>' + escapeHtml(b.model) + '</td>' +
            '<td>' + formatNumber(b.inputTokens) + '</td>' +
            '<td>' + formatNumber(b.outputTokens) + '</td>' +
            '<td>' + (b.latencyMs) + 'ms</td>' +
          '</tr>';
        }).join('');
      }
    }

    // ─── Helpers ─────────────────────────────────────────────
    function formatNumber(n) {
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    function escapeHtml(s) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(s));
      return div.innerHTML;
    }

    // Load default template on start
    loadTemplate('code');
  </script>
</body>
</html>`;

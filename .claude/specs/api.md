# 04 — API Specification

## Base URL
```
Development: http://localhost:3000/api/v1
Production:  https://api.modelmesh.app/api/v1
```

## Authentication
All requests must include:
```
X-API-Key: your-api-key
```

---

## REST Endpoints

### POST /tasks
Submit a new task for processing.

**Request:**
```json
{
  "input": {
    "type": "text | image | pdf | audio | video | code | multipart",
    "text": "Analyze my Java backend for security vulnerabilities",
    "files": [
      {
        "id": "file_abc123",
        "mimeType": "application/pdf",
        "base64": "...",
        "metadata": {
          "pageCount": 12,
          "sizeBytes": 204800,
          "preprocessedAt": "2025-01-01T00:00:00Z"
        }
      }
    ],
    "localMetadata": {
      "imageWidth": 1920,
      "imageHeight": 1080,
      "audioDurationSeconds": 45,
      "detectedText": "QR/OCR pre-extracted on device",
      "detectedLanguage": "en",
      "deviceModel": "iQOO 13",
      "hasNPU": true
    }
  },
  "strategy": "balanced",
  "budget": {
    "maxTokens": 50000,
    "maxLatencyMs": 15000,
    "minQuality": 0.75
  },
  "preferences": {
    "preferLocalModels": false,
    "explainPlan": true,
    "streamTrace": true
  }
}
```

**Response (202 Accepted):**
```json
{
  "taskId": "task_01J9K7XHAB2M4V3N5P8Q",
  "status": "received",
  "websocketRoom": "task_01J9K7XHAB2M4V3N5P8Q",
  "estimatedMs": 4200,
  "createdAt": "2025-01-01T12:00:00Z"
}
```

---

### GET /tasks/:taskId
Get task status and result.

**Response (200):**
```json
{
  "taskId": "task_01J9K7XHAB2M4V3N5P8Q",
  "status": "completed",
  "result": {
    "output": "## Security Analysis\n\n...",
    "format": "markdown",
    "confidence": 0.87
  },
  "plan": {
    "strategy": "balanced",
    "subtaskCount": 4,
    "parallelGroups": [["s1","s2","s3"], ["s4"]],
    "reasoning": "4 independent analysis subtasks were parallelized for 58% latency reduction"
  },
  "telemetry": {
    "totalMs": 3847,
    "estimatedTokens": 18400,
    "actualTokens": 14200,
    "savedTokens": 4200,
    "savingsPercent": 22.8,
    "providerBreakdown": [
      { "provider": "groq", "model": "llama-3.1-70b", "tokens": 5200, "subtask": "bug_analysis" },
      { "provider": "gemini", "model": "1.5-flash", "tokens": 4600, "subtask": "security_analysis" },
      { "provider": "together", "model": "deepseek-coder", "tokens": 4400, "subtask": "performance" }
    ],
    "failovers": 1,
    "cacheHits": 0
  }
}
```

---

### GET /tasks/:taskId/trace
Get the full execution trace (for history view in Android app).

**Response:**
```json
{
  "taskId": "task_01J9K7XHAB2M4V3N5P8Q",
  "events": [
    { "event": "task_received", "ts": 0 },
    { "event": "classified", "taskType": "CODE_SECURITY", "confidence": 0.94, "ts": 120 },
    { "event": "enhanced", "originalLength": 42, "enhancedLength": 380, "ts": 890 },
    { "event": "decomposed", "subtaskCount": 4, "ts": 1240 },
    { "event": "plan_selected", "strategy": "balanced", "plans": 3, "ts": 1380 },
    { "event": "subtask_started", "subtaskId": "s1", "role": "SECURITY_ANALYZER", "ts": 1400 },
    { "event": "subtask_started", "subtaskId": "s2", "role": "CODER", "ts": 1402 },
    { "event": "subtask_started", "subtaskId": "s3", "role": "PERFORMANCE_ANALYZER", "ts": 1404 },
    { "event": "subtask_done", "subtaskId": "s1", "tokens": 3200, "ms": 2100, "ts": 3500 },
    { "event": "subtask_failed", "subtaskId": "s2", "error": "429", "retry": 1, "ts": 3600 },
    { "event": "subtask_done", "subtaskId": "s2", "tokens": 2800, "ms": 2400, "failovers": 1, "ts": 3810 },
    { "event": "subtask_done", "subtaskId": "s3", "tokens": 2600, "ms": 2200, "ts": 3605 },
    { "event": "aggregating", "conflictsFound": 0, "ts": 3815 },
    { "event": "completed", "totalTokens": 14200, "ms": 3847, "ts": 3847 }
  ]
}
```

---

### GET /providers/status
Get current health of all providers and their key pools.

**Response:**
```json
{
  "providers": [
    {
      "provider": "gemini",
      "status": "healthy",
      "activeKeys": 2,
      "rateLimitedKeys": 0,
      "avgLatencyMs": 1200,
      "healthScore": 0.97,
      "quotaConsumedToday": 45230,
      "models": ["gemini-1.5-flash", "gemini-1.5-pro"]
    },
    {
      "provider": "groq",
      "status": "degraded",
      "activeKeys": 1,
      "rateLimitedKeys": 1,
      "avgLatencyMs": 340,
      "healthScore": 0.72,
      "quotaConsumedToday": 89100,
      "models": ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"]
    }
  ],
  "timestamp": "2025-01-01T12:00:00Z"
}
```

---

### POST /providers/keys
Add a new API key for a provider.

**Request:**
```json
{
  "provider": "groq",
  "key": "gsk_...",
  "priority": 1,
  "label": "primary-key"
}
```

**Response (201):**
```json
{
  "keyId": "key_abc123",
  "provider": "groq",
  "maskedKey": "gsk_****xyz",
  "status": "active"
}
```

---

### GET /telemetry/stats
Get calibration and performance statistics.

**Response:**
```json
{
  "period": "last_7_days",
  "tasks": {
    "total": 1247,
    "byStrategy": { "draft": 312, "balanced": 780, "premium": 155 },
    "byType": { "code": 456, "document": 289, "research": 312, "image": 190 }
  },
  "tokens": {
    "totalEstimated": 18450000,
    "totalActual": 14320000,
    "avgSavingsPercent": 22.4,
    "calibrationError": 0.08
  },
  "latency": {
    "p50Ms": 2100,
    "p95Ms": 8400,
    "p99Ms": 14200
  },
  "reliability": {
    "taskSuccessRate": 0.987,
    "subtaskFailoverRate": 0.043,
    "cacheHitRate": 0.18
  },
  "providerBreakdown": [
    { "provider": "gemini", "callCount": 2341, "avgLatencyMs": 1180, "errorRate": 0.02 },
    { "provider": "groq", "callCount": 3892, "avgLatencyMs": 310, "errorRate": 0.06 }
  ]
}
```

---

### POST /tasks/:taskId/feedback
Submit user feedback (for future quality learning).

**Request:**
```json
{
  "rating": 4,
  "comment": "Good analysis but missed one bug",
  "actualQuality": 0.75
}
```

---

## WebSocket Events

Connect to: `ws://localhost:3000/ws/tasks/:taskId`

### Client → Server
```json
{ "type": "subscribe", "taskId": "task_..." }
{ "type": "unsubscribe" }
```

### Server → Client Events

| Event | When | Key Payload |
|-------|------|-------------|
| `task_received` | Task accepted | `taskId` |
| `classifying` | Starting classification | - |
| `classified` | Classification done | `taskType`, `confidence` |
| `enhancing` | Starting enhancement | - |
| `enhanced` | Enhancement done | `subtaskCount` |
| `planning` | Generating execution plans | `planCount: 3` |
| `plan_selected` | Plan chosen | `strategy`, `estimatedTokens`, `reasoning` |
| `subtask_started` | Subtask begins execution | `subtaskId`, `role`, `provider`, `model` |
| `subtask_progress` | Streaming token (optional) | `subtaskId`, `token` |
| `subtask_failed` | Subtask had an error | `subtaskId`, `error`, `retrying`, `attemptNumber` |
| `subtask_done` | Subtask completed | `subtaskId`, `tokens`, `ms`, `confidence`, `failovers` |
| `aggregating` | Merging results | `conflictsFound` |
| `verifying` | Running verification | `reason` |
| `completed` | Task fully done | `totalTokens`, `savedTokens`, `ms`, `output` |
| `failed` | Task failed permanently | `error`, `failedSubtasks` |

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_INPUT` | 400 | Malformed request body |
| `UNSUPPORTED_MODALITY` | 400 | Input type not yet supported |
| `FILE_TOO_LARGE` | 413 | File exceeds 20MB limit |
| `NO_PROVIDERS_AVAILABLE` | 503 | All keys rate-limited or unhealthy |
| `TASK_NOT_FOUND` | 404 | Task ID doesn't exist |
| `TASK_TIMED_OUT` | 408 | Task exceeded 60 second limit |
| `QUOTA_EXCEEDED` | 429 | Global quota exhausted |
| `PROMPT_INJECTION_DETECTED` | 400 | Safety guard triggered |

---

## Rate Limits (App-Level)

| Endpoint | Limit |
|----------|-------|
| POST /tasks | 10 req/min per API key |
| GET /tasks/:id | 60 req/min |
| WebSocket connections | 5 concurrent |

/**
 * Durable persistence.
 *
 * `PrismaPersistence` is the production path (PostgreSQL, docs/05-DATA-MODELS.md).
 * `MemoryPersistence` implements the identical contract in-process so the
 * orchestrator can be demoed and tested with no database running.
 */
import { PrismaClient } from '@prisma/client';
import type { ExecutionStrategy, InputType, ProviderName, TaskStatus } from '@modelmesh/types';
import { config } from '../config';
import { logger } from './logger';
import { eventId, keyId } from './ids';
import {
  NEUTRAL_CALIBRATION,
  type CacheEntryRecord,
  type CalibrationRecord,
  type FeedbackRecord,
  type NewProviderKey,
  type NewSubTask,
  type NewTask,
  type ProviderKeyPatch,
  type ProviderKeyRecord,
  type SubTaskPatch,
  type SubTaskRecord,
  type TaskPatch,
  type TaskRecord,
  type TelemetryRecord,
  type TelemetryRecordInput,
  type TraceEventRecord,
} from './records';

export interface TelemetryQuery {
  since?: Date;
  taskType?: string;
  provider?: string;
  limit?: number;
}

export interface Persistence {
  readonly kind: 'prisma' | 'memory';

  createTask(input: NewTask): Promise<TaskRecord>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  getTask(id: string): Promise<TaskRecord | null>;
  listTasks(options?: { limit?: number; status?: TaskStatus }): Promise<TaskRecord[]>;

  createSubTasks(subtasks: NewSubTask[]): Promise<void>;
  updateSubTask(taskId: string, nodeId: string, patch: SubTaskPatch): Promise<void>;
  listSubTasks(taskId: string): Promise<SubTaskRecord[]>;

  appendTrace(taskId: string, event: string, payload: Record<string, unknown>, msOffset: number): Promise<void>;
  listTrace(taskId: string): Promise<TraceEventRecord[]>;

  createProviderKey(input: NewProviderKey): Promise<ProviderKeyRecord>;
  listProviderKeys(provider?: ProviderName): Promise<ProviderKeyRecord[]>;
  getProviderKey(id: string): Promise<ProviderKeyRecord | null>;
  findProviderKeyByHash(keyHash: string): Promise<ProviderKeyRecord | null>;
  updateProviderKey(id: string, patch: ProviderKeyPatch): Promise<void>;

  recordTelemetry(input: TelemetryRecordInput): Promise<void>;
  listTelemetry(query?: TelemetryQuery): Promise<TelemetryRecord[]>;

  getCalibration(taskType: string, role: string): Promise<CalibrationRecord>;
  upsertCalibration(record: CalibrationRecord): Promise<void>;
  listCalibrations(): Promise<CalibrationRecord[]>;

  getCacheEntry(cacheKey: string): Promise<CacheEntryRecord | null>;
  putCacheEntry(entry: CacheEntryRecord): Promise<void>;
  listCacheEntriesByRole(role: string, limit: number): Promise<CacheEntryRecord[]>;
  incrementCacheHit(cacheKey: string): Promise<void>;
  purgeExpiredCache(): Promise<number>;

  saveFeedback(feedback: FeedbackRecord): Promise<void>;

  ping(): Promise<boolean>;
  close(): Promise<void>;
}

// ─── Enum mapping between the API vocabulary and the DB vocabulary ────────

const upper = (value: string): string => value.toUpperCase();
const lower = (value: string): string => value.toLowerCase();

const predictionError = (estimated: number | null | undefined, actual: number | null | undefined): number | null => {
  if (!estimated || estimated <= 0 || actual === null || actual === undefined) return null;
  return (actual - estimated) / estimated;
};

// ─── In-process implementation ────────────────────────────────────────────

export class MemoryPersistence implements Persistence {
  readonly kind = 'memory' as const;

  private readonly tasks = new Map<string, TaskRecord>();
  private readonly subtasks = new Map<string, SubTaskRecord>(); // `${taskId}:${nodeId}`
  private readonly traces = new Map<string, TraceEventRecord[]>();
  private readonly keys = new Map<string, ProviderKeyRecord>();
  private readonly telemetry: TelemetryRecord[] = [];
  private readonly calibrations = new Map<string, CalibrationRecord>();
  private readonly cacheEntries = new Map<string, CacheEntryRecord>();
  private readonly feedback = new Map<string, FeedbackRecord>();

  async createTask(input: NewTask): Promise<TaskRecord> {
    const record: TaskRecord = {
      id: input.id,
      status: input.status ?? 'received',
      strategy: input.strategy,
      inputType: input.inputType,
      inputText: input.inputText ?? null,
      inputMeta: input.inputMeta ?? null,
      taskType: null,
      confidence: null,
      enhancedSpec: null,
      executionPlan: null,
      output: null,
      outputFormat: null,
      outputConfidence: null,
      verification: null,
      partial: false,
      errorCode: null,
      estimatedTokens: null,
      actualTokens: null,
      savedTokens: null,
      estimatedLatencyMs: input.estimatedLatencyMs ?? null,
      actualLatencyMs: null,
      failovers: 0,
      cacheHits: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.tasks.set(record.id, record);
    return record;
  }

  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    const existing = this.tasks.get(id);
    if (!existing) return;
    this.tasks.set(id, { ...existing, ...patch });
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return this.tasks.get(id) ?? null;
  }

  async listTasks(options?: { limit?: number; status?: TaskStatus }): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => !options?.status || task.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options?.limit ?? 50);
  }

  async createSubTasks(subtasks: NewSubTask[]): Promise<void> {
    for (const input of subtasks) {
      const key = `${input.taskId}:${input.nodeId}`;
      this.subtasks.set(key, {
        id: key,
        taskId: input.taskId,
        nodeId: input.nodeId,
        role: input.role,
        status: input.status ?? 'pending',
        dependencies: input.dependencies,
        contextSlice: input.contextSlice ?? null,
        prompt: input.prompt ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        attemptNumber: 1,
        failovers: 0,
        fromCache: false,
        output: null,
        confidence: null,
        estimatedInputTokens: input.estimatedInputTokens ?? null,
        estimatedOutputTokens: input.estimatedOutputTokens ?? null,
        actualInputTokens: null,
        actualOutputTokens: null,
        latencyMs: null,
        errorCode: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
      });
    }
  }

  async updateSubTask(taskId: string, nodeId: string, patch: SubTaskPatch): Promise<void> {
    const key = `${taskId}:${nodeId}`;
    const existing = this.subtasks.get(key);
    if (!existing) return;
    this.subtasks.set(key, { ...existing, ...patch });
  }

  async listSubTasks(taskId: string): Promise<SubTaskRecord[]> {
    return [...this.subtasks.values()].filter((subtask) => subtask.taskId === taskId);
  }

  async appendTrace(
    taskId: string,
    event: string,
    payload: Record<string, unknown>,
    msOffset: number,
  ): Promise<void> {
    const events = this.traces.get(taskId) ?? [];
    events.push({ id: eventId(), taskId, event, payload, msOffset });
    this.traces.set(taskId, events);
  }

  async listTrace(taskId: string): Promise<TraceEventRecord[]> {
    return [...(this.traces.get(taskId) ?? [])].sort((a, b) => a.msOffset - b.msOffset);
  }

  async createProviderKey(input: NewProviderKey): Promise<ProviderKeyRecord> {
    const record: ProviderKeyRecord = {
      id: keyId(),
      provider: input.provider,
      maskedKey: input.maskedKey,
      encryptedKey: input.encryptedKey,
      keyHash: input.keyHash,
      label: input.label ?? null,
      priority: input.priority ?? 1,
      healthScore: 1,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      lastErrorCode: null,
      lastUsedAt: null,
      avgLatencyMs: 0,
      quotaLimit: input.quotaLimit ?? null,
      quotaUsed: 0,
      quotaResetAt: null,
      isRateLimited: false,
      rateLimitUntil: null,
      active: input.active ?? true,
      createdAt: new Date(),
    };
    this.keys.set(record.id, record);
    return record;
  }

  async listProviderKeys(provider?: ProviderName): Promise<ProviderKeyRecord[]> {
    return [...this.keys.values()].filter((key) => !provider || key.provider === provider);
  }

  async getProviderKey(id: string): Promise<ProviderKeyRecord | null> {
    return this.keys.get(id) ?? null;
  }

  async findProviderKeyByHash(keyHash: string): Promise<ProviderKeyRecord | null> {
    return [...this.keys.values()].find((key) => key.keyHash === keyHash) ?? null;
  }

  async updateProviderKey(id: string, patch: ProviderKeyPatch): Promise<void> {
    const existing = this.keys.get(id);
    if (!existing) return;
    this.keys.set(id, { ...existing, ...patch });
  }

  async recordTelemetry(input: TelemetryRecordInput): Promise<void> {
    this.telemetry.push({
      ...input,
      id: eventId(),
      tokenPredictionError: predictionError(
        (input.estimatedInputTokens ?? 0) + (input.estimatedOutputTokens ?? 0),
        (input.actualInputTokens ?? 0) + (input.actualOutputTokens ?? 0),
      ),
      latencyPredictionError: predictionError(input.estimatedLatencyMs, input.actualLatencyMs),
      recordedAt: new Date(),
    });
    // Bound memory growth in long demo sessions.
    if (this.telemetry.length > 20_000) this.telemetry.splice(0, 5_000);
  }

  async listTelemetry(query?: TelemetryQuery): Promise<TelemetryRecord[]> {
    return this.telemetry
      .filter((record) => {
        if (query?.since && record.recordedAt < query.since) return false;
        if (query?.taskType && record.taskType !== query.taskType) return false;
        if (query?.provider && record.provider !== query.provider) return false;
        return true;
      })
      .slice(-(query?.limit ?? 5_000));
  }

  async getCalibration(taskType: string, role: string): Promise<CalibrationRecord> {
    return this.calibrations.get(`${taskType}:${role}`) ?? NEUTRAL_CALIBRATION(taskType, role);
  }

  async upsertCalibration(record: CalibrationRecord): Promise<void> {
    this.calibrations.set(`${record.taskType}:${record.role}`, record);
  }

  async listCalibrations(): Promise<CalibrationRecord[]> {
    return [...this.calibrations.values()];
  }

  async getCacheEntry(cacheKey: string): Promise<CacheEntryRecord | null> {
    const entry = this.cacheEntries.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt.getTime() <= Date.now()) {
      this.cacheEntries.delete(cacheKey);
      return null;
    }
    return entry;
  }

  async putCacheEntry(entry: CacheEntryRecord): Promise<void> {
    this.cacheEntries.set(entry.cacheKey, entry);
  }

  async listCacheEntriesByRole(role: string, limit: number): Promise<CacheEntryRecord[]> {
    const now = Date.now();
    return [...this.cacheEntries.values()]
      .filter((entry) => entry.role === role && entry.expiresAt.getTime() > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async incrementCacheHit(cacheKey: string): Promise<void> {
    const entry = this.cacheEntries.get(cacheKey);
    if (entry) entry.hitCount += 1;
  }

  async purgeExpiredCache(): Promise<number> {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.cacheEntries) {
      if (entry.expiresAt.getTime() <= now) {
        this.cacheEntries.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  async saveFeedback(feedback: FeedbackRecord): Promise<void> {
    this.feedback.set(feedback.taskId, feedback);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.tasks.clear();
    this.subtasks.clear();
    this.traces.clear();
    this.telemetry.length = 0;
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma JSON columns are structurally dynamic. */
const asJson = (value: unknown): any => value as any;

export class PrismaPersistence implements Persistence {
  readonly kind = 'prisma' as const;

  constructor(private readonly prisma: PrismaClient) {}

  private static toTask(row: Record<string, any>): TaskRecord {
    return {
      id: row.id,
      status: lower(row.status) as TaskStatus,
      strategy: lower(row.strategy) as ExecutionStrategy,
      inputType: lower(row.inputType) as InputType,
      inputText: row.inputText,
      inputMeta: row.inputMeta ?? null,
      taskType: row.taskType,
      confidence: row.confidence,
      enhancedSpec: row.enhancedSpec ?? null,
      executionPlan: row.executionPlan ?? null,
      output: row.output,
      outputFormat: row.outputFormat,
      outputConfidence: row.outputConfidence,
      verification: row.verification ?? null,
      partial: row.partial,
      errorCode: row.errorCode,
      estimatedTokens: row.estimatedTokens,
      actualTokens: row.actualTokens,
      savedTokens: row.savedTokens,
      estimatedLatencyMs: row.estimatedLatencyMs,
      actualLatencyMs: row.actualLatencyMs,
      failovers: row.failovers,
      cacheHits: row.cacheHits,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  private static toSubTask(row: Record<string, any>): SubTaskRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      nodeId: row.nodeId,
      role: row.role,
      status: lower(row.status) as SubTaskRecord['status'],
      dependencies: row.dependencies ?? [],
      contextSlice: row.contextSlice,
      prompt: row.prompt,
      provider: row.provider,
      model: row.model,
      attemptNumber: row.attemptNumber,
      failovers: row.failovers,
      fromCache: row.fromCache,
      output: row.output,
      confidence: row.confidence,
      estimatedInputTokens: row.estimatedInputTokens,
      estimatedOutputTokens: row.estimatedOutputTokens,
      actualInputTokens: row.actualInputTokens,
      actualOutputTokens: row.actualOutputTokens,
      latencyMs: row.latencyMs,
      errorCode: row.errorCode,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  private static toKey(row: Record<string, any>): ProviderKeyRecord {
    return {
      id: row.id,
      provider: row.provider as ProviderName,
      maskedKey: row.maskedKey,
      encryptedKey: row.encryptedKey,
      keyHash: row.keyHash,
      label: row.label,
      priority: row.priority,
      healthScore: row.healthScore,
      totalCalls: row.totalCalls,
      successfulCalls: row.successfulCalls,
      failedCalls: row.failedCalls,
      lastErrorCode: row.lastErrorCode,
      lastUsedAt: row.lastUsedAt,
      avgLatencyMs: row.avgLatencyMs,
      quotaLimit: row.quotaLimit,
      quotaUsed: row.quotaUsed,
      quotaResetAt: row.quotaResetAt,
      isRateLimited: row.isRateLimited,
      rateLimitUntil: row.rateLimitUntil,
      active: row.active,
      createdAt: row.createdAt,
    };
  }

  /** Only send the columns the caller actually set; map enums + JSON. */
  private static taskWrite(patch: TaskPatch): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (field === 'status' || field === 'strategy' || field === 'inputType') {
        data[field] = upper(String(value));
      } else if (
        field === 'inputMeta' ||
        field === 'enhancedSpec' ||
        field === 'executionPlan' ||
        field === 'verification'
      ) {
        if (value !== null) data[field] = asJson(value);
      } else {
        data[field] = value;
      }
    }
    return data;
  }

  async createTask(input: NewTask): Promise<TaskRecord> {
    const row = await this.prisma.task.create({
      data: {
        id: input.id,
        status: upper(input.status ?? 'received') as never,
        strategy: upper(input.strategy) as never,
        inputType: upper(input.inputType) as never,
        inputText: input.inputText ?? null,
        inputMeta: input.inputMeta ? asJson(input.inputMeta) : undefined,
        estimatedLatencyMs: input.estimatedLatencyMs ?? null,
      },
    });
    return PrismaPersistence.toTask(row);
  }

  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: PrismaPersistence.taskWrite(patch) as never,
    });
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const row = await this.prisma.task.findUnique({ where: { id } });
    return row ? PrismaPersistence.toTask(row) : null;
  }

  async listTasks(options?: { limit?: number; status?: TaskStatus }): Promise<TaskRecord[]> {
    const rows = await this.prisma.task.findMany({
      where: options?.status ? { status: upper(options.status) as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
    return rows.map(PrismaPersistence.toTask);
  }

  async createSubTasks(subtasks: NewSubTask[]): Promise<void> {
    if (subtasks.length === 0) return;
    await this.prisma.$transaction(
      subtasks.map((input) =>
        this.prisma.subTask.upsert({
          where: { taskId_nodeId: { taskId: input.taskId, nodeId: input.nodeId } },
          create: {
            taskId: input.taskId,
            nodeId: input.nodeId,
            role: input.role,
            status: upper(input.status ?? 'pending') as never,
            dependencies: input.dependencies,
            contextSlice: input.contextSlice ?? null,
            prompt: input.prompt ?? null,
            provider: input.provider ?? null,
            model: input.model ?? null,
            estimatedInputTokens: input.estimatedInputTokens ?? null,
            estimatedOutputTokens: input.estimatedOutputTokens ?? null,
          },
          update: {
            role: input.role,
            dependencies: input.dependencies,
            contextSlice: input.contextSlice ?? null,
            prompt: input.prompt ?? null,
            estimatedInputTokens: input.estimatedInputTokens ?? null,
            estimatedOutputTokens: input.estimatedOutputTokens ?? null,
          },
        }),
      ),
    );
  }

  async updateSubTask(taskId: string, nodeId: string, patch: SubTaskPatch): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      data[field] = field === 'status' ? upper(String(value)) : value;
    }
    await this.prisma.subTask.update({
      where: { taskId_nodeId: { taskId, nodeId } },
      data: data as never,
    });
  }

  async listSubTasks(taskId: string): Promise<SubTaskRecord[]> {
    const rows = await this.prisma.subTask.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
    return rows.map(PrismaPersistence.toSubTask);
  }

  async appendTrace(
    taskId: string,
    event: string,
    payload: Record<string, unknown>,
    msOffset: number,
  ): Promise<void> {
    await this.prisma.traceEvent.create({
      data: { taskId, event, payload: asJson(payload), msOffset },
    });
  }

  async listTrace(taskId: string): Promise<TraceEventRecord[]> {
    const rows = await this.prisma.traceEvent.findMany({
      where: { taskId },
      orderBy: [{ msOffset: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, taskId: true, event: true, payload: true, msOffset: true },
    });
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      event: row.event,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      msOffset: row.msOffset,
    }));
  }

  async createProviderKey(input: NewProviderKey): Promise<ProviderKeyRecord> {
    const row = await this.prisma.providerKey.create({
      data: {
        provider: input.provider,
        maskedKey: input.maskedKey,
        encryptedKey: input.encryptedKey,
        keyHash: input.keyHash,
        label: input.label ?? null,
        priority: input.priority ?? 1,
        quotaLimit: input.quotaLimit ?? null,
        active: input.active ?? true,
      },
    });
    return PrismaPersistence.toKey(row);
  }

  async listProviderKeys(provider?: ProviderName): Promise<ProviderKeyRecord[]> {
    const rows = await this.prisma.providerKey.findMany({
      where: provider ? { provider } : undefined,
      orderBy: [{ healthScore: 'desc' }, { priority: 'asc' }],
    });
    return rows.map(PrismaPersistence.toKey);
  }

  async getProviderKey(id: string): Promise<ProviderKeyRecord | null> {
    const row = await this.prisma.providerKey.findUnique({ where: { id } });
    return row ? PrismaPersistence.toKey(row) : null;
  }

  async findProviderKeyByHash(keyHash: string): Promise<ProviderKeyRecord | null> {
    const row = await this.prisma.providerKey.findUnique({ where: { keyHash } });
    return row ? PrismaPersistence.toKey(row) : null;
  }

  async updateProviderKey(id: string, patch: ProviderKeyPatch): Promise<void> {
    await this.prisma.providerKey.update({ where: { id }, data: patch as never });
  }

  async recordTelemetry(input: TelemetryRecordInput): Promise<void> {
    await this.prisma.telemetryRecord.create({
      data: {
        ...input,
        subtaskId: input.subtaskId ?? null,
        tokenPredictionError: predictionError(
          (input.estimatedInputTokens ?? 0) + (input.estimatedOutputTokens ?? 0),
          (input.actualInputTokens ?? 0) + (input.actualOutputTokens ?? 0),
        ),
        latencyPredictionError: predictionError(input.estimatedLatencyMs, input.actualLatencyMs),
      } as never,
    });
  }

  async listTelemetry(query?: TelemetryQuery): Promise<TelemetryRecord[]> {
    const rows = await this.prisma.telemetryRecord.findMany({
      where: {
        recordedAt: query?.since ? { gte: query.since } : undefined,
        taskType: query?.taskType,
        provider: query?.provider,
      },
      orderBy: { recordedAt: 'desc' },
      take: query?.limit ?? 5_000,
    });
    return rows as unknown as TelemetryRecord[];
  }

  async getCalibration(taskType: string, role: string): Promise<CalibrationRecord> {
    const row = await this.prisma.calibrationModel.findUnique({
      where: { taskType_role: { taskType, role } },
    });
    return row ? (row as unknown as CalibrationRecord) : NEUTRAL_CALIBRATION(taskType, role);
  }

  async upsertCalibration(record: CalibrationRecord): Promise<void> {
    const { taskType, role, ...coefficients } = record;
    await this.prisma.calibrationModel.upsert({
      where: { taskType_role: { taskType, role } },
      create: { taskType, role, ...coefficients },
      update: coefficients,
    });
  }

  async listCalibrations(): Promise<CalibrationRecord[]> {
    const rows = await this.prisma.calibrationModel.findMany();
    return rows as unknown as CalibrationRecord[];
  }

  async getCacheEntry(cacheKey: string): Promise<CacheEntryRecord | null> {
    const row = await this.prisma.semanticCache.findUnique({ where: { cacheKey } });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row as unknown as CacheEntryRecord;
  }

  async putCacheEntry(entry: CacheEntryRecord): Promise<void> {
    await this.prisma.semanticCache.upsert({
      where: { cacheKey: entry.cacheKey },
      create: entry,
      update: { response: entry.response, expiresAt: entry.expiresAt },
    });
  }

  async listCacheEntriesByRole(role: string, limit: number): Promise<CacheEntryRecord[]> {
    const rows = await this.prisma.semanticCache.findMany({
      where: { role, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows as unknown as CacheEntryRecord[];
  }

  async incrementCacheHit(cacheKey: string): Promise<void> {
    await this.prisma.semanticCache.update({
      where: { cacheKey },
      data: { hitCount: { increment: 1 } },
    });
  }

  async purgeExpiredCache(): Promise<number> {
    const result = await this.prisma.semanticCache.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return result.count;
  }

  async saveFeedback(feedback: FeedbackRecord): Promise<void> {
    await this.prisma.taskFeedback.upsert({
      where: { taskId: feedback.taskId },
      create: {
        taskId: feedback.taskId,
        rating: feedback.rating,
        comment: feedback.comment,
        actualQuality: feedback.actualQuality,
      },
      update: { rating: feedback.rating, comment: feedback.comment, actualQuality: feedback.actualQuality },
    });
  }

  async ping(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Factory ──────────────────────────────────────────────────────────────

export const createPersistence = async (): Promise<Persistence> => {
  const mode = config.datastore.persistence;
  const url = config.datastore.databaseUrl;

  if (mode === 'memory' || !url) {
    if (mode === 'prisma') throw new Error('PERSISTENCE=prisma but DATABASE_URL is empty');
    return new MemoryPersistence();
  }

  const prisma = new PrismaClient({
    datasources: { db: { url } },
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    logger.info({ backend: 'postgresql' }, 'Persistence ready');
    return new PrismaPersistence(prisma);
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    if (mode === 'prisma') throw error;
    logger.warn(
      { err: (error as Error).message, backend: 'memory' },
      'PostgreSQL unreachable — falling back to in-process persistence',
    );
    return new MemoryPersistence();
  }
};

import { ulid } from 'ulid';

/** Monotonic, sortable, prefixed identifiers. */
export const taskId = (): string => `task_${ulid()}`;
export const planId = (): string => `plan_${ulid()}`;
export const conflictId = (): string => `conflict_${ulid()}`;
export const keyId = (): string => `key_${ulid()}`;
export const eventId = (): string => `evt_${ulid()}`;

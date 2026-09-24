import path from 'node:path';
import type {
  LogBatchResponse,
  WorkerLogEntry,
  WorkerLogQuery,
} from '@bitbucket-pr-approver/shared';
import { VersionedJsonStore, type VersionedDocument } from './versioned-json-store.js';

interface WorkerLogData {
  entries: WorkerLogEntry[];
  acceptedSequences: Record<string, number>;
}

const SCHEMA_VERSION = 1;
const RETENTION_PER_WORKER = 300;
const MAX_BATCH_SIZE = 50;

function migrate(document: VersionedDocument<unknown>): VersionedDocument<WorkerLogData> {
  if (document.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported worker log schema version ${document.schemaVersion}`);
  }
  return document as VersionedDocument<WorkerLogData>;
}

export class WorkerLogStore {
  private readonly store: VersionedJsonStore<WorkerLogData>;

  constructor(dataDir: string) {
    this.store = new VersionedJsonStore(
      path.join(dataDir, 'worker-logs.json'),
      SCHEMA_VERSION,
      () => ({ entries: [], acceptedSequences: {} }),
      migrate
    );
  }

  appendBatch(
    workerId: string,
    executionId: string,
    sequence: number,
    items: WorkerLogEntry[]
  ): LogBatchResponse {
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw Object.assign(new Error('Batch sequence must be a positive integer'), {
        code: 'INVALID_SEQUENCE',
        statusCode: 400,
      });
    }
    if (items.length > MAX_BATCH_SIZE) {
      throw Object.assign(new Error(`Log batch cannot exceed ${MAX_BATCH_SIZE} entries`), {
        code: 'BATCH_TOO_LARGE',
        statusCode: 400,
      });
    }

    const key = `${workerId}:${executionId}`;
    let response: LogBatchResponse = { acceptedThrough: 0, retained: 0 };

    this.store.update((data) => {
      const accepted = data.acceptedSequences[key] ?? 0;
      if (sequence <= accepted) {
        response = {
          acceptedThrough: accepted,
          retained: data.entries.filter((entry) => entry.workerId === workerId).length,
        };
        return data;
      }
      if (sequence !== accepted + 1) {
        throw Object.assign(
          new Error(`Expected log batch sequence ${accepted + 1}, received ${sequence}`),
          { code: 'SEQUENCE_GAP', statusCode: 409, acceptedThrough: accepted }
        );
      }

      for (const item of items) {
        if (item.workerId !== workerId || item.executionId !== executionId) {
          throw Object.assign(new Error('Log entry does not match worker or execution'), {
            code: 'LOG_SCOPE_MISMATCH',
            statusCode: 400,
          });
        }
      }

      const deduplicated = new Map(data.entries.map((entry) => [entry.id, entry]));
      for (const item of items) deduplicated.set(item.id, item);

      const allEntries = [...deduplicated.values()];
      const workerEntries = allEntries
        .filter((entry) => entry.workerId === workerId)
        .sort(
          (left, right) =>
            new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime() ||
            left.sequence - right.sequence
        )
        .slice(-RETENTION_PER_WORKER);
      const otherEntries = allEntries.filter((entry) => entry.workerId !== workerId);

      response = { acceptedThrough: sequence, retained: workerEntries.length };
      return {
        entries: [...otherEntries, ...workerEntries],
        acceptedSequences: { ...data.acceptedSequences, [key]: sequence },
      };
    });

    return response;
  }

  query(query: WorkerLogQuery = {}): WorkerLogEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), RETENTION_PER_WORKER);
    const search = query.search?.trim().toLowerCase();

    return this.store
      .read()
      .entries.filter((entry) => {
        if (query.workerId && entry.workerId !== query.workerId) return false;
        if (query.jobId && entry.jobId !== query.jobId) return false;
        if (query.executionId && entry.executionId !== query.executionId) return false;
        if (query.status && entry.status !== query.status) return false;
        if (query.repository && entry.repository !== query.repository) return false;
        if (
          search &&
          ![
            entry.repository,
            entry.prTitle,
            entry.author,
            entry.sourceBranch,
            entry.targetBranch,
            entry.failureReason,
            ...entry.matchedConditions,
          ].some((value) => value?.toLowerCase().includes(search))
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, limit);
  }

  count(workerId: string): number {
    return this.store.read().entries.filter((entry) => entry.workerId === workerId).length;
  }
}

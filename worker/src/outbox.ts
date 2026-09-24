import fs from 'node:fs';
import path from 'node:path';
import type { WorkerLogEntry } from '@bitbucket-pr-approver/shared';

interface OutboxData {
  entries: WorkerLogEntry[];
  lastSequences: Record<string, number>;
}

const MAX_ENTRIES = 300;

export class WorkerOutbox {
  constructor(private readonly filePath: string) {}

  append(entries: WorkerLogEntry[]): number {
    const current = this.read();
    const deduplicated = new Map(current.entries.map((entry) => [entry.id, entry]));
    for (const entry of entries) deduplicated.set(entry.id, entry);
    const retained = [...deduplicated.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_ENTRIES);
    const lastSequences = { ...current.lastSequences };
    for (const entry of entries) {
      lastSequences[entry.executionId] = Math.max(
        lastSequences[entry.executionId] || 0,
        entry.sequence
      );
    }
    this.write({ entries: retained, lastSequences });
    return retained.length;
  }

  peek(limit = 50): WorkerLogEntry[] {
    return this.read().entries.slice(0, Math.min(Math.max(limit, 1), 50));
  }

  acknowledge(executionId: string, acceptedThrough: number): number {
    const data = this.read();
    const entries = data.entries.filter(
      (entry) => entry.executionId !== executionId || entry.sequence > acceptedThrough
    );
    this.write({ ...data, entries });
    return entries.length;
  }

  nextSequence(executionId: string): number {
    return (this.read().lastSequences[executionId] || 0) + 1;
  }

  size(): number {
    return this.read().entries.length;
  }

  private read(): OutboxData {
    if (!fs.existsSync(this.filePath)) return { entries: [], lastSequences: {} };
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<OutboxData>;
    return { entries: data.entries || [], lastSequences: data.lastSequences || {} };
  }

  private write(data: OutboxData): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

import fs from 'node:fs';
import path from 'node:path';

export interface VersionedDocument<T> {
  schemaVersion: number;
  data: T;
}

export class VersionedJsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly currentVersion: number,
    private readonly initialValue: () => T,
    private readonly migrate: (
      document: VersionedDocument<unknown>
    ) => VersionedDocument<T> = (document) => document as VersionedDocument<T>
  ) {}

  read(): T {
    if (!fs.existsSync(this.filePath)) {
      return this.initialValue();
    }

    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as VersionedDocument<unknown>;
    const document =
      parsed.schemaVersion === this.currentVersion ? (parsed as VersionedDocument<T>) : this.migrate(parsed);

    if (document.schemaVersion !== this.currentVersion) {
      throw new Error(
        `Unsupported schema version ${document.schemaVersion} for ${path.basename(this.filePath)}`
      );
    }

    return document.data;
  }

  write(data: T): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    const document: VersionedDocument<T> = {
      schemaVersion: this.currentVersion,
      data,
    };
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const descriptor = fs.openSync(tempPath, 'w', 0o600);

    try {
      fs.writeFileSync(descriptor, JSON.stringify(document, null, 2), 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    fs.renameSync(tempPath, this.filePath);
  }

  update(mutator: (data: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }
}

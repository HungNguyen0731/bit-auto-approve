import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ControlPlaneClient } from './control-plane-client.js';

interface PendingUpdate {
  previousTarget?: string;
  nextTarget: string;
  bootAttempted: boolean;
}

export class WorkerUpdater {
  private readonly versionsDirectory: string;
  private readonly currentLink: string;
  private readonly pendingPath: string;

  constructor(
    private readonly client: ControlPlaneClient,
    private readonly currentVersion: string,
    private readonly applicationSupportDirectory: string,
    private readonly verificationPublicKey?: string
  ) {
    this.versionsDirectory = path.join(applicationSupportDirectory, 'versions');
    this.currentLink = path.join(applicationSupportDirectory, 'current');
    this.pendingPath = path.join(applicationSupportDirectory, 'update-pending.json');
  }

  recoverOrBeginHealthWindow(): boolean {
    if (!fs.existsSync(this.pendingPath)) return false;
    const pending = JSON.parse(fs.readFileSync(this.pendingPath, 'utf8')) as PendingUpdate;
    if (!pending.bootAttempted) {
      pending.bootAttempted = true;
      fs.writeFileSync(this.pendingPath, JSON.stringify(pending, null, 2), { mode: 0o600 });
      return false;
    }

    if (pending.previousTarget) {
      const temporary = `${this.currentLink}.rollback.${process.pid}`;
      fs.symlinkSync(pending.previousTarget, temporary);
      fs.renameSync(temporary, this.currentLink);
    }
    fs.rmSync(this.pendingPath, { force: true });
    return true;
  }

  markHealthy(): void {
    fs.rmSync(this.pendingPath, { force: true });
  }

  async checkAndApply(): Promise<boolean> {
    if (!this.verificationPublicKey) return false;
    const manifest = await this.client.getUpdateManifest();
    if (
      !manifest.available ||
      !manifest.version ||
      manifest.version === this.currentVersion ||
      !manifest.bundleUrl ||
      !manifest.sha256 ||
      !manifest.signature
    ) {
      return false;
    }

    const response = await fetch(manifest.bundleUrl);
    if (!response.ok) throw new Error(`Worker update download failed: ${response.status}`);
    const bundle = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash('sha256').update(bundle).digest('hex');
    if (digest !== manifest.sha256) throw new Error('Worker update checksum mismatch');

    const signedPayload = Buffer.from(
      `${manifest.version}\n${manifest.sha256}\n${manifest.bundleUrl}`,
      'utf8'
    );
    const verified = crypto.verify(
      null,
      signedPayload,
      this.verificationPublicKey,
      Buffer.from(manifest.signature, 'base64url')
    );
    if (!verified) throw new Error('Worker update signature is invalid');

    const targetDirectory = path.join(this.versionsDirectory, manifest.version);
    fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    const bundlePath = path.join(targetDirectory, 'worker-bundle.mjs');
    fs.writeFileSync(bundlePath, bundle, { mode: 0o700 });

    const previousTarget = fs.existsSync(this.currentLink)
      ? fs.readlinkSync(this.currentLink)
      : undefined;
    const temporary = `${this.currentLink}.next.${process.pid}`;
    fs.symlinkSync(targetDirectory, temporary);
    fs.renameSync(temporary, this.currentLink);
    const pending: PendingUpdate = { previousTarget, nextTarget: targetDirectory, bootAttempted: false };
    fs.writeFileSync(this.pendingPath, JSON.stringify(pending, null, 2), { mode: 0o600 });
    return true;
  }
}

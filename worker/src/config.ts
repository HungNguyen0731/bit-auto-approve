import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WorkerConfig {
  workerId: string;
  controlPlaneUrl: string;
  heartbeatIntervalMs: number;
  claimIntervalMs: number;
  version: string;
}

export const DEFAULT_CONFIG_DIRECTORY =
  process.env.BITBUCKET_WORKER_DATA_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'BitbucketPRWorker');

export function configPath(directory = DEFAULT_CONFIG_DIRECTORY): string {
  return path.join(directory, 'config.json');
}

export function loadConfig(directory = DEFAULT_CONFIG_DIRECTORY): WorkerConfig {
  const parsed = JSON.parse(fs.readFileSync(configPath(directory), 'utf8')) as WorkerConfig;
  if (!parsed.workerId || !parsed.controlPlaneUrl) {
    throw new Error('Worker configuration is incomplete');
  }
  return {
    ...parsed,
    heartbeatIntervalMs: parsed.heartbeatIntervalMs || 10_000,
    claimIntervalMs: parsed.claimIntervalMs || 5_000,
  };
}

export function saveConfig(config: WorkerConfig, directory = DEFAULT_CONFIG_DIRECTORY): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = configPath(directory);
  const temporary = `${target}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

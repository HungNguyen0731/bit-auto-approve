import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class KeychainStore {
  private readonly helperPath: string;

  constructor(
    private readonly account = process.env.BITBUCKET_WORKER_KEYCHAIN_ACCOUNT || 'default',
    helperPath?: string
  ) {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    this.helperPath =
      helperPath ||
      process.env.BITBUCKET_WORKER_KEYCHAIN_HELPER ||
      path.resolve(moduleDirectory, '../native/keychain-helper');
  }

  async set(service: string, value: string): Promise<void> {
    await this.run(['set', service, this.account], value);
  }

  async get(service: string): Promise<string | null> {
    try {
      return await this.run(['get', service, this.account]);
    } catch (error: any) {
      if (error.exitCode === 44) return null;
      throw error;
    }
  }

  async delete(service: string): Promise<boolean> {
    try {
      await this.run(['delete', service, this.account]);
      return true;
    } catch (error: any) {
      if (error.exitCode === 44) return false;
      throw error;
    }
  }

  private run(argumentsList: string[], stdin?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.helperPath, argumentsList, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
      child.once('error', reject);
      child.once('close', (exitCode) => {
        if (exitCode === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
        reject(
          Object.assign(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Keychain command failed'), {
            exitCode,
          })
        );
      });
      if (stdin) child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}

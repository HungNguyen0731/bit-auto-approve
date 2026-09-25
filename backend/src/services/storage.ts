import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  APP_CONSTANTS,
  type ApprovalJob,
  type ApprovalLogEntry,
  type BitbucketConnectionConfig,
  type CreateJobDto,
  type MaskedConnectionConfig,
  type UpdateJobDto,
} from '@bitbucket-pr-approver/shared';
import { CryptoService, type EncryptedData } from './crypto.js';

interface StoredConfig extends Omit<BitbucketConnectionConfig, 'token'> {
  encryptedToken?: EncryptedData;
  tokenPreview?: string;
  hasToken: boolean;
}

export class StorageService {
  private readonly dataDir: string;
  private readonly cryptoService: CryptoService;
  private readonly configFile: string;
  private readonly jobsFile: string;
  private readonly logsFile: string;

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ||
      process.env.BITBUCKET_APPROVER_DATA_DIR ||
      path.resolve(process.cwd(), APP_CONSTANTS.STORAGE.DEFAULT_DATA_DIR);

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const keyFilePath = path.join(this.dataDir, APP_CONSTANTS.STORAGE.SECRET_KEY_FILE);
    this.cryptoService = new CryptoService(keyFilePath);

    this.configFile = path.join(this.dataDir, APP_CONSTANTS.STORAGE.CONFIG_FILE);
    this.jobsFile = path.join(this.dataDir, APP_CONSTANTS.STORAGE.JOBS_FILE);
    this.logsFile = path.join(this.dataDir, APP_CONSTANTS.STORAGE.LOGS_FILE);
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  private atomicWriteFileSync(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  // ==========================================
  // Configuration Storage
  // ==========================================

  getConfig(): BitbucketConnectionConfig | null {
    if (!fs.existsSync(this.configFile)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.configFile, 'utf8');
      const stored = JSON.parse(raw) as StoredConfig;

      let token: string | undefined;
      if (stored.encryptedToken) {
        token = this.cryptoService.decrypt(stored.encryptedToken);
      }

      return {
        serverType: stored.serverType,
        baseUrl: stored.baseUrl,
        authType: stored.authType,
        username: stored.username,
        workspace: stored.workspace,
        token,
        skipSslVerification: stored.skipSslVerification,
        proxyUrl: stored.proxyUrl,
        timeoutMs: stored.timeoutMs,
      };
    } catch {
      return null;
    }
  }

  getMaskedConfig(): MaskedConnectionConfig | null {
    if (!fs.existsSync(this.configFile)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.configFile, 'utf8');
      const stored = JSON.parse(raw) as StoredConfig;

      return {
        serverType: stored.serverType,
        baseUrl: stored.baseUrl,
        authType: stored.authType,
        username: stored.username,
        workspace: stored.workspace,
        hasToken: stored.hasToken,
        tokenPreview: stored.tokenPreview,
        skipSslVerification: Boolean(stored.skipSslVerification),
        proxyUrl: stored.proxyUrl,
        timeoutMs: stored.timeoutMs || APP_CONSTANTS.BITBUCKET.DEFAULT_TIMEOUT_MS,
      };
    } catch {
      return null;
    }
  }

  saveConfig(config: BitbucketConnectionConfig): MaskedConnectionConfig {
    const existing = this.getConfig();

    // If no new token provided, preserve existing token
    let tokenToEncrypt = config.token;
    let tokenPreview = config.token ? CryptoService.maskToken(config.token) : undefined;

    if (!tokenToEncrypt && existing?.token) {
      tokenToEncrypt = existing.token;
      tokenPreview = CryptoService.maskToken(existing.token);
    }

    let encryptedToken: EncryptedData | undefined;
    if (tokenToEncrypt) {
      encryptedToken = this.cryptoService.encrypt(tokenToEncrypt);
    }

    const storedConfig: StoredConfig = {
      serverType: config.serverType,
      baseUrl: config.baseUrl,
      authType: config.authType,
      username: config.username,
      workspace: config.workspace || existing?.workspace,
      encryptedToken,
      hasToken: Boolean(tokenToEncrypt),
      tokenPreview,
      skipSslVerification: Boolean(config.skipSslVerification),
      proxyUrl: config.proxyUrl,
      timeoutMs: config.timeoutMs || APP_CONSTANTS.BITBUCKET.DEFAULT_TIMEOUT_MS,
    };

    this.atomicWriteFileSync(this.configFile, JSON.stringify(storedConfig, null, 2));

    return {
      serverType: storedConfig.serverType,
      baseUrl: storedConfig.baseUrl,
      authType: storedConfig.authType,
      username: storedConfig.username,
      workspace: storedConfig.workspace,
      hasToken: storedConfig.hasToken,
      tokenPreview: storedConfig.tokenPreview,
      skipSslVerification: storedConfig.skipSslVerification ?? false,
      proxyUrl: storedConfig.proxyUrl,
      timeoutMs: storedConfig.timeoutMs || APP_CONSTANTS.BITBUCKET.DEFAULT_TIMEOUT_MS,
    };
  }

  // ==========================================
  // Jobs Storage
  // ==========================================

  getJobs(): ApprovalJob[] {
    if (!fs.existsSync(this.jobsFile)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.jobsFile, 'utf8');
      return JSON.parse(raw) as ApprovalJob[];
    } catch {
      return [];
    }
  }

  getJobById(id: string): ApprovalJob | null {
    const jobs = this.getJobs();
    return jobs.find((j) => j.id === id) || null;
  }

  createJob(dto: CreateJobDto): ApprovalJob {
    const jobs = this.getJobs();
    const now = new Date().toISOString();

    const newJob: ApprovalJob = {
      id: crypto.randomUUID(),
      name: dto.name,
      description: dto.description,
      enabled: dto.enabled !== undefined ? dto.enabled : true,
      intervalSeconds: Math.max(
        APP_CONSTANTS.SCHEDULER.MIN_INTERVAL_SECONDS,
        dto.intervalSeconds || APP_CONSTANTS.SCHEDULER.DEFAULT_INTERVAL_SECONDS
      ),
      dryRun: Boolean(dto.dryRun),
      executionMode: dto.executionMode ?? 'local',
      workerId: dto.executionMode === 'worker' ? dto.workerId : undefined,
      accountId: dto.executionMode === 'worker' ? dto.accountId : undefined,
      rules: {
        repositories: dto.rules.repositories || [],
        authorWhitelist: dto.rules.authorWhitelist || [],
        authorBlacklist: dto.rules.authorBlacklist || [],
        excludeSelf: dto.rules.excludeSelf !== undefined ? dto.rules.excludeSelf : true,
        targetBranches: dto.rules.targetBranches || ['master', 'main', 'develop'],
        sourceBranches: dto.rules.sourceBranches || [],
        titleKeywordsInclude: dto.rules.titleKeywordsInclude || [],
        titleKeywordsExclude: dto.rules.titleKeywordsExclude || [],
        ignoreDrafts: dto.rules.ignoreDrafts !== undefined ? dto.rules.ignoreDrafts : true,
        ignoreWithConflicts: dto.rules.ignoreWithConflicts !== undefined ? dto.rules.ignoreWithConflicts : true,
        requireSuccessfulBuild: Boolean(dto.rules.requireSuccessfulBuild),
        minApprovalsNeeded: dto.rules.minApprovalsNeeded || 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    jobs.push(newJob);
    this.saveJobs(jobs);
    return newJob;
  }

  updateJob(id: string, dto: UpdateJobDto): ApprovalJob | null {
    const jobs = this.getJobs();
    const index = jobs.findIndex((j) => j.id === id);
    if (index === -1) {
      return null;
    }

    const current = jobs[index];
    const updated: ApprovalJob = {
      ...current,
      name: dto.name !== undefined ? dto.name : current.name,
      description: dto.description !== undefined ? dto.description : current.description,
      enabled: dto.enabled !== undefined ? dto.enabled : current.enabled,
      intervalSeconds:
        dto.intervalSeconds !== undefined
          ? Math.max(APP_CONSTANTS.SCHEDULER.MIN_INTERVAL_SECONDS, dto.intervalSeconds)
          : current.intervalSeconds,
      dryRun: dto.dryRun !== undefined ? dto.dryRun : current.dryRun,
      executionMode:
        dto.executionMode !== undefined ? dto.executionMode : current.executionMode ?? 'local',
      workerId:
        dto.executionMode === 'local'
          ? undefined
          : dto.workerId !== undefined
          ? dto.workerId
          : current.workerId,
      accountId:
        dto.executionMode === 'local'
          ? undefined
          : dto.accountId !== undefined
          ? dto.accountId
          : current.accountId,
      rules: dto.rules ? { ...current.rules, ...dto.rules } : current.rules,
      updatedAt: new Date().toISOString(),
    };

    jobs[index] = updated;
    this.saveJobs(jobs);
    return updated;
  }

  deleteJob(id: string): boolean {
    const jobs = this.getJobs();
    const filtered = jobs.filter((j) => j.id !== id);
    if (filtered.length === jobs.length) {
      return false;
    }
    this.saveJobs(filtered);
    return true;
  }

  toggleJob(id: string, enabled: boolean): ApprovalJob | null {
    return this.updateJob(id, { enabled });
  }

  saveJobs(jobs: ApprovalJob[]): void {
    this.atomicWriteFileSync(this.jobsFile, JSON.stringify(jobs, null, 2));
  }

  // ==========================================
  // Execution Logs Storage
  // ==========================================

  getRawLogs(): ApprovalLogEntry[] {
    if (!fs.existsSync(this.logsFile)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.logsFile, 'utf8');
      return JSON.parse(raw) as ApprovalLogEntry[];
    } catch {
      return [];
    }
  }

  getLogs(filters?: {
    page?: number;
    limit?: number;
    jobId?: string;
    status?: string;
    repo?: string;
    search?: string;
  }): { items: ApprovalLogEntry[]; total: number; page: number; limit: number; totalPages: number } {
    const all = this.getRawLogs();

    let filtered = all;
    if (filters?.jobId) {
      filtered = filtered.filter((l) => l.jobId === filters.jobId);
    }
    if (filters?.status) {
      filtered = filtered.filter((l) => l.status === filters.status);
    }
    if (filters?.repo) {
      filtered = filtered.filter((l) => l.repository.toLowerCase().includes(filters.repo!.toLowerCase()));
    }
    if (filters?.search) {
      const q = filters.search.trim().toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.prTitle?.toLowerCase().includes(q) ||
          l.author?.toLowerCase().includes(q) ||
          l.repository?.toLowerCase().includes(q) ||
          l.reason?.toLowerCase().includes(q) ||
          String(l.prId).includes(q)
      );
    }

    // Newest first
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const page = Math.max(1, filters?.page || 1);
    const limit = Math.min(
      APP_CONSTANTS.LOGS.MAX_PAGE_SIZE,
      Math.max(1, filters?.limit || APP_CONSTANTS.LOGS.DEFAULT_PAGE_SIZE)
    );

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  getLogStats(): {
    total: number;
    approved: number;
    dryRun: number;
    skipped: number;
    failed: number;
    byRepository: Record<string, number>;
    recent24hCount: number;
  } {
    const all = this.getRawLogs();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let approved = 0;
    let dryRun = 0;
    let skipped = 0;
    let failed = 0;
    let recent24hCount = 0;
    const byRepository: Record<string, number> = {};

    for (const l of all) {
      if (l.status === 'APPROVED') approved++;
      else if (l.status === 'DRY_RUN') dryRun++;
      else if (l.status === 'SKIPPED') skipped++;
      else if (l.status === 'FAILED') failed++;

      byRepository[l.repository] = (byRepository[l.repository] || 0) + 1;

      if (now - new Date(l.timestamp).getTime() < oneDayMs) {
        recent24hCount++;
      }
    }

    return {
      total: all.length,
      approved,
      dryRun,
      skipped,
      failed,
      byRepository,
      recent24hCount,
    };
  }

  addLog(entry: Omit<ApprovalLogEntry, 'id' | 'timestamp'>): ApprovalLogEntry {
    const logs = this.getRawLogs();
    const newEntry: ApprovalLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    logs.push(newEntry);

    // Keep bounded within MAX_STORED_LOGS
    if (logs.length > APP_CONSTANTS.LOGS.MAX_STORED_LOGS) {
      logs.splice(0, logs.length - APP_CONSTANTS.LOGS.MAX_STORED_LOGS);
    }

    this.atomicWriteFileSync(this.logsFile, JSON.stringify(logs, null, 2));
    return newEntry;
  }

  clearLogs(): void {
    this.atomicWriteFileSync(this.logsFile, JSON.stringify([], null, 2));
  }

  getTotalApprovedCount(): number {
    const logs = this.getRawLogs();
    return logs.filter((l) => l.status === 'APPROVED').length;
  }
}

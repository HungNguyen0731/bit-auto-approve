import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface OwnerSession {
  idHash: string;
  ownerId: string;
  csrfToken: string;
  expiresAt: string;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class ControlPlaneAuth {
  private readonly password?: string;
  private readonly salt: Buffer;
  private readonly sessions = new Map<string, OwnerSession>();

  constructor(dataDir: string, password = process.env.CONTROL_PLANE_OWNER_PASSWORD) {
    this.password = password;
    if (process.env.NODE_ENV === 'production' && !password) {
      throw new Error('CONTROL_PLANE_OWNER_PASSWORD is required in production');
    }

    const saltPath = path.join(dataDir, 'control-plane-auth.salt');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(saltPath)) {
      fs.writeFileSync(saltPath, crypto.randomBytes(32), { mode: 0o600 });
    }
    this.salt = fs.readFileSync(saltPath);
  }

  get enabled(): boolean {
    return Boolean(this.password);
  }

  login(password: string, now: Date = new Date()): {
    sessionId: string;
    csrfToken: string;
    expiresAt: string;
  } {
    if (!this.password) {
      throw Object.assign(new Error('Owner authentication is disabled in local mode'), {
        code: 'AUTH_DISABLED',
        statusCode: 409,
      });
    }

    const supplied = crypto.scryptSync(password, this.salt, 32);
    const expected = crypto.scryptSync(this.password, this.salt, 32);
    if (!crypto.timingSafeEqual(supplied, expected)) {
      throw Object.assign(new Error('Invalid owner password'), {
        code: 'AUTH_INVALID',
        statusCode: 401,
      });
    }

    const sessionId = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    const idHash = this.hash(sessionId);
    this.sessions.set(idHash, { idHash, ownerId: 'owner', csrfToken, expiresAt });
    return { sessionId, csrfToken, expiresAt };
  }

  requireSession(sessionId?: string, now: Date = new Date()): OwnerSession {
    if (!this.password) {
      return {
        idHash: 'local-mode',
        ownerId: 'owner',
        csrfToken: 'local-mode',
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      };
    }
    if (!sessionId) {
      throw Object.assign(new Error('Owner session is required'), {
        code: 'SESSION_REQUIRED',
        statusCode: 401,
      });
    }

    const idHash = this.hash(sessionId);
    const session = this.sessions.get(idHash);
    if (!session || new Date(session.expiresAt).getTime() <= now.getTime()) {
      if (session) this.sessions.delete(idHash);
      throw Object.assign(new Error('Owner session expired or invalid'), {
        code: 'SESSION_INVALID',
        statusCode: 401,
      });
    }
    return session;
  }

  requireCsrf(session: OwnerSession, supplied?: string): void {
    if (!this.password) return;
    if (!supplied) {
      throw Object.assign(new Error('CSRF token is required'), {
        code: 'CSRF_REQUIRED',
        statusCode: 403,
      });
    }
    const left = Buffer.from(session.csrfToken);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw Object.assign(new Error('CSRF token is invalid'), {
        code: 'CSRF_INVALID',
        statusCode: 403,
      });
    }
  }

  logout(sessionId?: string): void {
    if (sessionId) this.sessions.delete(this.hash(sessionId));
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

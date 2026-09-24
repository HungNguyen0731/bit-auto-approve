import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ControlPlaneAuth } from '../services/control-plane-auth.js';

const COOKIE_NAME = 'bitbucket_approver_owner';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 8 * 60 * 60,
  };
}

export function ownerSessionId(request: FastifyRequest): string | undefined {
  return request.cookies?.[COOKIE_NAME];
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: { auth: ControlPlaneAuth }
): Promise<void> {
  const { auth } = options;

  app.get('/api/session', async (request, reply) => {
    try {
      const session = auth.requireSession(ownerSessionId(request));
      return reply.send({
        success: true,
        data: {
          authenticated: true,
          authEnabled: auth.enabled,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error: any) {
      return reply.status(error.statusCode || 401).send({
        success: false,
        error: { code: error.code || 'SESSION_INVALID', message: error.message },
      });
    }
  });

  app.post<{ Body: { password?: string } }>('/api/session/login', async (request, reply) => {
    try {
      const session = auth.login(request.body?.password || '');
      reply.setCookie(COOKIE_NAME, session.sessionId, cookieOptions());
      return reply.send({
        success: true,
        data: { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
      });
    } catch (error: any) {
      return reply.status(error.statusCode || 401).send({
        success: false,
        error: { code: error.code || 'AUTH_INVALID', message: error.message },
      });
    }
  });

  app.post('/api/session/logout', async (request, reply) => {
    auth.logout(ownerSessionId(request));
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ success: true, data: { authenticated: false } });
  });
}

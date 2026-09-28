import type { FastifyInstance } from 'fastify';
import type { BitbucketOAuth } from '../services/bitbucket-oauth.js';
import type { ControlPlaneAuth } from '../services/control-plane-auth.js';
import { ownerSessionId } from './session.js';

export async function registerAccountOAuthRoutes(app: FastifyInstance, options: {
  oauth: BitbucketOAuth; auth: ControlPlaneAuth;
}): Promise<void> {
  const { oauth, auth } = options;
  app.get('/api/accounts/oauth/config', async (_request, reply) =>
    reply.send({ success: true, data: { configured: oauth.configured } }));

  app.post<{ Body?: { accountId?: string } }>('/api/accounts/oauth/start', async (request, reply) => {
    const session = auth.requireSession(ownerSessionId(request));
    const result = oauth.start(session.idHash, request.body?.accountId);
    return reply.send({ success: true, data: result });
  });

  app.get<{ Params: { flowId: string } }>('/api/accounts/oauth/status/:flowId', async (request, reply) => {
    const session = auth.requireSession(ownerSessionId(request));
    return reply.send({ success: true, data: oauth.status(request.params.flowId, session.idHash) });
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/api/accounts/oauth/callback', async (request, reply) => {
    let complete = false;
    try { complete = await oauth.callback(request.query.state || '',
      (hash) => auth.hasSessionHash(hash), request.query.code, request.query.error); }
    catch { /* Invalid or expired state: show a generic browser result without disclosing details. */ }
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Bitbucket connection</title><body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:24px"><h1>${complete ? 'Đã kết nối Bitbucket' : 'Không thể kết nối Bitbucket'}</h1><p>${complete ? 'Quay lại ứng dụng Mac để chọn account cho job.' : 'Quay lại ứng dụng Mac để xem lỗi và thử lại.'}</p></body></html>`);
  });
}

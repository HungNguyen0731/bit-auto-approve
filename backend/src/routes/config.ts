import type { FastifyInstance } from 'fastify';
import type { BitbucketConnectionConfig } from '@bitbucket-pr-approver/shared';
import { createBitbucketClient } from '../bitbucket/index.js';
import type { StorageService } from '../services/storage.js';

export async function registerConfigRoutes(
  app: FastifyInstance,
  options: { storage: StorageService }
): Promise<void> {
  const { storage } = options;

  app.get('/api/config', async (_req, reply) => {
    const config = storage.getMaskedConfig();
    return reply.send({
      success: true,
      data: config || {
        serverType: 'cloud',
        baseUrl: 'https://api.bitbucket.org/2.0',
        authType: 'basic',
        username: null,
        workspace: null,
        hasToken: false,
        skipSslVerification: false,
        proxyUrl: null,
        timeoutMs: 15000,
      },
    });
  });

  app.post<{ Body: BitbucketConnectionConfig }>('/api/config', async (req, reply) => {
    const body = req.body;
    if (!body) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing configuration payload',
          httpStatus: 400,
          rateLimitReset: null,
          details: null,
        },
      });
    }

    const existing = storage.getConfig();

    // Default to Bitbucket Cloud standard while preserving omitted values from
    // partial settings updates. Raw tokens remain preserved by StorageService.
    const configToSave: BitbucketConnectionConfig = {
      serverType: 'cloud',
      baseUrl: body.baseUrl?.trim() || existing?.baseUrl || 'https://api.bitbucket.org/2.0',
      authType: body.authType || existing?.authType || 'basic',
      token: body.token,
      username: body.username !== undefined ? body.username?.trim() : existing?.username,
      workspace: body.workspace !== undefined ? body.workspace?.trim() : existing?.workspace,
      skipSslVerification: body.skipSslVerification !== undefined
        ? Boolean(body.skipSslVerification)
        : Boolean(existing?.skipSslVerification),
      proxyUrl: body.proxyUrl !== undefined ? body.proxyUrl : existing?.proxyUrl,
      timeoutMs: body.timeoutMs || existing?.timeoutMs || 15000,
    };

    try {
      const masked = storage.saveConfig(configToSave);
      return reply.send({
        success: true,
        data: masked,
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message,
          httpStatus: 500,
          rateLimitReset: null,
          details: null,
        },
      });
    }
  });

  app.post<{ Body: Partial<BitbucketConnectionConfig> }>('/api/config/test', async (req, reply) => {
    const body = req.body || {};
    const existing = storage.getConfig();

    const configToTest: BitbucketConnectionConfig = {
      serverType: 'cloud',
      baseUrl: body.baseUrl?.trim() || existing?.baseUrl || 'https://api.bitbucket.org/2.0',
      authType: body.authType || existing?.authType || 'basic',
      token: body.token || existing?.token,
      username: body.username !== undefined ? body.username?.trim() : existing?.username,
      workspace: body.workspace !== undefined ? body.workspace?.trim() : existing?.workspace,
      skipSslVerification: body.skipSslVerification !== undefined ? body.skipSslVerification : existing?.skipSslVerification,
      proxyUrl: body.proxyUrl !== undefined ? body.proxyUrl : existing?.proxyUrl,
      timeoutMs: body.timeoutMs || existing?.timeoutMs || 15000,
    };

    if (!configToTest.token) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Bitbucket Cloud App Password / token is required to verify connection',
          httpStatus: 400,
          rateLimitReset: null,
          details: null,
        },
      });
    }

    try {
      const client = createBitbucketClient(configToTest);
      const user = await client.testConnection();

      return reply.send({
        success: true,
        data: {
          valid: true,
          user,
        },
      });
    } catch (err: any) {
      const status = err.statusCode || 400;
      return reply.status(status).send({
        success: false,
        error: {
          code: err.code || 'AUTH_INVALID_TOKEN',
          message: err.message,
          httpStatus: status,
          rateLimitReset: err.details?.rateLimitReset ?? null,
          details: err.details ?? null,
        },
      });
    }
  });
}

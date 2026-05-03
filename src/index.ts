import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { getDb } from './db.js';
import { processCron } from './cron/process.js';
import { registerWebRoutes } from './web/routes.js';
import { logger } from './utils/logger.js';
import { getLastSuccessfulRunTime } from './db.js';

const app = new Hono();

// Initialize DB on startup
getDb();

// ── Cron ─────────────────────────────────────────────────────────────────────
app.post('/cron/process', (c) => processCron(c));

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (c) => {
  const lastRun = getLastSuccessfulRunTime();
  return c.json({
    status: 'ok',
    lastRun,
    uptime: Math.floor(process.uptime()),
    env: config.app.nodeEnv,
  });
});

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (c) => c.redirect('/dashboard'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
registerWebRoutes(app);

// ── Dev-only routes ───────────────────────────────────────────────────────────
if (config.app.nodeEnv === 'development') {
  // Trigger without needing Authorization header
  app.post('/dev/trigger', async (c) => {
    const req = new Request(c.req.url.replace('/dev/trigger', '/cron/process'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.app.cronSecret}` },
    });
    return processCron({ ...c, req: { ...c.req, header: (name: string) => req.headers.get(name) ?? undefined } } as never);
  });

  // OAuth flow to obtain refresh token
  app.get('/auth/google', (c) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.google.clientId);
    url.searchParams.set('redirect_uri', `http://localhost:${config.app.port}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly',
    );
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return c.redirect(url.toString());
  });

  app.get('/auth/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.text('Missing code', 400);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: `http://localhost:${config.app.port}/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    return c.html(`
      <h2>Tokens recebidos</h2>
      <p>Copie o <strong>refresh_token</strong> abaixo para o seu <code>.env</code>:</p>
      <pre style="background:#111;color:#0f0;padding:16px;border-radius:8px;white-space:pre-wrap">${JSON.stringify(data, null, 2)}</pre>
    `);
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
serve({ fetch: app.fetch, port: config.app.port }, (info) => {
  logger.info(`Server started`, { port: info.port, env: config.app.nodeEnv });
  logger.info(`Dashboard: http://localhost:${info.port}/dashboard`);
  if (config.app.nodeEnv === 'development') {
    logger.info(`Auth flow: http://localhost:${info.port}/auth/google`);
    logger.info(`Dev trigger: POST http://localhost:${info.port}/dev/trigger`);
  }
});

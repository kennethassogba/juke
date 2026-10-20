import { DurableObject } from 'cloudflare:workers';
import {routeSite} from './site.js';

const MODELS = Object.freeze({
  'gpt-6-luna': { endpoint: '/v1/decisions', input: 0.10, cached: 0.01, output: 0.50, cacheWrite: 0.125, kind: 'decision' },
  'gpt-5.6-luna': { endpoint: '/v1/responses', input: 0.20, cached: 0.02, output: 1.20, cacheWrite: 0.25, kind: 'response' },
  'gpt-4.1-nano': { endpoint: '/v1/responses', input: 0.10, cached: 0.025, output: 0.40, cacheWrite: 0.125, kind: 'response' },
});

const ACTIONS = Object.freeze(['intercept', 'press', 'left', 'center', 'right']);
const SYSTEM_INSTRUCTIONS = 'Defend your goal against one human in this four-paddle arena snapshot. Coordinates face your goal at y=0, x=goalStart..goalEnd. Other goals center on other walls. Intercept aims at the incoming puck crossing y=.15. Press aims at y=.28. Left, center, right guard x=.42,.50,.58 at y=.15. The selected target is held until your next API decision. Return only one allowed action.';
const CHOICES = Object.freeze([
  { value: 'intercept', description: 'Meet the puck on its path when it is moving toward your goal.' },
  { value: 'press', description: 'Step toward the puck to shorten its angle.' },
  { value: 'left', description: 'Guard the left lane.' },
  { value: 'center', description: 'Guard the center lane.' },
  { value: 'right', description: 'Guard the right lane.' },
]);

const ACTION_SCHEMA = {
  type: 'object',
  properties: { action: { type: 'string', enum: ACTIONS } },
  required: ['action'],
  additionalProperties: false,
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function finiteBetween(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function cleanState(value) {
  if (!value || value.version !== 1 || !value.bounds || !value.puck || !value.player || !value.defender) return null;
  if (!Number.isInteger(value.score?.player) || !Number.isInteger(value.score?.defender)) return null;
  if (value.score.player < 0 || value.score.player > 5 || value.score.defender < 0 || value.score.defender > 5) return null;
  const position = (item) => item && finiteBetween(item.x, -0.04, 1.04) && finiteBetween(item.y, -0.04, 1.04);
  if (!position(value.puck) || !position(value.player) || !position(value.defender)) return null;
  if (!finiteBetween(value.puck.vx, -4, 4) || !finiteBetween(value.puck.vy, -4, 4)) return null;
  if (!finiteBetween(value.puck.radius, 0, 0.1) || !finiteBetween(value.player.radius, 0, 0.15) || !finiteBetween(value.defender.radius, 0, 0.15)) return null;
  if (!finiteBetween(value.bounds.goalStart, 0, 1) || !finiteBetween(value.bounds.goalEnd, 0, 1) || value.bounds.goalStart >= value.bounds.goalEnd) return null;
  if (typeof value.bumpersOn !== 'boolean' || !Array.isArray(value.bumpers) || value.bumpers.length > 4) return null;
  const bumpers = [];
  for (const bumper of value.bumpers) {
    if (!position(bumper) || !finiteBetween(bumper.radius, 0, 0.15)) return null;
    bumpers.push({ x: bumper.x, y: bumper.y, radius: bumper.radius });
  }
  if (!Array.isArray(value.otherDefenders) || value.otherDefenders.length !== 2) return null;
  const otherDefenders = [];
  for (const paddle of value.otherDefenders) {
    if (!position(paddle) || !finiteBetween(paddle.radius, 0, .15)) return null;
    otherDefenders.push({ x: paddle.x, y: paddle.y, radius: paddle.radius });
  }
  return {
    version: 1,
    bounds: { goalStart: value.bounds.goalStart, goalEnd: value.bounds.goalEnd },
    score: { player: value.score.player, defender: value.score.defender },
    puck: { x: value.puck.x, y: value.puck.y, vx: value.puck.vx, vy: value.puck.vy, radius: value.puck.radius },
    player: { x: value.player.x, y: value.player.y, radius: value.player.radius },
    defender: { x: value.defender.x, y: value.defender.y, radius: value.defender.radius },
    otherDefenders,
    bumpersOn: value.bumpersOn,
    bumpers,
  };
}

function actualUsage(model, usage) {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return null;
  const prices = MODELS[model];
  const inputDetail = usage.input_tokens_details || {};
  const cachedTokens = Number.isFinite(inputDetail.cached_tokens) ? inputDetail.cached_tokens : 0;
  const cacheWriteTokens = Number.isFinite(inputDetail.cache_write_tokens)
    ? inputDetail.cache_write_tokens
    : (Number.isFinite(usage.cache_write_input_tokens) ? usage.cache_write_input_tokens : 0);
  const outputTokens = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
  if (cachedTokens + cacheWriteTokens > usage.input_tokens) return null;
  const uncachedTokens = usage.input_tokens - cachedTokens - cacheWriteTokens;
  const costUsd = (
    uncachedTokens * prices.input +
    cachedTokens * prices.cached +
    cacheWriteTokens * prices.cacheWrite +
    outputTokens * prices.output
  ) / 1_000_000;
  return { inputTokens: usage.input_tokens, outputTokens, cachedTokens, costUsd };
}

function extractResponseText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const blocks = payload.output || [];
  for (const block of blocks) {
    if (block.type !== 'message' || block.role !== 'assistant') continue;
    const part = (block.content || []).find((item) => item.type === 'output_text' && typeof item.text === 'string');
    if (part) return part.text;
  }
  return null;
}

function providerError(code, status) {
  const result = {
    type: 'error',
    status,
    code,
    message: status === 401 || status === 403
      ? 'OpenAI rejected the server key. Check the Worker secret and project access.'
      : status === 404
        ? 'This model is unavailable to the server key.'
        : status === 429
          ? 'OpenAI is rate limited. The game will retry this decision.'
          : 'OpenAI could not return a decision. The game will retry.',
  };
  return result;
}

async function apiStatus(env) {
  if (!env.OPENAI_API_KEY) {
    return json({ configured: false, models: Object.keys(MODELS).map((id) => ({ id, ready: false, reason: 'missing_key' })) });
  }
  const models = await Promise.all(Object.keys(MODELS).map(async (id) => {
    try {
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) {
        console.warn(JSON.stringify({ event: 'model_check_failed', model: id, status: response.status }));
        return { id, ready: false, reason: response.status === 404 ? 'model_unavailable' : response.status === 401 || response.status === 403 ? 'key_rejected' : 'check_failed' };
      }
      return { id, ready: true };
    } catch (error) {
      console.warn(JSON.stringify({ event: 'model_check_failed', model: id, error: error?.name || 'network_error' }));
      return { id, ready: false, reason: 'check_failed' };
    }
  }));
  return json({ configured: true, models });
}

async function allowDecision(request, env, scope = 'decision') {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const name = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
  return limiter.fetch(`https://limit.internal/${scope}`, { method: 'POST' });
}

async function mailingList(request, env) {
  if (request.method !== 'POST') return json({ message: 'Use the signup form.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ message: 'Open the signup form on JUKE.' }, 403);
  if (!env.MAILING_LIST) return json({ message: 'Signup is unavailable. Try again later.' }, 503);
  if (Number(request.headers.get('content-length')) > 2048) return json({ message: 'Enter a valid email address.' }, 413);
  if ((await allowDecision(request, env, 'signup')).status === 429) return json({ message: 'Wait a minute before trying again.' }, 429);
  let data;
  try { const raw = await request.text(); if (raw.length > 2048) throw new Error(); data = JSON.parse(raw); }
  catch { return json({ message: 'Enter a valid email address.' }, 400); }
  if (new URL(request.url).pathname === '/api/unsubscribe') {
    if (typeof data.token !== 'string' || !/^[a-f0-9-]{36}$/.test(data.token)) return json({ message: 'This removal link is invalid.' }, 400);
    await env.MAILING_LIST.prepare("DELETE FROM mailing_subscriptions WHERE site = 'juke' AND unsubscribe_token = ?").bind(data.token).run();
    return json({ message: 'You have left the list.' });
  }
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (data.website) return json({ message: 'You’re on the list.' });
  if (data.consent !== true || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: 'Enter your email and agree to receive JUKE updates.' }, 400);
  const token = crypto.randomUUID();
  const saved = await env.MAILING_LIST.prepare("INSERT OR IGNORE INTO mailing_subscriptions (email, site, created_at, consent_text, unsubscribe_token) VALUES (?, 'juke', ?, ?, ?)")
    .bind(email, new Date().toISOString(), 'I agree to receive JUKE updates from keff by email.', token).run();
  return json({ message: 'You’re on the list.', token: saved.meta.changes ? token : undefined });
}

async function runDecision(request, env, budget) {
  if (request.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST for a model decision.' }, 405, { allow: 'POST' });
  if (!env.OPENAI_API_KEY) return json({ code: 'missing_key', message: 'The OpenAI server key is not configured.' }, 503);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ code: 'origin_rejected', message: 'This request must come from the game site.' }, 403);
  }
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 8_192) return json({ code: 'request_too_large', message: 'The table state is too large.' }, 413);

  const rate = await allowDecision(request, env);
  if (rate.status === 429) return json({ code: 'rate_limited', message: 'Decision limit reached. Wait a moment and try again.' }, 429, { 'retry-after': rate.headers.get('retry-after') || '60' });

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8_192) return json({ code: 'request_too_large', message: 'The table state is too large.' }, 413);
    body = JSON.parse(rawBody);
  }
  catch { return json({ code: 'invalid_json', message: 'The table state could not be read.' }, 400); }
  const model = body?.model;
  if (typeof model !== 'string' || !Object.hasOwn(MODELS, model)) return json({ code: 'unsupported_model', message: 'This model is not configured for JUKE.' }, 400);
  const state = cleanState(body?.state);
  if (!state) return json({ code: 'invalid_state', message: 'The table state is incomplete.' }, 400);

  const config = MODELS[model];
  const payload = config.kind === 'decision'
    ? {
        model,
        input: JSON.stringify(state),
        questions: [{ type: 'choice', name: 'action', instructions: SYSTEM_INSTRUCTIONS, choices: CHOICES }],
      }
    : {
        model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: `Allowed actions: ${ACTIONS.join(', ')}.\nLive table state: ${JSON.stringify(state)}`,
        reasoning: model === 'gpt-5.6-luna' ? { effort: 'none' } : undefined,
        text: { format: { type: 'json_schema', name: 'juke_defense', strict: true, schema: ACTION_SCHEMA } },
        max_output_tokens: 24,
        store: false,
      };
  if (payload.reasoning === undefined) delete payload.reasoning;

  // UTF-8 bytes bound the token count conservatively; include protocol overhead.
  const reserveUsd = ((new TextEncoder().encode(JSON.stringify(payload)).length + 1024) * Math.max(config.input, config.cacheWrite) + 24 * config.output) / 1_000_000;
  const reservation = await budget.reserve(reserveUsd);
  if (!reservation.allowed) return json({ code: 'budget_exhausted', message: 'Today’s play allowance is used. Come back tomorrow.', budget: reservation.budget }, 429);
  const settle = async (usage, failed = false) => budget.settle(reservation.id, usage?.costUsd ?? (failed ? 0 : null));

  const startedAt = performance.now();
  let upstream;
  try {
    upstream = await fetch(`https://api.openai.com${config.endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'decision_network_error', model, error: error?.name || 'network_error' }));
    return json({ ...providerError('openai_network_error', 0), latencyMs: Math.round(performance.now() - startedAt), usage: null, budget: await settle(null) }, 502);
  }

  let latencyMs = Math.round(performance.now() - startedAt);
  if (!upstream.ok) {
    console.warn(JSON.stringify({ event: 'decision_rejected', model, status: upstream.status, requestId: upstream.headers.get('x-request-id') || null }));
    const failure = providerError('openai_rejected', upstream.status);
    const headers = upstream.status === 429 ? { 'retry-after': upstream.headers.get('retry-after') || '3' } : {};
    return json({ ...failure, upstreamStatus: upstream.status, latencyMs, usage: null, budget: await settle(null, upstream.status < 500) }, upstream.status === 429 ? 429 : 502, headers);
  }

  let response;
  try { response = await upstream.json(); }
  catch {
    console.error(JSON.stringify({ event: 'decision_unreadable', model }));
    return json({ code: 'openai_unreadable', message: 'OpenAI returned a response JUKE could not read.', latencyMs, usage: null, budget: await settle(null) }, 502);
  }
  latencyMs = Math.round(performance.now() - startedAt);

  const usage = actualUsage(model, response.usage);
  const dailyBudget = await settle(usage);
  let action;
  if (config.kind === 'decision') {
    const answer = (response.answers || []).find((item) => item.name === 'action' && item.type === 'choice');
    action = answer?.choice;
  } else {
    const text = extractResponseText(response);
    if (text) {
      try { action = JSON.parse(text)?.action; }
      catch { action = null; }
    }
  }
  if (!ACTIONS.includes(action)) {
    console.warn(JSON.stringify({ event: 'decision_invalid_action', model, requestId: response.id || null }));
    return json({ code: 'invalid_model_action', message: 'OpenAI returned no allowed action. The game will retry.', latencyMs, usage, budget: dailyBudget }, 502);
  }

  return json({
    model,
    action,
    latencyMs,
    usage,
    budget: dailyBudget,
  });
}

const DAILY_NANODOLLARS = 500_000_000;
export class BrowserBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, day TEXT NOT NULL, amount INTEGER NOT NULL)');
  }
  day() { return new Date().toISOString().slice(0, 10); }
  status() {
    const day = this.day();
    this.sql.exec('INSERT OR IGNORE INTO days(day) VALUES (?)', day);
    const saved = this.sql.exec('SELECT used, uncertain FROM days WHERE day = ?', day).one();
    const held = this.sql.exec('SELECT COALESCE(SUM(amount), 0) AS total FROM holds WHERE day = ?', day).one().total;
    const remaining = Math.max(0, DAILY_NANODOLLARS - saved.used - saved.uncertain - held);
    return { limitUsd: .5, usedUsd: saved.used / 1e9, heldUsd: held / 1e9, uncertainUsd: saved.uncertain / 1e9, remainingUsd: remaining / 1e9, resetAt: new Date(Date.parse(day) + 86400000).toISOString(), updatedAt: Date.now() };
  }
  async reserve(usd) {
    if (!Number.isFinite(usd) || usd <= 0 || usd > .01) throw new Error('Invalid reservation');
    const amount = Math.ceil(usd * 1e9);
    const current = this.status();
    if (amount > Math.round(current.remainingUsd * 1e9)) return { allowed: false, budget: current };
    const id = crypto.randomUUID();
    // Synchronous SQL keeps the read and reservation atomic across concurrent tabs.
    this.sql.exec('INSERT INTO holds(id, day, amount) VALUES (?, ?, ?)', id, this.day(), amount);
    await this.ctx.storage.setAlarm(Date.now() + 2 * 86400000);
    return { allowed: true, id, budget: this.status() };
  }
  settle(id, usd) {
    const hold = this.sql.exec('SELECT day, amount FROM holds WHERE id = ?', id).toArray()[0];
    if (hold) {
      const known = Number.isFinite(usd) && usd >= 0;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('UPDATE days SET used = used + ?, uncertain = uncertain + ? WHERE day = ?', known ? Math.ceil(usd * 1e9) : 0, known ? 0 : hold.amount, hold.day);
        this.sql.exec('DELETE FROM holds WHERE id = ?', id);
      });
    }
    return this.status();
  }
  async alarm() {
    const day = this.day();
    this.sql.exec('DELETE FROM holds WHERE day < ?', day);
    this.sql.exec('DELETE FROM days WHERE day < ?', day);
  }
}

function browserSession(request, env) {
  const raw = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-juke=([a-f0-9]{64})(?:;|$)/)?.[1];
  let id;
  try { if (raw) id = env.BROWSER_BUDGET.idFromString(raw); } catch { /* Invalid namespace ID gets a new session. */ }
  const fresh = !id;
  id ||= env.BROWSER_BUDGET.newUniqueId();
  return { budget: env.BROWSER_BUDGET.get(id), cookie: fresh ? `__Host-juke=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000` : null, fresh };
}

export class IpRateLimiter {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const now = Date.now();
    const window = Math.floor(now / 60_000);
    const signup = new URL(request.url).pathname === '/signup';
    const key = signup ? 'signup' : 'window';
    const saved = await this.ctx.storage.get(key);
    const count = saved?.window === window ? saved.count : 0;
    if (count >= (signup ? 5 : 180)) return new Response(null, { status: 429, headers: { 'retry-after': String(60 - Math.floor((now % 60_000) / 1_000)) } });
    await this.ctx.storage.put(key, { window, count: count + 1 });
    return new Response(null, { status: 204 });
  }
}

export default {
  async fetch(request, env) {
    const site = await routeSite(request, env);
    if (site) return site;
    const url = new URL(request.url);
    url.pathname = url.pathname.slice('/juke'.length);
    request = new Request(url, request);
    if (url.pathname === '/api/subscribe' || url.pathname === '/api/unsubscribe') return mailingList(request, env);
    if (url.pathname === '/api/budget' || url.pathname === '/api/status' || url.pathname === '/api/decision') {
      const session = browserSession(request, env);
      let response;
      if (url.pathname === '/api/budget') response = request.method === 'GET' ? json({ budget: await session.budget.status() }) : json({ code: 'method_not_allowed' }, 405);
      else if (url.pathname === '/api/status') {
        response = request.method === 'GET' ? await apiStatus(env) : json({ code: 'method_not_allowed' }, 405);
        const data = await response.json();
        response = json({ ...data, budget: await session.budget.status() }, response.status);
      } else {
        response = session.fresh ? json({ code: 'session_required', message: 'Reload JUKE to start your play session.' }, 403) : await runDecision(request, env, session.budget);
      }
      if (session.cookie) response.headers.set('set-cookie', session.cookie);
      return response;
    }
    if (url.pathname.startsWith('/api/')) return json({ code: 'not_found', message: 'API route not found.' }, 404);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set('content-security-policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    headers.set('x-frame-options', 'DENY');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};

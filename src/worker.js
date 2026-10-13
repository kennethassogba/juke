const MODELS = Object.freeze({
  'gpt-6-luna': { endpoint: '/v1/decisions', input: 0.10, cached: 0.01, output: 0.50, cacheWrite: 0.125, kind: 'decision' },
  'gpt-5.6-luna': { endpoint: '/v1/responses', input: 0.20, cached: 0.02, output: 1.20, cacheWrite: 0.25, kind: 'response' },
  'gpt-4.1-nano': { endpoint: '/v1/responses', input: 0.10, cached: 0.025, output: 0.40, cacheWrite: 0.125, kind: 'response' },
});

const ACTIONS = Object.freeze(['intercept', 'press', 'left', 'center', 'right']);
const SYSTEM_INSTRUCTIONS = 'Choose one defender action from the allowed list using this live table state. Intercept meets a puck moving toward your goal. Press steps forward. Left, center, and right guard those lanes. Return only the selected action.';
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
  if (value.score.player < 0 || value.score.player > 4 || value.score.defender < 0 || value.score.defender > 4) return null;
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
  return {
    version: 1,
    bounds: { goalStart: value.bounds.goalStart, goalEnd: value.bounds.goalEnd },
    score: { player: value.score.player, defender: value.score.defender },
    puck: { x: value.puck.x, y: value.puck.y, vx: value.puck.vx, vy: value.puck.vy, radius: value.puck.radius },
    player: { x: value.player.x, y: value.player.y, radius: value.player.radius },
    defender: { x: value.defender.x, y: value.defender.y, radius: value.defender.radius },
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

async function allowDecision(request, env) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const name = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
  return limiter.fetch('https://limit.internal/check', { method: 'POST' });
}

async function runDecision(request, env) {
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
    return json({ ...providerError('openai_network_error', 0), latencyMs: Math.round(performance.now() - startedAt), usage: null }, 502);
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  if (!upstream.ok) {
    console.warn(JSON.stringify({ event: 'decision_rejected', model, status: upstream.status, requestId: upstream.headers.get('x-request-id') || null }));
    const failure = providerError('openai_rejected', upstream.status);
    const headers = upstream.status === 429 ? { 'retry-after': upstream.headers.get('retry-after') || '3' } : {};
    return json({ ...failure, upstreamStatus: upstream.status, latencyMs, usage: null }, upstream.status === 429 ? 429 : 502, headers);
  }

  let response;
  try { response = await upstream.json(); }
  catch {
    console.error(JSON.stringify({ event: 'decision_unreadable', model }));
    return json({ code: 'openai_unreadable', message: 'OpenAI returned a response JUKE could not read.', latencyMs, usage: null }, 502);
  }

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
    return json({ code: 'invalid_model_action', message: 'OpenAI returned no allowed action. The game will retry.', latencyMs, usage: actualUsage(model, response.usage) }, 502);
  }

  return json({
    model,
    action,
    latencyMs,
    usage: actualUsage(model, response.usage),
  });
}

export class IpRateLimiter {
  constructor(ctx) { this.ctx = ctx; }
  async fetch() {
    const now = Date.now();
    const window = Math.floor(now / 60_000);
    const saved = await this.ctx.storage.get('window');
    const count = saved?.window === window ? saved.count : 0;
    if (count >= 180) return new Response(null, { status: 429, headers: { 'retry-after': String(60 - Math.floor((now % 60_000) / 1_000)) } });
    await this.ctx.storage.put('window', { window, count: count + 1 });
    return new Response(null, { status: 204 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') {
      if (request.method !== 'GET') return json({ code: 'method_not_allowed', message: 'Use GET for model status.' }, 405, { allow: 'GET' });
      return apiStatus(env);
    }
    if (url.pathname === '/api/decision') return runDecision(request, env);
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

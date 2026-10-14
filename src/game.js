import { Arena3D, COLORS } from './scene.js';

const MODELS = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4.1-nano'];
const NAMES = ['GPT-6 Luna', 'GPT-5.6 Luna', 'GPT-4.1 nano'];
const INKS = ['#216e9d', '#a94523', '#96366f'];
const ACTIONS = new Set(['intercept', 'press', 'left', 'center', 'right']);
const BUMPERS = [{ x: .34, y: .46, radius: .045 }, { x: .66, y: .54, radius: .045 }];
const GOAL_MIN = .375, GOAL_MAX = .625, MATCH_SECONDS = 40, WIN = 5;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const $ = (selector) => document.querySelector(selector);
const canvas = $('#arena');
const play = $('#play');
const pause = $('#pause');
const replay = $('#replay');
const notice = $('#notice');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const videoCanvas = document.createElement('canvas');
videoCanvas.width = 1080; videoCanvas.height = 1920;
const video = videoCanvas.getContext('2d');
let arena, connected = false, active = false, paused = false, serial = 0;
let deadline = 0, pausedAt = 0, endedAt = 0, previous = 0, accumulator = 0, hudAt = 0, videoAt = 0;
let timeLeft = MATCH_SECONDS, you = 0, opponents = 0, serveAt = 0, lastTouch = -1;
let pointerHeld = false, bumpersOn = true, result = '';
let target = { x: .5, y: .85 };
let player = body(.5, .85, .072);
let puck = newPuck();
let recorder = null, chunks = [], clip = null, clipUrl = null;
let resumeAfterGuide = false;
let bots = newBots();
let dailyBudget = null, budgetBlocked = false;
const heldKeys = new Set();
const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const recalled = key => { try { return localStorage.getItem(key); } catch { return null; } };
let installPrompt = null;
let modalTrigger = null;

function body(x, y, radius) { return { x, y, vx: 0, vy: 0, radius }; }
function newPuck() { return { ...body(.5, .5, .026), vx: .18, vy: .85, trail: [] }; }
function newBots() {
  return MODELS.map((model, index) => ({
    model, index, paddle: index === 0 ? body(.15, .5, .065) : index === 1 ? body(.5, .15, .065) : body(.85, .5, .065),
    action: null, aim: null, thinking: false, latency: null, started: 0, cost: 0, knownCost: true,
    goals: 0, conceded: 0, timer: 0, retry: 0, error: '',
  }));
}

try { arena = new Arena3D(canvas, reduced); }
catch (error) {
  console.error('3D renderer unavailable', error);
  notice.textContent = '3D is unavailable in this browser.';
  play.textContent = '3D unavailable'; play.disabled = true;
}

// Every defender sees the same arena in a coordinate frame facing its own goal.
function local(item, index) {
  if (index === 0) return { x: 1 - item.y, y: item.x, vx: -(item.vy || 0), vy: item.vx || 0, radius: item.radius };
  if (index === 2) return { x: item.y, y: 1 - item.x, vx: item.vy || 0, vy: -(item.vx || 0), radius: item.radius };
  return { x: item.x, y: item.y, vx: item.vx || 0, vy: item.vy || 0, radius: item.radius };
}
function world(point, index) {
  if (index === 0) return { x: point.y, y: 1 - point.x };
  if (index === 2) return { x: 1 - point.y, y: point.x };
  return point;
}
function position(item) { return { x: +item.x.toFixed(3), y: +item.y.toFixed(3), radius: item.radius }; }
function physicalState(bot) {
  const p = local(puck, bot.index);
  return {
    version: 1, bounds: { goalStart: GOAL_MIN, goalEnd: GOAL_MAX },
    score: { player: bot.conceded, defender: bot.goals },
    puck: { ...position(p), vx: +p.vx.toFixed(3), vy: +p.vy.toFixed(3) },
    player: position(local(player, bot.index)), defender: position(local(bot.paddle, bot.index)),
    otherDefenders: bots.filter(other => other !== bot).map(other => position(local(other.paddle, bot.index))),
    bumpersOn, bumpers: BUMPERS.map(item => position(local(item, bot.index))),
  };
}

function setNotice(text, error = false) { notice.textContent = text; notice.dataset.error = String(error); }
function cost(bot) { return bot.knownCost ? `$${bot.cost.toFixed(5)}` : '-'; }
function controls() {
  const pending = bots.some(bot => bot.thinking);
  play.disabled = !arena || pending || Boolean(recorder) || budgetBlocked;
  pause.disabled = !active;
  pause.textContent = paused ? 'Resume' : 'Pause';
  $('#restart').hidden = !active;
  play.hidden = active;
  replay.disabled = !clip;
}
async function connect() {
  if (!arena) return;
  play.disabled = true; play.textContent = 'Connecting';
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    updateBudget(data.budget);
    connected = response.ok && data.configured && MODELS.every(model => data.models?.some(item => item.id === model && item.ready));
    if (!connected) throw new Error('Models unavailable');
    play.textContent = serial ? 'Play again' : 'Play';
    setNotice('');
  } catch {
    connected = false; play.disabled = false; play.textContent = 'Retry connection';
    setNotice('Models unavailable. Retry the connection.', true);
  }
  if (connected) { if (budgetBlocked) play.textContent = 'Back tomorrow'; controls(); }
}

function schedule(bot, match, delay = 1100) {
  clearTimeout(bot.timer);
  if (active && !paused && match === serial) bot.timer = setTimeout(() => decide(bot, match), delay);
}
async function decide(bot, match) {
  if (!active || paused || bot.thinking || match !== serial) return;
  bot.thinking = true; bot.started = performance.now();
  const snapshot = physicalState(bot);
  try {
    const response = await fetch('/api/decision', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: bot.model, state: snapshot }),
    });
    const data = await response.json();
    updateBudget(data.budget);
    if (match !== serial) return;
    if (data.code === 'budget_exhausted') { budgetBlocked = true; finish('Back tomorrow'); play.textContent = 'Back tomorrow'; setNotice('Daily allowance used. It resets at midnight UTC.'); return; }
    bot.latency = Number.isFinite(data.latencyMs) ? data.latencyMs : Math.round(performance.now() - bot.started);
    if (data.usage && Number.isFinite(data.usage.costUsd)) bot.cost += data.usage.costUsd;
    else if (response.ok || response.status >= 500) bot.knownCost = false;
    if (response.ok && ACTIONS.has(data.action)) {
      bot.error = ''; bot.retry = 0;
      if (active) {
        bot.action = data.action;
        bot.aim = resolveTarget(data.action, snapshot, bot.index);
      }
    } else {
      bot.error = data.message || 'No model decision received.';
      const status = data.upstreamStatus || response.status;
      if ((status >= 400 && status < 500 && status !== 429) || data.code === 'missing_key') {
        connected = false; finish('Connection lost'); play.textContent = 'Retry connection';
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      bot.retry = response.status === 429 && retryAfter > 0 ? clamp(retryAfter * 1000, 2600, 60000) : 2600;
      setNotice(`${NAMES[bot.index]}: ${bot.error}`, true);
    }
  } catch {
    if (match === serial) { bot.error = 'Connection interrupted.'; bot.knownCost = false; bot.retry = 2600; setNotice('Connection interrupted. Retrying.', true); }
  } finally {
    if (match === serial) {
      bot.thinking = false;
      schedule(bot, match, bot.retry || 1100);
      controls();
    }
  }
}

function reflect(x) {
  const span = .9;
  const value = ((x - .05) % (span * 2) + span * 2) % (span * 2);
  return .05 + (value > span ? span * 2 - value : value);
}
function resolveTarget(action, snapshot, index) {
  const p = snapshot.puck, d = snapshot.defender;
  const lane = action === 'left' ? .42 : action === 'right' ? .58 : .5;
  if (['left', 'center', 'right'].includes(action)) return world({ x: lane, y: .15 }, index);
  const y = action === 'press' ? .28 : .15;
  const intercept = p.vy < -.02 ? reflect(p.x + p.vx * clamp((y - p.y) / p.vy, 0, 1.2)) : d.x;
  return world({ x: clamp(intercept, .15, .85), y }, index);
}
function move(paddle, aim, speed, dt) {
  const dx = aim.x - paddle.x, dy = aim.y - paddle.y;
  const distance = Math.hypot(dx, dy), scale = distance > 0 ? Math.min(1, speed * dt / distance) : 0;
  const x = clamp(paddle.x + dx * scale, .075, .925), y = clamp(paddle.y + dy * scale, .075, .925);
  paddle.vx = (x - paddle.x) / dt; paddle.vy = (y - paddle.y) / dt;
  paddle.x = x; paddle.y = y;
}
function collide(item, touch = null, fixed = false) {
  const dx = puck.x - item.x, dy = puck.y - item.y;
  const distance = Math.hypot(dx, dy), radius = puck.radius + item.radius;
  if (distance >= radius) return;
  const nx = distance > .00001 ? dx / distance : 0, ny = distance > .00001 ? dy / distance : 1;
  puck.x = item.x + nx * (radius + .0002); puck.y = item.y + ny * (radius + .0002);
  const vx = fixed ? 0 : item.vx, vy = fixed ? 0 : item.vy;
  const approaching = (puck.vx - vx) * nx + (puck.vy - vy) * ny;
  if (approaching < 0) {
    puck.vx -= 1.92 * approaching * nx; puck.vy -= 1.92 * approaching * ny;
    if (!fixed) { puck.vx += vx * .15; puck.vy += vy * .15; }
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > 2.9) { puck.vx *= 2.9 / speed; puck.vy *= 2.9 / speed; }
    if (touch !== null) lastTouch = touch;
  }
}
function goal(side, now) {
  if (side === 'player') {
    opponents += 1;
    if (lastTouch >= 0) {
      bots[lastTouch].goals += 1;
      arena.goal(.5, .93, COLORS[lastTouch]);
      setNotice(`${NAMES[lastTouch]} scores`);
    } else {
      arena.goal(.5, .93, '#f1f5ff');
      setNotice('Own goal');
    }
  } else {
    bots[side].conceded += 1; you += 1;
    const positions = [[.07, .5], [.5, .07], [.93, .5]];
    arena.goal(...positions[side], '#f1f5ff');
    setNotice(`Goal against ${NAMES[side]}`);
  }
  puck = newPuck(); serveAt = now + 700; lastTouch = -1;
  if (you >= WIN || opponents >= WIN) finish(you > opponents ? 'You win' : 'Models win');
}
function physics(dt, now) {
  let kx = 0, ky = 0;
  for (const key of heldKeys) { kx += directions[key][0]; ky += directions[key][1]; }
  if (kx || ky) { const length = Math.hypot(kx, ky); target = { x: clamp(target.x + kx / length * 1.25 * dt, .08, .92), y: clamp(target.y + ky / length * 1.25 * dt, .61, .93) }; $('#gesture-hint').hidden = true; }
  move(player, target, 2.6, dt);
  bots.forEach(bot => move(bot.paddle, bot.aim || bot.paddle, .68, dt));
  if (now < serveAt) return;
  puck.x += puck.vx * dt; puck.y += puck.vy * dt;
  collide(player, -1); bots.forEach(bot => collide(bot.paddle, bot.index));
  if (bumpersOn) BUMPERS.forEach(item => collide(item, null, true));
  const verticalOpening = puck.y > GOAL_MIN + puck.radius && puck.y < GOAL_MAX - puck.radius;
  const horizontalOpening = puck.x > GOAL_MIN + puck.radius && puck.x < GOAL_MAX - puck.radius;
  if (puck.x < -puck.radius && verticalOpening) return goal(0, now);
  if (puck.x > 1 + puck.radius && verticalOpening) return goal(2, now);
  if (puck.y < -puck.radius && horizontalOpening) return goal(1, now);
  if (puck.y > 1 + puck.radius && horizontalOpening) return goal('player', now);
  if (!verticalOpening) {
    if (puck.x < puck.radius) { puck.x = puck.radius; puck.vx = Math.abs(puck.vx) * .98; }
    if (puck.x > 1 - puck.radius) { puck.x = 1 - puck.radius; puck.vx = -Math.abs(puck.vx) * .98; }
  }
  if (!horizontalOpening) {
    if (puck.y < puck.radius) { puck.y = puck.radius; puck.vy = Math.abs(puck.vy) * .98; }
    if (puck.y > 1 - puck.radius) { puck.y = 1 - puck.radius; puck.vy = -Math.abs(puck.vy) * .98; }
  }
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed < .55 && speed > .001) { puck.vx *= 1.001; puck.vy *= 1.001; }
  puck.trail.push({ x: puck.x, y: puck.y }); if (puck.trail.length > 20) puck.trail.shift();
}

function start() {
  if (budgetBlocked) return;
  if (!connected) return connect();
  if (active || bots.some(bot => bot.thinking) || recorder) return;
  serial += 1; bots = newBots(); player = body(.5, .85, .072); target = { x: .5, y: .85 }; puck = newPuck();
  you = opponents = 0; lastTouch = -1; timeLeft = MATCH_SECONDS; result = '';
  active = true; paused = false; accumulator = 0; heldKeys.clear(); $('#install-nudge').hidden = true;
  deadline = performance.now() + MATCH_SECONDS * 1000; serveAt = performance.now() + 900;
  clip = null; if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = null;
  document.body.dataset.playing = 'true'; $('#result').hidden = true; $('#paused').hidden = true; $('#gesture-hint').hidden = false;
  setNotice(''); startRecording(); bots.forEach(bot => decide(bot, serial)); controls();
  canvas.focus({ preventScroll: true });
}
function finish(message) {
  if (!active) return;
  heldKeys.clear(); remember('juke-played', '1'); showInstallNudge();
  active = false; paused = false; endedAt = performance.now(); result = message;
  $('#paused').hidden = true;
  bots.forEach(bot => clearTimeout(bot.timer));
  $('#result').hidden = false; $('#result-title').textContent = message;
  $('#result-score').textContent = `${you} : ${opponents}`;
  $('#gesture-hint').hidden = true; play.textContent = 'Play again';
  document.body.dataset.playing = 'false';
  if (recorder?.state === 'paused') recorder.resume();
  controls();
}
function togglePause() {
  if (!active) return;
  heldKeys.clear(); paused = !paused;
  if (paused) { pausedAt = performance.now(); bots.forEach(bot => clearTimeout(bot.timer)); if (recorder?.state === 'recording') recorder.pause(); }
  else { deadline += performance.now() - pausedAt; serveAt += performance.now() - pausedAt; if (recorder?.state === 'paused') recorder.resume(); bots.forEach(bot => schedule(bot, serial, 0)); previous = performance.now(); accumulator = 0; }
  $('#paused').hidden = !paused; controls();
}

function pointer(event) {
  if (!active || paused) return;
  const point = arena.pointerPosition(event.clientX, event.clientY);
  if (point) target = { x: clamp(point.x, .08, .92), y: clamp(point.y, .61, .93) };
  $('#gesture-hint').hidden = true;
}
canvas.addEventListener('pointerdown', event => {
  pointerHeld = true; canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); pointer(event); event.preventDefault();
});
canvas.addEventListener('pointermove', event => { if (pointerHeld || event.pointerType === 'mouse') pointer(event); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { pointerHeld = false; });
window.addEventListener('keydown', event => {
  if (!active || paused || !directions[event.key] || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
  heldKeys.add(event.key); event.preventDefault();
});
window.addEventListener('keyup', event => heldKeys.delete(event.key));


function startRecording() {
  if (!window.MediaRecorder || !videoCanvas.captureStream) return;
  const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) return;
  try {
    arena.startReplay(); chunks = [];
    const stream = videoCanvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { clip = chunks.length ? new Blob(chunks, { type: mime }) : null; stream.getTracks().forEach(track => track.stop()); recorder = null; controls(); };
    recorder.onerror = () => setNotice('Replay recording interrupted.', true);
    recorder.start(1000);
  } catch (error) { console.warn('Replay unavailable', error); recorder = null; }
}
function drawReplay() {
  const w = videoCanvas.width;
  video.fillStyle = '#ffffff'; video.fillRect(0, 0, w, 1920);
  video.fillStyle = '#1c2331'; video.font = '900 italic 72px Arial'; video.textAlign = 'left'; video.fillText('JUKE', 48, 100);
  video.textAlign = 'right'; video.fillStyle = '#1c2331'; video.font = '700 56px Arial'; video.fillText(`${you} : ${opponents}`, w - 48, 100);
  video.font = '500 32px Arial'; video.fillText(active ? `${timeLeft}s` : result.toUpperCase(), w - 48, 158);
  video.drawImage(arena.replayFrame(), 0, 200, 1080, 1350);
  const labels = [[-.035, .5], [.5, -.035], [1.035, .5]];
  labels.forEach(([x, y], index) => {
    const point = arena.project(x, y, 2.0, true);
    video.textAlign = 'center'; video.font = '700 28px Arial';
    const labelWidth = video.measureText(NAMES[index]).width;
    video.fillStyle = '#ffffff'; video.fillRect(point.x * 1080 - labelWidth / 2 - 8, 170 + point.y * 1350, labelWidth + 16, 38);
    video.fillStyle = INKS[index]; video.fillText(NAMES[index], point.x * 1080, 200 + point.y * 1350);
  });
  bots.forEach((bot, index) => {
    const x = 48 + index * 340;
    video.textAlign = 'left'; video.fillStyle = INKS[index]; video.fillRect(x, 1560, 300, 4);
    video.font = '700 34px Arial'; video.fillText(NAMES[index], x, 1610);
    video.font = '500 30px monospace'; video.fillStyle = '#2f3b4f';
    video.fillText(`${bot.conceded}:${bot.goals}   ${bot.latency == null ? '-' : bot.latency}ms`, x, 1660);
    video.fillText(cost(bot), x, 1710);
    video.fillStyle = '#596473'; video.font = '500 26px Arial'; video.fillText(bot.thinking ? 'READING' : bot.action?.toUpperCase() || 'WAITING', x, 1755);
  });
  video.textAlign = 'left'; video.fillStyle = '#596473'; video.font = '500 30px Arial'; video.fillText('juke.keff.uk', 48, 1860);
}

function hud(now) {
  $('#you-score').textContent = you; $('#ai-score').textContent = opponents; $('#clock').textContent = `${timeLeft}s`;
  bots.forEach((bot, index) => {
    const card = document.querySelector(`[data-opponent="${index}"]`);
    card.querySelector('[data-score]').textContent = `${bot.conceded}:${bot.goals}`;
    card.querySelector('[data-latency]').textContent = bot.thinking ? `${Math.round(now - bot.started)} ms` : bot.latency == null ? '- ms' : `${bot.latency} ms`;
    card.querySelector('[data-cost]').textContent = cost(bot);
    const state = card.querySelector('[data-action]');
    state.textContent = bot.error ? 'Retrying' : bot.thinking ? 'Reading' : bot.action || (connected ? 'Ready' : 'Connecting');
    card.dataset.thinking = String(bot.thinking); card.dataset.error = String(Boolean(bot.error));
  });
  const labels = [[-.035, .5], [.5, -.035], [1.035, .5]];
  labels.forEach(([x, y], index) => {
    const point = arena.project(x, y);
    const label = document.querySelector(`[data-goal="${index}"]`);
    const half = label.offsetWidth / 2;
    label.style.left = `${clamp(point.x * canvas.clientWidth, half + 8, canvas.clientWidth - half - 8)}px`;
    label.style.top = `${point.y * 100}%`;
  });
}
function frame(now) {
  const dt = previous ? Math.min((now - previous) / 1000, .07) : 0; previous = now;
  if (active && !paused) {
    timeLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
    if (now >= deadline) finish(you === opponents ? 'Draw' : you > opponents ? 'You win' : 'Models win');
    else {
      accumulator += dt;
      while (accumulator >= 1 / 120 && active) { physics(1 / 120, now); accumulator -= 1 / 120; }
    }
  }
  if (arena) {
    arena.render({ player, puck, bots, bumpersOn }, now);
    if (now - hudAt > 100) { hud(now); hudAt = now; }
    if (recorder?.state === 'recording' && now - videoAt >= 1000 / 30) { drawReplay(); videoAt = now; }
    if (recorder && !active && now - endedAt > 1000 && !bots.some(bot => bot.thinking) && recorder.state !== 'inactive') recorder.stop();
  }
  requestAnimationFrame(frame);
}

play.addEventListener('click', start);
pause.addEventListener('click', togglePause);
$('#restart').addEventListener('click', () => finish('Match ended'));
$('#obstacles').addEventListener('click', () => { bumpersOn = !bumpersOn; $('#obstacles').setAttribute('aria-pressed', String(bumpersOn)); });
function openDialog(id, trigger = document.activeElement) {
  if (!document.querySelector('dialog[open]')) { resumeAfterGuide = active && !paused; modalTrigger = trigger; if (resumeAfterGuide) togglePause(); }
  for (const dialog of document.querySelectorAll('dialog[open]')) { dialog.dataset.switching = 'true'; dialog.close(); }
  const dialog = document.getElementById(id); dialog.showModal(); dialog.querySelector('button, input')?.focus();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close], #close-guide')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    if (dialog.dataset.switching) { delete dialog.dataset.switching; return; }
    if (resumeAfterGuide && active && paused) togglePause();
    resumeAfterGuide = false; modalTrigger?.focus();
  });
}
$('#help').addEventListener('click', () => openDialog('guide'));
for (const button of document.querySelectorAll('[data-open]')) button.addEventListener('click', () => openDialog(button.dataset.open, button));
$('#budget-info').addEventListener('click', () => { openDialog('allowance'); refreshBudget(); });
function updateBudget(value) {
  if (!value || (dailyBudget && value.updatedAt < dailyBudget.updatedAt)) return;
  dailyBudget = value;
  const money = amount => `$${amount.toFixed(2)}`;
  $('#budget-summary').textContent = `${money(value.remainingUsd)} / $0.50 left today`;
  $('#budget-detail').textContent = `${money(value.usedUsd)} used · ${money(value.remainingUsd)} available`;
  $('#budget-meter').value = value.limitUsd - value.remainingUsd;
  $('#budget-reset').textContent = `Resets ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value.resetAt))} your time.`;
  $('#budget-reserved').hidden = !(value.heldUsd + value.uncertainUsd > 0);
  $('#budget-reserved').textContent = 'A small amount is reserved for calls still awaiting usage. Calls with unconfirmed usage keep that reserve until tomorrow.';
  if (value.remainingUsd <= 0) budgetBlocked = true;
  if (value.remainingUsd > .01 && budgetBlocked) { budgetBlocked = false; play.textContent = serial ? 'Play again' : 'Play'; controls(); }
}
async function refreshBudget() { try { const response = await fetch('/api/budget', { cache: 'no-store' }); if (response.ok) updateBudget((await response.json()).budget); } catch {} }
replay.addEventListener('click', async () => {
  if (!clip) return;
  const file = new File([clip], `juke-${new Date().toISOString().slice(0, 10)}.${clip.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: clip.type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'JUKE replay', text: 'One paddle against three AI opponents. juke.keff.uk' }); }
    catch (error) { if (error.name !== 'AbortError') openDialog('share-guide', replay); }
  } else openDialog('share-guide', replay);
});
$('#save-clip').addEventListener('click', () => {
  if (!clip) return;
  if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = URL.createObjectURL(clip);
  const link = document.createElement('a'); link.href = clipUrl; link.download = `juke-${new Date().toISOString().slice(0, 10)}.${clip.type.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.append(link); link.click(); link.remove(); $('#share-guide').close();
});
function installed() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function showInstallNudge() { $('#install-nudge').hidden = !recalled('juke-played') || recalled('juke-install-dismissed') === '1' || installed(); }
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; if (!active) showInstallNudge(); });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#install-nudge').hidden = true; });
$('#dismiss-install').addEventListener('click', () => { remember('juke-install-dismissed', '1'); $('#install-nudge').hidden = true; });
$('#install').addEventListener('click', async () => {
  if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted') $('#install-nudge').hidden = true; return; }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install-instructions').textContent = ios ? 'In Safari, open the Share menu, choose Add to Home Screen, turn on Open as Web App, then tap Add.' : /Android/.test(navigator.userAgent) ? 'In Chrome, open the ⋮ menu and choose Add to Home screen, then Install. If Install is unavailable, choose Create shortcut.' : 'Open your browser menu and choose Install JUKE or Install this page as an app. The option is available in Chrome and Edge.';
  openDialog('install-guide');
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
showInstallNudge();
const signup = $('#signup-form');
$('#unsubscribe').hidden = !recalled('juke-unsubscribe');
const removalToken = new URL(location.href).searchParams.get('unsubscribe');
if (removalToken && /^[a-f0-9-]{36}$/.test(removalToken)) {
  remember('juke-unsubscribe', removalToken); $('#unsubscribe').hidden = false;
  history.replaceState(null, '', location.pathname); openDialog('newsletter');
}
signup.addEventListener('submit', async event => {
  event.preventDefault(); const button = signup.querySelector('button'); button.disabled = true;
  const status = $('#signup-status'); status.textContent = 'Joining…'; status.dataset.error = 'false';
  try {
    const form = new FormData(signup);
    const response = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), consent: form.get('consent') === 'on', website: form.get('website') }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message);
    status.textContent = data.message; signup.reset();
    if (data.token) { remember('juke-unsubscribe', data.token); $('#unsubscribe').hidden = false; }
  } catch (error) { status.textContent = error.message || 'Signup failed. Try again.'; status.dataset.error = 'true'; }
  finally { button.disabled = false; }
});
$('#unsubscribe').addEventListener('click', async () => {
  const button = $('#unsubscribe'); button.disabled = true;
  try {
    const response = await fetch('/api/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: recalled('juke-unsubscribe') }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message);
    remember('juke-unsubscribe', ''); button.hidden = true; $('#signup-status').textContent = data.message;
  } catch { $('#signup-status').textContent = 'Could not leave the list. Try again.'; }
  finally { button.disabled = false; }
});
window.addEventListener('focus', refreshBudget);
document.addEventListener('visibilitychange', () => { heldKeys.clear(); if (document.hidden && active && !paused) togglePause(); if (!document.hidden) refreshBudget(); });
window.addEventListener('blur', () => { pointerHeld = false; heldKeys.clear(); });
requestAnimationFrame(frame);
connect();

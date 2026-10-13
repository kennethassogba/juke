import { Arena3D, COLORS } from './scene.js';

const MODELS = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4.1-nano'];
const NAMES = ['GPT-6 Luna', 'GPT-5.6 Luna', 'GPT-4.1 nano'];
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
let bots = newBots();

function body(x, y, radius) { return { x, y, vx: 0, vy: 0, radius }; }
function newPuck() { return { ...body(.5, .5, .026), vx: .18, vy: .85, trail: [] }; }
function newBots() {
  return MODELS.map((model, index) => ({
    model, index, paddle: index === 0 ? body(.15, .5, .065) : index === 1 ? body(.5, .15, .065) : body(.85, .5, .065),
    action: null, thinking: false, latency: null, started: 0, cost: 0, knownCost: true,
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
  play.disabled = !arena || pending || Boolean(recorder);
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
    connected = response.ok && data.configured && MODELS.every(model => data.models?.some(item => item.id === model && item.ready));
    if (!connected) throw new Error('Models unavailable');
    play.textContent = serial ? 'Play again' : 'Play';
    setNotice('');
  } catch {
    connected = false; play.disabled = false; play.textContent = 'Retry connection';
    setNotice('Models unavailable. Retry the connection.', true);
  }
  if (connected) controls();
}

function schedule(bot, match, delay = 1100) {
  clearTimeout(bot.timer);
  if (active && !paused && match === serial) bot.timer = setTimeout(() => decide(bot, match), delay);
}
async function decide(bot, match) {
  if (!active || paused || bot.thinking || match !== serial) return;
  bot.thinking = true; bot.started = performance.now();
  try {
    const response = await fetch('/api/decision', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: bot.model, state: physicalState(bot) }),
    });
    const data = await response.json();
    if (match !== serial) return;
    bot.latency = Number.isFinite(data.latencyMs) ? data.latencyMs : Math.round(performance.now() - bot.started);
    if (data.usage && Number.isFinite(data.usage.costUsd)) bot.cost += data.usage.costUsd;
    else if (response.ok || response.status >= 500) bot.knownCost = false;
    if (response.ok && ACTIONS.has(data.action)) {
      bot.error = ''; bot.retry = 0;
      if (active) bot.action = data.action;
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
function chosenTarget(bot) {
  if (!bot.action) return bot.paddle;
  const p = local(puck, bot.index);
  const d = local(bot.paddle, bot.index);
  const lane = bot.action === 'left' ? .30 : bot.action === 'right' ? .70 : .5;
  if (['left', 'center', 'right'].includes(bot.action)) return world({ x: lane, y: .15 }, bot.index);
  const y = bot.action === 'press' ? .28 : .15;
  const intercept = p.vy < -.02 ? reflect(p.x + p.vx * clamp((y - p.y) / p.vy, 0, 1.2)) : d.x;
  return world({ x: clamp(intercept, .15, .85), y }, bot.index);
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
    const scorer = lastTouch >= 0 ? lastTouch : 1;
    bots[scorer].goals += 1; opponents += 1;
    arena.goal(.5, .93, COLORS[scorer]);
    setNotice(`${NAMES[scorer]} scores`);
  } else {
    bots[side].conceded += 1; you += 1;
    const positions = [[.07, .5], [.5, .07], [.93, .5]];
    arena.goal(...positions[side], '#f1f5ff');
    setNotice(`You score against ${NAMES[side]}`);
  }
  puck = newPuck(); serveAt = now + 700; lastTouch = -1;
  if (you >= WIN || opponents >= WIN) finish(you > opponents ? 'You win' : 'Models win');
}
function physics(dt, now) {
  move(player, target, 2.6, dt);
  bots.forEach(bot => move(bot.paddle, chosenTarget(bot), .68, dt));
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
  if (!connected) return connect();
  if (active || bots.some(bot => bot.thinking) || recorder) return;
  serial += 1; bots = newBots(); player = body(.5, .85, .072); target = { x: .5, y: .85 }; puck = newPuck();
  you = opponents = 0; lastTouch = -1; timeLeft = MATCH_SECONDS; result = '';
  active = true; paused = false; accumulator = 0;
  deadline = performance.now() + MATCH_SECONDS * 1000; serveAt = performance.now() + 900;
  clip = null; if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = null;
  document.body.dataset.playing = 'true'; $('#result').hidden = true; $('#gesture-hint').hidden = false;
  setNotice(''); startRecording(); bots.forEach(bot => decide(bot, serial)); controls();
}
function finish(message) {
  if (!active) return;
  active = false; paused = false; endedAt = performance.now(); result = message;
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
  paused = !paused;
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
canvas.addEventListener('keydown', event => {
  const directions = { ArrowLeft: [-.055, 0], ArrowRight: [.055, 0], ArrowUp: [0, -.045], ArrowDown: [0, .045], a: [-.055, 0], d: [.055, 0], w: [0, -.045], s: [0, .045] };
  if (!active || paused || !directions[event.key]) return;
  const [x, y] = directions[event.key]; target = { x: clamp(target.x + x, .08, .92), y: clamp(target.y + y, .61, .93) };
  $('#gesture-hint').hidden = true; event.preventDefault();
});

function startRecording() {
  if (!window.MediaRecorder || !videoCanvas.captureStream) return;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
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
  video.fillStyle = '#080a11'; video.fillRect(0, 0, w, 1920);
  video.fillStyle = '#f3f6ff'; video.font = '900 italic 72px Arial'; video.textAlign = 'left'; video.fillText('JUKE', 48, 100);
  video.font = '500 32px Arial'; video.fillStyle = '#aab3c5'; video.fillText('ONE PADDLE. THREE OPPONENTS.', 48, 158);
  video.textAlign = 'right'; video.fillStyle = '#f3f6ff'; video.font = '700 56px Arial'; video.fillText(`${you} : ${opponents}`, w - 48, 100);
  video.font = '500 32px Arial'; video.fillText(active ? `${timeLeft}s` : result.toUpperCase(), w - 48, 158);
  video.drawImage(arena.replayFrame(), 0, 200, 1080, 1350);
  const labels = [[-.035, .5], [.5, -.035], [1.035, .5]];
  labels.forEach(([x, y], index) => {
    const point = arena.project(x, y, 2.0, true);
    video.textAlign = 'center'; video.fillStyle = COLORS[index]; video.font = '700 28px Arial';
    video.fillText(NAMES[index], point.x * 1080, 200 + point.y * 1350);
  });
  bots.forEach((bot, index) => {
    const x = 48 + index * 340;
    video.textAlign = 'left'; video.fillStyle = COLORS[index]; video.fillRect(x, 1560, 300, 4);
    video.font = '700 34px Arial'; video.fillText(NAMES[index], x, 1610);
    video.font = '500 30px monospace'; video.fillStyle = '#e1e7f5';
    video.fillText(`${bot.conceded}:${bot.goals}   ${bot.latency == null ? '-' : bot.latency}ms`, x, 1660);
    video.fillText(cost(bot), x, 1710);
    video.fillStyle = '#9aa6bf'; video.font = '500 26px Arial'; video.fillText(bot.thinking ? 'READING' : bot.action?.toUpperCase() || 'WAITING', x, 1755);
  });
  video.textAlign = 'left'; video.fillStyle = '#8c97ad'; video.font = '500 30px Arial'; video.fillText('juke.keff.uk', 48, 1860);
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
    label.style.left = `${point.x * 100}%`; label.style.top = `${point.y * 100}%`;
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
replay.addEventListener('click', () => {
  if (!clip) return;
  if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = URL.createObjectURL(clip);
  const link = document.createElement('a'); link.href = clipUrl; link.download = `juke-3d-${new Date().toISOString().slice(0, 10)}.${clip.type.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.append(link); link.click(); link.remove();
});
$('#help').addEventListener('click', () => { $('#guide').showModal(); $('#close-guide').focus(); });
$('#close-guide').addEventListener('click', () => { $('#guide').close(); $('#help').focus(); });
$('#guide').addEventListener('click', event => { if (event.target === $('#guide')) { $('#guide').close(); $('#help').focus(); } });
window.addEventListener('blur', () => { pointerHeld = false; });
requestAnimationFrame(frame);
connect();

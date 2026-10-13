const ACTIONS = new Set(['intercept', 'press', 'left', 'center', 'right']);
const MODEL_IDS = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4.1-nano'];
const GOAL_START = 0.375;
const GOAL_END = 0.625;
const WIN_SCORE = 3;
const MATCH_LENGTH = 40;
const THINK_GAP = 1_100;
const RETRY_GAP = 2_600;

const cards = MODEL_IDS.map((id, index) => ({
  id,
  index,
  root: document.querySelector(`[data-model="${id}"]`),
  canvas: document.querySelector(`[data-board="${index}"]`),
  score: document.querySelectorAll('[data-score]')[index],
  stateLabel: document.querySelectorAll('[data-state]')[index],
  actionLabel: document.querySelectorAll('[data-action]')[index],
  latencyLabel: document.querySelectorAll('[data-latency]')[index],
  costLabel: document.querySelectorAll('[data-cost]')[index],
  flash: document.querySelectorAll('.goal-flash')[index],
}));

const startButton = document.querySelector('#start-match');
const startLabel = document.querySelector('#start-label');
const pauseButton = document.querySelector('#pause-match');
const bumpersButton = document.querySelector('#obstacles-toggle');
const statusLine = document.querySelector('#connection-status');
const replayButton = document.querySelector('#save-replay');
const replayNote = document.querySelector('#replay-note');
const replayCanvas = document.querySelector('#replay-canvas');
const replayContext = replayCanvas.getContext('2d');
const helpDialog = document.querySelector('#help-dialog');
const helpOpen = document.querySelector('#help-open');
const helpClose = document.querySelector('#help-close');
const helpDone = document.querySelector('#help-done');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const bumperLayout = [
  { x: 0.33, y: 0.47, radius: 0.045 },
  { x: 0.67, y: 0.53, radius: 0.045 },
];

let bumpersOn = true;
let active = false;
let paused = false;
let modelsReady = false;
let modelFailure = '';
let deadline = 0;
let pauseStarted = 0;
let secondsLeft = MATCH_LENGTH;
let previousFrame = 0;
let accumulator = 0;
let uiTick = 0;
let matchNumber = 0;
let replayRecorder = null;
let replayBlob = null;
let replayUrl = null;
let recorderChunks = [];
let pointerHeld = false;
let playerTarget = { x: 0.5, y: 0.84 };

function servePuck(direction = 1, nudge = 0) {
  return {
    x: clamp(0.5 + nudge, 0.42, 0.58),
    y: 0.5,
    vx: 0.28 + nudge * 0.8,
    vy: direction * 0.83,
    radius: 0.026,
    trail: [],
  };
}

function makeTable(index) {
  return {
    index,
    puck: servePuck(),
    player: { x: 0.5, y: 0.84, vx: 0, vy: 0, radius: 0.072 },
    defender: { x: 0.5, y: 0.16, vx: 0, vy: 0, radius: 0.072 },
    playerScore: 0,
    defenderScore: 0,
    action: null,
    isThinking: false,
    thoughtStarted: 0,
    timer: 0,
    latencyMs: null,
    totalCost: 0,
    costKnown: true,
    requests: 0,
    retryDelayMs: 0,
    finished: false,
    celebrationUntil: 0,
    lastError: '',
  };
}

let tables = cards.map((_, index) => makeTable(index));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberLabel(value) {
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function costLabel(table) {
  if (!table.costKnown) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 5, maximumFractionDigits: 5,
  }).format(table.totalCost);
}

function currentIntent(table) {
  if (table.isThinking) return 'READING';
  if (table.lastError) return active ? 'RETRYING' : 'API ERROR';
  if (table.finished) return 'FINISHED';
  if (!table.action) return 'WAITING';
  return table.action.toUpperCase();
}

function setCardStatus(index, status, text) {
  const card = cards[index];
  card.stateLabel.dataset.status = status;
  card.stateLabel.textContent = text;
}

function updateStats(index) {
  const table = tables[index];
  cards[index].score.innerHTML = `${table.playerScore} <i>:</i> ${table.defenderScore}`;
  cards[index].actionLabel.textContent = currentIntent(table);
  const latency = table.isThinking ? performance.now() - table.thoughtStarted : table.latencyMs;
  cards[index].latencyLabel.textContent = numberLabel(latency);
  cards[index].costLabel.textContent = costLabel(table);
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.dataset.tone = isError ? 'error' : 'normal';
}

function failureMessage(status) {
  if (!status) return 'Model check failed. Reload the page to retry.';
  if (!status.configured) return 'OpenAI is not connected. Check the Worker key, then reload.';
  const failed = (status.models || []).filter((model) => !model.ready);
  if (failed.length) {
    const reasons = new Set(failed.map((model) => model.reason));
    if (reasons.has('key_rejected')) return 'OpenAI rejected the Worker key. Check the key and project, then reload.';
    if (reasons.has('model_unavailable')) return 'This API project cannot access every model. Check project access, then reload.';
    return 'Could not verify every model. Check the Worker and reload.';
  }
  return '';
}

async function checkModels() {
  startButton.disabled = true;
  startLabel.textContent = 'Checking models';
  MODEL_IDS.forEach((_, index) => setCardStatus(index, 'checking', 'CHECKING'));
  try {
    const response = await fetch('/api/status', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const status = await response.json();
    const byId = new Map((status.models || []).map((model) => [model.id, model]));
    modelsReady = Boolean(status.configured && MODEL_IDS.every((id) => byId.get(id)?.ready));
    modelFailure = failureMessage(status);
    MODEL_IDS.forEach((id, index) => {
      const model = byId.get(id);
      if (model?.ready) setCardStatus(index, 'ready', 'READY');
      else setCardStatus(index, status.configured ? 'error' : 'missing', status.configured ? 'OFFLINE' : 'NO KEY');
    });
    if (modelsReady) setStatus('Models ready. Start a match and move on any table.');
    else setStatus(modelFailure, true);
  } catch {
    modelsReady = false;
    modelFailure = 'JUKE could not reach its Worker. Check the deployment, then reload.';
    MODEL_IDS.forEach((_, index) => setCardStatus(index, 'error', 'OFFLINE'));
    setStatus(modelFailure, true);
  }
  syncControls();
}

function syncControls() {
  const pending = tables.some((table) => table.isThinking);
  const unfinished = active && tables.some((table) => !table.finished);
  startButton.disabled = !modelsReady || unfinished || pending;
  startLabel.textContent = active ? 'Match in play' : matchNumber ? 'Play again' : 'Start match';
  pauseButton.disabled = !active;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  replayButton.disabled = !replayBlob;
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return true;
}

function project(layout, x, y) {
  return {
    x: layout.cx + (x - y) * layout.a,
    y: layout.cy + (x + y - 1) * layout.b,
  };
}

function unproject(layout, x, y) {
  const dx = (x - layout.cx) / (layout.a * 2);
  const dy = (y - layout.cy) / (layout.b * 2);
  return { x: 0.5 + dx + dy, y: 0.5 - dx + dy };
}

function boardLayout(width, height) {
  return {
    cx: width / 2,
    cy: height / 2,
    a: Math.max(15, Math.min(width / 2 - 25, height * 0.77)),
    b: Math.max(15, Math.min(height / 2 - 18, width * 0.45)),
  };
}

function pathTable(context, layout, inset = 0, bottom = 0) {
  const top = project(layout, 0, 0);
  const right = project(layout, 1, 0);
  const lower = project(layout, 1, 1);
  const left = project(layout, 0, 1);
  const points = [top, right, lower, left].map((point) => ({ x: point.x, y: point.y + bottom }));
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  return points;
}

function drawDisk(context, layout, position, radius, color, rim, shadow = true) {
  const point = project(layout, position.x, position.y);
  const scale = Math.min(layout.a, layout.b) * 2;
  const size = radius * scale;
  if (shadow) {
    context.beginPath();
    context.ellipse(point.x + 2, point.y + size * 0.34 + 3, size * 1.1, size * 0.64, 0, 0, Math.PI * 2);
    context.fillStyle = 'rgba(3, 11, 7, .43)';
    context.fill();
  }
  context.beginPath();
  context.ellipse(point.x, point.y, size, size * 0.68, 0, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = Math.max(1.2, size * 0.14);
  context.strokeStyle = rim;
  context.stroke();
  context.beginPath();
  context.ellipse(point.x, point.y - size * 0.12, size * 0.69, size * 0.38, 0, Math.PI * 1.08, Math.PI * 1.92);
  context.strokeStyle = 'rgba(255,255,255,.62)';
  context.lineWidth = Math.max(1, size * 0.09);
  context.stroke();
}

function drawBoard(context, width, height, table, index, isReplay = false) {
  context.save();
  context.clearRect(0, 0, width, height);
  const layout = boardLayout(width, height);
  const points = pathTable(context, layout, 0, 12);
  context.fillStyle = '#0b100d';
  context.fill();
  context.beginPath();
  context.moveTo(points[2].x, points[2].y);
  context.lineTo(points[3].x, points[3].y);
  const leftTop = project(layout, 0, 0);
  context.lineTo(leftTop.x, leftTop.y + 12);
  const rightTop = project(layout, 1, 0);
  context.lineTo(rightTop.x, rightTop.y + 12);
  context.closePath();
  context.fillStyle = '#18231b';
  context.fill();
  pathTable(context, layout);
  const felt = context.createLinearGradient(layout.cx - layout.a, layout.cy - layout.b, layout.cx + layout.a, layout.cy + layout.b);
  felt.addColorStop(0, '#1b5038');
  felt.addColorStop(0.56, '#153e2d');
  felt.addColorStop(1, '#103323');
  context.fillStyle = felt;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = '#24372a';
  context.stroke();

  const topRail = [project(layout, 0, 1), project(layout, 0, 0), project(layout, 1, 0)];
  context.beginPath();
  context.moveTo(topRail[0].x, topRail[0].y);
  context.lineTo(topRail[1].x, topRail[1].y);
  context.lineTo(topRail[2].x, topRail[2].y);
  context.strokeStyle = 'rgba(204, 253, 177, .65)';
  context.lineWidth = 1.7;
  context.stroke();
  const bottomRail = [project(layout, 0, 1), project(layout, 1, 1), project(layout, 1, 0)];
  context.beginPath();
  context.moveTo(bottomRail[0].x, bottomRail[0].y);
  context.lineTo(bottomRail[1].x, bottomRail[1].y);
  context.lineTo(bottomRail[2].x, bottomRail[2].y);
  context.strokeStyle = 'rgba(200, 242, 163, .56)';
  context.lineWidth = 1.7;
  context.stroke();

  const sideLine = project(layout, 0.5, 0.5);
  const centerLeft = project(layout, 0, 0.5);
  const centerRight = project(layout, 1, 0.5);
  context.beginPath();
  context.moveTo(centerLeft.x, centerLeft.y);
  context.lineTo(centerRight.x, centerRight.y);
  context.strokeStyle = 'rgba(218, 242, 200, .24)';
  context.lineWidth = 1.2;
  context.stroke();
  context.beginPath();
  context.ellipse(sideLine.x, sideLine.y, layout.a * 0.23, layout.b * 0.23, 0, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(218, 242, 200, .18)';
  context.stroke();
  for (let step = 1; step <= 3; step += 1) {
    const point = project(layout, 0.12 + step * 0.19, 0.5);
    context.beginPath();
    context.arc(point.x, point.y, 2, 0, Math.PI * 2);
    context.fillStyle = 'rgba(223, 241, 208, .31)';
    context.fill();
  }

  for (const [y, color] of [[0, '#d1fb65'], [1, '#f0eee2']]) {
    const first = project(layout, GOAL_START, y);
    const last = project(layout, GOAL_END, y);
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(last.x, last.y);
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.stroke();
    context.lineCap = 'butt';
  }

  if (bumpersOn) {
    for (const bumper of bumperLayout) {
      const point = project(layout, bumper.x, bumper.y);
      const size = bumper.radius * Math.min(layout.a, layout.b) * 2;
      context.beginPath();
      context.ellipse(point.x + 2, point.y + 3, size * 1.15, size * 0.72, 0, 0, Math.PI * 2);
      context.fillStyle = 'rgba(3, 11, 7, .38)';
      context.fill();
      context.beginPath();
      context.ellipse(point.x, point.y, size, size * 0.65, 0, 0, Math.PI * 2);
      context.fillStyle = '#f5a16d';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = '#ffd5a4';
      context.stroke();
      context.beginPath();
      context.ellipse(point.x, point.y - 1, size * 0.55, size * 0.31, 0, Math.PI, Math.PI * 2);
      context.strokeStyle = 'rgba(255, 249, 227, .8)';
      context.stroke();
    }
  }

  if (table.puck.trail.length > 1 && !reducedMotion.matches) {
    for (let i = 0; i < table.puck.trail.length - 1; i += 1) {
      const alpha = ((i + 1) / table.puck.trail.length) * 0.16;
      const from = project(layout, table.puck.trail[i].x, table.puck.trail[i].y);
      const to = project(layout, table.puck.trail[i + 1].x, table.puck.trail[i + 1].y);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = `rgba(242, 241, 222, ${alpha})`;
      context.lineWidth = 3;
      context.stroke();
    }
  }

  drawDisk(context, layout, table.player, table.player.radius, '#f1eee2', '#fffdf2');
  drawDisk(context, layout, table.defender, table.defender.radius, ['#ac9cff', '#d1fb65', '#ff8067'][index], '#fff1d7');
  drawDisk(context, layout, table.puck, table.puck.radius, '#f7edcb', '#fffdf3');

  if (table.finished && isReplay) {
    context.fillStyle = 'rgba(10, 17, 12, .52)';
    pathTable(context, layout);
    context.fill();
    const center = project(layout, 0.5, 0.5);
    context.font = `700 ${Math.max(14, width * 0.026)}px Manrope, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.fillStyle = '#f1f1e9';
    context.fillText('TABLE FINISHED', center.x, center.y + 5);
  }
  context.restore();
}

function setPaddleTarget(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = canvas.width;
  const height = canvas.height;
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  const layout = boardLayout(width, height);
  const point = unproject(layout, (event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
  playerTarget = { x: clamp(point.x, 0.075, 0.925), y: clamp(point.y, 0.57, 0.94) };
}

function bindCanvas(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    if (!active || paused) return;
    pointerHeld = true;
    canvas.focus({ preventScroll: true });
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') canvas.setPointerCapture(event.pointerId);
    setPaddleTarget(event, canvas);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointerHeld || !active || paused) return;
    setPaddleTarget(event, canvas);
    event.preventDefault();
  });
  const release = (event) => {
    pointerHeld = false;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('keydown', (event) => {
    const vectors = {
      ArrowLeft: [-0.055, 0], ArrowRight: [0.055, 0], ArrowUp: [0, -0.04], ArrowDown: [0, 0.04],
      a: [-0.055, 0], d: [0.055, 0], w: [0, -0.04], s: [0, 0.04],
    };
    const vector = vectors[event.key];
    if (!vector || !active || paused) return;
    playerTarget = {
      x: clamp(playerTarget.x + vector[0], 0.075, 0.925),
      y: clamp(playerTarget.y + vector[1], 0.57, 0.94),
    };
    event.preventDefault();
  });
}

cards.forEach((card) => bindCanvas(card.canvas));

function stepPaddle(paddle, target, speed, minY, maxY, dt) {
  const dx = target.x - paddle.x;
  const dy = target.y - paddle.y;
  const distance = Math.hypot(dx, dy);
  const maxStep = speed * dt;
  const ratio = distance > maxStep && distance > 0 ? maxStep / distance : 1;
  const nextX = clamp(paddle.x + dx * ratio, 0.08, 0.92);
  const nextY = clamp(paddle.y + dy * ratio, minY, maxY);
  paddle.vx = (nextX - paddle.x) / dt;
  paddle.vy = (nextY - paddle.y) / dt;
  paddle.x = nextX;
  paddle.y = nextY;
}

function reflectedX(x) {
  let result = x;
  while (result < 0.05 || result > 0.95) {
    if (result < 0.05) result = 0.1 - result;
    if (result > 0.95) result = 1.9 - result;
  }
  return result;
}

function defenderTarget(table) {
  if (!table.action) return { x: table.defender.x, y: table.defender.y };
  const puck = table.puck;
  if (table.action === 'left') return { x: 0.24, y: 0.17 };
  if (table.action === 'center') return { x: 0.5, y: 0.17 };
  if (table.action === 'right') return { x: 0.76, y: 0.17 };
  if (table.action === 'press') {
    const predict = puck.vy < -0.04 ? puck.x + puck.vx * clamp((0.31 - puck.y) / puck.vy, 0, 0.42) : puck.x;
    return { x: reflectedX(predict), y: 0.31 };
  }
  const time = puck.vy < -0.06 ? clamp((0.16 - puck.y) / puck.vy, 0, 0.5) : 0;
  return { x: reflectedX(puck.x + puck.vx * time), y: 0.16 };
}

function hitPaddle(puck, paddle, dt) {
  const dx = puck.x - paddle.x;
  const dy = puck.y - paddle.y;
  const distance = Math.hypot(dx, dy);
  const safeDistance = puck.radius + paddle.radius;
  if (distance >= safeDistance || distance === 0) return false;
  const nx = dx / distance;
  const ny = dy / distance;
  puck.x = paddle.x + nx * (safeDistance + 0.002);
  puck.y = paddle.y + ny * (safeDistance + 0.002);
  const speed = clamp(Math.hypot(puck.vx, puck.vy) + 0.2, 0.72, 1.78);
  const relative = (paddle.vx * nx + paddle.vy * ny) * 0.18;
  puck.vx = clamp(nx * speed + paddle.vx * 0.1, -1.72, 1.72);
  puck.vy = clamp(ny * speed + paddle.vy * 0.1 + relative, -1.72, 1.72);
  if (Math.abs(puck.vy) < 0.48) puck.vy = Math.sign(ny || -1) * 0.48;
  return true;
}

function hitBumper(puck, bumper) {
  const dx = puck.x - bumper.x;
  const dy = puck.y - bumper.y;
  const distance = Math.hypot(dx, dy);
  const safeDistance = puck.radius + bumper.radius;
  if (distance >= safeDistance || distance === 0) return false;
  const nx = dx / distance;
  const ny = dy / distance;
  puck.x = bumper.x + nx * (safeDistance + 0.002);
  puck.y = bumper.y + ny * (safeDistance + 0.002);
  const dot = puck.vx * nx + puck.vy * ny;
  puck.vx -= 1.82 * dot * nx;
  puck.vy -= 1.82 * dot * ny;
  return true;
}

function serveAfterScore(table, direction) {
  const lane = clamp(table.puck.x, 0.4, 0.6);
  table.puck = servePuck(direction, lane - 0.5);
}

function score(table, playerScored) {
  if (playerScored) {
    table.playerScore += 1;
    serveAfterScore(table, -1);
  } else {
    table.defenderScore += 1;
    serveAfterScore(table, 1);
  }
  table.celebrationUntil = performance.now() + 700;
  updateStats(table.index);
  setStatus(`${modelShortName(table.index)}: ${playerScored ? 'you scored' : 'model scored'}, ${table.playerScore} to ${table.defenderScore}.`);
  if (table.playerScore >= WIN_SCORE || table.defenderScore >= WIN_SCORE) {
    table.finished = true;
    setCardStatus(table.index, 'done', table.playerScore > table.defenderScore ? 'YOU WIN' : 'MODEL WINS');
    if (tables.every((entry) => entry.finished)) finishMatch('Three tables played to three.');
  }
}

function stepTable(table, dt) {
  if (table.finished) return;
  stepPaddle(table.player, playerTarget, 1.8, 0.58, 0.94, dt);
  stepPaddle(table.defender, defenderTarget(table), 1.36, 0.075, 0.39, dt);
  const puck = table.puck;
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  puck.vx *= 0.9993;
  puck.vy *= 0.9993;
  puck.trail.push({ x: puck.x, y: puck.y });
  if (puck.trail.length > 8) puck.trail.shift();

  if (puck.x < puck.radius) { puck.x = puck.radius; puck.vx = Math.abs(puck.vx) * 0.94; }
  if (puck.x > 1 - puck.radius) { puck.x = 1 - puck.radius; puck.vx = -Math.abs(puck.vx) * 0.94; }
  if (puck.y < puck.radius) {
    if (puck.x > GOAL_START && puck.x < GOAL_END) return score(table, true);
    puck.y = puck.radius;
    puck.vy = Math.abs(puck.vy) * 0.9;
  }
  if (puck.y > 1 - puck.radius) {
    if (puck.x > GOAL_START && puck.x < GOAL_END) return score(table, false);
    puck.y = 1 - puck.radius;
    puck.vy = -Math.abs(puck.vy) * 0.9;
  }
  if (bumpersOn) for (const bumper of bumperLayout) hitBumper(puck, bumper);
  hitPaddle(puck, table.player, dt);
  hitPaddle(puck, table.defender, dt);
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > 1.78) {
    puck.vx *= 1.78 / speed;
    puck.vy *= 1.78 / speed;
  } else if (speed < 0.38) {
    const scale = 0.5 / Math.max(speed, 0.1);
    puck.vx *= scale;
    puck.vy *= scale;
  }
}

function gameState(table) {
  return {
    version: 1,
    bounds: { goalStart: GOAL_START, goalEnd: GOAL_END },
    score: { player: table.playerScore, defender: table.defenderScore },
    puck: { x: round(table.puck.x), y: round(table.puck.y), vx: round(table.puck.vx), vy: round(table.puck.vy), radius: table.puck.radius },
    player: { x: round(table.player.x), y: round(table.player.y), radius: table.player.radius },
    defender: { x: round(table.defender.x), y: round(table.defender.y), radius: table.defender.radius },
    bumpersOn,
    bumpers: bumperLayout.map(({ x, y, radius }) => ({ x, y, radius })),
  };
}

function round(number) {
  return Math.round(number * 1000) / 1000;
}

function countUsage(table, usage) {
  if (usage && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) {
    table.totalCost += usage.costUsd;
  } else {
    table.costKnown = false;
  }
  updateStats(table.index);
}

function retryDelay(response) {
  const value = response.headers.get('retry-after');
  if (!value) return RETRY_GAP;
  const seconds = Number(value);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(wait) ? clamp(wait, RETRY_GAP, 60_000) : RETRY_GAP;
}

async function askModel(table, matchId) {
  if (!active || paused || table.finished || table.isThinking || matchId !== matchNumber) return;
  table.isThinking = true;
  table.thoughtStarted = performance.now();
  table.lastError = '';
  setCardStatus(table.index, 'thinking', 'THINKING');
  updateStats(table.index);
  syncControls();
  const started = performance.now();

  try {
    const response = await fetch('/api/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model: tableModel(table.index), state: gameState(table) }),
    });
    let result;
    try { result = await response.json(); }
    catch { result = { code: 'invalid_worker_response', message: 'JUKE could not read the model response.' }; }

    if (matchId !== matchNumber) return;
    table.latencyMs = Number.isFinite(result.latencyMs) ? result.latencyMs : Math.round(performance.now() - started);
    if (response.ok || response.status >= 500) countUsage(table, result.usage);

    if (response.ok && ACTIONS.has(result.action)) {
      table.lastError = '';
      table.retryDelayMs = 0;
      if (active && !table.finished) table.action = result.action;
      setCardStatus(table.index, table.finished ? 'done' : 'ready', table.finished ? 'FINISHED' : 'LIVE');
      table.requests += 1;
    } else {
      table.lastError = result.message || 'No action received.';
      setCardStatus(table.index, 'error', 'RETRYING');
      setStatus(`${modelShortName(table.index)}: ${table.lastError}`, true);
      table.retryDelayMs = response.status === 429 ? retryDelay(response) : 0;
      const errorStatus = result.upstreamStatus || response.status;
      const permanentRequestFailure = errorStatus >= 400 && errorStatus < 500 && errorStatus !== 429;
      if ((response.status === 503 && result.code === 'missing_key') || permanentRequestFailure) {
        modelsReady = false;
        modelFailure = result.message || 'OpenAI could not serve this model. Check the Worker key and project access, then reload.';
        finishMatch(`${modelShortName(table.index)}: ${modelFailure}`);
      }
    }
  } catch {
    if (matchId === matchNumber) {
      table.latencyMs = Math.round(performance.now() - started);
      table.costKnown = false;
      table.lastError = 'The Worker did not return a response. Check the connection.';
      setCardStatus(table.index, 'error', 'RETRYING');
      setStatus(`${modelShortName(table.index)}: ${table.lastError}`, true);
    }
  } finally {
    if (matchId === matchNumber) {
      table.isThinking = false;
      table.timer = 0;
      if (table.finished) setCardStatus(table.index, 'done', table.playerScore > table.defenderScore ? 'YOU WIN' : 'MODEL WINS');
      else if (active) setCardStatus(table.index, table.lastError ? 'error' : 'ready', table.lastError ? 'RETRYING' : 'LIVE');
      else setCardStatus(table.index, table.lastError ? 'error' : 'done', table.lastError ? 'API ERROR' : 'END');
      updateStats(table.index);
      if (active && !paused && !table.finished) scheduleDecision(table, matchId, table.lastError ? table.retryDelayMs || RETRY_GAP : THINK_GAP);
      syncControls();
    }
  }
}

function tableModel(index) {
  return MODEL_IDS[index];
}

function modelShortName(index) {
  return ['GPT-6 Luna', 'GPT-5.6 Luna', 'GPT-4.1 nano'][index];
}

function scheduleDecision(table, matchId, delay) {
  clearTimeout(table.timer);
  if (!active || paused || table.finished) return;
  table.timer = window.setTimeout(() => askModel(table, matchId), delay);
}

function resetTables() {
  tables = cards.map((_, index) => makeTable(index));
  playerTarget = { x: 0.5, y: 0.84 };
  cards.forEach((_, index) => {
    setCardStatus(index, 'ready', 'READY');
    updateStats(index);
  });
}

function startMatch() {
  if (!modelsReady || active || tables.some((table) => table.isThinking)) return;
  matchNumber += 1;
  resetTables();
  active = true;
  paused = false;
  secondsLeft = MATCH_LENGTH;
  document.querySelector('.duration-number').textContent = String(MATCH_LENGTH);
  deadline = performance.now() + MATCH_LENGTH * 1000;
  replayBlob = null;
  if (replayUrl) URL.revokeObjectURL(replayUrl);
  replayUrl = null;
  recorderChunks = [];
  replayNote.textContent = '';
  startRecorder();
  tables.forEach((table) => askModel(table, matchNumber));
  setStatus('Live. One move controls all three paddles.');
  syncControls();
}

function startRecorder() {
  if (!replayCanvas.captureStream || !window.MediaRecorder) {
    replayNote.textContent = 'Replay recording is not available in this browser.';
    return;
  }
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    replayNote.textContent = 'Replay recording is not available in this browser.';
    return;
  }
  try {
    const stream = replayCanvas.captureStream(30);
    replayRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    replayRecorder.ondataavailable = (event) => { if (event.data.size) recorderChunks.push(event.data); };
    replayRecorder.onerror = () => { replayNote.textContent = 'Replay recording stopped. This match is still in your scores.'; };
    replayRecorder.onstop = () => {
      if (recorderChunks.length) replayBlob = new Blob(recorderChunks, { type: mimeType });
      for (const track of stream.getTracks()) track.stop();
      replayRecorder = null;
      replayButton.disabled = !replayBlob;
      replayNote.textContent = replayBlob ? 'Replay ready.' : 'No replay file was recorded.';
    };
    replayRecorder.start(1000);
  } catch {
    replayRecorder = null;
    replayNote.textContent = 'Replay recording is not available in this browser.';
  }
}

function stopRecorder() {
  if (replayRecorder && replayRecorder.state !== 'inactive') replayRecorder.stop();
}

function finishMatch(message) {
  if (!active) return;
  active = false;
  paused = false;
  secondsLeft = Math.max(0, secondsLeft);
  tables.forEach((table) => {
    clearTimeout(table.timer);
    if (!table.finished && !table.isThinking) setCardStatus(table.index, 'done', 'END');
  });
  stopRecorder();
  pauseButton.textContent = 'Pause';
  setStatus(message);
  syncControls();
}

function togglePause() {
  if (!active) return;
  paused = !paused;
  if (paused) {
    pauseStarted = performance.now();
    if (replayRecorder?.state === 'recording') replayRecorder.pause();
    tables.forEach((table) => clearTimeout(table.timer));
    setStatus('Paused. Resume when ready.');
  } else {
    deadline += performance.now() - pauseStarted;
    if (replayRecorder?.state === 'paused') replayRecorder.resume();
    tables.forEach((table) => {
      if (!table.finished && !table.isThinking) scheduleDecision(table, matchNumber, 80);
    });
    setStatus('Live. One move controls all three paddles.');
    previousFrame = performance.now();
  }
  syncControls();
}

function updateMatch(dt, now) {
  if (!active || paused) return;
  secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (deadline <= now) {
    finishMatch('Time. Check the three scores.');
    return;
  }
  accumulator += Math.min(dt, 0.06);
  const fixed = 1 / 120;
  let substeps = 0;
  while (accumulator >= fixed && substeps < 10) {
    tables.forEach((table) => stepTable(table, fixed));
    accumulator -= fixed;
    substeps += 1;
  }
}

function drawReplay(now) {
  if (!replayContext) return;
  const context = replayContext;
  const width = replayCanvas.width;
  const height = replayCanvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#101512';
  context.fillRect(0, 0, width, height);
  context.textAlign = 'left';
  context.fillStyle = '#d1fb65';
  context.font = '800 54px Manrope, system-ui, sans-serif';
  context.fillText('JUKE', 58, 73);
  context.fillStyle = '#a0aa9f';
  context.font = '500 28px "DM Mono", ui-monospace, monospace';
  context.fillText('THREE MODELS · ONE MOVE', 238, 70);
  context.textAlign = 'right';
  context.fillStyle = '#dbe2d7';
  context.fillText(active ? `${secondsLeft}s` : 'FINAL', width - 58, 70);
  context.textAlign = 'left';

  const margin = 42;
  const tileHeight = 540;
  const gap = 14;
  const top = 110;
  tables.forEach((table, index) => {
    const y = top + index * (tileHeight + gap);
    context.beginPath();
    context.roundRect(margin, y, width - margin * 2, tileHeight, 19);
    context.fillStyle = '#191f1c';
    context.fill();
    context.strokeStyle = '#303a33';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = ['#ac9cff', '#d1fb65', '#ff8067'][index];
    context.font = '500 28px "DM Mono", ui-monospace, monospace';
    context.fillText(modelShortName(index).toUpperCase(), margin + 22, y + 44);
    context.textAlign = 'right';
    context.fillStyle = '#b8c2b6';
    context.font = '500 26px "DM Mono", ui-monospace, monospace';
    context.fillText(`${table.latencyMs == null ? '-' : `${table.latencyMs}ms`}   ${costLabel(table)}`, width - margin - 22, y + 44);
    context.textAlign = 'left';

    context.fillStyle = '#9da79d';
    context.font = '500 26px "DM Mono", ui-monospace, monospace';
    context.fillText('YOU', margin + 22, y + 90);
    context.textAlign = 'center';
    context.fillStyle = '#f1f1e9';
    context.font = '700 38px Manrope, system-ui, sans-serif';
    context.fillText(`${table.playerScore}   :   ${table.defenderScore}`, width / 2, y + 90);
    context.textAlign = 'right';
    context.fillStyle = ['#c3b8ff', '#d1fb65', '#ffb3a3'][index];
    context.font = '500 26px "DM Mono", ui-monospace, monospace';
    context.fillText(table.isThinking ? 'THINKING' : currentIntent(table), width - margin - 22, y + 90);
    context.textAlign = 'left';

    const boardTop = y + 110;
    const boardWidth = width - margin * 2 - 38;
    const boardHeight = tileHeight - 125;
    context.save();
    context.beginPath();
    context.rect(margin + 19, boardTop, boardWidth, boardHeight);
    context.clip();
    context.translate(margin + 19, boardTop);
    drawBoard(context, boardWidth, boardHeight, table, index, true);
    context.restore();
  });
  context.textAlign = 'left';
  context.fillStyle = '#9da79d';
  context.font = '500 26px "DM Mono", ui-monospace, monospace';
  context.fillText('OPENAI API · USAGE-BASED COST', margin, height - 35);
  context.textAlign = 'right';
  context.fillText(active ? 'LIVE REPLAY' : 'JUKE.KEFF.UK', width - margin, height - 35);
  context.textAlign = 'left';
  void now;
}

function render(now) {
  for (const card of cards) {
    if (!fitCanvas(card.canvas)) continue;
    const ctx = card.canvas.getContext('2d');
    drawBoard(ctx, card.canvas.width, card.canvas.height, tables[card.index], card.index);
  }
  if (replayRecorder?.state === 'recording') drawReplay(now);
}

function frame(now) {
  if (!previousFrame) previousFrame = now;
  const dt = Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  updateMatch(dt, now);
  render(now);
  if (now - uiTick > 100) {
    uiTick = now;
    if (active && !paused) document.querySelector('.duration-number').textContent = String(secondsLeft).padStart(2, '0');
    tables.forEach((table, index) => updateStats(index));
  }
  requestAnimationFrame(frame);
}

startButton.addEventListener('click', startMatch);
pauseButton.addEventListener('click', togglePause);
bumpersButton.addEventListener('click', () => {
  bumpersOn = !bumpersOn;
  bumpersButton.setAttribute('aria-pressed', String(bumpersOn));
  setStatus(bumpersOn ? 'Bumpers on.' : 'Bumpers off.');
});

replayButton.addEventListener('click', () => {
  if (!replayBlob) return;
  const extension = replayBlob.type.includes('mp4') ? 'mp4' : 'webm';
  replayUrl = URL.createObjectURL(replayBlob);
  const anchor = document.createElement('a');
  anchor.href = replayUrl;
  anchor.download = `juke-match-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  replayNote.textContent = 'Replay saved.';
});

function closeDialog() {
  if (helpDialog.open) helpDialog.close();
  helpOpen.focus();
}
helpOpen.addEventListener('click', () => { helpDialog.showModal(); helpClose.focus(); });
helpClose.addEventListener('click', closeDialog);
helpDone.addEventListener('click', closeDialog);
helpDialog.addEventListener('click', (event) => { if (event.target === helpDialog) closeDialog(); });
helpDialog.addEventListener('close', () => helpOpen.focus());

window.addEventListener('resize', () => render(performance.now()), { passive: true });
window.addEventListener('pagehide', () => {
  if (replayUrl) URL.revokeObjectURL(replayUrl);
});

syncControls();
render(performance.now());
requestAnimationFrame(frame);
checkModels();

Warning: truncated output (original token count: 8765)
Total output lines: 937

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
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function costLabel(table) {
  if (!table.costKnown) return '—';
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
    x: layout.cx + (x - 0.5) * layout.a * 2 - (y - 0.5) * layout.a * 2,
    y: layout.cy + (x + y - 1) * layout.b * 2,
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
  const top = project(layout, 0.5, 0);
  const right = project(layout, 1, 0.5);
  const lower = project(layout, 0.5, 1);
  const left = project(layout, 0, 0.5);
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
  const leftTop = project(layout, 0.5, 0);
  context.lineTo(leftTop.x, leftTop.y + 12);
  const rightTop = project(layout, 1, 0.5);
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

  const topRail = [project(layout, 0, 0.5), project(layout, 0.5, 0), project(layout, 1, 0.5)];
  context.beginPath();
  context.moveTo(topRail[0].x, topRail[0].y);
  context.lineTo(topRail[1].x, topRail[1].y);
  context.lineTo(topRail[2].x, topRail[2].y);
  context.strokeStyle = 'rgba(204, 253, 177, .65)';
  context.lineWidth = 1.7;
  context.stroke();
  const bottomRail = [project(layout, 0, 0.5), project(layout, 0.5, 1), project(layout, 1, 0.5)];
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

  for (co…2765 tokens truncated…cept: 'application/json' },
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
      const permanentRequestFailure = response.status >= 400 && response.status < 500 && response.status !== 429;
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
    tables.forEach((table) => clearTimeout(table.timer));
    setStatus('Paused. Resume when ready.');
  } else {
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
  context.font = '800 28px Manrope, system-ui, sans-serif';
  context.fillText('JUKE', 58, 73);
  context.fillStyle = '#a0aa9f';
  context.font = '500 15px "DM Mono", ui-monospace, monospace';
  context.fillText('THREE MODELS · ONE MOVE', 173, 70);
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
    context.font = '500 14px "DM Mono", ui-monospace, monospace';
    context.fillText(`0${index + 1}  ${modelShortName(index).toUpperCase()}`, margin + 22, y + 34);
    context.textAlign = 'right';
    context.fillStyle = '#b8c2b6';
    context.fillText(`${table.latencyMs == null ? '—' : `${table.latencyMs}ms`}   ${costLabel(table)}`, width - margin - 22, y + 34);
    context.textAlign = 'left';

    context.fillStyle = '#9da79d';
    context.font = '500 12px "DM Mono", ui-monospace, monospace';
    context.fillText('YOU', margin + 22, y + 65);
    context.textAlign = 'center';
    context.fillStyle = '#f1f1e9';
    context.font = '700 27px Manrope, system-ui, sans-serif';
    context.fillText(`${table.playerScore}   :   ${table.defenderScore}`, width / 2, y + 68);
    context.textAlign = 'right';
    context.fillStyle = ['#c3b8ff', '#d1fb65', '#ffb3a3'][index];
    context.font = '500 12px "DM Mono", ui-monospace, monospace';
    context.fillText(table.isThinking ? 'THINKING' : currentIntent(table), width - margin - 22, y + 65);
    context.textAlign = 'left';

    const boardTop = y + 83;
    const boardWidth = width - margin * 2 - 38;
    const boardHeight = tileHeight - 98;
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
  context.font = '500 12px "DM Mono", ui-monospace, monospace';
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

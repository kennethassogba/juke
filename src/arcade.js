// Classic game AI: predict the puck, find a reachable contact, aim the rebound.
// No network calls, model outputs or future player input are used here.
export const LEVELS = {
  easy: { label: 'Easy', reaction: 200, speed: .85, horizon: .65, error: .055 },
  normal: { label: 'Normal', reaction: 110, speed: 1.35, horizon: 1, error: .025 },
  hard: { label: 'Hard', reaction: 55, speed: 1.95, horizon: 1.35, error: .008 },
  expert: { label: 'Expert', reaction: 25, speed: 2.6, horizon: 1.7, error: 0 },
};
export const ROLES = ['Keeper', 'Striker', 'Counter'];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const opening = (v, r) => v > .375 + r && v < .625 - r;

function forecast(puck, bumpers, horizon) {
  const p = { ...puck }, path = [];
  const dt = 1 / 120, r = p.radius;
  for (let t = dt; t <= horizon; t += dt) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const b of bumpers) {
      const dx = p.x - b.x, dy = p.y - b.y, distance = Math.hypot(dx, dy);
      if (distance >= r + b.radius || distance < .00001) continue;
      const nx = dx / distance, ny = dy / distance;
      p.x = b.x + nx * (r + b.radius + .0002); p.y = b.y + ny * (r + b.radius + .0002);
      const approach = p.vx * nx + p.vy * ny;
      if (approach < 0) { p.vx -= 1.92 * approach * nx; p.vy -= 1.92 * approach * ny; }
    }
    if (!opening(p.y, r)) {
      if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx) * .98; }
      if (p.x > 1 - r) { p.x = 1 - r; p.vx = -Math.abs(p.vx) * .98; }
    }
    if (!opening(p.x, r)) {
      if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy) * .98; }
      if (p.y > 1 - r) { p.y = 1 - r; p.vy = -Math.abs(p.vy) * .98; }
    }
    if (p.x < -r || p.x > 1 + r || p.y < -r || p.y > 1 + r) break;
    path.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, t });
  }
  return path;
}

// All planning happens in the defender's frame: its goal is centred at y = 0.
export function planArcade({ puck, defender, playerGoal, bumpers, index, difficulty }) {
  const level = LEVELS[difficulty], path = forecast(puck, bumpers, level.horizon);
  const depth = [.23, .34, .29][index];
  const noise = (Math.random() - .5) * 2 * level.error;
  for (const p of path) {
    if (p.y < .13 || p.y > depth || p.x < .16 || p.x > .84) continue;
    // Do not chase a puck already escaping the defended end.
    if (p.vy > .1 && p.y > .22) continue;
    const dx = playerGoal.x - p.x, dy = playerGoal.y - p.y;
    const length = Math.hypot(dx, dy) || 1, speed = Math.hypot(p.vx, p.vy) || 1;
    // A collision normal that reflects the incoming velocity toward the shot.
    const nx = dx / length * speed - p.vx, ny = dy / length * speed - p.vy;
    const normal = Math.hypot(nx, ny) || 1;
    if (ny / normal < .2) continue;
    const contact = defender.radius + puck.radius - .004;
    const aim = { x: clamp(p.x - nx / normal * contact + noise, .1, .9), y: clamp(p.y - ny / normal * contact, .075, depth) };
    const travel = Math.hypot(aim.x - defender.x, aim.y - defender.y);
    if (travel <= level.speed * p.t) return { aim, action: p.y > .21 ? 'Attacking' : 'Intercepting' };
  }
  // Fall back to covering the goal, including rebounds that are not reachable yet.
  const threat = path.find(p => p.vy < 0 && p.y < .18);
  return { aim: { x: clamp((threat?.x ?? .5) + noise, .37, .63), y: .105 }, action: 'Guarding' };
}

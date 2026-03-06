import { createFixedLoop } from "./engine/loop.js";
import { clamp, dist, lerp } from "./engine/utils.js";
import { LEVELS } from "./data/levels.js";
import { TOWERS } from "./data/towers.js";
import { ENEMIES } from "./data/enemies.js";
import { buildWaves } from "./data/waves.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hudWave = document.getElementById("hud-wave");
const hudLives = document.getElementById("hud-lives");
const hudCredits = document.getElementById("hud-credits");
const hudEnemies = document.getElementById("hud-enemies");
const hudStatus = document.getElementById("hud-status");
const startWaveBtn = document.getElementById("start-wave");
const pauseBtn = document.getElementById("toggle-pause");
const resetBtn = document.getElementById("reset-game");
const towerList = document.getElementById("tower-list");
const towerInspect = document.getElementById("tower-inspect");

const level = LEVELS.level2;
canvas.width = level.canvas.width;
canvas.height = level.canvas.height;

const grid = {
  cols: level.grid.cols,
  rows: level.grid.rows,
  padding: level.grid.padding,
  cell: 60,
};

grid.cell = Math.min(
  (canvas.width - grid.padding * 2) / grid.cols,
  (canvas.height - grid.padding * 2) / grid.rows
);

const state = {
  wave: 1,
  lives: 20,
  credits: 250,
  paused: false,
  buildMode: true,
  selectedTower: "earth",
  hoverCell: null,
  enemies: [],
  towers: [],
  projectiles: [],
  waveQueue: buildWaves(),
  waveSpawning: false,
  spawnTimer: 0,
  spawnStack: [],
  background: null,
  assets: {
    towers: {},
  },
};

const path = level.path.map((node) => ({ ...node }));

function gridToPixel(x, y) {
  return {
    x: grid.padding + x * grid.cell + grid.cell / 2,
    y: grid.padding + y * grid.cell + grid.cell / 2,
  };
}

function pixelToGrid(x, y) {
  const gx = Math.floor((x - grid.padding) / grid.cell);
  const gy = Math.floor((y - grid.padding) / grid.cell);
  return { x: gx, y: gy };
}

function isOnPath(cell) {
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    if (a.x === b.x) {
      if (cell.x === a.x && cell.y >= Math.min(a.y, b.y) && cell.y <= Math.max(a.y, b.y)) return true;
    } else if (a.y === b.y) {
      if (cell.y === a.y && cell.x >= Math.min(a.x, b.x) && cell.x <= Math.max(a.x, b.x)) return true;
    }
  }
  return false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadAssets() {
  state.background = await loadImage(level.background);
  const towerEntries = Object.entries(TOWERS);
  for (const [key, tower] of towerEntries) {
    const idle = await Promise.all(tower.sprites.idle.map(loadImage));
    const shoot = await Promise.all(tower.sprites.shoot.map(loadImage));
    state.assets.towers[key] = { idle, shoot };
  }
}

function resetGame() {
  state.wave = 1;
  state.lives = 20;
  state.credits = 250;
  state.paused = false;
  state.buildMode = true;
  state.enemies = [];
  state.towers = [];
  state.projectiles = [];
  state.waveQueue = buildWaves();
  state.waveSpawning = false;
  state.spawnTimer = 0;
  state.spawnStack = [];
  updateHud();
  pauseBtn.textContent = "Pause";
}

function updateHud() {
  hudWave.textContent = state.wave;
  hudLives.textContent = state.lives;
  hudCredits.textContent = state.credits;
  hudEnemies.textContent = state.enemies.length;
  hudStatus.textContent = state.buildMode ? "Build mode" : "Wave live";
  hudStatus.className = state.buildMode ? "status-pill build" : "status-pill live";
}

function buildTowerCards() {
  towerList.innerHTML = Object.entries(TOWERS)
    .map(
      ([key, tower]) => `
      <button class="tower-card ${state.selectedTower === key ? "active" : ""}"
              data-tower="${key}" style="--tower-color:${tower.color}">
        <strong style="color:${state.selectedTower === key ? tower.color : ''}">${tower.name}</strong>
        <span>$${tower.cost} &nbsp;·&nbsp; Range ${tower.range}</span>
        <span>${tower.fireRate}s fire &nbsp;·&nbsp; ${tower.damage} dmg${tower.slow ? " &nbsp;·&nbsp; slows" : ""}</span>
      </button>
    `
    )
    .join("");
}

function updateTowerInspect() {
  const tower = TOWERS[state.selectedTower];
  towerInspect.innerHTML = `
    <strong style="color:${tower.color}">${tower.name}</strong>
    <br>Cost $${tower.cost} &nbsp;·&nbsp; Range ${tower.range}
    <br>Damage ${tower.damage} &nbsp;·&nbsp; Fire ${tower.fireRate}s${tower.slow ? " &nbsp;·&nbsp; Slows enemies" : ""}
  `;
}

function placeTower(cell) {
  if (cell.x < 0 || cell.x >= grid.cols || cell.y < 0 || cell.y >= grid.rows) return;
  if (isOnPath(cell)) return;
  if (state.towers.some((tower) => tower.cell.x === cell.x && tower.cell.y === cell.y)) return;
  const towerData = TOWERS[state.selectedTower];
  if (!towerData || state.credits < towerData.cost) return;

  state.credits -= towerData.cost;
  state.towers.push({
    type: state.selectedTower,
    cell,
    cooldown: 0,
    anim: "idle",
    animTimer: 0,
    animTime: 0,
  });
  updateHud();
}

function startWave() {
  if (state.waveSpawning) return;
  const waveConfig = state.waveQueue[state.wave - 1];
  if (!waveConfig) return;
  const stack = [];
  Object.entries(waveConfig).forEach(([type, count]) => {
    for (let i = 0; i < count; i += 1) stack.push(type);
  });
  state.spawnStack = stack.sort(() => Math.random() - 0.5);
  state.waveSpawning = true;
  state.buildMode = false;
  state.spawnTimer = 0.2;
  updateHud();
}

function spawnEnemy(typeKey) {
  const template = ENEMIES[typeKey];
  if (!template) return;
  const start = gridToPixel(path[0].x, path[0].y);
  state.enemies.push({
    type: typeKey,
    x: start.x,
    y: start.y,
    hp: template.hp,
    maxHp: template.hp,
    speed: template.speed,
    reward: template.reward,
    color: template.color,
    pathIndex: 0,
    slowTimer: 0,
  });
}

function updateSpawner(dt) {
  if (!state.waveSpawning) return;
  state.spawnTimer -= dt;
  if (state.spawnTimer > 0) return;
  if (state.spawnStack.length === 0) {
    state.waveSpawning = false;
    state.wave += 1;
    state.buildMode = true;
    updateHud();
    return;
  }
  const next = state.spawnStack.pop();
  spawnEnemy(next);
  state.spawnTimer = 0.6;
}

function updateEnemies(dt) {
  state.enemies.forEach((enemy) => {
    const targetNode = path[enemy.pathIndex + 1];
    if (!targetNode) return;
    const target = gridToPixel(targetNode.x, targetNode.y);
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      enemy.pathIndex += 1;
      if (enemy.pathIndex >= path.length - 1) enemy.reached = true;
      return;
    }
    const slowFactor = enemy.slowTimer > 0 ? 0.6 : 1;
    const speed = enemy.speed * slowFactor;
    enemy.x += (dx / distance) * speed * dt;
    enemy.y += (dy / distance) * speed * dt;
    enemy.slowTimer = Math.max(0, enemy.slowTimer - dt);
  });

  const alive = [];
  state.enemies.forEach((enemy) => {
    if (enemy.reached) {
      state.lives -= 1;
    } else if (enemy.hp > 0) {
      alive.push(enemy);
    } else {
      state.credits += enemy.reward;
    }
  });
  state.enemies = alive;
}

function updateTowers(dt) {
  state.towers.forEach((tower) => {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) return;
    const towerData = TOWERS[tower.type];
    if (!towerData) return;
    const pos = gridToPixel(tower.cell.x, tower.cell.y);
    const target = state.enemies.find((enemy) => dist(enemy, pos) <= towerData.range);
    if (!target) return;

    tower.cooldown = towerData.fireRate;

    state.projectiles.push({
      x: pos.x,
      y: pos.y,
      target,
      speed: towerData.projectileSpeed,
      damage: towerData.damage,
      slow: towerData.slow || 0,
      color: towerData.color,
    });
  });
}

function updateProjectiles(dt) {
  const remaining = [];
  state.projectiles.forEach((shot) => {
    if (!shot.target || shot.target.hp <= 0) return;
    const dx = shot.target.x - shot.x;
    const dy = shot.target.y - shot.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 8) {
      shot.target.hp -= shot.damage;
      if (shot.slow) shot.target.slowTimer = Math.max(shot.target.slowTimer, 1.2);
      return;
    }
    shot.x += (dx / distance) * shot.speed * dt;
    shot.y += (dy / distance) * shot.speed * dt;
    remaining.push(shot);
  });
  state.projectiles = remaining;
}

function update(dt) {
  if (state.paused || state.lives <= 0) return;
  updateSpawner(dt);
  updateEnemies(dt);
  updateTowers(dt);
  updateProjectiles(dt);
  updateHud();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= grid.cols; x += 1) {
    const px = grid.padding + x * grid.cell;
    ctx.beginPath();
    ctx.moveTo(px, grid.padding);
    ctx.lineTo(px, grid.padding + grid.rows * grid.cell);
    ctx.stroke();
  }
  for (let y = 0; y <= grid.rows; y += 1) {
    const py = grid.padding + y * grid.cell;
    ctx.beginPath();
    ctx.moveTo(grid.padding, py);
    ctx.lineTo(grid.padding + grid.cols * grid.cell, py);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawPath() {
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "rgba(40,180,220,0.2)";
  ctx.lineWidth = grid.cell * 0.72;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const s = gridToPixel(path[0].x, path[0].y);
  ctx.moveTo(s.x, s.y);
  path.slice(1).forEach((node) => {
    const p = gridToPixel(node.x, node.y);
    ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawBackground() {
  if (!state.background) return;
  ctx.drawImage(state.background, 0, 0, canvas.width, canvas.height);
}

function drawTowers() {
  state.towers.forEach((tower) => {
    const pos = gridToPixel(tower.cell.x, tower.cell.y);
    const sprite = state.assets.towers[tower.type];
    if (sprite) {
      const img = sprite.idle[0];
      const size = 56;
      ctx.drawImage(img, pos.x - size / 2, pos.y - size / 2, size, size);
      return;
    }
    const towerData = TOWERS[tower.type];
    const half = grid.cell * 0.34;
    ctx.save();
    ctx.shadowColor = towerData.color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = towerData.color;
    ctx.lineWidth = 2;
    ctx.fillStyle = towerData.color + "18";
    ctx.fillRect(pos.x - half, pos.y - half, half * 2, half * 2);
    ctx.strokeRect(pos.x - half, pos.y - half, half * 2, half * 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = towerData.color;
    ctx.font = `bold ${Math.floor(half * 0.95)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(towerData.name[0], pos.x, pos.y);
    ctx.restore();
  });
}

function drawEnemies() {
  state.enemies.forEach((enemy) => {
    ctx.save();
    ctx.shadowColor = enemy.color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const barW = 42, barH = 6;
    const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1);
    const hpColor = ratio > 0.6 ? "#d90429" : ratio > 0.3 ? "#8a8a8a" : "#2f2f2f";
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(enemy.x - barW / 2, enemy.y - 28, barW, barH);
    ctx.fillStyle = hpColor;
    ctx.fillRect(enemy.x - barW / 2, enemy.y - 28, barW * ratio, barH);
  });
}

function drawProjectiles() {
  state.projectiles.forEach((shot) => {
    ctx.save();
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = shot.color;
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawPlacementGhost() {
  if (!state.hoverCell) return;
  const cell = state.hoverCell;
  if (cell.x < 0 || cell.x >= grid.cols || cell.y < 0 || cell.y >= grid.rows) return;
  const pos = gridToPixel(cell.x, cell.y);
  const towerData = TOWERS[state.selectedTower];
  const valid = !isOnPath(cell) && !state.towers.some((t) => t.cell.x === cell.x && t.cell.y === cell.y);
  const color = valid ? "#d90429" : "#2f2f2f";
  ctx.save();
  // Cell highlight
  ctx.fillStyle = color + "18";
  ctx.fillRect(pos.x - grid.cell / 2, pos.y - grid.cell / 2, grid.cell, grid.cell);
  // Range ring (dashed)
  ctx.strokeStyle = color + "88";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, towerData.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawPath();
  drawGrid();
  drawPlacementGhost();
  drawTowers();
  drawEnemies();
  drawProjectiles();
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  state.hoverCell = pixelToGrid(x, y);
});

canvas.addEventListener("mouseleave", () => {
  state.hoverCell = null;
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const cell = pixelToGrid(x, y);
  placeTower(cell);
});

startWaveBtn.addEventListener("click", () => startWave());

pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? "Resume" : "Pause";
});

resetBtn.addEventListener("click", () => {
  resetGame();
});

towerList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tower]");
  if (!button) return;
  state.selectedTower = button.dataset.tower;
  buildTowerCards();
  updateTowerInspect();
});

await loadAssets();
resetGame();
buildTowerCards();
updateTowerInspect();

const loop = createFixedLoop(update, render);
loop.start();

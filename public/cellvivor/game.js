(() => {
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlayTitle");
  const overlayCopy = document.querySelector("#overlayCopy");
  const overlayButton = document.querySelector("#overlayButton");
  const pauseButton = document.querySelector("#pauseButton");
  const restartButton = document.querySelector("#restartButton");
  const levelNode = document.querySelector("#level");
  const timerNode = document.querySelector("#timer");
  const generationNode = document.querySelector("#generation");
  const lifePips = document.querySelector("#lifePips");

  const LIFE_STEP_SECONDS = 0.18;
  const LIFE_TIME_SECONDS = 20;
  const MAX_LIVES = 3;
  const MAX_INITIAL_DENSITY = 0.18;
  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  const state = {
    mode: "ready",
    width: 960,
    height: 540,
    dpr: 1,
    chasm: null,
    cellSize: 11,
    cols: 0,
    rows: 0,
    cells: new Uint8Array(0),
    nextCells: new Uint8Array(0),
    level: 1,
    generation: 0,
    lifeClock: 0,
    elapsed: 0,
    timeLeft: LIFE_TIME_SECONDS,
    lives: MAX_LIVES,
    invincible: 0,
    particles: [],
    stars: [],
    player: {
      x: 0,
      y: 0,
      r: 11,
      speed: 245,
      angle: 0,
    },
  };

  let seed = Math.floor(Date.now() % 2147483647);
  let lastFrame = performance.now();

  function random() {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(320, rect.width || 960);
    const height = Math.max(180, rect.height || 540);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);

    state.width = width;
    state.height = height;
    state.dpr = dpr;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const side = clamp(width * 0.14, 44, 136);
    const top = clamp(height * 0.14, 26, 76);
    const bottom = clamp(height * 0.11, 22, 60);
    const rawChasm = {
      x: side,
      y: top,
      w: width - side * 2,
      h: height - top - bottom,
    };

    const cellSize = clamp(
      Math.floor(Math.min(rawChasm.w / 58, rawChasm.h / 31)),
      5,
      14,
    );
    const cols = Math.max(24, Math.floor(rawChasm.w / cellSize));
    const rows = Math.max(16, Math.floor(rawChasm.h / cellSize));

    const layoutChanged = cols !== state.cols || rows !== state.rows;
    state.cellSize = cellSize;
    state.cols = cols;
    state.rows = rows;
    state.chasm = {
      x: Math.round((width - cols * cellSize) / 2),
      y: Math.round((height - rows * cellSize) / 2),
      w: cols * cellSize,
      h: rows * cellSize,
    };
    state.player.r = clamp(Math.min(width, height) * 0.023, 7, 12);
    state.player.speed = clamp(width * 0.28, 175, 275);

    if (layoutChanged || state.cells.length === 0) {
      seedLife();
      makeStars();
    }

    if (state.mode !== "playing") {
      placePlayer();
    } else {
      constrainPlayer();
    }
  }

  function makeStars() {
    const count = Math.round(clamp((state.width * state.height) / 5200, 60, 150));
    state.stars = Array.from({ length: count }, () => ({
      x: random(),
      y: random(),
      size: 0.6 + random() * 1.8,
      phase: random() * Math.PI * 2,
      speed: 0.5 + random() * 1.4,
    }));
  }

  function placePlayer() {
    state.player.x = Math.max(24, state.chasm.x * 0.45);
    state.player.y = state.height * 0.5;
    state.player.angle = 0;
    constrainPlayer();
  }

  function constrainPlayer() {
    const p = state.player;
    const shipExtent = p.r * 1.7 + 4;
    const laneTop = state.chasm.y + p.r + 2;
    const laneBottom = state.chasm.y + state.chasm.h - p.r - 2;

    p.x = clamp(p.x, shipExtent, state.width - shipExtent);
    p.y = clamp(p.y, laneTop, laneBottom);
  }

  function index(col, row) {
    return row * state.cols + col;
  }

  function clearEntryLanes(grid) {
    const gateHalfHeight = Math.max(3, Math.floor(state.rows * 0.13));
    const center = Math.floor(state.rows / 2);
    const leftGate = Math.max(4, Math.floor(state.cols * 0.10));
    const rightGateStart = state.cols - leftGate;

    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const inGate =
          Math.abs(row - center) <= gateHalfHeight &&
          (col < leftGate || col >= rightGateStart);
        if (inGate) {
          grid[index(col, row)] = 0;
        }
      }
    }
  }

  function setPattern(grid, originCol, originRow, pattern) {
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] !== "1") {
          continue;
        }
        const targetCol = originCol + col;
        const targetRow = originRow + row;
        if (
          targetCol >= 2 &&
          targetCol < state.cols - 2 &&
          targetRow >= 2 &&
          targetRow < state.rows - 2
        ) {
          grid[index(targetCol, targetRow)] = 1;
        }
      }
    }
  }

  function seedLife() {
    const total = state.cols * state.rows;
    state.cells = new Uint8Array(total);
    state.nextCells = new Uint8Array(total);
    state.generation = 0;
    state.lifeClock = 0;

    const levelIndex = state.level - 1;
    const density = clamp(0.055 + levelIndex * 0.014, 0.055, MAX_INITIAL_DENSITY);
    const centerDensity = clamp(0.045 + levelIndex * 0.006, 0.045, 0.09);

    const centerRow = state.rows / 2;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const centerBias = 1 - Math.min(0.55, Math.abs(row - centerRow) / state.rows);
        const edgeColumn = col < 5 || col > state.cols - 6;
        if (!edgeColumn && random() < density + centerBias * centerDensity) {
          state.cells[index(col, row)] = 1;
        }
      }
    }

    const patterns = [
      ["11", "11"],
      ["111"],
      ["011", "110"],
      ["0110", "1001", "1001", "0110"],
      ["010", "001", "111"],
      ["01110", "10001", "00001", "10010"],
    ];

    const basePatternCount = state.cols * state.rows / 320;
    const patternCount = Math.round(clamp(basePatternCount + levelIndex * 2.2, 5, 34));
    for (let i = 0; i < patternCount; i += 1) {
      const pattern = patterns[Math.floor(random() * patterns.length)];
      const col = Math.floor(clamp(random() * state.cols, 7, state.cols - 10));
      const row = Math.floor(clamp(random() * state.rows, 4, state.rows - 8));
      setPattern(state.cells, col, row, pattern);
    }

    clearEntryLanes(state.cells);
  }

  function countNeighbors(col, row) {
    let count = 0;
    for (let y = -1; y <= 1; y += 1) {
      for (let x = -1; x <= 1; x += 1) {
        if (x === 0 && y === 0) {
          continue;
        }
        const nextCol = (col + x + state.cols) % state.cols;
        const nextRow = (row + y + state.rows) % state.rows;
        count += state.cells[index(nextCol, nextRow)];
      }
    }
    return count;
  }

  function stepLife() {
    let liveCount = 0;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const neighbors = countNeighbors(col, row);
        const cellIndex = index(col, row);
        const alive = state.cells[cellIndex] === 1;
        const nextAlive = alive
          ? neighbors === 2 || neighbors === 3
          : neighbors === 3;
        state.nextCells[cellIndex] = nextAlive ? 1 : 0;
        if (nextAlive) {
          liveCount += 1;
        }
      }
    }

    const swap = state.cells;
    state.cells = state.nextCells;
    state.nextCells = swap;
    state.nextCells.fill(0);
    state.generation += 1;

    if (liveCount < Math.max(18, state.cols * state.rows * 0.025)) {
      injectLife();
    }
  }

  function injectLife() {
    const patterns = [
      ["010", "001", "111"],
      ["111"],
      ["011", "110"],
      ["11", "11"],
    ];
    const bursts = Math.max(2, Math.floor(state.cols / 16) + Math.floor((state.level - 1) / 3));
    for (let i = 0; i < bursts; i += 1) {
      const col = Math.floor(clamp(8 + random() * (state.cols - 16), 8, state.cols - 8));
      const row = Math.floor(clamp(3 + random() * (state.rows - 6), 3, state.rows - 6));
      setPattern(state.cells, col, row, patterns[Math.floor(random() * patterns.length)]);
    }
  }

  function startGame() {
    state.level = 1;
    state.lives = MAX_LIVES;
    startLevel();
  }

  function startLevel() {
    state.mode = "playing";
    state.elapsed = 0;
    state.timeLeft = LIFE_TIME_SECONDS;
    state.invincible = 1.3;
    state.particles = [];
    seedLife();
    placePlayer();
    updateOverlay();
    updateHud();
  }

  function togglePause() {
    if (state.mode === "playing") {
      state.mode = "paused";
    } else if (state.mode === "paused") {
      state.mode = "playing";
    }
    updateOverlay();
  }

  function primaryAction() {
    if (state.mode === "won") {
      state.level += 1;
      startLevel();
    } else if (state.mode === "ready" || state.mode === "gameover") {
      startGame();
    } else if (state.mode === "paused") {
      togglePause();
    }
  }

  function crash() {
    burst(state.player.x, state.player.y);
    state.lives -= 1;
    if (state.lives <= 0) {
      state.timeLeft = Math.max(0, state.timeLeft);
      state.mode = "gameover";
      updateOverlay();
      return;
    }
    state.timeLeft = LIFE_TIME_SECONDS;
    placePlayer();
    state.invincible = 1.8;
  }

  function win() {
    state.mode = "won";
    updateOverlay();
  }

  function circleRectOverlap(cx, cy, radius, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  function hitLiveCell() {
    if (state.invincible > 0) {
      return false;
    }
    const p = state.player;
    const chasm = state.chasm;
    if (
      p.x + p.r < chasm.x ||
      p.x - p.r > chasm.x + chasm.w ||
      p.y + p.r < chasm.y ||
      p.y - p.r > chasm.y + chasm.h
    ) {
      return false;
    }

    const minCol = clamp(Math.floor((p.x - p.r - chasm.x) / state.cellSize), 0, state.cols - 1);
    const maxCol = clamp(Math.floor((p.x + p.r - chasm.x) / state.cellSize), 0, state.cols - 1);
    const minRow = clamp(Math.floor((p.y - p.r - chasm.y) / state.cellSize), 0, state.rows - 1);
    const maxRow = clamp(Math.floor((p.y + p.r - chasm.y) / state.cellSize), 0, state.rows - 1);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (state.cells[index(col, row)] !== 1) {
          continue;
        }
        const rx = chasm.x + col * state.cellSize;
        const ry = chasm.y + row * state.cellSize;
        if (circleRectOverlap(p.x, p.y, p.r * 0.86, rx, ry, state.cellSize, state.cellSize)) {
          return true;
        }
      }
    }
    return false;
  }

  function update(dt) {
    if (state.mode !== "playing") {
      updateParticles(dt);
      return;
    }

    state.elapsed += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    state.invincible = Math.max(0, state.invincible - dt);
    state.lifeClock += dt;
    while (state.lifeClock >= LIFE_STEP_SECONDS) {
      state.lifeClock -= LIFE_STEP_SECONDS;
      stepLife();
    }

    const horizontal = Number(input.right) - Number(input.left);
    const vertical = Number(input.down) - Number(input.up);
    const length = Math.hypot(horizontal, vertical) || 1;
    const vx = horizontal / length;
    const vy = vertical / length;

    if (horizontal !== 0 || vertical !== 0) {
      state.player.angle = Math.atan2(vy * 0.7, 1 + Math.max(0, vx) * 0.55);
    } else {
      state.player.angle *= 0.9;
    }

    state.player.x += vx * state.player.speed * dt;
    state.player.y += vy * state.player.speed * dt;
    constrainPlayer();

    if (state.timeLeft <= 0) {
      crash();
    } else if (hitLiveCell()) {
      crash();
    } else if (state.player.x > state.width - Math.max(30, state.chasm.x * 0.34)) {
      win();
    }

    updateParticles(dt);
    updateHud();
  }

  function burst(x, y) {
    for (let i = 0; i < 34; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 55 + random() * 190;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + random() * 0.55,
        maxLife: 0.9,
        size: 1.5 + random() * 3.5,
      });
    }
  }

  function updateParticles(dt) {
    for (const particle of state.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function draw(now) {
    ctx.clearRect(0, 0, state.width, state.height);
    drawSpace(now);
    drawDocks();
    drawChasm();
    drawParticles();
    drawShip(now);
  }

  function drawSpace(now) {
    const bg = ctx.createLinearGradient(0, 0, state.width, state.height);
    bg.addColorStop(0, "#05070c");
    bg.addColorStop(0.55, "#09111c");
    bg.addColorStop(1, "#0b070d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, state.width, state.height);

    for (const star of state.stars) {
      const twinkle = 0.35 + Math.sin(now * 0.001 * star.speed + star.phase) * 0.25;
      ctx.globalAlpha = clamp(0.28 + twinkle, 0.2, 0.86);
      ctx.fillStyle = star.size > 1.8 ? "#ffc857" : "#d8f6ff";
      ctx.beginPath();
      ctx.arc(star.x * state.width, star.y * state.height, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDocks() {
    const chasm = state.chasm;
    const mid = state.height / 2;
    const leftWidth = Math.max(34, chasm.x - 14);
    const rightX = chasm.x + chasm.w + 14;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(86, 230, 255, 0.32)";
    ctx.fillStyle = "rgba(86, 230, 255, 0.06)";
    ctx.beginPath();
    ctx.moveTo(0, mid - 62);
    ctx.lineTo(leftWidth, mid - 34);
    ctx.lineTo(leftWidth, mid + 34);
    ctx.lineTo(0, mid + 62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(131, 255, 159, 0.42)";
    ctx.fillStyle = "rgba(131, 255, 159, 0.07)";
    ctx.beginPath();
    ctx.moveTo(state.width, mid - 66);
    ctx.lineTo(rightX, mid - 34);
    ctx.lineTo(rightX, mid + 34);
    ctx.lineTo(state.width, mid + 66);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawChasm() {
    const chasm = state.chasm;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    ctx.fillRect(chasm.x, chasm.y, chasm.w, chasm.h);

    ctx.strokeStyle = "rgba(86, 230, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 0; col <= state.cols; col += 1) {
      const x = chasm.x + col * state.cellSize;
      ctx.moveTo(x, chasm.y);
      ctx.lineTo(x, chasm.y + chasm.h);
    }
    for (let row = 0; row <= state.rows; row += 1) {
      const y = chasm.y + row * state.cellSize;
      ctx.moveTo(chasm.x, y);
      ctx.lineTo(chasm.x + chasm.w, y);
    }
    ctx.stroke();

    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (state.cells[index(col, row)] !== 1) {
          continue;
        }
        const x = chasm.x + col * state.cellSize;
        const y = chasm.y + row * state.cellSize;
        const inset = Math.max(1, state.cellSize * 0.15);
        const pulse = 0.65 + Math.sin((state.generation + col * 0.7 + row * 0.35) * 0.7) * 0.20;

        ctx.globalAlpha = 0.18 * pulse;
        ctx.fillStyle = "#83ff9f";
        ctx.fillRect(x - 1, y - 1, state.cellSize + 2, state.cellSize + 2);

        ctx.globalAlpha = 0.78 + pulse * 0.18;
        ctx.fillStyle = col % 7 === 0 ? "#56e6ff" : "#83ff9f";
        ctx.fillRect(
          x + inset,
          y + inset,
          state.cellSize - inset * 2,
          state.cellSize - inset * 2,
        );
      }
    }
    ctx.globalAlpha = 1;

    const border = ctx.createLinearGradient(chasm.x, chasm.y, chasm.x + chasm.w, chasm.y);
    border.addColorStop(0, "#56e6ff");
    border.addColorStop(0.5, "#ffc857");
    border.addColorStop(1, "#83ff9f");
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    ctx.strokeRect(chasm.x - 1, chasm.y - 1, chasm.w + 2, chasm.h + 2);

    ctx.strokeStyle = "rgba(255, 111, 97, 0.42)";
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 1;
    ctx.strokeRect(chasm.x + 7, chasm.y + 7, chasm.w - 14, chasm.h - 14);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawShip(now) {
    if (state.mode === "gameover") {
      return;
    }
    const p = state.player;
    if (state.invincible > 0 && Math.floor(now / 90) % 2 === 0) {
      return;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    const flame = input.left || input.right || input.up || input.down;
    if (flame && state.mode === "playing") {
      ctx.fillStyle = "rgba(255, 200, 87, 0.74)";
      ctx.beginPath();
      ctx.moveTo(-p.r * 1.1, 0);
      ctx.lineTo(-p.r * 2.1, -p.r * 0.42);
      ctx.lineTo(-p.r * 1.7, 0);
      ctx.lineTo(-p.r * 2.1, p.r * 0.42);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#edf7ff";
    ctx.strokeStyle = "#56e6ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.r * 1.55, 0);
    ctx.lineTo(-p.r * 0.95, -p.r * 0.88);
    ctx.lineTo(-p.r * 0.48, 0);
    ctx.lineTo(-p.r * 0.95, p.r * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0a1521";
    ctx.beginPath();
    ctx.ellipse(p.r * 0.36, 0, p.r * 0.34, p.r * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = alpha > 0.45 ? "#ffc857" : "#ff6f61";
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    levelNode.textContent = `L${state.level}`;
    timerNode.textContent = state.timeLeft.toFixed(1).padStart(4, "0");
    timerNode.parentElement.classList.toggle(
      "danger",
      state.mode === "playing" && state.timeLeft <= 5,
    );
    generationNode.textContent = String(state.generation).padStart(3, "0");

    lifePips.innerHTML = "";
    for (let i = 0; i < MAX_LIVES; i += 1) {
      const pip = document.createElement("span");
      pip.className = i < state.lives ? "pip" : "pip empty";
      lifePips.append(pip);
    }
  }

  function updateOverlay() {
    const config = {
      ready: ["CELLVIVOR", "Level 1 waits.", "Launch"],
      playing: null,
      paused: ["PAUSED", "The colony is waiting.", "Resume"],
      won: ["ESCAPED", `Level ${state.level} cleared in ${state.elapsed.toFixed(1)} seconds`, "Next Level"],
      gameover: ["SHIP LOST", `Reached level ${state.level}`, "Retry"],
    }[state.mode];

    pauseButton.textContent = state.mode === "paused" ? "Resume" : "Pause";
    pauseButton.disabled = state.mode === "ready" || state.mode === "gameover" || state.mode === "won";

    if (!config) {
      overlay.classList.add("hidden");
      return;
    }

    overlayTitle.textContent = config[0];
    overlayCopy.textContent = config[1];
    overlayButton.textContent = config[2];
    overlay.classList.remove("hidden");
  }

  function setInput(direction, value) {
    if (direction in input) {
      input[direction] = value;
    }
  }

  function onKeyDown(event) {
    const keyMap = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };

    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      primaryAction();
      return;
    }
    if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (keyMap[event.key]) {
      event.preventDefault();
      setInput(keyMap[event.key], true);
    }
  }

  function onKeyUp(event) {
    const keyMap = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };
    if (keyMap[event.key]) {
      event.preventDefault();
      setInput(keyMap[event.key], false);
    }
  }

  function bindTouchControls() {
    for (const button of document.querySelectorAll("[data-touch]")) {
      const direction = button.dataset.touch;
      const release = (event) => {
        event.preventDefault();
        setInput(direction, false);
        button.releasePointerCapture?.(event.pointerId);
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        setInput(direction, true);
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    update(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  overlayButton.addEventListener("click", primaryAction);
  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", startGame);
  bindTouchControls();
  resize();
  updateHud();
  updateOverlay();
  requestAnimationFrame(frame);
})();

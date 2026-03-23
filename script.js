// Variables to control game state
let gameRunning = false; // Keeps track of whether game is active or not
let dropMaker; // Will store our timer that creates drops regularly
let countdownTimer; // 30s countdown; ends game at 0
let collisionRafId = null;
let catchPlatform = null;
let score = 0;
let catchStreak = 0;
let gameStartMs = 0;

const HIGH_SCORE_STORAGE_KEY = "waterDropHighScores";
const MAX_HIGH_SCORES = 10;

const gameContainer = document.getElementById("game-container");

const WIN_SCORE = 20;
const GAME_DURATION_SEC = 30;
/** Extra points the first time each “fill” reaches a full can (score crosses up to WIN_SCORE). */
const FULL_CAN_BONUS = 5;

const BAD_DROP_CHANCE = 0.28;
const OBSTACLE_DROP_CHANCE = 0.18;
const OBSTACLE_SCORE_PENALTY = 3;

/** Fall animation: starts at 4s, speeds up as elapsed time increases (capped). */
const BASE_FALL_DURATION_SEC = 4;
const MIN_FALL_DURATION_SEC = 0.65;
const FALL_DURATION_RAMP_PER_SEC = 0.07;

function getFallDurationSec(elapsedSec) {
  return Math.max(
    MIN_FALL_DURATION_SEC,
    BASE_FALL_DURATION_SEC - elapsedSec * FALL_DURATION_RAMP_PER_SEC
  );
}

function formatElapsed(totalSec) {
  const s = Math.floor(Math.max(0, totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function updateCountdownDisplay() {
  if (!gameRunning || !gameStartMs) return;
  const elapsed = (Date.now() - gameStartMs) / 1000;
  const remaining = Math.max(0, GAME_DURATION_SEC - elapsed);
  const displaySec = remaining <= 0 ? 0 : Math.ceil(remaining);
  document.getElementById("time").textContent = formatElapsed(displaySec);
  if (remaining <= 0) {
    endGame({ timeUp: true });
  }
}

function updateStreakDisplay() {
  const el = document.getElementById("streak");
  if (el) el.textContent = catchStreak;
}

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHighScores(entries) {
  try {
    localStorage.setItem(HIGH_SCORE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota / private mode */
  }
}

function recordHighScore(finalScore) {
  if (typeof finalScore !== "number" || !Number.isFinite(finalScore) || finalScore <= 0) {
    return;
  }
  const list = loadHighScores();
  list.push({ score: Math.round(finalScore), at: Date.now() });
  list.sort((a, b) => b.score - a.score);
  saveHighScores(list.slice(0, MAX_HIGH_SCORES));
  renderHighScores();
}

function renderHighScores() {
  const listEl = document.getElementById("highscores-list");
  const emptyEl = document.getElementById("highscores-empty");
  if (!listEl) return;
  const entries = loadHighScores();
  listEl.innerHTML = "";
  if (entries.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  entries.forEach((row) => {
    const li = document.createElement("li");
    const when =
      row.at != null ? formatter.format(new Date(row.at)) : "—";
    li.textContent = `${row.score} pts — ${when}`;
    listEl.appendChild(li);
  });
}

function refreshScoreHud() {
  document.getElementById("score").textContent = score;
  updateStreakDisplay();
  updateWellWaterLevel();
}

function onGoodWaterCaught() {
  const prev = score;
  score += 1;
  applyFullCanBonusIfEarned(prev);
  catchStreak += 1;
  refreshScoreHud();
}

function onObstacleCaught(drop) {
  score = Math.max(0, score - OBSTACLE_SCORE_PENALTY);
  catchStreak = 0;
  refreshScoreHud();
  drop.remove();
}

const winningMessages = [
  "Amazing! You're a water hero!",
  "Outstanding — clean water champion!",
  "You did it! That's how we change lives.",
  "Fantastic catch! Every drop counts.",
  "Incredible! You're making a real splash!",
];

const losingMessages = [
  "Try again — you've got this!",
  "So close! One more round?",
  "Keep going — practice makes perfect!",
  "Not quite 20 — give it another shot!",
  "Every try helps you improve. Play again!",
];

const contaminatedMessages = [
  "Contaminated drop — game over!",
  "That water wasn't safe. Try again!",
  "You caught polluted water. Stay careful next time!",
  "Brown means unsafe — round over.",
  "Oops! Dirty water ended the run.",
];

// Wait for button click to start the game
document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("reset-btn").addEventListener("click", resetGame);

gameContainer.addEventListener("pointermove", (e) => {
  if (!gameRunning || !catchPlatform) return;
  const rect = gameContainer.getBoundingClientRect();
  const w = catchPlatform.offsetWidth;
  let x = e.clientX - rect.left - w / 2;
  x = Math.max(0, Math.min(x, gameContainer.clientWidth - w));
  catchPlatform.style.left = `${x}px`;
});

function getOrCreateMessageEl() {
  let el = document.getElementById("game-message");
  if (!el) {
    el = document.createElement("p");
    el.id = "game-message";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const wrapper = document.querySelector(".game-wrapper");
    const container = document.getElementById("game-container");
    wrapper.insertBefore(el, container);
  }
  return el;
}

function hideEndMessage() {
  const el = document.getElementById("game-message");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

const CONFETTI_COLORS = [
  "#FFC907",
  "#2E9DF7",
  "#4FCB53",
  "#159A48",
  "#FF902A",
  "#F16061",
];

function celebrateWin() {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  const count = 72;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.left = `${Math.random() * 100}%`;
    p.style.backgroundColor =
      CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    p.style.animationDuration = `${2 + Math.random() * 2}s`;
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    const drift = (Math.random() - 0.5) * 200;
    p.style.setProperty("--drift", `${drift}px`);
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 4500);
}

function showEndMessage(text, isWin) {
  const el = getOrCreateMessageEl();
  el.textContent = text;
  el.hidden = false;
  el.style.textAlign = "center";
  el.style.fontSize = "1.25rem";
  el.style.margin = "0.5rem 0";
  el.style.fontWeight = "bold";
  el.style.color = isWin ? "#159A48" : "#FF902A";
}

function rectsOverlap(a, b) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

function updateWellWaterLevel() {
  if (!catchPlatform) return;
  const waterEl = catchPlatform.querySelector(".well-water");
  if (!waterEl) return;
  const pct = Math.max(0, Math.min(100, (score / WIN_SCORE) * 100));
  waterEl.style.height = `${pct}%`;
}

function applyFullCanBonusIfEarned(prevScore) {
  if (prevScore < WIN_SCORE && score >= WIN_SCORE) {
    score += FULL_CAN_BONUS;
  }
}

function collisionLoop() {
  if (!gameRunning) {
    collisionRafId = null;
    return;
  }
  if (catchPlatform) {
    const pr = catchPlatform.getBoundingClientRect();
    const drops = [...gameContainer.querySelectorAll(".water-drop")];
    const overlapping = drops.filter((drop) =>
      rectsOverlap(drop.getBoundingClientRect(), pr)
    );
    if (overlapping.some((drop) => drop.classList.contains("bad-drop"))) {
      endGame({ contaminated: true });
      return;
    }
    overlapping.forEach((drop) => {
      if (drop.classList.contains("obstacle-drop")) {
        onObstacleCaught(drop);
        return;
      }
      onGoodWaterCaught();
      drop.remove();
    });
  }
  collisionRafId = requestAnimationFrame(collisionLoop);
}

function endGame(options = {}) {
  if (!gameRunning) return;
  recordHighScore(score);

  if (dropMaker != null) {
    clearInterval(dropMaker);
    dropMaker = null;
  }
  if (countdownTimer != null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (collisionRafId != null) {
    cancelAnimationFrame(collisionRafId);
    collisionRafId = null;
  }

  gameRunning = false;
  catchPlatform = null;

  gameContainer.classList.remove("game-active");
  gameContainer.innerHTML = "";

  const contaminated = options.contaminated === true;
  const won = !contaminated && score >= WIN_SCORE;
  let message;
  if (contaminated) {
    const pool = contaminatedMessages;
    message = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const pool = won ? winningMessages : losingMessages;
    message = pool[Math.floor(Math.random() * pool.length)];
  }
  if (won) {
    celebrateWin();
  }
  showEndMessage(message, won);
}

function resetGame() {
  const hadActiveRun = gameRunning;
  const scoreAtReset = score;

  if (dropMaker != null) {
    clearInterval(dropMaker);
    dropMaker = null;
  }
  if (countdownTimer != null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (collisionRafId != null) {
    cancelAnimationFrame(collisionRafId);
    collisionRafId = null;
  }

  gameRunning = false;
  catchPlatform = null;
  score = 0;
  catchStreak = 0;
  gameStartMs = 0;

  if (hadActiveRun) {
    recordHighScore(scoreAtReset);
  }

  document.getElementById("score").textContent = score;
  updateStreakDisplay();
  document.getElementById("time").textContent = formatElapsed(GAME_DURATION_SEC);
  gameContainer.classList.remove("game-active");
  gameContainer.innerHTML = "";
  hideEndMessage();
}

function startGame() {
  // Prevent multiple games from running at once
  if (gameRunning) return;

  if (dropMaker != null) clearInterval(dropMaker);
  if (countdownTimer != null) clearInterval(countdownTimer);

  gameRunning = true;
  score = 0;
  catchStreak = 0;
  gameStartMs = Date.now();

  document.getElementById("score").textContent = score;
  updateStreakDisplay();
  document.getElementById("time").textContent = formatElapsed(GAME_DURATION_SEC);
  hideEndMessage();

  gameContainer.classList.add("game-active");
  gameContainer.innerHTML = "";

  catchPlatform = document.createElement("div");
  catchPlatform.className = "water-can-catcher";
  catchPlatform.setAttribute("aria-hidden", "true");
  const fillClip = document.createElement("div");
  fillClip.className = "can-fill-clip";
  const water = document.createElement("div");
  water.className = "well-water";
  fillClip.appendChild(water);
  const canImg = document.createElement("img");
  canImg.className = "water-can-sprite";
  canImg.src = "img/water-can.png";
  canImg.alt = "";
  catchPlatform.appendChild(canImg);
  catchPlatform.appendChild(fillClip);
  gameContainer.appendChild(catchPlatform);
  const pw = catchPlatform.offsetWidth;
  catchPlatform.style.left = `${(gameContainer.clientWidth - pw) / 2}px`;
  updateWellWaterLevel();

  collisionRafId = requestAnimationFrame(collisionLoop);

  // Create new drops every second (1000 milliseconds)
  dropMaker = setInterval(createDrop, 1000);

  countdownTimer = setInterval(updateCountdownDisplay, 100);
}

function createDrop() {
  if (!gameRunning) return;

  // Create a new div element that will be our water drop
  const drop = document.createElement("div");
  drop.className = "water-drop";
  const roll = Math.random();
  if (roll < BAD_DROP_CHANCE) {
    drop.classList.add("bad-drop");
  } else if (roll < BAD_DROP_CHANCE + OBSTACLE_DROP_CHANCE) {
    drop.classList.add("obstacle-drop");
  }

  // Make drops different sizes for visual variety
  const initialSize = 60;
  const sizeMultiplier = Math.random() * 0.8 + 0.5;
  const size = initialSize * sizeMultiplier;
  drop.style.width = drop.style.height = `${size}px`;

  // Position the drop randomly across the game width
  // Subtract 60 pixels to keep drops fully inside the container
  const gameWidth = document.getElementById("game-container").offsetWidth;
  const xPosition = Math.random() * (gameWidth - 60);
  drop.style.left = xPosition + "px";

  const elapsedSec = (Date.now() - gameStartMs) / 1000;
  const fallSec = getFallDurationSec(elapsedSec);
  drop.style.animationDuration = `${fallSec}s`;

  drop.addEventListener("click", () => {
    if (!gameRunning) return;
    if (drop.classList.contains("bad-drop")) {
      endGame({ contaminated: true });
      return;
    }
    if (drop.classList.contains("obstacle-drop")) {
      onObstacleCaught(drop);
      return;
    }
    onGoodWaterCaught();
    drop.remove();
  });

  // Add the new drop to the game screen
  document.getElementById("game-container").appendChild(drop);

  drop.addEventListener("animationend", () => {
    if (gameRunning) {
      const isGood =
        !drop.classList.contains("bad-drop") &&
        !drop.classList.contains("obstacle-drop");
      if (isGood) {
        catchStreak = 0;
        updateStreakDisplay();
      }
    }
    drop.remove();
  });
}

renderHighScores();

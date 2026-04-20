const TOKEN_KEY = "minimaths_user_token";
const SIZE = 5;
const MAX_CHANCES = 5;

const COLORS = {
  blue: "#8db6d5",
  red: "#e58f7b",
  yellow: "#f6dd8a",
  green: "#8fc8a6",
  orange: "#f0a423",
  gray: "#d9d4cc",
  empty: "#f7f2e9",
};

const TILES = {
  bomb: { color: COLORS.blue, className: "bomb", icon: "bomb", label: "炸弹" },
  bombYellow: { color: COLORS.yellow, className: "bomb", icon: "bomb", label: "炸弹" },
  coin: { color: COLORS.gray, className: "coin", icon: "coin", label: "硬币" },
  coinOrange: { color: COLORS.orange, className: "coin", icon: "coin", label: "硬币" },
  trap: { color: COLORS.gray, className: "trap", icon: "trap", label: "陷阱" },
  diamond: { color: COLORS.gray, className: "diamond", icon: "diamond", label: "钻石" },
};

const PIECES = [
  {
    id: "single-bomb",
    name: "单格炸弹",
    cells: [{ dr: 0, dc: 0, tile: "bomb" }],
    note: "蓝色炸弹",
  },
  {
    id: "l-bomb",
    name: "L 型三格",
    cells: [
      { dr: 0, dc: 0, tile: "coin" },
      { dr: 1, dc: 0, tile: "bomb" },
      { dr: 1, dc: 1, tile: "trap" },
    ],
    note: "转角蓝雷，另两格为灰币/灰陷阱",
  },
  {
    id: "line-bomb",
    name: "横排三格",
    cells: [
      { dr: 0, dc: 0, tile: "bombYellow" },
      { dr: 0, dc: 1, tile: "coin" },
      { dr: 0, dc: 2, tile: "trap" },
    ],
    note: "黄雷 + 灰币 + 灰陷阱",
  },
  {
    id: "treasure-2x2",
    name: "宝藏 2x2",
    cells: [
      { dr: 0, dc: 0, tile: "coinOrange" },
      { dr: 0, dc: 1, tile: "coin" },
      { dr: 1, dc: 0, tile: "coin" },
      { dr: 1, dc: 1, tile: "diamond" },
    ],
    note: "左上橙币，右下灰钻",
  },
];

const PIECE_ORDER = PIECES.map((piece) => piece.id);
const PIECE_BY_ID = new Map(PIECES.map((piece) => [piece.id, piece]));
const ROTATION_VALUES = [0, 90, 180, 270];
const PIECE_IMAGE_BY_KEY = new Map();

const tabBuildBtn = document.getElementById("tab-build");
const tabHuntBtn = document.getElementById("tab-hunt");
const buildSection = document.getElementById("build-section");
const huntSection = document.getElementById("hunt-section");

const buildBoardEl = document.getElementById("build-board");
const pieceListEl = document.getElementById("piece-list");
const buildStatusEl = document.getElementById("build-status");
const saveMapBtn = document.getElementById("save-map-btn");
const clearBuildBtn = document.getElementById("clear-build-btn");
const publishMapBtn = document.getElementById("publish-map-btn");
const myMapsBtn = document.getElementById("my-maps-btn");
const myMapsModal = document.getElementById("my-maps-modal");
const myMapsCloseBtn = document.getElementById("my-maps-close-btn");
const myMapsListEl = document.getElementById("my-maps-list");

const huntBoardEl = document.getElementById("hunt-board");
const huntStatusEl = document.getElementById("hunt-status");
const huntStateEl = document.getElementById("hunt-state");
const chancesLeftEl = document.getElementById("chances-left");
const huntScoreEl = document.getElementById("hunt-score");
const huntUuidTextEl = document.getElementById("hunt-uuid-text");
const huntUuidEditBtn = document.getElementById("hunt-uuid-edit-btn");
const huntUuidCancelBtn = document.getElementById("hunt-uuid-cancel-btn");
const huntUuidEditInputEl = document.getElementById("hunt-uuid-edit-input");
const huntHistoryModal = document.getElementById("hunt-history-modal");
const huntHistoryListEl = document.getElementById("hunt-history-list");
const huntHistoryBtn = document.getElementById("my-hunt-history-btn");
const huntHistoryCloseBtn = document.getElementById("hunt-history-close-btn");
const reloadHuntBtn = document.getElementById("reload-hunt-btn");
const restartHuntBtn = document.getElementById("restart-hunt-btn");
const rotateLockEl = document.getElementById("rotate-lock");
const canBuildInteractions = Boolean(buildBoardEl && saveMapBtn && clearBuildBtn);

let activeMode = "build";
let placements = {};
let pieceRotations = Object.fromEntries(PIECE_ORDER.map((pieceId) => [pieceId, 0]));
let selectedPieceId = "";
let savedMap = null;
let draggingPieceId = "";
let suppressClickUntil = 0;
const touchDragState = {
  pieceId: "",
  active: false,
  timer: null,
  startX: 0,
  startY: 0,
};

let huntCells = [];
let huntGameOver = false;
let chancesLeft = MAX_CHANCES;
let huntScore = 0;
let currentHuntUuid = "";
let huntSubmitted = false;
let huntAlreadyPlayed = false;
let huntUuidEditing = false;
const HUNT_RANDOM_COLORS = [COLORS.yellow, COLORS.red, COLORS.green, COLORS.blue, COLORS.orange];
const isMobileLike = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") || window.innerWidth <= 1024;

function iconMarkup(iconType, x, y, size) {
  const unit = size / 24;
  const tx = Number(x.toFixed(2));
  const ty = Number(y.toFixed(2));
  const s = Number(unit.toFixed(4));
  const tr = `translate(${tx} ${ty}) scale(${s})`;

  if (iconType === "bomb") {
    return (
      `<g transform="${tr}">` +
      `<path d="M12 4 C15 2, 18 2, 19 5 C16 5, 14 7, 13 10" fill="none" stroke="#7a4f28" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="19.5" cy="5" r="2.1" fill="#f6a82f"/>` +
      `<circle cx="19.5" cy="5" r="1.1" fill="#ffd86a"/>` +
      `<circle cx="11.5" cy="14.5" r="6.8" fill="#2f3744"/>` +
      `<circle cx="8.7" cy="11.7" r="1.9" fill="#556071" opacity="0.9"/>` +
      `</g>`
    );
  }
  if (iconType === "coin") {
    return (
      `<g transform="${tr}">` +
      `<circle cx="12" cy="12" r="8" fill="#f2c54f" stroke="#9b6c11" stroke-width="1.6"/>` +
      `<circle cx="12" cy="12" r="5.2" fill="#f8de86" stroke="#c39124" stroke-width="1.1"/>` +
      `<path d="M12 8.5 L13.2 11 L16 11.3 L13.9 13.1 L14.5 15.8 L12 14.4 L9.5 15.8 L10.1 13.1 L8 11.3 L10.8 11 Z" fill="#ba7a08"/>` +
      `</g>`
    );
  }
  if (iconType === "trap") {
    return (
      `<g transform="${tr}">` +
      `<rect x="4.2" y="14.2" width="15.6" height="4.2" rx="1.2" fill="#70533f"/>` +
      `<path d="M6 14.2 L8.1 8.7 L10.2 14.2 Z M9.9 14.2 L12 8.1 L14.1 14.2 Z M13.8 14.2 L15.9 8.7 L18 14.2 Z" fill="#8b6750"/>` +
      `</g>`
    );
  }
  if (iconType === "diamond") {
    return (
      `<g transform="${tr}">` +
      `<path d="M12 4.6 L18.4 10.4 L12 19.4 L5.6 10.4 Z" fill="#58c7f2" stroke="#1c77a3" stroke-width="1.3"/>` +
      `<path d="M12 4.6 L15.2 10.4 L12 19.4 L8.8 10.4 Z" fill="#84ddff" opacity="0.9"/>` +
      `<path d="M8.6 10.4 L12 10.4 L12 6.2 Z M12 10.4 L15.4 10.4 L12 6.2 Z" fill="#c8f1ff" opacity="0.95"/>` +
      `</g>`
    );
  }
  if (iconType === "question") {
    return (
      `<g transform="${tr}">` +
      `<circle cx="12" cy="12" r="9" fill="#ffffff" stroke="#7d2ea8" stroke-width="1.4"/>` +
      `<path d="M9.1 9.2 C9.4 7.3 10.9 6.2 12.8 6.2 C14.8 6.2 16.2 7.4 16.2 9.1 C16.2 10.3 15.6 11.2 14.3 12 L13.3 12.6" fill="none" stroke="#7d2ea8" stroke-width="1.8" stroke-linecap="round"/>` +
      `<circle cx="12.1" cy="16.8" r="1.1" fill="#7d2ea8"/>` +
      `</g>`
    );
  }
  if (iconType === "safe") {
    return (
      `<g transform="${tr}">` +
      `<path d="M12 3.8 L18.2 6.5 V11.6 C18.2 15.4 15.7 18.5 12 19.8 C8.3 18.5 5.8 15.4 5.8 11.6 V6.5 Z" fill="#e8fff0" stroke="#238a4a" stroke-width="1.4"/>` +
      `<path d="M8.8 11.8 L11 14 L15.4 9.6" fill="none" stroke="#238a4a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</g>`
    );
  }
  return "";
}

function buildIconDataUrl(iconType) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    iconMarkup(iconType, 0, 0, 24) +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TILE_ICON_DATA = {
  bomb: buildIconDataUrl("bomb"),
  coin: buildIconDataUrl("coin"),
  trap: buildIconDataUrl("trap"),
  diamond: buildIconDataUrl("diamond"),
  question: buildIconDataUrl("question"),
  safe: buildIconDataUrl("safe"),
};

function createTileIconElement(tile, className = "cell-icon") {
  const img = document.createElement("img");
  img.className = className;
  img.src = TILE_ICON_DATA[tile.icon] || "";
  img.alt = tile.label || "图标";
  img.draggable = false;
  return img;
}

function createHintIconElement(kind) {
  const img = document.createElement("img");
  img.className = "hint-icon";
  img.src = TILE_ICON_DATA[kind] || "";
  img.alt = kind === "question" ? "附近有东西" : "附近安全";
  img.draggable = false;
  return img;
}

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isInteger(n)) return 0;
  const mod = ((n % 360) + 360) % 360;
  return ROTATION_VALUES.includes(mod) ? mod : 0;
}

function rotateCellsOnce(cells) {
  return cells.map((cell) => ({
    dr: cell.dc,
    dc: -cell.dr,
    tile: cell.tile,
  }));
}

function normalizeCells(cells) {
  const minRow = Math.min(...cells.map((cell) => cell.dr));
  const minCol = Math.min(...cells.map((cell) => cell.dc));
  return cells.map((cell) => ({
    dr: cell.dr - minRow,
    dc: cell.dc - minCol,
    tile: cell.tile,
  }));
}

function getPieceCellsByRotation(pieceId, rotation = 0) {
  const piece = PIECE_BY_ID.get(pieceId);
  if (!piece) return [];
  let cells = piece.cells.map((cell) => ({ ...cell }));
  const steps = normalizeRotation(rotation) / 90;
  for (let i = 0; i < steps; i += 1) {
    cells = rotateCellsOnce(cells);
  }
  return normalizeCells(cells);
}

function buildPieceImageData(piece, rotation = 0) {
  const cells = getPieceCellsByRotation(piece.id, rotation);
  const rows = cells.map((cell) => cell.dr);
  const cols = cells.map((cell) => cell.dc);
  const minRow = Math.min(...rows);
  const minCol = Math.min(...cols);
  const maxRow = Math.max(...rows);
  const maxCol = Math.max(...cols);
  const cellSize = 58;
  const pad = 8;
  const width = (maxCol - minCol + 1) * cellSize + pad * 2;
  const height = (maxRow - minRow + 1) * cellSize + pad * 2;

  const rects = cells
    .map((cell) => {
      const tile = TILES[cell.tile];
      const x = pad + (cell.dc - minCol) * cellSize;
      const y = pad + (cell.dr - minRow) * cellSize;
      const iconX = x + (cellSize - 44) / 2;
      const iconY = y + (cellSize - 44) / 2;
      return (
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="8" ` +
        `fill="${tile.color}" stroke="rgba(0,0,0,0.2)"/>` +
        iconMarkup(tile.icon, iconX, iconY, 44)
      );
    })
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    rects +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getPiecePreviewImage(pieceId, rotation) {
  const key = `${pieceId}:${normalizeRotation(rotation)}`;
  if (!PIECE_IMAGE_BY_KEY.has(key)) {
    const piece = PIECE_BY_ID.get(pieceId);
    if (!piece) return "";
    PIECE_IMAGE_BY_KEY.set(key, buildPieceImageData(piece, rotation));
  }
  return PIECE_IMAGE_BY_KEY.get(key) || "";
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setBuildStatus(text, type = "") {
  if (!buildStatusEl) return;
  buildStatusEl.textContent = text || "";
  buildStatusEl.classList.remove("success", "error");
  if (type) buildStatusEl.classList.add(type);
}

function applyLandscapeRequirement() {
  if (!isMobileLike) {
    document.body.classList.remove("mobile-landscape-required");
    if (rotateLockEl) rotateLockEl.style.display = "none";
    return;
  }
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  document.body.classList.toggle("mobile-landscape-required", isPortrait);
}

async function tryLockLandscape() {
  if (!isMobileLike) return;
  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Some browsers require fullscreen/user gesture for lock; fallback uses CSS overlay.
  }
}

function setHuntStatus(text) {
  if (huntStatusEl) huntStatusEl.textContent = text || "";
}

function setHuntState(text) {
  if (huntStateEl) huntStateEl.textContent = text || "进行中";
}

function updateChances() {
  if (chancesLeftEl) chancesLeftEl.textContent = String(chancesLeft);
}

function updateHuntScore() {
  if (huntScoreEl) huntScoreEl.textContent = String(huntScore);
}

function updateHuntUuidText() {
  if (huntUuidTextEl) huntUuidTextEl.textContent = currentHuntUuid || "未指定";
}

function setHuntUuidEditMode(editing) {
  huntUuidEditing = Boolean(editing);
  if (huntUuidEditBtn) {
    huntUuidEditBtn.classList.toggle("confirm", huntUuidEditing);
    huntUuidEditBtn.textContent = huntUuidEditing ? "✓" : "✏";
    huntUuidEditBtn.setAttribute("aria-label", huntUuidEditing ? "确认UUID" : "编辑UUID");
  }
  if (huntUuidCancelBtn) {
    huntUuidCancelBtn.style.display = huntUuidEditing ? "inline-flex" : "none";
  }
  if (huntUuidTextEl) {
    huntUuidTextEl.style.display = huntUuidEditing ? "none" : "";
  }
  if (huntUuidEditInputEl) {
    huntUuidEditInputEl.style.display = huntUuidEditing ? "" : "none";
    if (huntUuidEditing) {
      huntUuidEditInputEl.value = currentHuntUuid || "";
      huntUuidEditInputEl.focus();
      huntUuidEditInputEl.select();
    }
  }
}

async function confirmUuidEdit() {
  if (!huntUuidEditInputEl) return;
  const ok = await loadPublicMapByUuid(huntUuidEditInputEl.value || "");
  if (ok) {
    setHuntUuidEditMode(false);
  }
}

function makeBoardCells() {
  const cells = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      cells.push({
        id: row * SIZE + col,
        row,
        col,
        tile: null,
        pieceId: null,
        maskColor: COLORS.empty,
        hintMark: null,
        revealed: false,
      });
    }
  }
  return cells;
}

function buildMaskColorsForCells(cells) {
  const quotaByColor = new Map(HUNT_RANDOM_COLORS.map((color) => [color, 5]));
  const flexibleCells = [];
  const result = new Array(SIZE * SIZE).fill(COLORS.empty);

  for (const cell of cells) {
    const tile = cell.tile ? TILES[cell.tile] : null;
    if (tile && quotaByColor.has(tile.color) && tile.color !== COLORS.gray) {
      result[cell.id] = tile.color;
      const left = (quotaByColor.get(tile.color) || 0) - 1;
      quotaByColor.set(tile.color, left);
    } else {
      flexibleCells.push(cell);
    }
  }

  const pool = [];
  for (const color of HUNT_RANDOM_COLORS) {
    const remain = quotaByColor.get(color) || 0;
    if (remain < 0) {
      throw new Error(`Invalid hunt color quota for ${color}`);
    }
    for (let i = 0; i < remain; i += 1) {
      pool.push(color);
    }
  }

  if (pool.length !== flexibleCells.length) {
    throw new Error("Hunt color pool size mismatch");
  }

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let i = 0; i < flexibleCells.length; i += 1) {
    result[flexibleCells[i].id] = pool[i];
  }
  return result;
}

function maskColorsValid(maskColors) {
  if (!Array.isArray(maskColors) || maskColors.length !== SIZE * SIZE) return false;
  const counts = new Map(HUNT_RANDOM_COLORS.map((color) => [color, 0]));
  for (const color of maskColors) {
    if (!counts.has(color)) return false;
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return HUNT_RANDOM_COLORS.every((color) => counts.get(color) === 5);
}

function applySavedMaskColors(cells, maskColors) {
  if (!maskColorsValid(maskColors)) return false;
  cells.forEach((cell) => {
    cell.maskColor = maskColors[cell.id];
  });
  return true;
}

function getFootprintCells(pieceId, originRow, originCol, rotation = 0) {
  const cells = getPieceCellsByRotation(pieceId, rotation);
  return cells.map((cell) => ({
    row: originRow + cell.dr,
    col: originCol + cell.dc,
    tile: cell.tile,
  }));
}

function canPlaceAt(nextPlacements, pieceId, originRow, originCol) {
  const target = nextPlacements[pieceId] || { row: originRow, col: originCol, rotation: 0 };
  const footprint = getFootprintCells(pieceId, originRow, originCol, target.rotation);
  for (const cell of footprint) {
    if (cell.row < 0 || cell.col < 0 || cell.row >= SIZE || cell.col >= SIZE) {
      return { ok: false, reason: "超出图纸边界" };
    }
  }

  const occupied = new Set();
  for (const [id, pos] of Object.entries(nextPlacements)) {
    if (!pos || id === pieceId) continue;
    const other = getFootprintCells(id, pos.row, pos.col, pos.rotation);
    for (const cell of other) {
      occupied.add(`${cell.row},${cell.col}`);
    }
  }

  for (const cell of footprint) {
    if (occupied.has(`${cell.row},${cell.col}`)) {
      return { ok: false, reason: "拼图不能重叠" };
    }
  }
  return { ok: true, reason: "" };
}

function applyPlacementsToCells(nextPlacements) {
  const cells = makeBoardCells();
  for (const [pieceId, pos] of Object.entries(nextPlacements)) {
    if (!pos) continue;
    const footprint = getFootprintCells(pieceId, pos.row, pos.col, pos.rotation);
    for (const item of footprint) {
      const idx = item.row * SIZE + item.col;
      cells[idx].pieceId = pieceId;
      cells[idx].tile = item.tile;
    }
  }
  return cells;
}

function currentPlacementPayload() {
  return PIECE_ORDER.map((pieceId) => {
    const pos = placements[pieceId];
    return pos ? { pieceId, row: pos.row, col: pos.col, rotation: normalizeRotation(pos.rotation) } : null;
  }).filter(Boolean);
}

function hasAllPiecesPlaced() {
  return PIECE_ORDER.every((pieceId) => {
    const pos = placements[pieceId];
    return (
      pos &&
      Number.isInteger(pos.row) &&
      Number.isInteger(pos.col) &&
      ROTATION_VALUES.includes(normalizeRotation(pos.rotation))
    );
  });
}

function switchMode(mode) {
  activeMode = mode === "hunt" ? "hunt" : "build";
  if (tabBuildBtn) tabBuildBtn.classList.toggle("is-active", activeMode === "build");
  if (tabHuntBtn) tabHuntBtn.classList.toggle("is-active", activeMode === "hunt");
  if (buildSection) buildSection.style.display = activeMode === "build" ? "block" : "none";
  if (huntSection) huntSection.style.display = activeMode === "hunt" ? "block" : "none";
}

function clearBuildPreview() {
  if (!buildBoardEl) return;
  buildBoardEl
    .querySelectorAll(".preview-ok, .preview-bad, .preview-origin, .drop-ok, .drop-bad")
    .forEach((el) => {
      el.classList.remove("preview-ok", "preview-bad", "preview-origin", "drop-ok", "drop-bad");
    });
}

function clearTouchDragState() {
  if (touchDragState.timer) {
    clearTimeout(touchDragState.timer);
    touchDragState.timer = null;
  }
  touchDragState.active = false;
  touchDragState.pieceId = "";
  draggingPieceId = "";
  clearBuildPreview();
}

function getBuildCellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cell = el.closest("#build-board .cell");
  if (!cell) return null;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

function updateTouchDragPreview(x, y) {
  const pieceId = touchDragState.pieceId;
  if (!pieceId || !PIECE_BY_ID.has(pieceId)) return;
  const hit = getBuildCellFromPoint(x, y);
  if (!hit) {
    clearBuildPreview();
    return;
  }
  const probe = {
    ...placements,
    [pieceId]: { row: hit.row, col: hit.col, rotation: normalizeRotation(pieceRotations[pieceId]) },
  };
  const check = canPlaceAt(probe, pieceId, hit.row, hit.col);
  paintBuildPreview(pieceId, hit.row, hit.col, check.ok);
}

function onGlobalTouchMove(event) {
  if (!touchDragState.active) {
    if (touchDragState.timer) {
      event.preventDefault();
      const t = event.touches?.[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - touchDragState.startX);
      const dy = Math.abs(t.clientY - touchDragState.startY);
      if (dx > 10 || dy > 10) {
        clearTimeout(touchDragState.timer);
        touchDragState.timer = null;
      }
    }
    return;
  }
  const t = event.touches?.[0];
  if (!t) return;
  event.preventDefault();
  updateTouchDragPreview(t.clientX, t.clientY);
}

function onGlobalTouchEnd(event) {
  if (!touchDragState.active) {
    clearTouchDragState();
    return;
  }
  event.preventDefault();
  const touch =
    event.changedTouches?.[0] ||
    event.touches?.[0] || {
      clientX: touchDragState.startX,
      clientY: touchDragState.startY,
    };
  const hit = getBuildCellFromPoint(touch.clientX, touch.clientY);
  const pieceId = touchDragState.pieceId;
  if (hit && pieceId) {
    placePieceAt(pieceId, hit.row, hit.col);
  }
  suppressClickUntil = Date.now() + 350;
  clearTouchDragState();
}

function placePieceAt(pieceId, row, col) {
  if (!pieceId || !PIECE_BY_ID.has(pieceId)) return false;
  const next = {
    ...placements,
    [pieceId]: { row, col, rotation: normalizeRotation(pieceRotations[pieceId]) },
  };
  const check = canPlaceAt(next, pieceId, row, col);
  if (!check.ok) {
    setBuildStatus(check.reason, "error");
    return false;
  }
  placements = next;
  setBuildStatus(`已放置：${PIECE_BY_ID.get(pieceId).name}（${next[pieceId].rotation}°）`, "success");
  renderBuildBoard();
  renderPieceList();
  return true;
}

function rotatePiece(pieceId) {
  const currentRotation = normalizeRotation(pieceRotations[pieceId]);
  const idx = ROTATION_VALUES.indexOf(currentRotation);
  const nextRotation = ROTATION_VALUES[(idx + 1) % ROTATION_VALUES.length];
  pieceRotations[pieceId] = nextRotation;
  if (placements[pieceId]) {
    const updated = {
      ...placements[pieceId],
      rotation: nextRotation,
    };
    const probe = { ...placements, [pieceId]: updated };
    const check = canPlaceAt(probe, pieceId, updated.row, updated.col);
    if (!check.ok) {
      delete placements[pieceId];
      setBuildStatus(`旋转后与其他拼图冲突，已移除：${PIECE_BY_ID.get(pieceId)?.name || pieceId}`, "error");
    } else {
      placements[pieceId] = updated;
      setBuildStatus(`已旋转：${PIECE_BY_ID.get(pieceId)?.name || pieceId}（${nextRotation}°）`, "success");
    }
  } else {
    setBuildStatus(`已旋转：${PIECE_BY_ID.get(pieceId)?.name || pieceId}（${nextRotation}°）`, "success");
  }
  renderBuildBoard();
  renderPieceList();
}

function paintBuildPreview(pieceId, originRow, originCol, canPlace) {
  if (!buildBoardEl || !PIECE_BY_ID.has(pieceId)) return;
  clearBuildPreview();
  const footprint = getFootprintCells(
    pieceId,
    originRow,
    originCol,
    normalizeRotation(pieceRotations[pieceId]),
  );
  for (const cell of footprint) {
    if (cell.row < 0 || cell.col < 0 || cell.row >= SIZE || cell.col >= SIZE) continue;
    const el = buildBoardEl.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
    if (!el) continue;
    el.classList.add(canPlace ? "preview-ok" : "preview-bad");
    if (cell.row === originRow && cell.col === originCol) {
      el.classList.add("preview-origin");
    }
  }
}

function renderPieceList() {
  if (!pieceListEl) return;
  pieceListEl.innerHTML = "";

  PIECES.forEach((piece) => {
    const card = document.createElement("div");
    card.className = "piece-card";
    if (canBuildInteractions && selectedPieceId === piece.id) {
      card.classList.add("is-selected");
    }
    card.dataset.pieceId = piece.id;

    const previewWrap = document.createElement("div");
    previewWrap.className = "piece-preview-wrap";
    const preview = document.createElement("img");
    preview.className = "piece-preview";
    const currentRotation = normalizeRotation(pieceRotations[piece.id]);
    preview.src = getPiecePreviewImage(piece.id, currentRotation);
    preview.alt = piece.name;
    preview.title = `${piece.name}（${currentRotation}°）`;
    preview.draggable = canBuildInteractions;
    if (!canBuildInteractions) {
      preview.style.cursor = "default";
    }
    if (canBuildInteractions) {
    preview.addEventListener("click", () => {
      if (Date.now() < suppressClickUntil) return;
      if (selectedPieceId !== piece.id) {
        selectedPieceId = piece.id;
        setBuildStatus(`已选中：${piece.name}。可点击图纸放置，再次点图片可旋转。`, "success");
        renderPieceList();
        return;
      } else {
        rotatePiece(piece.id);
      }
    });
    preview.addEventListener("dragstart", (event) => {
      draggingPieceId = piece.id;
      selectedPieceId = piece.id;
      event.dataTransfer?.setData("text/plain", piece.id);
      event.dataTransfer?.setData("application/x-piece-id", piece.id);
      event.dataTransfer.effectAllowed = "move";
    });
    preview.addEventListener("dragend", () => {
      draggingPieceId = "";
      clearBuildPreview();
    });
    preview.addEventListener(
      "touchstart",
      (event) => {
        const t = event.touches?.[0];
        if (!t) return;
        clearTouchDragState();
        touchDragState.pieceId = piece.id;
        touchDragState.startX = t.clientX;
        touchDragState.startY = t.clientY;
        touchDragState.timer = setTimeout(() => {
          touchDragState.timer = null;
          touchDragState.active = true;
          draggingPieceId = piece.id;
          selectedPieceId = piece.id;
          renderPieceList();
          setBuildStatus(`长按拖拽中：${piece.name}，移动到图纸后松手放置。`, "success");
          updateTouchDragPreview(touchDragState.startX, touchDragState.startY);
        }, 260);
      },
      { passive: false },
    );
    preview.addEventListener("touchcancel", () => {
      clearTouchDragState();
    });
    }
    previewWrap.appendChild(preview);

    card.appendChild(previewWrap);

    pieceListEl.appendChild(card);
  });
}

function renderBuildBoard() {
  if (!buildBoardEl) return;
  buildBoardEl.innerHTML = "";
  const cells = applyPlacementsToCells(placements);

  cells.forEach((cell) => {
    const tile = cell.tile ? TILES[cell.tile] : null;
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.row = String(cell.row);
    el.dataset.col = String(cell.col);
    el.style.background = tile ? tile.color : COLORS.empty;

    if (tile) {
      el.classList.add("filled", tile.className);
      const content = document.createElement("span");
      content.className = "cell-content";
      content.appendChild(createTileIconElement(tile));
      el.appendChild(content);
    }

    el.addEventListener("dragover", (event) => {
      event.preventDefault();
      const pieceId =
        event.dataTransfer?.getData("application/x-piece-id") ||
        event.dataTransfer?.getData("text/plain") ||
        draggingPieceId;
      if (!pieceId) return;
      const probe = {
        ...placements,
        [pieceId]: { row: cell.row, col: cell.col, rotation: normalizeRotation(pieceRotations[pieceId]) },
      };
      const check = canPlaceAt(probe, pieceId, cell.row, cell.col);
      event.dataTransfer.dropEffect = check.ok ? "move" : "none";
      paintBuildPreview(pieceId, cell.row, cell.col, check.ok);
    });

    el.addEventListener("dragleave", () => {
      // Preview is managed globally; do not clear on each cell leave.
    });

    el.addEventListener("drop", (event) => {
      event.preventDefault();
      clearBuildPreview();
      const pieceId =
        event.dataTransfer?.getData("application/x-piece-id") ||
        event.dataTransfer?.getData("text/plain") ||
        draggingPieceId;
      if (!pieceId || !PIECE_BY_ID.has(pieceId)) return;
      placePieceAt(pieceId, cell.row, cell.col);
    });

    el.addEventListener("click", () => {
      if (!selectedPieceId) return;
      placePieceAt(selectedPieceId, cell.row, cell.col);
    });

    buildBoardEl.appendChild(el);
  });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fetchJsonAuth(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  return fetchJson(url, { ...options, headers });
}

async function saveMap() {
  if (!hasAllPiecesPlaced()) {
    setBuildStatus("请先把 4 块拼图全部放到图纸上。", "error");
    return;
  }

  const token = getToken();
  if (!token) {
    setBuildStatus("请先登录后再保存藏宝图。", "error");
    return;
  }

  const mapCells = applyPlacementsToCells(placements);
  const payload = {
    placements: currentPlacementPayload(),
    maskColors: buildMaskColorsForCells(mapCells),
  };
  const { ok, data } = await fetchJson("/api/dungeon/map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });

  if (!ok) {
    setBuildStatus(data.error || "保存失败，请稍后重试。", "error");
    return;
  }

  savedMap = data.map || null;
  setBuildStatus("藏宝图已保存。", "success");
  refreshHuntFromSavedMap();
}

function renderMiniMap(container, placements, maskColors) {
  const cells = applyPlacementsToCells(
    Object.fromEntries(
      (placements || []).map((item) => [
        item.pieceId,
        { row: Number(item.row), col: Number(item.col), rotation: normalizeRotation(item.rotation) },
      ]),
    ),
  );
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gridTemplateColumns = "repeat(5, 1fr)";
  wrap.style.gap = "2px";
  wrap.style.width = "100%";
  wrap.style.maxWidth = "180px";
  cells.forEach((cell) => {
    const tile = cell.tile ? TILES[cell.tile] : null;
    const dot = document.createElement("div");
    dot.style.aspectRatio = "1 / 1";
    dot.style.borderRadius = "4px";
    dot.style.border = "1px solid rgba(0,0,0,.08)";
    dot.style.background = Array.isArray(maskColors) && maskColors[cell.id] ? maskColors[cell.id] : COLORS.empty;
    if (tile) {
      const icon = createTileIconElement(tile, "cell-icon");
      icon.style.width = "12px";
      icon.style.height = "12px";
      icon.style.display = "block";
      const holder = document.createElement("div");
      holder.style.width = "100%";
      holder.style.height = "100%";
      holder.style.display = "flex";
      holder.style.alignItems = "center";
      holder.style.justifyContent = "center";
      holder.appendChild(icon);
      dot.appendChild(holder);
    }
    wrap.appendChild(dot);
  });
  container.appendChild(wrap);
}

async function publishMap() {
  const { ok, data } = await fetchJsonAuth("/api/dungeon/map/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!ok) {
    setBuildStatus(data.error || "发布失败，请先登录并保存藏宝图。", "error");
    return;
  }
  setBuildStatus(`发布成功，UUID: ${data.map?.uuid || "-"}`, "success");
  await loadMyMapsModal();
}

async function loadMyMapsModal() {
  if (!myMapsListEl) return;
  const { ok, data } = await fetchJsonAuth("/api/dungeon/maps/mine");
  myMapsListEl.innerHTML = "";
  if (!ok) {
    const item = document.createElement("div");
    item.textContent = data.error || "读取失败";
    myMapsListEl.appendChild(item);
    return;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.textContent = "暂无已发布藏宝图。";
    myMapsListEl.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("div");
    card.style.border = "1px solid rgba(29,26,22,.14)";
    card.style.borderRadius = "10px";
    card.style.padding = "10px";
    const uuid = document.createElement("div");
    uuid.style.fontWeight = "700";
    uuid.style.marginBottom = "6px";
    uuid.textContent = `UUID: ${item.uuid}`;
    card.appendChild(uuid);
    const stats = document.createElement("div");
    stats.style.fontSize = "13px";
    stats.style.color = "#666";
    stats.style.marginBottom = "6px";
    stats.textContent = `游玩 ${item.playCount || 0} 人 · 通关 ${item.winCount || 0} 人`;
    card.appendChild(stats);
    renderMiniMap(card, item.placements, item.maskColors);
    myMapsListEl.appendChild(card);
  });
}

async function loadSavedMap() {
  const token = getToken();
  if (!token) {
    savedMap = null;
    setBuildStatus("当前未登录，可先体验建造，登录后可保存。");
    return;
  }

  const { ok, data } = await fetchJson("/api/dungeon/map", {
    headers: {
      Authorization: "Bearer " + token,
    },
  });

  if (!ok) {
    savedMap = null;
    setBuildStatus(data.error || "读取藏宝图失败。", "error");
    return;
  }

  savedMap = data.map || null;
  if (savedMap?.placements?.length) {
    const restored = {};
    for (const item of savedMap.placements) {
      if (!item || !PIECE_BY_ID.has(item.pieceId)) continue;
      const rotation = normalizeRotation(item.rotation);
      restored[item.pieceId] = { row: Number(item.row), col: Number(item.col), rotation };
      pieceRotations[item.pieceId] = rotation;
    }
    placements = restored;
    renderBuildBoard();
    renderPieceList();
    setBuildStatus("已读取你的藏宝图，可以继续调整后保存。", "success");
  } else {
    setBuildStatus("你还没有保存过藏宝图。");
  }
}

async function loadPublicMapByUuid(rawUuid) {
  const uuid = String(rawUuid || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(uuid)) {
    setHuntStatus("UUID 格式无效，请输入10位字母数字。");
    return false;
  }
  const token = getToken();
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const { ok, data } = await fetchJson(`/api/dungeon/map/public?uuid=${encodeURIComponent(uuid)}`, { headers });
  if (!ok) {
    setHuntStatus(data.error || "读取UUID藏宝图失败。");
    return false;
  }
  savedMap = data.map || null;
  currentHuntUuid = savedMap?.uuid || "";
  huntAlreadyPlayed = Boolean(data.alreadyPlayed);
  updateHuntUuidText();
  refreshHuntFromSavedMap();
  if (huntAlreadyPlayed) {
    huntGameOver = true;
    setHuntState("已完成");
    setHuntStatus("你已挑战过该UUID藏宝图，每图仅可挑战一次。");
  }
  return true;
}

async function loadMyHuntHistory() {
  if (!huntHistoryListEl) return;
  huntHistoryListEl.innerHTML = "";
  const token = getToken();
  if (!token) {
    const msg = document.createElement("div");
    msg.className = "status";
    msg.textContent = "请先登录后查看历史记录。";
    huntHistoryListEl.appendChild(msg);
    return;
  }
  const { ok, data } = await fetchJson("/api/dungeon/hunt/my-history", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!ok) {
    const err = document.createElement("div");
    err.className = "status";
    err.textContent = data.error || "读取历史记录失败。";
    huntHistoryListEl.appendChild(err);
    return;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = "暂无寻宝记录。";
    huntHistoryListEl.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "8px 10px";
    row.style.border = "1px solid rgba(29,26,22,.14)";
    row.style.borderRadius = "10px";
    row.style.fontSize = "14px";

    const left = document.createElement("div");
    const uuidSpan = document.createElement("span");
    uuidSpan.style.fontWeight = "700";
    uuidSpan.textContent = item.mapUuid;
    left.appendChild(uuidSpan);
    const timeSpan = document.createElement("span");
    timeSpan.style.color = "#6b5c48";
    timeSpan.style.marginLeft = "8px";
    timeSpan.style.fontSize = "12px";
    timeSpan.textContent = item.createdAt ? item.createdAt.replace("T", " ").slice(0, 16) : "";
    left.appendChild(timeSpan);

    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.style.whiteSpace = "nowrap";
    const resultSpan = document.createElement("span");
    resultSpan.style.fontWeight = "700";
    resultSpan.style.color = item.result === "win" ? "#2e7d32" : "#c62828";
    resultSpan.textContent = item.result === "win" ? "成功" : "失败";
    right.appendChild(resultSpan);
    const scoreSpan = document.createElement("span");
    scoreSpan.style.marginLeft = "8px";
    scoreSpan.textContent = `${item.score || 0}分`;
    right.appendChild(scoreSpan);

    row.appendChild(left);
    row.appendChild(right);
    huntHistoryListEl.appendChild(row);
  });
}

async function submitHuntRecord(result) {
  if (!currentHuntUuid || huntSubmitted) return;
  huntSubmitted = true;
  const payload = { uuid: currentHuntUuid, score: huntScore, result };
  const { ok, data } = await fetchJsonAuth("/api/dungeon/hunt/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!ok) {
    setHuntStatus(data.error || "战绩提交失败。");
  }
}

function revealHuntCell(cell) {
  if (cell.revealed) return;
  cell.revealed = true;
  cell.hintMark = null;
  const el = huntBoardEl?.querySelector(`[data-id="${cell.id}"]`);
  if (!el) return;
  const tile = cell.tile ? TILES[cell.tile] : null;
  const existingHint = el.querySelector(".hint-badge");
  if (existingHint) existingHint.remove();

  el.classList.add("revealed");
  if (!tile) return;

  el.style.background = tile.color;
  el.classList.add(tile.className);
  const content = document.createElement("span");
  content.className = "cell-content";
  content.appendChild(createTileIconElement(tile));
  el.appendChild(content);
}

function renderHuntHintForCell(cell) {
  const el = huntBoardEl?.querySelector(`[data-id="${cell.id}"]`);
  if (!el) return;
  const existingHint = el.querySelector(".hint-badge");
  if (existingHint) existingHint.remove();
  if (cell.revealed || !cell.hintMark) return;

  const hint = document.createElement("span");
  hint.className = "hint-badge";
  hint.appendChild(createHintIconElement(cell.hintMark));
  el.appendChild(hint);
}

function markAdjacentHints(centerCell) {
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dr, dc] of dirs) {
    const nr = centerCell.row + dr;
    const nc = centerCell.col + dc;
    if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
    const idx = nr * SIZE + nc;
    const neighbor = huntCells[idx];
    if (!neighbor || neighbor.revealed) continue;
    neighbor.hintMark = neighbor.tile ? "question" : "safe";
    renderHuntHintForCell(neighbor);
  }
}

function revealAllHuntCells() {
  huntCells.forEach((cell) => revealHuntCell(cell));
}

function onHuntCellClick(id) {
  if (huntGameOver) return;
  const cell = huntCells[id];
  if (!cell || cell.revealed) return;

  revealHuntCell(cell);
  markAdjacentHints(cell);

  if (cell.tile === "coin" || cell.tile === "coinOrange") {
    huntScore += 1;
    updateHuntScore();
  }

  if (cell.tile === "diamond") {
    huntScore += 10;
    updateHuntScore();
    huntGameOver = true;
    setHuntState("胜利");
    setHuntStatus(`你找到了钻石宝藏！本局得分 ${huntScore}。`);
    submitHuntRecord("win");
    return;
  }

  if (cell.tile === "bomb" || cell.tile === "bombYellow") {
    huntGameOver = true;
    setHuntState("失败");
    setHuntStatus(`踩中炸弹，寻宝失败。本局得分 ${huntScore}。`);
    revealAllHuntCells();
    submitHuntRecord("lose");
    return;
  }

  if (cell.tile === "trap") {
    chancesLeft = Math.max(0, chancesLeft - 1);
    updateChances();
    if (chancesLeft <= 0) {
      huntGameOver = true;
      setHuntState("失败");
      setHuntStatus(`陷阱耗尽了你的机会。本局得分 ${huntScore}。`);
      revealAllHuntCells();
      submitHuntRecord("lose");
      return;
    }
    setHuntStatus(`触发陷阱，机会 -1（剩余 ${chancesLeft}）。`);
    return;
  }

  setHuntStatus("继续探索，找到钻石即可获胜。");
}

function renderHuntBoard() {
  if (!huntBoardEl) return;
  huntBoardEl.innerHTML = "";
  huntCells.forEach((cell) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.dataset.id = String(cell.id);
    btn.style.background = cell.maskColor || COLORS.empty;
    btn.addEventListener("click", () => onHuntCellClick(cell.id));
    huntBoardEl.appendChild(btn);
    renderHuntHintForCell(cell);
  });
}

function refreshHuntFromSavedMap() {
  if (!savedMap?.placements?.length) {
    huntCells = [];
    if (huntBoardEl) huntBoardEl.innerHTML = "";
    setHuntState("未开始");
    setHuntStatus("暂无藏宝图，请先在建造模式保存。");
    huntScore = 0;
    huntSubmitted = false;
    currentHuntUuid = "";
    huntAlreadyPlayed = false;
    updateHuntUuidText();
    updateHuntScore();
    updateChances();
    return;
  }

  const nextPlacements = {};
  for (const item of savedMap.placements) {
    if (!item || !PIECE_BY_ID.has(item.pieceId)) continue;
    nextPlacements[item.pieceId] = {
      row: Number(item.row),
      col: Number(item.col),
      rotation: normalizeRotation(item.rotation),
    };
  }

  huntCells = applyPlacementsToCells(nextPlacements);
  if (!applySavedMaskColors(huntCells, savedMap.maskColors)) {
    chancesLeft = MAX_CHANCES;
    huntGameOver = true;
    huntScore = 0;
    huntSubmitted = false;
    updateHuntScore();
    updateChances();
    setHuntState("未开始");
    setHuntStatus("藏宝图缺少有效颜色数据，请先在建设模式重新保存。");
    huntCells.forEach((cell) => {
      cell.maskColor = COLORS.empty;
    });
    renderHuntBoard();
    return;
  }
  huntCells.forEach((cell) => {
    cell.hintMark = null;
    cell.revealed = false;
  });
  chancesLeft = MAX_CHANCES;
  huntGameOver = huntAlreadyPlayed;
  huntScore = 0;
  huntSubmitted = false;
  currentHuntUuid = savedMap.uuid || currentHuntUuid || "";
  updateHuntUuidText();
  updateHuntScore();
  updateChances();
  setHuntState("进行中");
  setHuntStatus("点击格子开始寻宝，找到钻石即可胜利。");
  renderHuntBoard();
}

function clearBuild() {
  placements = {};
  pieceRotations = Object.fromEntries(PIECE_ORDER.map((pieceId) => [pieceId, 0]));
  selectedPieceId = "";
  renderBuildBoard();
  renderPieceList();
  setBuildStatus("已清空图纸。");
}

function bindEvents() {
  tabBuildBtn?.addEventListener("click", () => switchMode("build"));
  tabHuntBtn?.addEventListener("click", () => switchMode("hunt"));
  saveMapBtn?.addEventListener("click", saveMap);
  publishMapBtn?.addEventListener("click", publishMap);
  myMapsBtn?.addEventListener("click", async () => {
    if (myMapsModal) myMapsModal.style.display = "block";
    await loadMyMapsModal();
  });
  myMapsCloseBtn?.addEventListener("click", () => {
    if (myMapsModal) myMapsModal.style.display = "none";
  });
  myMapsModal?.addEventListener("click", (event) => {
    if (event.target === myMapsModal) {
      myMapsModal.style.display = "none";
    }
  });
  clearBuildBtn?.addEventListener("click", clearBuild);
  reloadHuntBtn?.addEventListener("click", async () => {
    const token = getToken();
    if (!token) {
      setHuntStatus("请先登录后再使用随机藏宝图。");
      return;
    }
    const { ok, data } = await fetchJson("/api/dungeon/map/random", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!ok) {
      setHuntStatus(data.error || "读取随机藏宝图失败。");
      return;
    }
    if (!data.map) {
      setHuntStatus("暂无可挑战的藏宝图，所有图纸均已游玩。");
      return;
    }
    savedMap = data.map;
    currentHuntUuid = savedMap.uuid || "";
    huntAlreadyPlayed = false;
    updateHuntUuidText();
    setHuntUuidEditMode(false);
    refreshHuntFromSavedMap();
  });
  restartHuntBtn?.addEventListener("click", () => {
    refreshHuntFromSavedMap();
  });
  huntHistoryBtn?.addEventListener("click", async () => {
    if (huntHistoryModal) huntHistoryModal.style.display = "block";
    await loadMyHuntHistory();
  });
  huntHistoryCloseBtn?.addEventListener("click", () => {
    if (huntHistoryModal) huntHistoryModal.style.display = "none";
  });
  huntHistoryModal?.addEventListener("click", (event) => {
    if (event.target === huntHistoryModal) {
      huntHistoryModal.style.display = "none";
    }
  });
  huntUuidEditBtn?.addEventListener("click", async () => {
    if (!huntUuidEditing) {
      setHuntUuidEditMode(true);
      return;
    }
    await confirmUuidEdit();
  });
  huntUuidEditInputEl?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    await confirmUuidEdit();
  });
  huntUuidEditInputEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setHuntUuidEditMode(false);
  });
  huntUuidCancelBtn?.addEventListener("click", () => {
    setHuntUuidEditMode(false);
  });
  buildBoardEl?.addEventListener("dragleave", (event) => {
    const next = event.relatedTarget;
    if (!next || !buildBoardEl.contains(next)) {
      clearBuildPreview();
    }
  });
  window.addEventListener("touchmove", onGlobalTouchMove, { passive: false });
  window.addEventListener("touchend", onGlobalTouchEnd, { passive: false });
  window.addEventListener("touchcancel", onGlobalTouchEnd, { passive: false });
  window.addEventListener("resize", applyLandscapeRequirement);
  window.addEventListener("orientationchange", applyLandscapeRequirement);
}

async function init() {
  applyLandscapeRequirement();
  tryLockLandscape();
  renderPieceList();
  renderBuildBoard();
  bindEvents();
  const preferredMode = document.body?.dataset.defaultMode === "hunt" ? "hunt" : "build";
  switchMode(preferredMode);
  updateChances();
  updateHuntScore();
  updateHuntUuidText();
  setHuntUuidEditMode(false);
  await loadSavedMap();
  if (preferredMode === "hunt") {
    // In hunt-only mode, auto-load a random unplayed map
    const token = getToken();
    if (token) {
      const { ok, data } = await fetchJson("/api/dungeon/map/random", {
        headers: { Authorization: "Bearer " + token },
      });
      if (ok && data.map) {
        savedMap = data.map;
        currentHuntUuid = savedMap.uuid || "";
        huntAlreadyPlayed = false;
        updateHuntUuidText();
      }
    }
  }
  refreshHuntFromSavedMap();
}

init();

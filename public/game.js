'use strict';
/* 블록 로얄 — 클라이언트 */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const N = 8;

  // ───────────────────────── 저장 데이터 ─────────────────────────
  const SAVE_KEY = 'blockRoyale.v1';
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const defaults = () => ({
    name: '', xp: 0, level: 1, coins: 0, best: 0, muted: false,
    skin: 'classic', owned: ['classic'], wins: 0, games: 0,
    daily: null, streak: 0, lastDay: null,
  });
  let save;
  try { save = Object.assign(defaults(), JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch { save = defaults(); }
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 저장 불가(시크릿 모드 등) */ } };
  const xpNeed = (lv) => 100 + lv * 60;

  // ───────────────────────── 스킨 ─────────────────────────
  const SKINS = {
    classic: { name: '클래식', price: 0, colors: ['#ff5f5f', '#ffb03b', '#ffe14d', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'] },
    candy: { name: '캔디', price: 200, colors: ['#ff9ecd', '#ffc6a5', '#fff3a5', '#b5f5c8', '#a5e4ff', '#d4b5ff', '#ffb5e8'] },
    neon: { name: '네온', price: 400, colors: ['#ff2079', '#ff8c00', '#f5ff00', '#00ff9f', '#00e5ff', '#8c4bff', '#ff00e6'] },
    animal: { name: '동물 친구', price: 600, colors: ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'], emo: ['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🐥'] },
    space: { name: '우주 탐험', price: 800, colors: ['#3b2a7a', '#203a8a', '#5a1f6e', '#1f5a6e', '#6e4a1f', '#2a2a5a', '#5a2a3a'], emo: ['🪐', '⭐', '🌙', '☄️', '🚀', '👽', '🌍'] },
    fruit: { name: '과일 가게', price: 1000, colors: ['#ffb3b3', '#ffd9a3', '#fff2a3', '#c9f5b0', '#b0d9f5', '#d9b0f5', '#ffc2d9'], emo: ['🍎', '🍊', '🍋', '🍏', '🫐', '🍇', '🍑'] },
  };
  const skin = () => SKINS[save.skin] || SKINS.classic;
  function paintCell(el, v) {
    // v: 0 빈칸, 1~7 색, 8 방해블록
    el.classList.toggle('f', v > 0 && v < 8);
    el.classList.toggle('stone', v === 8);
    const s = skin();
    if (v > 0 && v < 8) el.style.setProperty('--c', s.colors[v - 1]); else el.style.removeProperty('--c');
    let e = el.firstChild;
    const emo = v > 0 && v < 8 && s.emo ? s.emo[v - 1] : '';
    if (emo) {
      if (!e) { e = document.createElement('span'); e.className = 'emo'; el.appendChild(e); }
      e.textContent = emo;
    } else if (e) e.remove();
  }

  // ───────────────────────── 사운드 (WebAudio 합성) ─────────────────────────
  let actx = null;
  function tone(freq, dur = 0.08, type = 'sine', vol = 0.15, delay = 0) {
    if (save.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch { /* 오디오 미지원 */ }
  }
  const sfx = {
    pick: () => tone(520, 0.05, 'triangle', 0.08),
    place: () => tone(300, 0.07, 'square', 0.06),
    bad: () => tone(140, 0.12, 'sawtooth', 0.06),
    clear: (combo, lines) => {
      const base = 440 * Math.pow(1.06, Math.min(combo, 16) * 2);
      for (let i = 0; i < 2 + lines; i++) tone(base * Math.pow(1.26, i), 0.12, 'triangle', 0.12, i * 0.06);
    },
    perfect: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, i * 0.08)),
    over: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'sine', 0.14, i * 0.15)),
    garbage: () => tone(90, 0.2, 'sawtooth', 0.12),
    coin: () => { tone(988, 0.06, 'square', 0.06); tone(1319, 0.12, 'square', 0.06, 0.06); },
    level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'square', 0.08, i * 0.1)),
  };
  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } };

  // ───────────────────────── 조각 모양 ─────────────────────────
  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]], [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [1, 1]], [[0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 1], [1, 1], [2, 1], [2, 0]], [[0, 0], [0, 1], [1, 0], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [0, 2], [1, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [0, 2], [1, 1]], [[1, 0], [1, 1], [1, 2], [0, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 1], [1, 1], [2, 1], [1, 0]],
    [[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 1], [1, 1], [1, 0], [2, 0]],
    [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], [[0, 2], [1, 2], [2, 2], [2, 1], [2, 0]], [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]],
    [[0, 0], [1, 1]], [[0, 1], [1, 0]],
  ];
  // 너무 큰 조각은 덜 나오게 가중치
  const WEIGHTS = SHAPES.map((s) => (s.length === 1 ? 2 : s.length <= 3 ? 4 : s.length <= 4 ? 3 : s.length <= 6 ? 2 : 1));
  const W_TOTAL = WEIGHTS.reduce((a, b) => a + b, 0);

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ───────────────────────── 게임 상태 ─────────────────────────
  const G = {
    board: new Array(N * N).fill(0),
    tray: [null, null, null],
    score: 0, combo: 0, sinceClear: 0, lines: 0, maxCombo: 0, perfects: 0, itemsUsed: 0, triple: 0,
    items: { hammer: 0, bomb: 0, reroll: 0 },
    nextReward: 6, aiming: null, over: false, online: false, rng: Math.random,
    pendingGarbage: 0, garbageTimer: null, active: false, choosing: false,
  };

  function shapeSize(sh) {
    let r = 0, c = 0;
    for (const [y, x] of sh) { r = Math.max(r, y + 1); c = Math.max(c, x + 1); }
    return [r, c];
  }
  function canPlace(board, sh, r0, c0) {
    for (const [y, x] of sh) {
      const r = r0 + y, c = c0 + x;
      if (r < 0 || c < 0 || r >= N || c >= N || board[r * N + c]) return false;
    }
    return true;
  }
  function fitsAnywhere(board, sh) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (canPlace(board, sh, r, c)) return true;
    return false;
  }
  function randomPiece() {
    let x = G.rng() * W_TOTAL, i = 0;
    while (x >= WEIGHTS[i]) { x -= WEIGHTS[i]; i++; }
    return { shape: SHAPES[Math.min(i, SHAPES.length - 1)], color: 1 + Math.floor(G.rng() * 7) };
  }
  function newTray() {
    // 대부분 최소 한 개는 들어가도록 (너무 억울한 패배 방지 → "한 판 더" 유도)
    let best = null;
    for (let tries = 0; tries < 12; tries++) {
      const t = [randomPiece(), randomPiece(), randomPiece()];
      if (t.some((p) => fitsAnywhere(G.board, p.shape))) { best = t; break; }
      best = t;
    }
    G.tray = best;
    renderTray(true);
  }

  // 줄 지울 위치 계산
  function linesToClear(board) {
    const rows = [], cols = [];
    for (let r = 0; r < N; r++) { let full = true; for (let c = 0; c < N; c++) if (!board[r * N + c]) { full = false; break; } if (full) rows.push(r); }
    for (let c = 0; c < N; c++) { let full = true; for (let r = 0; r < N; r++) if (!board[r * N + c]) { full = false; break; } if (full) cols.push(c); }
    return { rows, cols };
  }

  // ───────────────────────── 렌더링 ─────────────────────────
  const boardEl = $('#board');
  const cells = [];
  for (let i = 0; i < N * N; i++) {
    const d = document.createElement('div');
    d.className = 'cell'; d.dataset.i = i;
    boardEl.appendChild(d); cells.push(d);
  }
  function renderBoard() {
    for (let i = 0; i < N * N; i++) paintCell(cells[i], G.board[i]);
  }
  function computeCell() {
    const online = G.online;
    const W = Math.min(window.innerWidth, 520) - 36;
    const reserved = 60 + (online ? 120 : 0) + 44 + 140 + (online ? 40 : 0) + 30;
    const H = window.innerHeight - reserved;
    const cell = Math.max(26, Math.floor(Math.min(W / N, H / N, 56)));
    document.documentElement.style.setProperty('--cell', cell + 'px');
    return cell;
  }
  window.addEventListener('resize', () => { computeCell(); });

  function pieceEl(p) {
    const [h, w] = shapeSize(p.shape);
    const el = document.createElement('div');
    el.className = 'piece';
    el.style.gridTemplateColumns = `repeat(${w}, var(--cell))`;
    el.style.gridTemplateRows = `repeat(${h}, var(--cell))`;
    const set = new Set(p.shape.map(([y, x]) => y * 10 + x));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = document.createElement('div');
      c.className = 'pcell';
      if (!set.has(y * 10 + x)) c.classList.add('e');
      else paintCell(c, p.color);
      c.classList.remove('f');
      el.appendChild(c);
    }
    return el;
  }
  const slots = $$('#tray .slot');
  function renderTray(animate) {
    G.tray.forEach((p, i) => {
      slots[i].innerHTML = '';
      if (!p) return;
      const el = pieceEl(p);
      el.classList.add('small');
      if (animate) el.classList.add('appear');
      if (!fitsAnywhere(G.board, p.shape)) el.classList.add('nofit');
      el.dataset.slot = i;
      slots[i].appendChild(el);
    });
  }
  function refreshFit() {
    G.tray.forEach((p, i) => {
      const el = slots[i].firstChild;
      if (p && el) el.classList.toggle('nofit', !fitsAnywhere(G.board, p.shape));
    });
  }
  function renderHUD() {
    $('#scoreTxt').textContent = G.score.toLocaleString();
    $('#gBestTxt').textContent = Math.max(save.best, G.online ? 0 : G.score).toLocaleString();
    const ct = $('#comboTxt');
    ct.textContent = G.combo >= 2 ? `콤보 x${G.combo}` : '';
    document.body.classList.toggle('fever', G.combo >= 5 && G.active);
    for (const b of $$('#items .item')) {
      const k = b.dataset.item;
      b.querySelector('span').textContent = G.items[k];
      b.classList.toggle('empty', G.items[k] === 0);
      b.classList.toggle('active', G.aiming === k);
    }
    boardEl.classList.toggle('aim', !!G.aiming);
    const gb = $('#garbageBar');
    gb.classList.toggle('on', G.pendingGarbage > 0);
    $('#garbageFill').style.width = Math.min(100, G.pendingGarbage * 12.5) + '%';
    $('#garbageTxt').textContent = G.pendingGarbage > 0 ? `⚠️ 방해블록 ${G.pendingGarbage}개 도착 예정! 줄을 지워 막아내세요` : '';
  }
  function bumpScore() {
    const s = $('#scoreTxt'); s.classList.add('bump'); setTimeout(() => s.classList.remove('bump'), 120);
  }

  // 이펙트
  const fx = $('#fxLayer');
  function floatText(text, x, y, big) {
    const d = document.createElement('div');
    d.className = 'float' + (big ? ' big' : '');
    d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px';
    fx.appendChild(d); setTimeout(() => d.remove(), 1000);
  }
  function particles(i, color) {
    const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));
    const r = Math.floor(i / N), c = i % N;
    for (let k = 0; k < 4; k++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = (4 + c * cell + cell / 2) + 'px'; p.style.top = (4 + r * cell + cell / 2) + 'px';
      p.style.background = color || '#fff';
      p.style.setProperty('--dx', (Math.random() - 0.5) * 120 + 'px');
      p.style.setProperty('--dy', (Math.random() - 0.5) * 120 + 'px');
      fx.appendChild(p); setTimeout(() => p.remove(), 700);
    }
  }
  let toastT;
  function toast(msg, ms = 1400) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  function shake() { boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake'); }

  // ───────────────────────── 드래그 & 드롭 ─────────────────────────
  const dragLayer = $('#dragLayer');
  let drag = null;
  function onPointerDown(e) {
    if (!G.active || G.over || G.choosing) return;
    const pEl = e.target.closest('.piece');
    if (!pEl || !pEl.parentElement.classList.contains('slot')) return;
    const idx = +pEl.dataset.slot;
    const p = G.tray[idx];
    if (!p) return;
    e.preventDefault();
    if (G.aiming) { G.aiming = null; renderHUD(); }
    const ghost = pieceEl(p);
    dragLayer.appendChild(ghost);
    pEl.style.opacity = '0.15';
    const touch = e.pointerType !== 'mouse';
    drag = { idx, p, ghost, src: pEl, lift: touch ? 70 : 20, pos: null, pid: e.pointerId };
    try { document.body.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    sfx.pick();
    moveDrag(e);
  }
  function moveDrag(e) {
    if (!drag) return;
    const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));
    const [h, w] = shapeSize(drag.p.shape);
    const gx = e.clientX - (w * cell) / 2;
    const gy = e.clientY - h * cell - drag.lift;
    drag.ghost.style.left = gx + 'px'; drag.ghost.style.top = gy + 'px';
    const br = boardEl.getBoundingClientRect();
    const c0 = Math.round((gx - br.left - 4) / cell);
    const r0 = Math.round((gy - br.top - 4) / cell);
    const ok = canPlace(G.board, drag.p.shape, r0, c0);
    const key = ok ? r0 * N + c0 : -1;
    if (drag.pos === key) return;
    drag.pos = key;
    clearPreview();
    if (ok) showPreview(drag.p, r0, c0);
  }
  function clearPreview() {
    for (const c of cells) {
      if (c.classList.contains('ghost')) { c.classList.remove('ghost'); paintCell(c, G.board[+c.dataset.i]); }
      c.classList.remove('willclear');
    }
  }
  function showPreview(p, r0, c0) {
    const tmp = G.board.slice();
    for (const [y, x] of p.shape) {
      const i = (r0 + y) * N + c0 + x;
      tmp[i] = p.color;
      cells[i].classList.add('ghost');
      cells[i].style.setProperty('--c', skin().colors[p.color - 1]);
    }
    const { rows, cols } = linesToClear(tmp);
    for (const r of rows) for (let c = 0; c < N; c++) { cells[r * N + c].classList.add('willclear'); cells[r * N + c].style.setProperty('--c', skin().colors[p.color - 1]); }
    for (const c of cols) for (let r = 0; r < N; r++) { cells[r * N + c].classList.add('willclear'); cells[r * N + c].style.setProperty('--c', skin().colors[p.color - 1]); }
  }
  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost.remove();
    clearPreview();
    let placed = false;
    if (d.pos !== null && d.pos >= 0 && G.active && !G.over) {
      const r0 = Math.floor(d.pos / N), c0 = d.pos % N;
      placed = placePiece(d.idx, r0, c0); // 드래그 중 방해블록이 떨어져 자리가 막혔으면 false
    }
    if (!placed) { d.src.style.opacity = ''; if (d.pos !== null && d.pos >= 0) sfx.bad(); }
  }
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', (e) => { if (drag) { e.preventDefault(); moveDrag(e); } }, { passive: false });
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', () => { if (drag) { drag.pos = null; endDrag(); } });

  // ───────────────────────── 핵심 로직 ─────────────────────────
  const LINE_SCORE = [0, 10, 30, 60, 100, 150, 210, 280, 360, 450, 550, 660, 780, 910, 1050, 1200, 1360];
  function placePiece(idx, r0, c0) {
    const p = G.tray[idx];
    if (!p || !canPlace(G.board, p.shape, r0, c0)) return false;
    for (const [y, x] of p.shape) {
      const i = (r0 + y) * N + c0 + x;
      G.board[i] = p.color; paintCell(cells[i], p.color);
      cells[i].classList.remove('drop'); void cells[i].offsetWidth; cells[i].classList.add('drop');
    }
    G.tray[idx] = null;
    G.score += p.shape.length;
    sfx.place(); vibrate(8);
    const cleared = resolveClears(p.color, r0, c0);
    if (G.tray.every((t) => !t)) newTray(); else renderTray(false);
    afterMove(cleared);
    return true;
  }

  function resolveClears(color, r0, c0) {
    const { rows, cols } = linesToClear(G.board);
    const lines = rows.length + cols.length;
    const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));
    if (!lines) {
      G.sinceClear++;
      if (G.sinceClear >= 3 && G.combo > 0) { G.combo = 0; }
      renderBoard(); renderHUD(); bumpScore();
      return 0;
    }
    G.combo++; G.sinceClear = 0;
    G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.lines += lines;
    if (lines >= 3) G.triple++;
    const mult = 1 + (G.combo - 1) * 0.5 + (G.combo >= 5 ? 1 : 0);
    let gain = Math.round(LINE_SCORE[Math.min(lines, 16)] * mult);
    const toClear = new Set();
    for (const r of rows) for (let c = 0; c < N; c++) toClear.add(r * N + c);
    for (const c of cols) for (let r = 0; r < N; r++) toClear.add(r * N + c);
    const col = skin().colors[(color || 1) - 1];
    for (const i of toClear) {
      G.board[i] = 0;
      cells[i].classList.add('pop');
      if (Math.random() < 0.5) particles(i, col);
    }
    setTimeout(() => { for (const i of toClear) cells[i].classList.remove('pop'); renderBoard(); refreshFit(); }, 340);
    const perfect = G.board.every((v) => !v);
    if (perfect) { gain += 300; G.perfects++; }
    G.score += gain;
    const x = 4 + (c0 + 1) * cell, y = 4 + (r0 + 0.5) * cell;
    floatText('+' + gain, Math.min(Math.max(x, 50), N * cell - 40), y);
    const words = ['', '', '좋아요!', '멋져요!', '대박!', '미쳤다!!', '전설!!!'];
    if (lines >= 2) floatText(words[Math.min(lines, 6)], (N * cell) / 2, (N * cell) / 2 - 40, true);
    if (G.combo >= 2) floatText(`🔥 콤보 x${G.combo}`, (N * cell) / 2, (N * cell) / 2 + 20, true);
    if (G.combo === 5) toast('🌈 피버 타임! 점수 2배 이상!');
    if (perfect) { floatText('✨ 퍼펙트 클리어! +300', (N * cell) / 2, (N * cell) / 2 - 90, true); sfx.perfect(); }
    sfx.clear(G.combo, lines); vibrate(lines >= 2 ? [20, 30, 20] : 15);
    if (lines >= 3 || G.combo >= 4) shake();
    renderHUD(); bumpScore();

    // 온라인 공격: 2줄 이상 / 콤보 / 퍼펙트
    if (G.online) {
      let atk = Math.max(0, lines - 1) + (G.combo >= 3 ? 1 : 0) + (G.combo >= 6 ? 1 : 0) + (perfect ? 4 : 0);
      // 받을 방해블록 먼저 상쇄: 지운 줄 수 + 공격력만큼 막고, 남은 공격력만 보냄
      if (G.pendingGarbage > 0) {
        const blocked = Math.min(G.pendingGarbage, lines + atk);
        G.pendingGarbage -= blocked;
        atk = Math.max(0, atk - Math.max(0, blocked - lines));
        toast(`🛡️ 방해블록 ${blocked}개 막음!`);
        if (G.pendingGarbage === 0) { clearTimeout(G.garbageTimer); G.garbageTimer = null; }
      }
      if (atk > 0) { net.send({ t: 'attack', n: atk }); floatText(`⚔️ 공격 ${atk}!`, (N * cell) / 2, 30, true); }
      renderHUD();
    }
    // 아이템 보상
    if (G.lines >= G.nextReward) { G.nextReward += 7; setTimeout(offerItem, 420); }
    return lines;
  }

  function afterMove() {
    if (G.online) {
      if (G.pendingGarbage > 0 && !G.garbageTimer) G.garbageTimer = setTimeout(applyGarbage, 2500);
      sendState();
    }
    updateMissionsLive();
    checkStuck();
  }

  function checkStuck() {
    if (G.over || !G.active) return;
    const pieces = G.tray.filter(Boolean);
    if (!pieces.length) return;
    if (pieces.some((p) => fitsAnywhere(G.board, p.shape))) return;
    const hasItem = G.items.hammer + G.items.bomb + G.items.reroll > 0;
    if (hasItem) { toast('😮 막혔어요! 아이템(🔨💣🔄)을 써 보세요!', 2200); shake(); return; }
    gameOver();
  }

  function applyGarbage() {
    G.garbageTimer = null;
    if (!G.active || G.over || G.pendingGarbage <= 0) return;
    let n = G.pendingGarbage; G.pendingGarbage = 0;
    const empty = [];
    for (let i = 0; i < N * N; i++) if (!G.board[i]) empty.push(i);
    while (n-- > 0 && empty.length) {
      const k = Math.floor(Math.random() * empty.length);
      const i = empty.splice(k, 1)[0];
      G.board[i] = 8;
      cells[i].classList.remove('drop'); void cells[i].offsetWidth; cells[i].classList.add('drop');
    }
    renderBoard(); refreshFit(); renderHUD(); shake(); sfx.garbage(); vibrate(60);
    sendState();
    checkStuck();
  }

  // ───────────────────────── 아이템 ─────────────────────────
  const ITEM_INFO = {
    hammer: { ic: '🔨', name: '뿅망치', desc: '블록 1칸 부수기' },
    bomb: { ic: '💣', name: '폭탄', desc: '3×3 칸 날리기' },
    reroll: { ic: '🔄', name: '새로고침', desc: '조각 3개 바꾸기' },
  };
  function offerItem() {
    if (!G.active || G.over) return;
    const keys = Object.keys(ITEM_INFO);
    // 3장 중 1장 고르기 (로그라이크 보상 느낌)
    const opts = [keys[Math.floor(Math.random() * 3)], keys[Math.floor(Math.random() * 3)], keys[Math.floor(Math.random() * 3)]];
    G.choosing = true;
    const pick = (k) => {
      clearTimeout(G.autoPick);
      if (!G.choosing) return;
      G.choosing = false; G.items[k]++; closeModal(); sfx.coin(); renderHUD();
      toast(`${ITEM_INFO[k].ic} ${ITEM_INFO[k].name} 획득!`);
    };
    openModal(`<h2>🎁 보상 선택!</h2><p>줄을 많이 지웠어요! 하나 골라요</p>
      <div class="choices">${opts.map((k, i) => `<button class="choice" data-k="${k}" data-i="${i}"><span class="ic">${ITEM_INFO[k].ic}</span>${ITEM_INFO[k].name}<br><small>${ITEM_INFO[k].desc}</small></button>`).join('')}</div>
      ${G.online ? '<p><small>4초 뒤 자동 선택</small></p>' : ''}`);
    $$('#modal .choice').forEach((b) => b.addEventListener('click', () => pick(b.dataset.k)));
    if (G.online) G.autoPick = setTimeout(() => pick(opts[0]), 4000);
    sfx.coin();
  }
  for (const b of $$('#items .item')) {
    b.addEventListener('click', () => {
      if (!G.active || G.over || G.choosing) return;
      const k = b.dataset.item;
      if (!G.items[k]) { toast('아이템이 없어요. 줄을 지우면 받을 수 있어요!'); return; }
      if (k === 'reroll') {
        G.items.reroll--; G.itemsUsed++;
        newTray(); renderHUD(); sfx.coin(); afterMove();
        return;
      }
      G.aiming = G.aiming === k ? null : k;
      if (G.aiming) toast(k === 'hammer' ? '부술 블록을 눌러요' : '폭탄 놓을 곳을 눌러요');
      renderHUD();
    });
  }
  boardEl.addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (!c || !G.aiming || !G.active || G.over) return;
    const i = +c.dataset.i;
    const k = G.aiming;
    if (k === 'hammer') {
      if (!G.board[i]) { toast('빈 칸이에요!'); return; }
      G.board[i] = 0; particles(i, '#fff');
    } else if (k === 'bomb') {
      const r = Math.floor(i / N), cc = i % N;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, c2 = cc + dc;
        if (rr >= 0 && rr < N && c2 >= 0 && c2 < N) { const j = rr * N + c2; if (G.board[j]) particles(j, '#f90'); G.board[j] = 0; }
      }
      shake();
    }
    G.items[k]--; G.itemsUsed++; G.aiming = null;
    sfx.clear(1, 1); renderBoard(); refreshFit(); renderHUD();
    afterMove();
  });

  // ───────────────────────── 게임 시작 / 종료 ─────────────────────────
  function resetGame(online, seed) {
    G.board.fill(0);
    G.score = 0; G.combo = 0; G.sinceClear = 0; G.lines = 0; G.maxCombo = 0; G.perfects = 0; G.itemsUsed = 0; G.triple = 0;
    G.items = { hammer: 1, bomb: 0, reroll: 1 };
    G.nextReward = 6; G.aiming = null; G.over = false; G.online = online; G.choosing = false; clearTimeout(G.autoPick);
    G.pendingGarbage = 0; clearTimeout(G.garbageTimer); G.garbageTimer = null;
    G.rng = mulberry32(seed || (Math.random() * 2 ** 31) | 0);
    G.active = true;
    $('#emotes').classList.toggle('hidden', !online);
    if (!online) $('#opponents').innerHTML = '';
    showScreen('game');
    computeCell();
    renderBoard();
    newTray();
    renderHUD();
  }
  function startSolo() { closeModal(); resetGame(false); }

  function gameOver() {
    if (G.over) return;
    G.over = true; G.active = false;
    clearTimeout(G.garbageTimer); G.garbageTimer = null;
    if (G.choosing) { G.choosing = false; clearTimeout(G.autoPick); closeModal(); }
    document.body.classList.remove('fever');
    sfx.over(); vibrate([40, 60, 40]);
    if (G.online) {
      net.send({ t: 'dead', score: G.score });
      toast('💥 탈락! 다른 사람들의 경기를 구경해요', 2500);
      // 결과 화면은 서버의 'end' 메시지에서
      return;
    }
    const prevBest = save.best;
    const newBest = G.score > prevBest;
    if (newBest) save.best = G.score;
    const rewards = grantRewards(G.score, false);
    const near = !newBest && prevBest > 0 ? `신기록까지 단 <b>${(prevBest - G.score + 1).toLocaleString()}</b>점!` : '';
    setTimeout(() => showResult({ title: '게임 오버', newBest, near, rewards }), 600);
  }

  function grantRewards(score, won, placeInfo) {
    save.games++;
    const xp = Math.round(score / 8) + (won ? 120 : 0) + 10;
    const coins = Math.round(score / 40) + (won ? 60 : 0);
    save.coins += coins;
    const before = { level: save.level, xp: save.xp };
    save.xp += xp;
    let leveled = 0;
    while (save.xp >= xpNeed(save.level)) { save.xp -= xpNeed(save.level); save.level++; leveled++; save.coins += 50; }
    // 미션 진행
    const d = ensureDaily();
    for (const m of d.missions) {
      const def = MISSIONS[m.id];
      if (!def) continue;
      m.progress = Math.min(def.goal, def.update(m.progress, { score, online: G.online, won, lines: G.lines, maxCombo: G.maxCombo, perfects: G.perfects, itemsUsed: G.itemsUsed, triple: G.triple, place: placeInfo }));
    }
    persist();
    return { xp, coins, leveled, before };
  }

  function showResult({ title, newBest, near, rewards, ranking }) {
    const need = xpNeed(save.level);
    const rankHtml = ranking ? `<ol>${ranking.map((r) => `<li class="${r.id === net.id ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][r.place - 1] || r.place + '등'} ${esc(r.name)}${r.bot ? ' 🤖' : ''}</span><span>${r.score.toLocaleString()}</span></li>`).join('')}</ol>` : '';
    openModal(`
      <h2>${title}</h2>
      <div class="bigscore">${G.score.toLocaleString()}</div>
      ${newBest ? '<div class="newbest">🏆 새 최고 기록!</div>' : ''}
      ${near ? `<div class="near">${near}</div>` : ''}
      ${rankHtml}
      <div>최대 콤보 x${G.maxCombo} · 지운 줄 ${G.lines}</div>
      <div class="xpline"><b>Lv.${save.level}</b><div class="xpbar"><div id="rXp" style="width:0;height:100%;background:linear-gradient(90deg,#5cf,#a6f);transition:width .8s"></div></div></div>
      <div>+${rewards.xp} XP · 🪙 +${rewards.coins}${rewards.leveled ? ` · <b style="color:#ffd23f">🎉 레벨 업! (+${50 * rewards.leveled}🪙)</b>` : ''}</div>
      <div class="btns">
        ${G.online
          ? `<button class="big-btn pink" id="againBtn">${net.quick ? '⚔️ 다시 매칭!' : '🏠 대기실로'}</button>`
          : '<button class="big-btn green" id="againBtn">🔁 한 판 더!</button>'}
        <button class="mid-btn" id="homeBtn">홈으로</button>
      </div>`);
    setTimeout(() => { const x = $('#rXp'); if (x) x.style.width = (100 * save.xp / need) + '%'; }, 50);
    if (rewards.leveled) sfx.level(); else if (rewards.coins) sfx.coin();
    $('#againBtn').addEventListener('click', () => {
      closeModal();
      if (!G.online) startSolo();
      else if (net.quick) { net.quickMatch(); }
      else if (net.lastRoom) showLobby(net.lastRoom);
      else goHome();
    });
    $('#homeBtn').addEventListener('click', () => { if (G.online) net.leave(); goHome(); });
    const again = $('#againBtn'); if (again) again.focus();
  }

  // ───────────────────────── 일일 미션 ─────────────────────────
  const MISSIONS = {
    lines20: { text: '줄 20개 지우기', goal: 20, reward: 60, update: (p, s) => p + s.lines },
    combo4: { text: '콤보 x4 달성', goal: 4, reward: 70, update: (p, s) => Math.max(p, s.maxCombo) },
    score800: { text: '한 판에 800점', goal: 800, reward: 80, update: (p, s) => Math.max(p, s.score) },
    score2000: { text: '한 판에 2000점', goal: 2000, reward: 150, update: (p, s) => Math.max(p, s.score) },
    online1: { text: '온라인 배틀 1판', goal: 1, reward: 60, update: (p, s) => p + (s.online ? 1 : 0) },
    top3: { text: '온라인 3등 안에 들기', goal: 1, reward: 100, update: (p, s) => p + (s.online && s.place && s.place <= 3 ? 1 : 0) },
    items3: { text: '아이템 3번 쓰기', goal: 3, reward: 50, update: (p, s) => p + s.itemsUsed },
    perfect1: { text: '퍼펙트 클리어 1번', goal: 1, reward: 120, update: (p, s) => p + s.perfects },
    triple2: { text: '3줄 이상 동시 지우기 2번', goal: 2, reward: 90, update: (p, s) => p + s.triple },
    play3: { text: '3판 플레이', goal: 3, reward: 50, update: (p) => p + 1 },
  };
  function ensureDaily() {
    const t = today();
    if (!save.daily || save.daily.date !== t) {
      // 연속 출석
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yk = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
      save.streak = save.lastDay === yk ? save.streak + 1 : 1;
      save.lastDay = t;
      const r = mulberry32([...t].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) | 0);
      const ids = Object.keys(MISSIONS);
      const pick = [];
      while (pick.length < 3) { const id = ids[Math.floor(r() * ids.length)]; if (!pick.includes(id)) pick.push(id); }
      save.daily = { date: t, missions: pick.map((id) => ({ id, progress: 0, claimed: false })), bonus: false };
      persist();
    }
    return save.daily;
  }
  function updateMissionsLive() { /* 라이브 진행은 판 끝날 때 반영 (단순·안전) */ }
  function renderHome() {
    const d = ensureDaily();
    if (!d.bonus) {
      d.bonus = true;
      const bonus = Math.min(7, save.streak) * 20;
      save.coins += bonus; persist();
      setTimeout(() => toastHome(`📅 ${save.streak}일 연속 접속! 🪙 +${bonus}`), 300);
    }
    $('#lvlBadge').textContent = 'Lv.' + save.level;
    $('#xpFill').style.width = (100 * save.xp / xpNeed(save.level)) + '%';
    $('#coinTxt').textContent = save.coins.toLocaleString();
    $('#bestTxt').textContent = save.best.toLocaleString();
    $('#muteBtn').textContent = save.muted ? '🔇' : '🔊';
    $('#streakTxt').textContent = `🔥 ${save.streak}일 연속`;
    $('#nameInput').value = save.name;
    const ul = $('#missionList'); ul.innerHTML = '';
    for (const m of d.missions) {
      const def = MISSIONS[m.id]; if (!def) continue;
      const li = document.createElement('li');
      const done = m.progress >= def.goal;
      li.innerHTML = `<span class="mtxt ${m.claimed ? 'done' : ''}">${def.text}</span>
        <div class="mbar"><div style="width:${100 * Math.min(1, m.progress / def.goal)}%"></div></div>
        ${m.claimed ? '✅' : done ? `<button>받기 🪙${def.reward}</button>` : `<small>🪙${def.reward}</small>`}`;
      const btn = li.querySelector('button');
      if (btn) btn.addEventListener('click', () => { m.claimed = true; save.coins += def.reward; persist(); sfx.coin(); renderHome(); });
      ul.appendChild(li);
    }
  }
  function toastHome(msg) {
    const t = document.createElement('div');
    t.className = 'toast show'; t.textContent = msg; t.style.position = 'fixed'; t.style.top = '10%';
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  // ───────────────────────── 화면/모달 ─────────────────────────
  function showScreen(id) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
    if (id !== 'game') document.body.classList.remove('fever');
  }
  function openModal(html) { $('#modal').innerHTML = html; $('#overlay').classList.remove('hidden'); }
  function closeModal() { $('#overlay').classList.add('hidden'); $('#modal').innerHTML = ''; }
  const modalOpen = () => !$('#overlay').classList.contains('hidden');
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function goHome() {
    G.active = false; G.online = false; G.choosing = false; clearTimeout(G.autoPick); closeModal();
    clearTimeout(G.garbageTimer); G.garbageTimer = null;
    showScreen('home'); renderHome();
  }
  function getName() {
    const v = $('#nameInput').value.trim().slice(0, 12);
    save.name = v; persist();
    return v || '플레이어' + Math.floor(Math.random() * 900 + 100);
  }

  // ───────────────────────── 온라인 ─────────────────────────
  const net = {
    ws: null, id: null, quick: false, room: null, lastRoom: null, players: new Map(), want: null,
    retry: 0, lastSend: 0, stateTimer: null,
    connect(then) {
      if (this.ws && this.ws.readyState === 1) { then && then(); return; }
      if (this.ws && this.ws.readyState === 0) { this.want = then; return; }
      this.want = then;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { toast('서버에 연결할 수 없어요'); return; }
      this.ws = ws;
      ws.onopen = () => { this.retry = 0; this.send({ t: 'hello', name: getName() }); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMsg(m); };
      ws.onclose = () => {
        this.ws = null;
        if (G.online && G.active) { toast('⚠️ 연결이 끊겼어요', 2500); G.active = false; setTimeout(goHome, 1500); }
        else if ($('#lobby').classList.contains('active')) { toastHome('⚠️ 서버 연결이 끊겼어요'); goHome(); }
      };
      ws.onerror = () => { if (location.protocol === 'file:') toastHome('온라인은 서버(node server.js)로 열어야 해요'); else toastHome('서버 연결 실패. 잠시 후 다시 시도해 주세요'); };
    },
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
    quickMatch() { this.quick = true; showLobbyWaiting('⚔️ 상대를 찾는 중...'); this.connect(() => this.send({ t: 'quick' })); },
    create() { this.quick = false; showLobbyWaiting('방 만드는 중...'); this.connect(() => this.send({ t: 'create' })); },
    join(code) { this.quick = false; showLobbyWaiting('입장 중...'); this.connect(() => this.send({ t: 'join', code })); },
    leave() { this.send({ t: 'leave' }); this.room = null; this.lastRoom = null; },
    onMsg(m) {
      switch (m.t) {
        case 'welcome': {
          this.id = m.id;
          const f = this.want; this.want = null; f && f();
          break;
        }
        case 'room':
          this.room = m; this.lastRoom = m;
          for (const p of m.players) this.players.set(p.id, p);
          if (!G.active && !modalOpen()) showLobby(m);
          else if ($('#lobby').classList.contains('active')) showLobby(m);
          break;
        case 'error':
          toastHome(m.msg);
          if ($('#lobby').classList.contains('active') && !this.room) goHome();
          break;
        case 'countdown': {
          const cd = $('#countdown');
          cd.classList.remove('hidden'); cd.innerHTML = `<span>${m.s}</span>`;
          tone(600, 0.1, 'square', 0.08);
          break;
        }
        case 'start': {
          const cd = $('#countdown');
          cd.innerHTML = '<span>GO!</span>'; tone(900, 0.2, 'square', 0.1);
          setTimeout(() => cd.classList.add('hidden'), 800);
          closeModal();
          this.players.clear();
          for (const p of m.players) this.players.set(p.id, p);
          resetGame(true, m.seed);
          renderOpponents();
          sendState(true);
          break;
        }
        case 'opp': {
          const p = this.players.get(m.id); if (!p) break;
          p.board = m.board; p.score = m.score;
          updateOpp(m.id);
          break;
        }
        case 'garbage':
          if (!G.active || G.over) break;
          G.pendingGarbage += m.n;
          renderHUD();
          toast(m.from ? `💢 ${m.fromName}의 공격! (${m.n})` : `⚡ 압박 블록 ${m.n}개!`);
          sfx.garbage();
          if (!G.garbageTimer) G.garbageTimer = setTimeout(applyGarbage, 2500);
          break;
        case 'attackfx': {
          const el = document.querySelector(`.opp[data-id="${m.to}"]`);
          if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
          break;
        }
        case 'pressure': break;
        case 'eliminated': {
          const p = this.players.get(m.id);
          if (p) { p.alive = false; p.place = m.place; }
          updateOpp(m.id);
          if (m.id !== this.id && p && G.active) toast(`💀 ${p.name} 탈락! (${m.place}등)`);
          break;
        }
        case 'emote': showEmote(m.id, m.e); break;
        case 'left': {
          const p = this.players.get(m.id); if (p) p.left = true;
          break;
        }
        case 'end': {
          const me = m.ranking.find((r) => r.id === this.id);
          const won = me && me.place === 1;
          const wasActive = G.active;
          G.active = false; G.over = true;
          clearTimeout(G.garbageTimer); G.garbageTimer = null;
          if (G.choosing) { G.choosing = false; clearTimeout(G.autoPick); }
          document.body.classList.remove('fever');
          if (won) save.wins++;
          const rewards = grantRewards(G.score, won, me ? me.place : null);
          if (G.score > save.best) save.best = G.score;
          persist();
          if (wasActive && won) sfx.perfect();
          setTimeout(() => showResult({ title: won ? '🏆 우승! 블록 왕!' : me ? `${me.place}등!` : '경기 종료', rewards, ranking: m.ranking }), wasActive ? 700 : 300);
          break;
        }
        default: break;
      }
    },
  };

  function sendState(force) {
    if (!G.online) return;
    const now = Date.now();
    const doSend = () => {
      net.stateTimer = null; net.lastSend = Date.now();
      net.send({ t: 'state', board: G.board.map((v) => v.toString(36)).join(''), score: G.score });
    };
    if (force || now - net.lastSend > 150) doSend();
    else if (!net.stateTimer) net.stateTimer = setTimeout(doSend, 150);
  }

  function renderOpponents() {
    const wrap = $('#opponents'); wrap.innerHTML = '';
    for (const p of net.players.values()) {
      if (p.id === net.id) continue;
      const d = document.createElement('div');
      d.className = 'opp'; d.dataset.id = p.id;
      d.innerHTML = `<div class="oname">${esc(p.name)}${p.bot ? '🤖' : ''}</div><div class="mini">${'<i></i>'.repeat(64)}</div><div class="oscore">0</div>`;
      wrap.appendChild(d);
      updateOpp(p.id);
    }
    computeCell();
  }
  function updateOpp(id) {
    const p = net.players.get(id);
    const el = document.querySelector(`.opp[data-id="${id}"]`);
    if (!p || !el) return;
    el.classList.toggle('dead', p.alive === false);
    el.querySelector('.oscore').textContent = p.alive === false && p.place ? `${p.place}등` : (p.score || 0).toLocaleString();
    if (p.board) {
      const is = el.querySelectorAll('.mini i'); const s = skin();
      for (let i = 0; i < 64; i++) {
        const v = parseInt(p.board[i], 36) || 0;
        is[i].style.background = v === 8 ? '#666' : v ? s.colors[(v - 1) % 7] : '';
      }
    }
  }
  function showEmote(id, e) {
    let host;
    if (id === net.id) { host = $('.scorebox'); }
    else host = document.querySelector(`.opp[data-id="${id}"]`);
    if (!host) return;
    host.style.position = 'relative';
    const s = document.createElement('div'); s.className = 'emo'; s.textContent = e;
    s.style.cssText = 'position:absolute;top:-8px;right:-6px;font-size:26px;animation:emo 1.6s forwards;pointer-events:none';
    host.appendChild(s); setTimeout(() => s.remove(), 1600);
  }
  let lastEmote = 0;
  for (const b of $$('#emotes button')) {
    b.addEventListener('click', () => {
      if (Date.now() - lastEmote < 800) return;
      lastEmote = Date.now();
      net.send({ t: 'emote', e: b.textContent });
    });
  }

  // 로비
  let lobbyTick = null;
  const TIPS = [
    '💡 2줄 이상 한꺼번에 지우면 상대에게 방해블록을 보내요!',
    '💡 줄을 지우면 날아오는 방해블록을 막을 수 있어요 🛡️',
    '💡 콤보 5 이상이면 피버 타임! 점수가 폭발해요 🌈',
    '💡 판을 싹 비우는 퍼펙트 클리어 = 4칸 대공격 ✨',
    '💡 60초가 지나면 모두에게 압박 블록이 떨어져요 ⚡',
  ];
  function showLobbyWaiting(msg) {
    showScreen('lobby');
    $('#lobbyTitle').textContent = net.quick ? '⚔️ 빠른 매칭' : '🏠 친구 방';
    $('#lobbyInfo').textContent = msg;
    $('#lobbyPlayers').innerHTML = '';
    $('#roomCodeBox').classList.add('hidden');
    $('#startBtn').classList.add('hidden'); $('#addBotBtn').classList.add('hidden');
    $('#lobbyTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }
  function showLobby(m) {
    if (G.active) return;
    showScreen('lobby');
    $('#lobbyTitle').textContent = m.quick ? '⚔️ 빠른 매칭' : '🏠 친구 방';
    $('#roomCodeBox').classList.toggle('hidden', m.quick);
    $('#roomCode').textContent = m.code;
    const isHost = m.host === net.id;
    $('#startBtn').classList.toggle('hidden', m.quick || !isHost);
    $('#addBotBtn').classList.toggle('hidden', m.quick || !isHost);
    const ul = $('#lobbyPlayers'); ul.innerHTML = '';
    for (const p of m.players) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p.id === m.host && !m.quick ? '👑 ' : ''}${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.id === net.id ? ' (나)' : ''}</span><span>${p.bot ? '봇' : '준비 완료'}</span>`;
      ul.appendChild(li);
    }
    clearInterval(lobbyTick);
    if (m.quick && m.state === 'lobby') {
      const until = Date.now() + (m.waitMs || 0);
      const upd = () => {
        const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        $('#lobbyInfo').textContent = `${m.players.length}/6명 · ${s}초 뒤 시작 (빈자리는 봇이 채워요)`;
      };
      upd(); lobbyTick = setInterval(upd, 500);
    } else if (m.quick) {
      $('#lobbyInfo').textContent = '곧 시작해요!';
    } else {
      $('#lobbyInfo').textContent = isHost ? '친구에게 코드를 알려주고, 모이면 시작을 눌러요!' : '방장이 시작하길 기다리는 중...';
    }
  }

  // ───────────────────────── 버튼 연결 ─────────────────────────
  $('#soloBtn').addEventListener('click', () => { getName(); startSolo(); });
  $('#quickBtn').addEventListener('click', () => net.quickMatch());
  $('#createBtn').addEventListener('click', () => net.create());
  $('#joinBtn').addEventListener('click', () => {
    openModal(`<h2>🔑 방 코드 입력</h2><input id="codeIn" maxlength="4" placeholder="ABCD" autocomplete="off">
      <div class="btns"><button class="big-btn pink" id="codeGo">입장</button><button class="mid-btn" id="codeCancel">취소</button></div>`);
    const inp = $('#codeIn'); inp.focus();
    const go = () => { const v = inp.value.trim().toUpperCase(); if (v.length !== 4) { inp.focus(); return; } closeModal(); net.join(v); };
    $('#codeGo').addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#codeCancel').addEventListener('click', closeModal);
  });
  $('#startBtn').addEventListener('click', () => net.send({ t: 'start' }));
  $('#addBotBtn').addEventListener('click', () => net.send({ t: 'addbot' }));
  $('#leaveBtn').addEventListener('click', () => { clearInterval(lobbyTick); net.leave(); goHome(); });
  $('#copyCodeBtn').addEventListener('click', () => {
    const code = $('#roomCode').textContent;
    const done = () => toastHome('코드 복사 완료! 친구에게 보내세요 📋');
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => toastHome('코드: ' + code)); else toastHome('코드: ' + code);
  });
  $('#muteBtn').addEventListener('click', () => { save.muted = !save.muted; persist(); renderHome(); });
  $('#nameInput').addEventListener('change', () => getName());
  $('#quitBtn').addEventListener('click', () => {
    if (!G.active) { if (G.online) net.leave(); goHome(); return; }
    openModal(`<h2>그만할까요?</h2><p>${G.online ? '온라인 경기에서 나가면 탈락 처리돼요.' : '지금 점수로 게임이 끝나요.'}</p>
      <div class="btns"><button class="big-btn green" id="contBtn">계속하기</button><button class="mid-btn" id="exitBtn">나가기</button></div>`);
    $('#contBtn').addEventListener('click', closeModal);
    $('#exitBtn').addEventListener('click', () => {
      closeModal();
      if (G.online) { net.leave(); goHome(); } else gameOver();
    });
  });
  $('#helpBtn').addEventListener('click', () => {
    openModal(`<h2>❓ 이렇게 놀아요</h2><div class="help">
      🧩 아래 조각 3개를 끌어서 8×8 판에 놓아요.<br>
      ➖ 가로나 세로 한 줄이 꽉 차면 <b>펑!</b> 사라져요.<br>
      🔥 연속으로 지우면 <b>콤보</b>! 5콤보부터 <b>피버 타임</b>.<br>
      ✨ 판을 싹 비우면 <b>퍼펙트 클리어</b> +300점.<br>
      🎁 줄을 지울수록 아이템 보상: 🔨뿅망치 · 💣폭탄 · 🔄새로고침<br>
      ⚔️ <b>온라인 배틀</b>: 2줄 이상·콤보로 상대에게 <b>방해블록</b>을 보내요. 줄을 지우면 막을 수 있어요. 마지막까지 살아남으면 우승!<br>
      📅 매일 미션과 연속 접속 보상, 🎨 코인으로 스킨을 모아 보세요.</div>
      <div class="btns"><button class="big-btn green" id="okBtn">알겠어요!</button></div>`);
    $('#okBtn').addEventListener('click', closeModal);
  });
  $('#shopBtn').addEventListener('click', openShop);
  function openShop() {
    const html = Object.entries(SKINS).map(([k, s]) => {
      const owned = save.owned.includes(k);
      const pv = s.colors.slice(0, 4).map((c, i) => `<i style="background:${c}">${s.emo ? s.emo[i] : ''}</i>`).join('');
      return `<button class="skin ${save.skin === k ? 'sel' : ''}" data-k="${k}"><div class="pv">${pv}</div>${s.name}<br><small>${save.skin === k ? '사용 중' : owned ? '보유' : '🪙 ' + s.price}</small></button>`;
    }).join('');
    openModal(`<h2>🎨 꾸미기</h2><div>🪙 ${save.coins.toLocaleString()}</div><div class="skins">${html}</div>
      <div class="btns"><button class="mid-btn" id="shopClose">닫기</button></div>`);
    $$('#modal .skin').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k, s = SKINS[k];
      if (save.owned.includes(k)) { save.skin = k; persist(); sfx.pick(); openShop(); return; }
      if (save.coins < s.price) { toastHome(`코인이 ${s.price - save.coins}개 부족해요! 미션을 깨 보세요`); sfx.bad(); return; }
      save.coins -= s.price; save.owned.push(k); save.skin = k; persist(); sfx.level(); openShop();
    }));
    $('#shopClose').addEventListener('click', () => { closeModal(); renderHome(); });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && G.aiming) { G.aiming = null; renderHUD(); } });

  // 디버그/테스트용 훅 (게임 진행에는 영향 없음)
  window.__br = { G, net, placePiece, canPlace, fitsAnywhere, linesToClear, newTray, gameOver, applyGarbage, SHAPES, save };

  computeCell();
  renderHome();
})();

/* ============================================================
   Двоичная змейка — игровая логика (клиент)
   Рекорды сохраняются на сервере через POST /api/score
   ============================================================ */
(function () {
  'use strict';

  const CFG = {
    COLS: 16,
    ROWS: 16,
    LOGICAL: 520,
    START_LEN: 3,
    START_STEP: 180,
    MIN_STEP: 80,
    STEP_DECAY: 7,
    BITS_PER_SYMBOL: 5,
    TOTAL_LEVELS: 8,
    BIT_LENGTHS: [3, 4, 4, 5, 5, 6, 6, 7],
    MAX_WALLS: 6,
    LIVES: 3,
    HINT_COST: 15,
    BONUS_CHANCE: 0.35,
    SLOW_MS: 3000,
    SCORE_PER_BIT: 10
  };
  const CELL = CFG.LOGICAL / CFG.COLS;

  const state = {
    screen: 'level',
    snake: [],
    prevSnake: [],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    walls: [],
    bits: [],
    bonus: null,
    roundIndex: 0,
    targetDecimal: 0,
    targetBits: '',
    collected: 0,
    score: 0,
    best: 0,
    lives: CFG.LIVES,
    errors: 0,
    levelErrors: 0,
    levelLivesLost: 0,
    stepMs: CFG.START_STEP,
    running: false,
    paused: false,
    slowUntil: 0,
    hintUntil: 0,
    hintUsed: false,
    results: [],
    rafId: 0,
    lastTs: 0,
    acc: 0
  };

  const els = {
    screens: {
      level: document.getElementById('screen-level'),
      game: document.getElementById('screen-game'),
      final: document.getElementById('screen-final')
    },
    btnStartLevel: document.getElementById('btn-start-level'),
    btnPause: document.getElementById('btn-pause'),
    btnResume: document.getElementById('btn-resume'),
    btnRestart: document.getElementById('btn-restart'),
    btnHint: document.getElementById('btn-hint'),
    btnAgain: document.getElementById('btn-again'),
    levelIndex: document.getElementById('level-index'),
    levelTotal: document.getElementById('level-total'),
    levelDecimal: document.getElementById('level-decimal'),
    levelBits: document.getElementById('level-bits'),
    roundIndex: document.getElementById('round-index'),
    roundTotal: document.getElementById('round-total'),
    statScore: document.getElementById('stat-score'),
    statBest: document.getElementById('stat-best'),
    statLives: document.getElementById('stat-lives'),
    statErrors: document.getElementById('stat-errors'),
    targetDecimal: document.getElementById('target-decimal'),
    mathPlace: document.getElementById('math-place'),
    mathRemain: document.getElementById('math-remain'),
    progress: document.getElementById('progress'),
    collectedCount: document.getElementById('collected-count'),
    gameMsg: document.getElementById('game-msg'),
    finalEyebrow: document.getElementById('final-eyebrow'),
    finalSubtitle: document.getElementById('final-subtitle'),
    finalScore: document.getElementById('final-score'),
    finalBest: document.getElementById('final-best'),
    finalRank: document.getElementById('final-rank'),
    saveMsg: document.getElementById('save-msg'),
    finalReview: document.getElementById('final-review'),
    canvas: document.getElementById('field'),
    dpadButtons: document.querySelectorAll('.dpad button'),
    nickname: document.getElementById('nickname'),
    overlay: document.getElementById('pause-overlay')
  };

  const ctx = els.canvas.getContext('2d');
  let DPR = 1;

  /* ---------------- утилиты ---------------- */
  const $ = (el, t) => { if (el) el.textContent = t; };
  const rand = n => Math.floor(Math.random() * n);
  const toBin = n => n.toString(2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------- звук ---------------- */
  let actx = null;
  const soundOn = () => !!(window.snakePrefs && window.snakePrefs.sound);
  function tone(freq, dur, type, vol) {
    if (!soundOn()) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.06, actx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur + 0.02);
    } catch (e) {}
  }
  const sfx = {
    correct() { tone(660, .12, 'triangle', .07); setTimeout(() => tone(880, .14, 'triangle', .06), 70); },
    wrong() { tone(180, .22, 'sawtooth', .05); },
    bonus() { tone(780, .1, 'sine', .06); setTimeout(() => tone(1040, .14, 'sine', .06), 90); },
    level() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .16, 'triangle', .06), i * 95)); },
    over() { [440, 330, 247].forEach((f, i) => setTimeout(() => tone(f, .3, 'sine', .07), i * 160)); }
  };
  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  /* ---------------- экраны ---------------- */
  function showScreen(name) {
    state.screen = name;
    Object.keys(els.screens).forEach(k => els.screens[k].classList.toggle('active', k === name));
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function setMessage(text, type) {
    els.gameMsg.className = 'msg ' + (type || 'info');
    els.gameMsg.textContent = text;
  }

  /* ---------------- поле ---------------- */
  function isBusy(x, y) {
    if (state.snake.some(s => s.x === x && s.y === y)) return true;
    if (state.walls.some(w => w.x === x && w.y === y)) return true;
    if (state.bits.some(b => b.x === x && b.y === y)) return true;
    if (state.bonus && state.bonus.x === x && state.bonus.y === y) return true;
    return false;
  }
  function findFreeCell() {
    for (let i = 0; i < 600; i++) {
      const x = rand(CFG.COLS), y = rand(CFG.ROWS);
      if (!isBusy(x, y)) return { x, y };
    }
    for (let y = 0; y < CFG.ROWS; y++) for (let x = 0; x < CFG.COLS; x++) if (!isBusy(x, y)) return { x, y };
    return null;
  }
  function spawnBits() {
    state.bits = [];
    ['0', '1'].forEach(sym => {
      for (let i = 0; i < CFG.BITS_PER_SYMBOL; i++) {
        const c = findFreeCell(); if (!c) break;
        state.bits.push({ x: c.x, y: c.y, symbol: sym, born: performance.now() });
      }
    });
  }
  function respawnBit(sym) {
    const c = findFreeCell();
    if (c) state.bits.push({ x: c.x, y: c.y, symbol: sym, born: performance.now() });
  }
  function addWall() { const c = findFreeCell(); if (c) state.walls.push(c); }
  function maybeSpawnBonus() {
    if (state.bonus || Math.random() > CFG.BONUS_CHANCE) return;
    const c = findFreeCell();
    if (c) state.bonus = { x: c.x, y: c.y, born: performance.now() };
  }

  /* ---------------- математика ---------------- */
  function nextRequiredBit() {
    const idx = state.targetBits.length - 1 - state.collected;
    return idx < 0 ? null : state.targetBits[idx];
  }
  const remainingValue = () => state.targetDecimal >> state.collected;
  const placeValue = () => Math.pow(2, state.collected);

  /* ---------------- подготовка уровня ---------------- */
  function prepareRound() {
    const bitsLen = CFG.BIT_LENGTHS[state.roundIndex] || 4;
    let n = Math.pow(2, bitsLen - 1) + rand(Math.pow(2, bitsLen - 1));
    if (Math.random() < 0.2) n = (n >> 2) << 2;
    state.targetDecimal = n;
    state.targetBits = toBin(n);

    state.collected = 0;
    state.walls = [];
    state.bits = [];
    state.bonus = null;
    state.paused = false;
    state.running = false;
    state.slowUntil = 0;
    state.hintUntil = 0;
    state.hintUsed = false;
    state.levelErrors = 0;
    state.levelLivesLost = 0;
    state.stepMs = CFG.START_STEP;
    cancelAnimationFrame(state.rafId);

    const cy = Math.floor(CFG.ROWS / 2);
    const cx = Math.floor(CFG.COLS / 2) - 1;
    state.snake = [{ x: cx + 1, y: cy }, { x: cx, y: cy }, { x: cx - 1, y: cy }];
    state.prevSnake = state.snake.map(s => ({ ...s }));
    state.dir = { x: 1, y: 0 };
    state.nextDir = { x: 1, y: 0 };

    spawnBits();

    $(els.levelIndex, String(state.roundIndex + 1));
    $(els.levelTotal, String(CFG.TOTAL_LEVELS));
    $(els.levelDecimal, String(n));
    $(els.levelBits, bitsLen + ' бит · собери от младшего к старшему');

    $(els.roundIndex, String(state.roundIndex + 1));
    $(els.roundTotal, String(CFG.TOTAL_LEVELS));
    $(els.targetDecimal, String(n));
    $(els.collectedCount, '(0 / ' + state.targetBits.length + ')');

    renderProgress();
    renderStats();
    renderMath();
    setMessage('Нажми «Начать уровень», чтобы запустить змейку.', 'info');
    render(0);
    showScreen('level');
  }

  function launchRound() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    $(els.btnPause, 'Пауза');
    els.overlay.classList.remove('show');
    setMessage('Съешь бит и поставь его в число.', 'info');
    showScreen('game');
    state.acc = 0;
    state.lastTs = 0;
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(loop);
  }

  /* ---------------- HUD ---------------- */
  function renderStats() {
    $(els.statScore, String(state.score));
    $(els.statBest, String(state.best));
    $(els.statErrors, String(state.errors));
    $(els.statLives, state.lives > 0 ? '❤️'.repeat(state.lives) : '—');
  }
  function renderMath() {
    const next = nextRequiredBit();
    if (next === null) {
      $(els.mathPlace, 'готово');
      $(els.mathRemain, '0');
    } else {
      $(els.mathPlace, String(placeValue()));
      $(els.mathRemain, String(remainingValue()));
    }
  }
  function renderProgress() {
    const bits = state.targetBits;
    const total = bits.length;
    const nextIdx = total - 1 - state.collected;
    els.progress.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const slot = document.createElement('div');
      slot.className = 'bit-slot';
      if (i > nextIdx) { slot.classList.add('filled'); slot.textContent = bits[i]; }
      else if (i === nextIdx) { slot.classList.add('current'); }
      els.progress.appendChild(slot);
    }
    $(els.collectedCount, '(' + state.collected + ' / ' + total + ')');
  }
  function popCurrentSlot() {
    const slots = els.progress.querySelectorAll('.bit-slot');
    const total = state.targetBits.length;
    const filledIdx = total - 1 - (state.collected - 1);
    if (slots[filledIdx]) slots[filledIdx].classList.add('pop');
  }

  /* ---------------- canvas ---------------- */
  function setupCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    els.canvas.width = CFG.LOGICAL * DPR;
    els.canvas.height = CFG.LOGICAL * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function render(t) {
    t = t || 0;
    const w = CFG.LOGICAL;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = dark ? '#151517' : '#ffffff';
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(60,60,67,.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CFG.COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, CFG.ROWS * CELL); ctx.stroke();
    }
    for (let y = 0; y <= CFG.ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(CFG.COLS * CELL, y * CELL + .5); ctx.stroke();
    }

    const accent = cssColor('--accent') || '#5e5ce6';
    const warn = cssColor('--warn') || '#ff9f0a';
    const text2 = cssColor('--text-2') || '#8e8e93';

    state.walls.forEach(wl => {
      rrect(ctx, wl.x * CELL + 2, wl.y * CELL + 2, CELL - 4, CELL - 4, 7);
      ctx.fillStyle = dark ? '#48484a' : '#8e8e93';
      ctx.fill();
    });

    if (state.bonus) {
      const b = state.bonus;
      const pulse = 1 + Math.sin(performance.now() / 220) * .06;
      const r = (CELL - 10) / 2 * pulse;
      ctx.save();
      ctx.shadowColor = warn; ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = dark ? '#3a2a00' : '#fff3dd';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = warn; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = warn;
      ctx.font = 'bold ' + (CELL * 0.6) + 'px -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', b.x * CELL + CELL / 2, b.y * CELL + CELL / 2 + 1);
      ctx.restore();
    }

    const hintActive = performance.now() < state.hintUntil;
    const required = nextRequiredBit();
    state.bits.forEach(b => {
      const isHint = hintActive && b.symbol === required;
      const cx0 = b.x * CELL + CELL / 2, cy0 = b.y * CELL + CELL / 2;
      const r = (CELL - 9) / 2;
      ctx.save();
      if (isHint && !reducedMotion()) {
        const p = 1 + Math.sin(performance.now() / 160) * .12;
        ctx.shadowColor = accent; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(cx0, cy0, r * p, 0, Math.PI * 2);
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, Math.PI * 2);
      if (b.symbol === '1') {
        ctx.fillStyle = dark ? 'rgba(94,92,230,.30)' : 'rgba(94,92,230,.14)';
        ctx.fill(); ctx.strokeStyle = accent;
      } else {
        ctx.fillStyle = dark ? 'rgba(255,255,255,.06)' : '#f2f2f7';
        ctx.fill(); ctx.strokeStyle = text2;
      }
      ctx.lineWidth = 2; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = b.symbol === '1' ? accent : text2;
      ctx.font = 'bold ' + (CELL * 0.62) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.symbol, cx0, cy0 + 1);
      ctx.restore();
    });

    const n = state.snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const cur = state.snake[i];
      const prev = state.prevSnake[i] || state.prevSnake[state.prevSnake.length - 1] || cur;
      const x = lerp(prev.x, cur.x, t);
      const y = lerp(prev.y, cur.y, t);
      const isHead = i === 0;
      const pad = isHead ? 2 : 3.5;
      ctx.save();
      if (isHead) {
        ctx.shadowColor = accent; ctx.shadowBlur = 14;
        rrect(ctx, x * CELL + pad, y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 9);
        ctx.fillStyle = accent;
      } else {
        const f = i / Math.max(1, n - 1);
        rrect(ctx, x * CELL + pad, y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 8);
        ctx.fillStyle = dark
          ? 'rgba(94,92,230,' + (0.55 - f * 0.3) + ')'
          : 'rgba(94,92,230,' + (0.30 - f * 0.16) + ')';
      }
      ctx.fill();
      ctx.restore();
      if (!isHead) {
        rrect(ctx, x * CELL + pad, y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 8);
        ctx.strokeStyle = 'rgba(94,92,230,.45)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  /* ---------------- цикл ---------------- */
  function effectiveStep() {
    const slow = performance.now() < state.slowUntil;
    return state.stepMs * (slow ? 1.9 : 1);
  }
  function loop(ts) {
    if (!state.running || state.paused) return;
    if (!state.lastTs) state.lastTs = ts;
    let dt = ts - state.lastTs;
    state.lastTs = ts;
    if (dt > 250) dt = 250;
    state.acc += dt;

    let guard = 0;
    while (state.acc >= effectiveStep() && state.running && guard++ < 5) {
      state.acc -= effectiveStep();
      step();
    }
    if (!state.running) return;
    const t = clamp(state.acc / effectiveStep(), 0, 1);
    render(t);
    state.rafId = requestAnimationFrame(loop);
  }

  function step() {
    state.dir = { ...state.nextDir };
    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    if (nx < 0 || nx >= CFG.COLS || ny < 0 || ny >= CFG.ROWS) { loseLife('Стена поля'); return; }
    if (state.walls.some(w => w.x === nx && w.y === ny)) { loseLife('Стена'); return; }

    const bitIdx = state.bits.findIndex(b => b.x === nx && b.y === ny);
    const bonusHit = state.bonus && state.bonus.x === nx && state.bonus.y === ny;
    const willEat = bitIdx !== -1;
    const willGrow = willEat || bonusHit;

    const bodyToCheck = willGrow ? state.snake : state.snake.slice(0, -1);
    if (bodyToCheck.some(s => s.x === nx && s.y === ny)) { loseLife('Столкновение с собой'); return; }

    state.prevSnake = state.snake.map(s => ({ ...s }));
    state.snake.unshift({ x: nx, y: ny });

    if (bonusHit) {
      state.bonus = null;
      state.score += 30;
      if (!reducedMotion()) state.slowUntil = performance.now() + CFG.SLOW_MS;
      setMessage('Бонус! +30 очков, змейка замедлилась.', 'warn');
      sfx.bonus(); vibrate(30);
      renderStats(); render();
      return;
    }

    if (!willEat) { state.snake.pop(); renderStats(); return; }

    const bit = state.bits[bitIdx];
    const required = nextRequiredBit();

    if (bit.symbol !== required) {
      state.errors += 1;
      state.levelErrors += 1;
      loseLife('Неверный бит');
      state.bits.splice(bitIdx, 1);
      respawnBit(bit.symbol);
      renderStats();
      return;
    }

    state.collected += 1;
    state.score += CFG.SCORE_PER_BIT;
    state.bits.splice(bitIdx, 1);
    respawnBit(bit.symbol);

    if (state.collected % 3 === 0) state.stepMs = Math.max(CFG.MIN_STEP, state.stepMs - CFG.STEP_DECAY);
    if (state.collected % 4 === 0 && state.walls.length < CFG.MAX_WALLS) addWall();
    maybeSpawnBonus();

    sfx.correct(); vibrate(15);
    renderStats(); renderProgress(); renderMath(); popCurrentSlot();

    const next = nextRequiredBit();
    if (next === null) setMessage('Число собрано!', 'ok');
    else setMessage('Верно! Осталось бит: ' + (state.targetBits.length - state.collected), 'ok');

    if (state.collected >= state.targetBits.length) {
      state.running = false;
      cancelAnimationFrame(state.rafId);
      sfx.level();
      setTimeout(finishRound, 850);
    }
  }

  function loseLife(reason) {
    state.lives -= 1;
    state.levelLivesLost += 1;
    sfx.wrong(); vibrate([40, 30, 40]);
    if (state.lives <= 0) { endGame(reason + '. Жизни закончились.'); return; }

    const cy = Math.floor(CFG.ROWS / 2);
    const cx = Math.floor(CFG.COLS / 2) - 1;
    state.snake = [{ x: cx + 1, y: cy }, { x: cx, y: cy }, { x: cx - 1, y: cy }];
    state.prevSnake = state.snake.map(s => ({ ...s }));
    state.dir = { x: 1, y: 0 };
    state.nextDir = { x: 1, y: 0 };
    setMessage(reason + '. Осталось жизней: ' + state.lives + '.', 'err');
    renderStats();
    render(0);
  }

  /* ---------------- управление ---------------- */
  function setDirection(name) {
    if (!state.running || state.paused) return;
    const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const nd = map[name];
    if (!nd) return;
    if (nd.x === -state.dir.x && nd.y === -state.dir.y) return;
    state.nextDir = nd;
  }
  function togglePause(force) {
    if (!state.running) return;
    const next = (typeof force === 'boolean') ? force : !state.paused;
    if (next === state.paused) return;
    state.paused = next;
    if (state.paused) {
      cancelAnimationFrame(state.rafId);
      els.overlay.classList.add('show');
      els.btnResume.focus();
    } else {
      els.overlay.classList.remove('show');
      state.lastTs = 0;
      state.rafId = requestAnimationFrame(loop);
    }
  }
  function useHint() {
    if (!state.running || state.paused) return;
    const req = nextRequiredBit();
    if (req === null) return;
    state.hintUntil = performance.now() + 2200;
    if (!state.hintUsed) {
      state.hintUsed = true;
      state.score = Math.max(0, state.score - CFG.HINT_COST);
      renderStats();
    }
    setMessage('Подсказка: нужен бит «' + req + '» (разряд ' + placeValue() + ').', 'warn');
    render(0);
  }

  /* ---------------- итоги ---------------- */
  function levelStars() {
    if (state.levelErrors === 0 && state.levelLivesLost === 0) return 3;
    if (state.levelErrors <= 2) return 2;
    return 1;
  }

  function finishRound() {
    const stars = levelStars();
    state.results.push({ decimal: state.targetDecimal, binary: state.targetBits, stars });
    state.score += state.targetBits.length * CFG.SCORE_PER_BIT;
    if (state.score > state.best) state.best = state.score;

    if (state.roundIndex < CFG.TOTAL_LEVELS - 1) {
      state.roundIndex += 1;
      prepareRound();
    } else {
      endGame('Все уровни пройдены!');
    }
  }

  async function saveScore() {
    const totalStars = state.results.reduce((a, r) => a + r.stars, 0);
    $(els.saveMsg, 'Сохраняем результат…');
    els.saveMsg.className = 'msg ok';
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: state.score,
          stars: totalStars,
          levels: state.results.length,
          errors: state.errors
        })
      });
      const data = await res.json();
      if (data.ok) {
        state.best = Math.max(state.best, data.personal_best || 0);
        $(els.finalBest, String(state.best));
        $(els.finalRank, data.rank ? ('#' + data.rank) : '—');
        $(els.saveMsg, 'Результат сохранён в базе данных. Личный рекорд: ' + state.best + '.');
      } else {
        $(els.saveMsg, 'Не удалось сохранить результат.');
        els.saveMsg.className = 'msg err';
      }
    } catch (e) {
      $(els.saveMsg, 'Сервер недоступен — результат не сохранён.');
      els.saveMsg.className = 'msg err';
    }
  }

  function endGame(reason) {
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    els.overlay.classList.remove('show');
    if (state.lives <= 0) sfx.over();

    $(els.finalEyebrow, state.lives <= 0 ? 'Игра окончена' : 'Игра завершена');
    $(els.finalScore, String(state.score));
    $(els.finalBest, String(state.best));
    $(els.finalRank, '…');
    $(els.finalSubtitle, (reason || '') + ' Ошибок: ' + state.errors + '.');

    els.finalReview.innerHTML = '';
    if (state.results.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Ни одного числа не собрано.';
      els.finalReview.appendChild(li);
    } else {
      state.results.forEach(r => {
        const li = document.createElement('li');
        const left = document.createElement('span');
        const num = document.createElement('span'); num.className = 'num'; num.textContent = r.decimal;
        const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '  →  ';
        left.appendChild(num); left.appendChild(arrow);
        const bin = document.createElement('span'); bin.className = 'bin'; bin.textContent = r.binary;
        const stars = document.createElement('span'); stars.className = 'stars';
        stars.textContent = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
        li.appendChild(left); li.appendChild(bin); li.appendChild(stars);
        els.finalReview.appendChild(li);
      });
    }

    showScreen('final');
    saveScore();
  }

  /* ---------------- старт ---------------- */
  function startGame() {
    state.score = 0;
    state.errors = 0;
    state.lives = CFG.LIVES;
    state.roundIndex = 0;
    state.paused = false;
    state.running = false;
    state.results = [];
    state.stepMs = CFG.START_STEP;
    cancelAnimationFrame(state.rafId);
    if (els.btnPause) els.btnPause.textContent = 'Пауза';
    prepareRound();
  }

  /* ---------------- события ---------------- */
  function init() {
    state.best = parseInt(els.statBest && els.statBest.textContent, 10) || 0;

    els.btnStartLevel.addEventListener('click', launchRound);
    els.btnAgain.addEventListener('click', startGame);
    els.btnResume.addEventListener('click', () => togglePause(false));
    els.btnPause.addEventListener('click', () => togglePause());
    els.btnHint.addEventListener('click', useHint);
    els.btnRestart.addEventListener('click', () => { cancelAnimationFrame(state.rafId); state.running = false; startGame(); });
    els.overlay.addEventListener('click', e => { if (e.target === els.overlay) togglePause(false); });

    els.dpadButtons.forEach(btn => btn.addEventListener('click', () => setDirection(btn.getAttribute('data-dir'))));

    document.addEventListener('keydown', e => {
      if (e.key === 'Tab') return;
      if (state.screen !== 'game') {
        if (e.key === 'Enter' && state.screen === 'level') { e.preventDefault(); launchRound(); }
        return;
      }
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); setDirection('up'); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); setDirection('down'); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); setDirection('left'); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); setDirection('right'); }
      else if (k === ' ' || k === 'Spacebar') { e.preventDefault(); togglePause(); }
      else if (k === 'h' || k === 'H' || k === 'р' || k === 'Р') { e.preventDefault(); useHint(); }
    });

    let tStart = null;
    els.canvas.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]; tStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    els.canvas.addEventListener('touchend', e => {
      if (!tStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      tStart = null;
      if (Math.max(ax, ay) < 22) return;
      if (ax > ay) setDirection(dx > 0 ? 'right' : 'left');
      else setDirection(dy > 0 ? 'down' : 'up');
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.running && !state.paused) togglePause(true);
    });
    window.addEventListener('blur', () => { if (state.running && !state.paused) togglePause(true); });
    window.addEventListener('resize', () => { setupCanvas(); render(0); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render(0));

    setupCanvas();
    renderStats();
    render(0);
    prepareRound();
  }

  init();
})();

(() => {
  'use strict';

  const W = 1920, H = 1080;
  const ROUND_SEC = 90;
  const STORAGE_KEY = 'baoji-chui-kui-save';
  const TOP_N = 20;
  const SERVE_WAIT = 4.0; // seconds to serve after uncover

  const firebaseConfig = {
    apiKey: 'AIzaSyCuQlCYRkta4cWF67prIIQaUv0JX1R-QsQ',
    authDomain: 'baoji-chui-kui.firebaseapp.com',
    databaseURL: 'https://baoji-chui-kui-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'baoji-chui-kui',
    storageBucket: 'baoji-chui-kui.firebasestorage.app',
    messagingSenderId: '281396127724',
    appId: '1:281396127724:web:576e36126934dca2ee82c9',
  };

  let db = null;
  let submitInFlight = false;
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    }
  } catch (err) {
    console.error('Firebase init failed', err);
    db = null;
  }

  const GRADE = {
    HONGXIN: { id: '紅心', score: 300, cls: 'good' },
    QIA: { id: '恰到好處', score: 200, cls: 'ok' },
    WEIJIAO: { id: '微焦', score: 80, cls: 'warn' },
    SHENG: { id: '生', score: 0, cls: 'bad' },
    JIAOHUI: { id: '焦毀', score: 0, cls: 'bad' },
    MEIJIE: { id: '沒揭到', score: 0, cls: 'bad' },
  };

  // Avatar sheet: 2x3 grid on 1280x720
  const AVATAR = {
    IDLE: 0, FIRE: 1, PROUD: 2, PANIC: 4, RUSH: 5, WIN: 6,
  };
  // indices 0..5 matching sheet cells
  const AV = { idle: 0, fire: 1, proud: 2, panic: 3, rush: 4, win: 5 };
  // HUD sheet is 2×3, reading order. Cell 5 (1-based) is the sweating 被催單緊張 face.
  const AV_SCARED = 4;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const assets = {};
  const ASSET_LIST = [
    ['wall', 'assets/01-far-wall-lids.jpg'],
    ['plate', 'assets/02-clean-plate-no-fx-1920x1080.jpg'],
    ['fire', 'assets/03-fire.png'],
    ['stove', 'assets/04-stove.png'],
    ['fg', 'assets/05b-foreground-v2-crate-fan.png'],
    ['stage', 'assets/09-stage-traditional-stove-mobile-v2.jpg'],
    ['baoge', 'assets/baoge-fullbody-34-idle-smile.png'],
    ['hudSheet', 'assets/baoge-hud-avatars-sheet.jpg'],
    ['bustSheet', 'assets/baoge-expressions-bust-sheet.jpg'],
    ['combo', 'assets/baoge-combo-closeup.jpg'],
    ['titleArt', 'assets/baoji-character-art.jfif'],
  ];

  // Interactive zones in design space
  const ZONES = {
    basket: { x: 220, y: 700, w: 340, h: 230, label: '出餐' },
    fan: { x: 1120, y: 580, w: 340, h: 280, label: '搧火' },
  };

  // Steamers unlock over heat/time. Spread across the stove so each kueh reads on its own.
  // Hit size is the visible pot; the cake is drawn at KUEH_WIDTH_RATIO of that width.
  const KUEH_WIDTH_RATIO = 0.72;
  const BAOGE_FLOOR = 1040;
  const BAOGE_H = Math.round(H * 0.38);
  const BAOGE_HOME_X = 860;
  const CRITTER_LIFE = 3;
  const EVENT_SCORE = 50;
  const ROACH_PENALTY = 150;
  const MOUSE_PENALTY = 200;
  const STEAMER_DEFS = [
    { id: 'a1', name: '鋁籠·左', x: 180, y: 400, w: 310, h: 170, unlockAt: 0, kind: 'alum' },
    { id: 'a2', name: '鋁籠·中下', x: 560, y: 408, w: 300, h: 170, unlockAt: 0, kind: 'alum' },
    { id: 'a3', name: '鋁籠·中上', x: 545, y: 205, w: 300, h: 160, unlockAt: 18, kind: 'alum' },
    { id: 'b1', name: '竹籠·下', x: 980, y: 412, w: 310, h: 158, unlockAt: 28, kind: 'bamboo' },
    { id: 'b2', name: '竹籠·中', x: 1220, y: 214, w: 280, h: 156, unlockAt: 42, kind: 'bamboo' },
    { id: 'b3', name: '竹籠·上', x: 890, y: 198, w: 280, h: 158, unlockAt: 55, kind: 'bamboo' },
  ];

  let state = 'boot'; // boot|title|play|results|boards
  let save = null;
  let playerName = '';
  let pendingRecord = null;

  // Play state
  let play = null;
  let lastTs = 0;
  let avatarExpr = AV.idle;
  let avatarHold = 0;
  let comboPopupT = 0;
  let firePulse = 0;
  let fanning = false;
  let pointers = new Map();
  let vizT = 0;
  let audioCtx = null;
  let chompAt = -1;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadAll() {
    await Promise.all(ASSET_LIST.map(async ([k, src]) => {
      assets[k] = await loadImage(src);
    }));
  }

  function defaultSave() {
    return { playerName: '' };
  }

  function readSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSave();
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return defaultSave();
      // Keep playerName only for shared-board purposes; leftover daily/allTime fields
      // may still exist in older saves but are no longer used as boards.
      return {
        playerName: typeof data.playerName === 'string' ? data.playerName : '',
      };
    } catch {
      return defaultSave();
    }
  }

  function writeSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ playerName: save.playerName || '' }));
  }

  function todayTaipei() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function formatBoardTime(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
      return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
    } catch {
      return '';
    }
  }

  function normalizeEntries(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.slice();
    if (typeof raw === 'object') {
      return Object.keys(raw)
        .filter((k) => /^(0|[1-9]|1[0-9])$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => raw[k]);
    }
    return [];
  }

  function sanitizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const name = String(e.name || '').trim();
    if (name.length < 2 || name.length > 8) return null;
    const score = Number(e.score);
    const maxCombo = Number(e.maxCombo);
    const time = typeof e.time === 'string' ? e.time : '';
    if (!Number.isFinite(score) || score < 0) return null;
    if (!Number.isFinite(maxCombo) || maxCombo < 0) return null;
    if (!time || time.length <= 0) return null;
    return { name, score, maxCombo, time };
  }

  function sortBoard(arr) {
    return arr.slice().sort((a, b) => b.score - a.score || (b.maxCombo || 0) - (a.maxCombo || 0));
  }

  function mergeBoard(existing, rec) {
    const list = normalizeEntries(existing)
      .map(sanitizeEntry)
      .filter(Boolean);
    list.push(rec);
    return sortBoard(list).slice(0, TOP_N);
  }

  function displayName(n) {
    const t = (n || '').trim();
    if (t.length >= 2 && t.length <= 8) return t;
    return '訪客';
  }

  function validName(n) {
    const t = (n || '').trim();
    return t.length >= 2 && t.length <= 8;
  }

  function setSubmitError(msg) {
    const el = $('submit-error');
    if (!el) {
      if (msg) alert(msg);
      return;
    }
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setSubmitBusy(busy) {
    submitInFlight = !!busy;
    const btn = $('btn-submit');
    if (btn) {
      btn.disabled = !!busy;
      btn.textContent = busy ? '登錄中…' : '登錄排行榜';
    }
  }

  function runTransaction(path, updater) {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject(new Error('Firebase 未初始化'));
        return;
      }
      db.ref(path).transaction((current) => {
        try {
          return updater(current);
        } catch (err) {
          console.error('transaction updater error', err);
          return; // abort
        }
      }, (error, committed, snapshot) => {
        if (error) reject(error);
        else if (!committed) reject(new Error('寫入未提交'));
        else resolve(snapshot && snapshot.val());
      }, false);
    });
  }

  function setAvatar(expr, holdSec = 1.2) {
    avatarExpr = expr;
    avatarHold = holdSec;
    updateHudAvatar();
  }

  function updateHudAvatar() {
    const el = $('hud-avatar');
    if (!el || !assets.hudSheet) return;
    // 2 rows x 3 cols on 1280x720 → each cell 426.67 x 360
    const col = exprCol(avatarExpr);
    const row = exprRow(avatarExpr);
    const bw = 100 / 3, bh = 100 / 2;
    el.style.backgroundImage = `url(assets/baoge-hud-avatars-sheet.jpg)`;
    el.style.backgroundSize = `${300}% ${200}%`;
    el.style.backgroundPosition = `${col * 50}% ${row * 100}%`;
  }

  function exprCol(i) { return i % 3; }
  function exprRow(i) { return Math.floor(i / 3); }

  function setBust(expr) {
    const el = $('results-bust');
    if (!el) return;
    const col = exprCol(expr);
    const row = exprRow(expr);
    el.style.backgroundImage = `url(assets/baoge-expressions-bust-sheet.jpg)`;
    el.style.backgroundSize = `${300}% ${200}%`;
    el.style.backgroundPosition = `${col * 50}% ${row * 100}%`;
  }

  function showScreen(id) {
    ['screen-title', 'screen-results', 'screen-boards'].forEach((s) => {
      $(s).classList.toggle('hidden', s !== id);
    });
    $('hud').classList.toggle('hidden', id !== null);
    $('touch-hint').classList.toggle('hidden', id !== null);
    if (id === null) {
      // playing
      $('hud').classList.remove('hidden');
      $('touch-hint').classList.remove('hidden');
    }
  }

  function multiplier(combo) {
    return Math.min(3.0, 1 + 0.1 * combo);
  }

  function heatWindows(heat) {
    // Ideal cook progress center ~0.62; windows tighten with heat
    const t = Math.min(1, Math.max(0, (heat - 20) / 70));
    const hong = 0.10 - t * 0.055; // half-width
    const qia = 0.20 - t * 0.08;
    const wei = 0.30 - t * 0.08;
    return { ideal: 0.62, hong, qia, wei };
  }

  function gradeFromProgress(p, heat) {
    const w = heatWindows(heat);
    const d = p - w.ideal;
    const ad = Math.abs(d);
    if (p > w.ideal + w.wei + 0.12) return GRADE.JIAOHUI;
    if (ad <= w.hong) return GRADE.HONGXIN;
    if (ad <= w.qia) return GRADE.QIA;
    if (d > 0 && d <= w.wei) return GRADE.WEIJIAO;
    if (d < 0) return GRADE.SHENG;
    return GRADE.WEIJIAO;
  }

  function makeSteamer(def) {
    return {
      ...def,
      state: 'empty', // empty|cooking|serve|cooldown
      progress: 0,
      cookTime: 0,
      overflowed: false,
      serveTimer: 0,
      flash: 0,
      lastGrade: null,
      unlocked: def.unlockAt <= 0,
      // Visual only — scoring still reads progress / grade.score.
      shownProgress: 0,
      lastHit: 0,
      revealAge: -1,
      carryAge: -1,
      carried: false,
      puffLife: 0,
      scale: 1,
      lidOpen: 0.62,
    };
  }

  function startRound() {
    const nameFromInput = ($('name-input').value || '').trim();
    if (validName(nameFromInput)) {
      playerName = nameFromInput;
      save.playerName = playerName;
      writeSave();
    } else if (validName(save.playerName)) {
      playerName = save.playerName;
    } else {
      playerName = '';
    }

    play = {
      timeLeft: ROUND_SEC,
      score: 0,
      combo: 0,
      maxCombo: 0,
      heat: 28,
      heatVel: 0,
      steamers: STEAMER_DEFS.map(makeSteamer),
      baoge: { x: BAOGE_HOME_X, y: BAOGE_FLOOR, tx: BAOGE_HOME_X, ty: BAOGE_FLOOR, facing: 1 },
      drops: [],
      sparks: [],
      selectedId: 'a1',
      critter: null,
      nextCritter: 30,
      edgeFlash: 0,
      events: [],
      eventCD: 8,
      milestones: { 5: false, 10: false, 15: false },
      stats: { hong: 0, qia: 0, wei: 0, fail: 0, serves: 0 },
      tutorialT: 6,
      rushT: 0,
      flareT: 0,
      burstTarget: null,
      charcoalFlicker: 0,
      fireOpen: false,
    };
    fanning = false;
    pointers.clear();
    setAvatar(AV.idle, 99);
    updateHud();
    showScreen(null);
    state = 'play';
    $('hud-name').textContent = displayName(playerName);
  }

  function endRound() {
    state = 'results';
    fanning = false;
    const name = displayName(playerName);
    pendingRecord = {
      name,
      score: play.score,
      maxCombo: play.maxCombo,
      time: new Date().toISOString(),
      _rawName: playerName,
      stats: { ...play.stats },
    };
    setAvatar(AV.win, 99);
    setBust(AV.win);
    $('results-score').textContent = String(play.score);
    $('results-detail').innerHTML =
      `最高連擊 <b>${play.maxCombo}</b> · 紅心 ${play.stats.hong} · 恰到好處 ${play.stats.qia}<br>` +
      `微焦 ${play.stats.wei} · 失敗 ${play.stats.fail} · 準時出餐 ${play.stats.serves}`;
    $('results-name').value = validName(playerName) ? playerName : '';
    setSubmitError('');
    setSubmitBusy(false);
    showScreen('screen-results');
    $('hud').classList.add('hidden');
    $('touch-hint').classList.add('hidden');
  }

  async function submitBoard() {
    if (!pendingRecord || submitInFlight) return;
    setSubmitError('');
    const typed = ($('results-name').value || '').trim();
    const name = validName(typed) ? typed : '訪客';
    if (validName(typed)) {
      playerName = typed;
      save.playerName = typed;
      writeSave();
    }

    const rec = {
      name,
      score: Number(pendingRecord.score),
      maxCombo: Number(pendingRecord.maxCombo),
      time: pendingRecord.time || new Date().toISOString(),
    };
    if (!Number.isFinite(rec.score) || rec.score < 0) rec.score = 0;
    if (!Number.isFinite(rec.maxCombo) || rec.maxCombo < 0) rec.maxCombo = 0;

    setSubmitBusy(true);
    try {
      const today = todayTaipei();
      await runTransaction('leaderboard/daily', (current) => {
        const cur = current && typeof current === 'object' ? current : null;
        const curDate = cur && typeof cur.date === 'string' ? cur.date : '';
        let entries;
        if (curDate !== today) {
          entries = [rec];
        } else {
          entries = mergeBoard(cur && cur.entries, rec);
        }
        return { date: today, entries };
      });
      await runTransaction('leaderboard/allTime', (current) => {
        const cur = current && typeof current === 'object' ? current : null;
        const entries = mergeBoard(cur && cur.entries, rec);
        return { entries };
      });
      pendingRecord = null;
      setSubmitBusy(false);
      await renderBoards();
      showScreen('screen-boards');
      state = 'boards';
    } catch (err) {
      console.error(err);
      setSubmitBusy(false);
      const msg = (err && err.message) ? String(err.message) : String(err);
      setSubmitError(`登錄失敗：${msg}（可再試一次）`);
      // keep pendingRecord so the player can retry
    }
  }

  function fillBoardList(ol, arr, emptyMsg) {
    ol.innerHTML = '';
    const list = sortBoard(arr).slice(0, TOP_N);
    if (!list.length) {
      ol.innerHTML = `<li>${emptyMsg || '（尚無紀錄）'}</li>`;
      return;
    }
    list.forEach((e, i) => {
      const li = document.createElement('li');
      const ts = formatBoardTime(e.time);
      li.textContent = `${e.name} · ${e.score} 分 · 連擊${e.maxCombo || 0}${ts ? ` · ${ts}` : ''}`;
      if (i === 0) li.style.color = '#ffe08a';
      ol.appendChild(li);
    });
  }

  async function renderBoards() {
    const dailyOl = $('board-daily');
    const allOl = $('board-alltime');
    dailyOl.innerHTML = '<li>讀取中…</li>';
    allOl.innerHTML = '<li>讀取中…</li>';

    if (!db) {
      dailyOl.innerHTML = '<li>連線榜讀取失敗</li>';
      allOl.innerHTML = '<li>連線榜讀取失敗</li>';
      return;
    }

    try {
      const [dailySnap, allSnap] = await Promise.all([
        db.ref('leaderboard/daily').once('value'),
        db.ref('leaderboard/allTime').once('value'),
      ]);
      const today = todayTaipei();
      const dailyVal = dailySnap.val();
      let dailyEntries = [];
      if (dailyVal && typeof dailyVal === 'object' && dailyVal.date === today) {
        dailyEntries = normalizeEntries(dailyVal.entries).map(sanitizeEntry).filter(Boolean);
      }
      // stale daily.date !== today → show empty (hide yesterday)
      fillBoardList(dailyOl, dailyEntries);

      const allVal = allSnap.val();
      const allEntries = allVal && typeof allVal === 'object'
        ? normalizeEntries(allVal.entries).map(sanitizeEntry).filter(Boolean)
        : [];
      fillBoardList(allOl, allEntries);
    } catch (err) {
      console.error(err);
      dailyOl.innerHTML = '<li>連線榜讀取失敗</li>';
      allOl.innerHTML = '<li>連線榜讀取失敗</li>';
    }
  }

  function updateHud() {
    if (!play) return;
    $('hud-score').textContent = String(Math.floor(play.score));
    const mul = multiplier(play.combo);
    $('hud-combo').textContent = `連擊 ${play.combo} · ×${mul.toFixed(1)}`;
    const m = Math.floor(play.timeLeft / 60);
    const s = Math.floor(play.timeLeft % 60);
    $('hud-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
    const heatPct = Math.max(0, Math.min(100, play.heat));
    $('heat-fill').style.width = `${heatPct}%`;
    $('heat-val').textContent = String(Math.round(play.heat));
    const hint = $('touch-hint');
    if (hint) hint.textContent = currentAction();
  }

  function currentAction() {
    if (!play) return '倒漿';
    const open = play.steamers.filter((s) => s.unlocked);
    if (open.some((s) => s.state === 'serve')) return '出餐';
    const cooking = open.filter((s) => s.state === 'cooking');
    if (cooking.length) {
      const ready = cooking.some((s) => {
        if (play.burstTarget === s.id) return true;
        const g = gradeFromProgress(s.progress, play.heat);
        return g.score > 0 || g === GRADE.JIAOHUI;
      });
      return ready ? '揭籠' : '搧火';
    }
    return '倒漿';
  }

  function stageInfo(p) {
    if (p < 0.18) return { key: 'liquid', label: '漿液', icon: 'wave' };
    if (p < 0.42) return { key: 'setting', label: '凝固', icon: 'half' };
    if (p < 0.74) return { key: 'cooked', label: '熟', icon: 'cake' };
    if (p < 0.96) return { key: 'scorch', label: '微焦', icon: 'tri' };
    return { key: 'burnt', label: '焦黑', icon: 'cross' };
  }

  function focusSteamer() {
    if (!play) return null;
    if (play.burstTarget) {
      const burst = play.steamers.find((s) => s.id === play.burstTarget && s.unlocked && s.state === 'cooking');
      if (burst) return burst;
    }
    if (play.selectedId) {
      const sel = play.steamers.find((s) => s.id === play.selectedId && s.unlocked && s.state !== 'cooldown');
      if (sel) return sel;
    }
    const action = currentAction();
    if (action === '揭籠') {
      const cooking = play.steamers.filter((s) => s.unlocked && s.state === 'cooking');
      const w = heatWindows(play.heat);
      cooking.sort((a, b) => Math.abs(a.progress - w.ideal) - Math.abs(b.progress - w.ideal));
      return cooking[0] || null;
    }
    if (action === '出餐') {
      const ready = play.steamers.filter((s) => s.state === 'serve');
      ready.sort((a, b) => a.serveTimer - b.serveTimer);
      return ready[0] || null;
    }
    return play.steamers.find((s) => s.unlocked && s.state === 'empty') || null;
  }

  function approachBaoge(x) {
    const bw = BAOGE_H * ((assets.baoge && assets.baoge.width) ? assets.baoge.width / assets.baoge.height : 0.75);
    const minX = ZONES.basket.x + ZONES.basket.w + bw * 0.2;
    const maxX = ZONES.fan.x - bw * 0.2;
    play.baoge.tx = Math.max(minX, Math.min(maxX, x));
    play.baoge.ty = BAOGE_FLOOR;
  }

  function crouchDrop() {
    return fanning ? 28 : 0;
  }

  function floatText(x, y, text, cls) {
    const layer = $('float-layer');
    const el = document.createElement('div');
    el.className = `float-text ${cls || 'good'}`;
    el.textContent = text;
    // convert design → overlay %
    const rect = canvas.getBoundingClientRect();
    const root = $('game-root').getBoundingClientRect();
    const px = rect.left - root.left + (x / W) * rect.width;
    const py = rect.top - root.top + (y / H) * rect.height;
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  function showComboPopup() {
    comboPopupT = 1.4;
    $('combo-popup').classList.remove('hidden');
  }

  function awardUncover(st, grade) {
    let base = grade.score;
    let extras = 0;
    let comboBefore = play.combo;

    if (grade === GRADE.HONGXIN || grade === GRADE.QIA) {
      play.combo += 1;
      setAvatar(AV.proud, 1.4);
    } else if (grade === GRADE.WEIJIAO) {
      // stays
      setAvatar(AV.fire, 1.0);
    } else {
      play.combo = 0;
      setAvatar(AV.panic, 1.6);
      play.stats.fail += 1;
    }

    if (grade === GRADE.HONGXIN) play.stats.hong += 1;
    if (grade === GRADE.QIA) play.stats.qia += 1;
    if (grade === GRADE.WEIJIAO) play.stats.wei += 1;

    play.maxCombo = Math.max(play.maxCombo, play.combo);

    // shape bonus
    if (grade.score > 0 && !st.overflowed) {
      extras += 50;
    }

    const mul = multiplier(play.combo);
    let hit = Math.floor((base + extras) * mul);

    // combo milestones
    let bonus = 0;
    for (const m of [5, 10, 15]) {
      if (play.combo >= m && !play.milestones[m]) {
        play.milestones[m] = true;
        const add = m === 5 ? 500 : m === 10 ? 1000 : 2000;
        bonus += add;
        if (m === 5) {
          play.fireOpen = true;
          showComboPopup();
        }
      }
    }
    hit += bonus;
    play.score += hit;

    // Freeze the look and the score this function just computed. Drawing reads these;
    // it does not invent a reward.
    st.shownProgress = st.progress;
    st.lastHit = hit;
    st.revealAge = 0;
    st.puffLife = 0.9;
    st.carryAge = -1;
    st.carried = false;
    st.scale = 1;
    st.lidOpen = 0.22;

    floatText(st.x + st.w / 2, st.y, `${grade.id} +${hit}`, grade.cls);
    if (extras && grade.score > 0) {
      floatText(st.x + st.w / 2, st.y + 36, '型完好 +50', 'bonus');
    }
    if (bonus) floatText(W / 2, H * 0.28, `連擊獎勵 +${bonus}`, 'good');

    st.lastGrade = grade;
    if (grade.score > 0) {
      st.state = 'serve';
      st.serveTimer = SERVE_WAIT;
      st.progress = 0;
    } else {
      st.state = 'cooldown';
      st.flash = 0.6;
      st.progress = 0;
      st.cookTime = 0.5;
    }
    updateHud();
  }

  function tryServe() {
    if (!play) return;
    const ready = play.steamers.filter((s) => s.state === 'serve');
    if (!ready.length) {
      floatText(ZONES.basket.x + ZONES.basket.w / 2, ZONES.basket.y, '沒有可出餐的粿', 'warn');
      return;
    }
    // serve the one with least remaining time
    ready.sort((a, b) => a.serveTimer - b.serveTimer);
    const st = ready[0];
    const mul = multiplier(play.combo);
    const add = Math.floor(30 * mul);
    play.score += add;
    play.stats.serves += 1;
    spawnDrop(st);
    st.state = 'cooldown';
    st.cookTime = 0.35;
    st.serveTimer = 0;
    st.carried = false;
    st.carryAge = -1;
    setAvatar(AV.proud, 1.0);
    floatText(ZONES.basket.x + ZONES.basket.w / 2, ZONES.basket.y + 40, `出餐 +${add}`, 'bonus');
    updateHud();
  }

  function pourSteamer(st) {
    if (st.state !== 'empty' || !st.unlocked) return;
    st.state = 'cooking';
    st.progress = 0.02;
    st.shownProgress = 0.02;
    st.overflowed = false;
    st.cookTime = 0;
    st.revealAge = -1;
    st.carryAge = -1;
    st.carried = false;
    st.puffLife = 0;
    st.scale = 1;
    st.lidOpen = 0;
    st.heartPlayed = false;
    st.heartTimer = 0;
    st.ruinedT = 0;
    st.lastGrade = null;
    st.lastHit = 0;
    play.selectedId = st.id;
    setAvatar(AV.fire, 0.8);
    floatText(st.x + st.w / 2, st.y + st.h / 2, '倒漿', 'ok');
    approachBaoge(st.x + st.w / 2);
  }

  function uncoverSteamer(st) {
    if (st.state !== 'cooking') return;
    play.selectedId = st.id;
    const grade = gradeFromProgress(st.progress, play.heat);
    awardUncover(st, grade);
    approachBaoge(st.x + st.w / 2);
  }

  function cookSteam(st) {
    const w = heatWindows(play.heat);
    const p = st.progress;
    if (p > w.ideal + w.hong) return 'over';
    if (Math.abs(p - w.ideal) <= w.hong) return 'heart';
    if (p >= w.ideal - w.qia) return 'near';
    return 'raw';
  }

  function critterTap() {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / W : 0.36;
    // 76 CSS px stays above the 64px minimum after device-pixel rounding.
    return Math.max(76 / scale, 76);
  }

  function critterPos(c) {
    const u = Math.min(1, Math.max(0, c.age / CRITTER_LIFE));
    if (c.kind === 'roach') {
      const st = play.steamers.find((s) => s.id === c.targetId) || play.steamers[0];
      const tx = st.x + st.w / 2;
      const ty = st.y + st.h * 0.55;
      return {
        x: c.originX + (tx - c.originX) * u + Math.sin(c.age * 11) * 16,
        y: c.originY + (ty - c.originY) * u,
      };
    }
    const bx = ZONES.basket.x + ZONES.basket.w * 0.5;
    const by = ZONES.basket.y + 36;
    const dash = Math.min(1, c.age / 1.15);
    const ease = dash * dash;
    return {
      x: c.originX + (bx - c.originX) * ease,
      y: c.originY + (by - c.originY) * ease + Math.sin(c.age * 18) * 10,
    };
  }

  function critterHit(x, y) {
    if (!play || !play.critter) return false;
    const p = critterPos(play.critter);
    const half = critterTap() / 2;
    return Math.abs(x - p.x) <= half && Math.abs(y - p.y) <= half;
  }

  function audio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playAlert() {
    try {
      const c = audio();
      if (!c) return;
      const now = c.currentTime;
      [880, 520].forEach((freq, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        const t0 = now + i * 0.11;
        o.type = 'square';
        o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
        o.connect(g);
        g.connect(c.destination);
        o.start(t0);
        o.stop(t0 + 0.11);
      });
    } catch (err) {
      console.error(err);
    }
  }

  function playChomp() {
    if (vizT - chompAt < 0.32) return;
    chompAt = vizT;
    try {
      const c = audio();
      if (!c) return;
      const now = c.currentTime;
      for (let i = 0; i < 2; i++) {
        const o = c.createOscillator();
        const g = c.createGain();
        const t0 = now + i * 0.12;
        o.type = 'triangle';
        o.frequency.setValueAtTime(480, t0);
        o.frequency.exponentialRampToValueAtTime(120, t0 + 0.08);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        o.connect(g);
        g.connect(c.destination);
        o.start(t0);
        o.stop(t0 + 0.1);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function spawnCritter(forcedKind) {
    if (!play || play.critter) return;
    const kind = forcedKind === 'mouse' || forcedKind === 'roach'
      ? forcedKind
      : (Math.random() < 0.5 ? 'roach' : 'mouse');
    let targetId = null;
    let originX;
    let originY;
    if (kind === 'roach') {
      const busy = play.steamers.filter((s) => s.unlocked && (s.state === 'cooking' || s.state === 'serve'));
      const open = play.steamers.filter((s) => s.unlocked);
      const list = busy.length ? busy : open;
      if (!list.length) return;
      const st = list[Math.floor(Math.random() * list.length)];
      targetId = st.id;
      originX = Math.max(40, st.x - 240);
      originY = st.y + st.h * 0.65;
    } else {
      originX = W - 70;
      originY = ZONES.basket.y - 20;
    }
    play.critter = { kind, age: 0, targetId, originX, originY };
    play.edgeFlash = 0.55;
    setAvatar(AV_SCARED, 1.7);
    playAlert();
  }

  function ruinSteamer(st) {
    st.shownProgress = 1.08;
    st.ruinedT = 0.8;
    st.revealAge = 0;
    st.lidOpen = 1;
    st.scale = 1.15;
    st.carried = false;
    st.carryAge = -1;
    st.serveTimer = 0;
    st.lastGrade = null;
    st.state = 'cooldown';
    st.cookTime = 0.8;
    st.progress = 0;
    st.heartPlayed = false;
  }

  function stealOneKueh() {
    const served = play.steamers.find((s) => s.state === 'serve');
    if (served) {
      served.state = 'empty';
      served.carried = false;
      served.carryAge = -1;
      served.serveTimer = 0;
      served.progress = 0;
      served.revealAge = -1;
      return;
    }
    const cooking = play.steamers.find((s) => s.state === 'cooking');
    if (cooking) {
      cooking.state = 'empty';
      cooking.progress = 0;
      cooking.lidOpen = 0.62;
      cooking.heartPlayed = false;
    }
  }

  function resolveCritter(tapped) {
    const c = play && play.critter;
    if (!c) return;
    const pos = critterPos(c);
    play.critter = null;
    const elapsed = ROUND_SEC - play.timeLeft;
    play.nextCritter = Math.max(play.nextCritter, elapsed + 15 + Math.random() * 5);
    if (tapped) {
      play.score += EVENT_SCORE;
      floatText(pos.x, pos.y, `+${EVENT_SCORE}`, 'good');
    } else if (c.kind === 'roach') {
      const st = play.steamers.find((s) => s.id === c.targetId);
      if (st && (st.state === 'cooking' || st.state === 'serve')) ruinSteamer(st);
      play.score = Math.max(0, play.score - ROACH_PENALTY);
      play.combo = 0;
      floatText(st ? st.x + st.w / 2 : pos.x, st ? st.y : pos.y, `-${ROACH_PENALTY}`, 'penalty');
    } else {
      stealOneKueh();
      play.score = Math.max(0, play.score - MOUSE_PENALTY);
      floatText(ZONES.basket.x + ZONES.basket.w / 2, ZONES.basket.y + 20, `-${MOUSE_PENALTY}`, 'penalty');
    }
    updateHud();
  }

  function updateCritters(dt, elapsed) {
    if (play.edgeFlash > 0) play.edgeFlash -= dt;
    if (play.critter) {
      play.critter.age += dt;
      if (play.critter.age >= CRITTER_LIFE) resolveCritter(false);
      return;
    }
    if (elapsed >= play.nextCritter) {
      spawnCritter();
      play.nextCritter = elapsed + 15 + Math.random() * 5;
    }
  }

  function hitTest(x, y) {
    // fan
    const f = ZONES.fan;
    if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return { type: 'fan' };
    const b = ZONES.basket;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { type: 'basket' };
    // steamers topmost first
    const list = play.steamers.slice().reverse();
    for (const st of list) {
      if (!st.unlocked) continue;
      if (x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.h) {
        return { type: 'steamer', st };
      }
    }
    // walkway tap
    if (y > 620 && y < 980 && x > 400 && x < 1200) return { type: 'walk', x, y };
    return null;
  }

  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  function onPointerDown(e) {
    if (state !== 'play') return;
    e.preventDefault();
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    try { audio(); } catch (err) { /* ignore */ }
    if (critterHit(x, y)) {
      pointers.set(e.pointerId, { x, y, role: 'critter' });
      resolveCritter(true);
      return;
    }
    const hit = hitTest(x, y);
    const role = hit && hit.type === 'fan' ? 'fan' : 'other';
    pointers.set(e.pointerId, { x, y, role });
    if (!hit) return;
    if (hit.type === 'fan') {
      fanning = true;
      play.baoge.tx = BAOGE_HOME_X;
      play.baoge.ty = BAOGE_FLOOR;
      if (!(avatarExpr === AV_SCARED && avatarHold > 0)) setAvatar(AV.fire, 0.6);
    } else if (hit.type === 'basket') {
      approachBaoge(ZONES.basket.x + ZONES.basket.w - 20);
      tryServe();
    } else if (hit.type === 'steamer') {
      const st = hit.st;
      play.selectedId = st.id;
      if (st.state === 'empty') pourSteamer(st);
      else if (st.state === 'cooking') uncoverSteamer(st);
      else if (st.state === 'serve') {
        floatText(st.x + st.w / 2, st.y, '先送到左邊紅籃出餐！', 'warn');
        approachBaoge(ZONES.basket.x + ZONES.basket.w - 20);
      }
    } else if (hit.type === 'walk') {
      approachBaoge(hit.x);
    }
  }

  function refreshFanning() {
    let held = false;
    for (const p of pointers.values()) {
      if (p.role === 'fan') held = true;
    }
    fanning = held;
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    refreshFanning();
  }

  function onPointerMove(e) {
    if (state !== 'play' || !pointers.has(e.pointerId)) return;
    const rec = pointers.get(e.pointerId);
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    rec.x = x;
    rec.y = y;
    if (rec.role !== 'fan') return;
    const f = ZONES.fan;
    const still = x >= f.x - 40 && x <= f.x + f.w + 40 && y >= f.y - 40 && y <= f.y + f.h + 40;
    if (!still) {
      rec.role = 'other';
      refreshFanning();
    }
  }

  function update(dt) {
    if (state !== 'play' || !play) return;

    play.timeLeft -= dt;
    if (play.timeLeft <= 0) {
      play.timeLeft = 0;
      // timeout any cooking as 沒揭到
      for (const st of play.steamers) {
        if (st.state === 'cooking') {
          awardUncover(st, GRADE.MEIJIE);
        } else if (st.state === 'serve') {
          // leftover serve without bonus — just clear
          st.state = 'empty';
          st.carried = false;
          st.carryAge = -1;
          st.revealAge = -1;
        }
      }
      endRound();
      return;
    }

    if (avatarHold > 0) {
      avatarHold -= dt;
      if (avatarHold <= 0 && !fanning && play.rushT <= 0) setAvatar(AV.idle, 99);
    }

    if (comboPopupT > 0) {
      comboPopupT -= dt;
      if (comboPopupT <= 0) $('combo-popup').classList.add('hidden');
    }

    // Heat
    if (fanning) {
      play.heat += 22 * dt;
      firePulse += dt * 8;
      if (!(avatarExpr === AV_SCARED && avatarHold > 0) && avatarExpr !== AV.fire) setAvatar(AV.fire, 0.5);
      if (Math.random() < 0.85) {
        play.sparks.push({
          x: 760 + Math.random() * 90,
          y: 600 + Math.random() * 30,
          vx: -30 + Math.random() * 80,
          vy: -160 - Math.random() * 120,
          life: 0.28 + Math.random() * 0.25,
          max: 0.45,
        });
      }
    } else {
      // natural drift toward mid-low, plus charcoal flicker
      const target = 22 + play.charcoalFlicker * 25;
      play.heat += (target - play.heat) * 0.15 * dt;
      play.heat -= 3.5 * dt;
    }
    if (play.flareT > 0) {
      play.flareT -= dt;
      play.heat += 35 * dt;
    }
    play.heat = Math.max(5, Math.min(100, play.heat));

    // Unlock steamers by elapsed / heat
    const elapsed = ROUND_SEC - play.timeLeft;
    for (const st of play.steamers) {
      if (!st.unlocked && (elapsed >= st.unlockAt || play.heat >= st.unlockAt + 10)) {
        st.unlocked = true;
        floatText(st.x + st.w / 2, st.y + st.h / 2, `${st.name} 可用`, 'bonus');
      }
    }

    // Early game: only 1-2 steamers first ~20s — keep later locked even if listed
    if (elapsed < 20) {
      play.steamers.forEach((st, i) => {
        if (i >= 2) st.unlocked = false;
      });
    }

    // Cook
    const heatFactor = 0.35 + (play.heat / 100) * 1.55;
    // consecutive 紅心 speeds curve
    const comboSpeed = 1 + Math.min(0.45, play.combo * 0.03);
    for (const st of play.steamers) {
      if (st.state === 'cooking') {
        st.progress += dt * 0.18 * heatFactor * comboSpeed;
        st.cookTime += dt;
        const steam = cookSteam(st);
        if (steam === 'heart') {
          st.heartTimer = (st.heartTimer || 0) + dt;
          if (!st.heartPlayed || st.heartTimer >= 0.9) {
            st.heartPlayed = true;
            st.heartTimer = 0;
            playChomp();
          }
        } else {
          st.heartPlayed = false;
          st.heartTimer = 0;
        }
        // auto fail if way overcooked
        if (st.progress >= 1.15) {
          awardUncover(st, GRADE.JIAOHUI);
        }
      } else if (st.state === 'serve') {
        st.serveTimer -= dt;
        if (st.serveTimer <= 0) {
          // missed serve — no points change, just lose the plate; combo unchanged for serve miss? Spec only resets on uncover fail. Clear.
          st.state = 'empty';
          st.carried = false;
          st.carryAge = -1;
          st.revealAge = -1;
          floatText(st.x + st.w / 2, st.y, '出餐逾時', 'warn');
        }
      } else if (st.state === 'cooldown') {
        st.cookTime -= dt;
        if (st.cookTime <= 0) {
          st.state = 'empty';
          st.progress = 0;
          st.overflowed = false;
          st.revealAge = -1;
          st.shownProgress = 0;
          st.lidOpen = 0.62;
        }
      }
      if (st.flash > 0) st.flash -= dt;
      if (st.ruinedT > 0) st.ruinedT -= dt;
      stepSteamerVisual(st, dt);
    }
    if (play.sparks && play.sparks.length) {
      for (const sp of play.sparks) {
        sp.life -= dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 80 * dt;
      }
      play.sparks = play.sparks.filter((sp) => sp.life > 0);
    }
    updateCritters(dt, elapsed);
    if (play.drops) {
      for (const d of play.drops) d.age += dt;
      play.drops = play.drops.filter((d) => d.age < d.dur + 0.42);
    }

    // Events at high heat
    play.eventCD -= dt;
    if (play.eventCD <= 0 && elapsed > 25) {
      play.eventCD = 7 + Math.random() * 6 - Math.min(3, play.combo * 0.15);
      // ease slightly on miss
      if (play.combo === 0) play.eventCD += 2;
      const roll = Math.random();
      if (play.heat > 55 && roll < 0.34) {
        play.flareT = 1.2 + Math.random();
        setAvatar(AV.rush, 1.5);
        floatText(W * 0.55, H * 0.55, '火勢暴衝！', 'bad');
      } else if (roll < 0.62) {
        // steam burst threat on a cooking steamer
        const cooking = play.steamers.filter((s) => s.state === 'cooking');
        if (cooking.length) {
          const t = cooking[Math.floor(Math.random() * cooking.length)];
          play.burstTarget = t.id;
          t.flash = 2.2;
          floatText(t.x + t.w / 2, t.y - 10, '蒸汽要炸籠！快揭！', 'warn');
          setAvatar(AV.rush, 1.2);
          // if not uncovered soon, overflow
          setTimeout(() => {
            if (!play || state !== 'play') return;
            const s = play.steamers.find((x) => x.id === t.id);
            if (s && s.state === 'cooking' && play.burstTarget === t.id) {
              s.overflowed = true;
              floatText(s.x + s.w / 2, s.y, '溢模！', 'bad');
              play.burstTarget = null;
            }
          }, 2200);
        }
      } else if (elapsed > 40 && roll < 0.85) {
        play.rushT = 5;
        setAvatar(AV.rush, 5);
        floatText(W / 2, H * 0.22, '整籃催單！加快出餐！', 'warn');
        // tighten serve window temporarily via flag checked? reduce serve timers
        for (const s of play.steamers) {
          if (s.state === 'serve') s.serveTimer = Math.min(s.serveTimer, 2.2);
        }
      } else {
        play.charcoalFlicker = Math.random() > 0.5 ? 1 : -0.6;
        floatText(W * 0.5, H * 0.6, play.charcoalFlicker > 0 ? '炭火忽旺' : '炭火忽弱', 'warn');
        setTimeout(() => { if (play) play.charcoalFlicker = 0; }, 3000);
      }
    }
    if (play.rushT > 0) play.rushT -= dt;

    // Move baoge
    const b = play.baoge;
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 4) {
      const sp = 420;
      b.x += (dx / dist) * Math.min(dist, sp * dt);
      b.y += (dy / dist) * Math.min(dist, sp * dt);
    }
    // ALWAYS face camera — no flip to back. Slight horizontal lean only via position.
    b.facing = 1;

    if (play.tutorialT > 0) play.tutorialT -= dt;

    updateHud();
  }

  function stepSteamerVisual(st, dt) {
    if (st.revealAge >= 0) st.revealAge += dt;
    if (st.puffLife > 0) st.puffLife -= dt;
    if (st.state === 'serve' && st.revealAge > 0.38 && st.carryAge < 0) st.carryAge = 0;
    if (st.carryAge >= 0 && !st.carried) {
      st.carryAge += dt;
      if (st.carryAge >= 0.55) st.carried = true;
    }
    if (st.revealAge >= 0 && st.revealAge < 0.5) {
      const t = st.revealAge;
      if (t < 0.16) st.scale = 1 + (t / 0.16) * 0.42;
      else if (t < 0.32) st.scale = 1.42 - ((t - 0.16) / 0.16) * 0.5;
      else st.scale = 0.92 + ((t - 0.32) / 0.18) * 0.08;
      st.lidOpen = Math.min(1, 0.22 + t / 0.30);
    } else if (st.revealAge >= 0.5) {
      st.scale = 1;
      st.lidOpen = 1;
    } else if (st.state === 'cooking') {
      st.scale = 1;
      st.lidOpen = 0;
    } else if (st.state === 'empty') {
      st.scale = 1;
      st.lidOpen = 0.62;
    }
  }

  function spawnDrop(st) {
    const pos = kuehAnchor(st);
    if (!play.drops) play.drops = [];
    play.drops.push({
      x: pos.x,
      y: pos.y,
      look: st.shownProgress,
      age: 0,
      dur: 0.5,
      seed: st.id,
    });
  }

  function handPoint(index, count) {
    const b = play.baoge;
    const bw = BAOGE_H * (assets.baoge.width / assets.baoge.height);
    const head = b.y - BAOGE_H;
    const drop = crouchDrop();
    const baseX = b.x - bw * 0.42;
    const baseY = head + BAOGE_H * 0.66 + drop;
    const spread = 76;
    const offset = (index - (count - 1) / 2) * spread;
    return {
      x: baseX + offset,
      y: Math.max(head + BAOGE_H * 0.48 + drop, baseY),
    };
  }

  function kuehAnchor(st) {
    const cx = st.x + st.w / 2;
    const cy = st.y + st.h * 0.48;
    if (st.state !== 'serve' || !play) return { x: cx, y: cy };
    const ready = play.steamers.filter((s) => s.state === 'serve');
    ready.sort((a, b) => a.serveTimer - b.serveTimer);
    const index = Math.max(0, ready.findIndex((s) => s.id === st.id));
    const hand = handPoint(index, ready.length);
    if (st.carried) return hand;
    if (st.carryAge >= 0) {
      const u = Math.min(1, st.carryAge / 0.55);
      const ease = u * u * (3 - 2 * u);
      const arc = Math.sin(ease * Math.PI) * 80;
      return {
        x: cx + (hand.x - cx) * ease,
        y: cy + (hand.y - cy) * ease - arc,
      };
    }
    return { x: cx, y: cy };
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function seedOf(id) {
    let h = 2166136261;
    const s = String(id || 'k');
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function drawDonenessRing(st) {
    if (st.state !== 'cooking') return;
    const w = heatWindows(play.heat);
    const cx = st.x + st.w / 2;
    const cy = Math.max(168, st.y - 46);
    const r = 30;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20,10,8,0.88)';
    ctx.lineWidth = 12;
    ctx.stroke();
    const a0 = -Math.PI / 2;
    const p = Math.max(0, Math.min(1.05, st.progress));
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + Math.min(1, p) * Math.PI * 2);
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = 12;
    ctx.stroke();
    // Window notches mark 紅心 on the ring. No kueh icon.
    const mark = (frac) => {
      const a = a0 + Math.max(0, Math.min(1, frac)) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
      ctx.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    mark(w.ideal - w.hong);
    mark(w.ideal + w.hong);
    ctx.restore();
  }

  function drawClosedLid(cx, cy, rx, ry, kind, hop) {
    ctx.save();
    ctx.translate(0, -hop);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.96, ry * 0.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bamboo' ? '#e7b45a' : '#d7e0e6';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#241c16';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.62, ry * 0.48, 0, 0, Math.PI * 2);
    ctx.strokeStyle = kind === 'bamboo' ? 'rgba(90,48,16,0.45)' : 'rgba(70,80,88,0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - ry * 0.05, Math.max(8, rx * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bamboo' ? '#8a4e22' : '#5d6a72';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#241c16';
    ctx.stroke();
    ctx.restore();
  }

  function drawSteamStage(cx, cy, stage, phase) {
    if (stage === 'heart') {
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const ox = Math.sin(phase * 1.4 + i) * 26;
        const oy = -i * 22 - Math.abs(Math.sin(phase * 2 + i)) * 10;
        ctx.globalAlpha = 0.9 - i * 0.1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx + ox, cy + oy, 78 + i * 14, 40 + i * 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(60,50,40,0.4)';
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.font = `bold 36px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2a211c';
      ctx.fillStyle = '#fffaf2';
      const label = '噛噛';
      const ly = cy - 78 - Math.abs(Math.sin(phase * 8)) * 6;
      ctx.strokeText(label, cx, ly);
      ctx.fillText(label, cx, ly);
      ctx.restore();
      return;
    }
    const over = stage === 'over';
    const near = stage === 'near';
    const n = over ? 6 : near ? 5 : 2;
    const width = over ? 16 : near ? 11 : 3;
    const rise = over ? 110 : near ? 86 : 40;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const ph = phase * (over ? 0.8 : 1.3) + i * 1.5;
      const x = cx + (i - (n - 1) / 2) * (near || over ? 22 : 16) + Math.sin(ph) * 6;
      ctx.globalAlpha = (over ? 0.55 : near ? 0.8 : 0.5);
      ctx.strokeStyle = over ? '#5e5a56' : '#fffaf3';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.bezierCurveTo(x - 16, cy - rise * 0.35, x + 20, cy - rise * 0.65, x - 4, cy - rise);
      ctx.stroke();
    }
    ctx.restore();
  }

  const UI_FONT = '"WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';

  function chipFor(st) {
    if (st.state === 'empty') return { icon: 'arrow', label: '倒漿' };
    if (st.state === 'cooking') {
      return { icon: 'lid', label: st.flash > 0 ? '快揭' : '揭籠' };
    }
    if (st.state === 'serve') return { icon: 'basket', label: `出餐 ${Math.max(0, st.serveTimer).toFixed(1)}s` };
    return { icon: 'dot', label: '…' };
  }

  function drawIcon(kind, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = Math.max(2.5, s * 0.12);
    ctx.strokeStyle = '#ffe08a';
    ctx.fillStyle = '#ffe08a';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const r = s * 0.36;
    if (kind === 'wave') {
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.15);
      ctx.bezierCurveTo(-r * 0.3, -r, r * 0.15, -r, 0, 0);
      ctx.bezierCurveTo(r * 0.35, r, r, r * 0.2, r, -r * 0.35);
      ctx.stroke();
    } else if (kind === 'half') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.arc(0, 0, r, Math.PI, 0, false);
      ctx.fill();
    } else if (kind === 'cake') {
      roundRect(ctx, -r, -r * 0.65, r * 2, r * 1.35, 4);
      ctx.fillStyle = '#f4e2c6';
      ctx.fill();
      ctx.strokeStyle = '#3a2a1c';
      ctx.stroke();
      ctx.fillStyle = '#c17d38';
      ctx.beginPath();
      ctx.arc(-r * 0.28, 0, r * 0.2, 0, Math.PI * 2);
      ctx.arc(r * 0.32, -r * 0.12, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'tri') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, r * 0.82);
      ctx.lineTo(-r, r * 0.82);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'cross') {
      ctx.beginPath();
      ctx.moveTo(-r, -r); ctx.lineTo(r, r);
      ctx.moveTo(r, -r); ctx.lineTo(-r, r);
      ctx.stroke();
    } else if (kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r * 0.9);
      ctx.moveTo(-r * 0.7, r * 0.25);
      ctx.lineTo(0, r * 0.9);
      ctx.lineTo(r * 0.7, r * 0.25);
      ctx.stroke();
    } else if (kind === 'basket') {
      roundRect(ctx, -r, -r * 0.15, r * 2, r * 1.15, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.15); ctx.lineTo(r, r * 0.15);
      ctx.moveTo(-r * 0.4, -r * 0.15); ctx.lineTo(-r * 0.4, r);
      ctx.moveTo(r * 0.4, -r * 0.15); ctx.lineTo(r * 0.4, r);
      ctx.stroke();
    } else if (kind === 'fan') {
      ctx.beginPath();
      ctx.arc(0, r * 0.45, r, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, r * 0.15);
      ctx.lineTo(0, r);
      ctx.stroke();
    } else if (kind === 'lid') {
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.42, -0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.1, -r * 0.05, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChip(cx, cy, icon, label) {
    ctx.save();
    ctx.font = `bold 30px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const iconS = 30;
    const padX = 12;
    const bw = tw + iconS + padX * 3;
    const bh = 42;
    const x = cx - bw / 2;
    const y = cy - bh / 2;
    roundRect(ctx, x, y, bw, bh, 21);
    ctx.fillStyle = 'rgba(24,12,8,0.9)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f0d7a2';
    ctx.stroke();
    drawIcon(icon, x + padX + iconS / 2, cy, iconS);
    ctx.fillStyle = '#fff6e4';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + padX * 2 + iconS, cy + 1);
    ctx.restore();
  }

  function drawLid(cx, cy, rx, ry, open, kind) {
    const slide = Math.max(0, Math.min(1, open));
    ctx.save();
    ctx.translate(cx + slide * rx * 0.72, cy - ry * (1.05 + slide * 0.85));
    ctx.rotate(-0.08 - slide * 0.7);
    const top = kind === 'bamboo' ? '#f3cc78' : '#f4f8fa';
    const side = kind === 'bamboo' ? '#c8883a' : '#aeb9c2';
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.16, rx * 0.74, ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#2a241c';
    ctx.stroke();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.74, ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (kind === 'bamboo') {
      ctx.strokeStyle = 'rgba(90,48,16,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.48, ry * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -ry * 0.02, Math.max(7, rx * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bamboo' ? '#8a4e22' : '#5d6a72';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a241c';
    ctx.stroke();
    ctx.restore();
  }

  function drawPotBody(cx, cy, rx, ry, kind) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (kind === 'bamboo') {
      const g = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
      g.addColorStop(0, '#c9843a');
      g.addColorStop(0.35, '#f0c36a');
      g.addColorStop(0.7, '#e0a24a');
      g.addColorStop(1, '#b8742e');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
      g.addColorStop(0, '#f7fbfc');
      g.addColorStop(0.4, '#d5dee4');
      g.addColorStop(1, '#8d9aa3');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#241c16';
    ctx.stroke();
    if (kind === 'bamboo') {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(70,36,12,0.4)';
      ctx.lineWidth = 3;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * rx * 0.24, cy - ry);
        ctx.lineTo(cx + i * rx * 0.24, cy + ry);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.8, ry * 0.74, 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bamboo' ? '#f0c27a' : '#d5dee4';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a241c';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.08, rx * 0.62, ry * 0.46, 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bamboo' ? '#e2b15e' : '#c3ced6';
    ctx.fill();
  }

  function drawFrontRim(cx, cy, rx, ry, kind) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.8, ry * 0.74, 0, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.strokeStyle = kind === 'bamboo' ? '#f6d7a0' : '#f4f7f8';
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  // Code-drawn steam. The reserved steam PNG is fully transparent, so it cannot tint the scene.
  function drawWisps(cx, cy, strength, phase) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const n = 3;
    for (let i = 0; i < n; i++) {
      const ph = phase * 1.25 + i * 1.7;
      const x = cx + (i - 1) * 26 + Math.sin(ph) * 8;
      ctx.globalAlpha = (0.55 + 0.4 * strength) * (0.8 + 0.2 * Math.sin(ph));
      ctx.strokeStyle = '#fffaf3';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.bezierCurveTo(x - 24, cy - 26, x + 28, cy - 48, x - 6, cy - 74 - i * 12);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(90,70,55,0.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPuff(cx, cy, life) {
    const u = 1 - Math.max(0, Math.min(1, life / 0.9));
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const ang = -Math.PI * 0.5 + (i - 2.5) * 0.42;
      const dist = 16 + u * 78;
      const x = cx + Math.cos(ang) * dist;
      const y = cy + Math.sin(ang) * dist * 0.72;
      ctx.globalAlpha = (1 - u) * 0.92;
      ctx.fillStyle = '#fffaf4';
      ctx.beginPath();
      ctx.ellipse(x, y, 26 + u * 36, 16 + u * 24, ang, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(70,54,40,0.35)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawKueh(cx, cy, w, h, p, scale, id) {
    const info = stageInfo(Math.max(0, p || 0));
    const seed = seedOf(id);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale || 1, scale || 1);
    ctx.lineJoin = 'round';
    if (info.key === 'liquid' || info.key === 'setting') {
      const setting = info.key === 'setting';
      const ew = w * 0.5;
      const eh = h * (setting ? 0.46 : 0.34);
      ctx.beginPath();
      ctx.ellipse(0, eh * 0.15, ew, eh, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(-ew * 0.25, -eh * 0.2, 6, 0, 0, ew);
      g.addColorStop(0, '#fff8e8');
      g.addColorStop(0.55, setting ? '#f0d2a4' : '#f7e3bf');
      g.addColorStop(1, setting ? '#e2bc84' : '#f0d3a0');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(5, w * 0.04);
      ctx.strokeStyle = '#2e2418';
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, eh * 0.15, ew - 3, eh - 3, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      const amp = (setting ? 0.35 : 1) * eh * 0.28;
      const baseY = eh * (setting ? 0.02 : -0.02);
      ctx.moveTo(-ew, eh);
      for (let x = -ew; x <= ew; x += 5) {
        const yy = baseY + Math.sin(x * 0.09 + vizT * 5.2 + (seed % 7)) * amp;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(ew, eh);
      ctx.closePath();
      ctx.fillStyle = setting ? 'rgba(255,248,236,0.35)' : 'rgba(255,252,245,0.62)';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(-ew * 0.28, -eh * 0.05, ew * 0.22, eh * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (setting) {
        ctx.fillStyle = '#d7a15a';
        for (let i = 0; i < 3; i++) {
          const px = (hash01(seed + i * 4) - 0.5) * w * 0.5;
          const py = (hash01(seed + i * 9) - 0.5) * eh * 0.5;
          ctx.beginPath();
          ctx.ellipse(px, py, 4, 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const burnt = info.key === 'burnt';
      const scorch = info.key === 'scorch' || burnt;
      const top = burnt ? '#221c18' : (scorch ? '#e7c79a' : '#f6e6cc');
      const side = burnt ? '#14110f' : (scorch ? '#c48a4e' : '#e4cfae');
      const spot = burnt ? '#3a312b' : (scorch ? '#7a4520' : '#c4843c');
      const slabH = h * 0.72;
      const sideH = h * 0.22;
      roundRect(ctx, -w / 2, -slabH * 0.25, w, slabH * 0.72 + sideH, 16);
      ctx.fillStyle = side;
      ctx.fill();
      ctx.lineWidth = Math.max(5, w * 0.038);
      ctx.strokeStyle = '#241c16';
      ctx.stroke();
      roundRect(ctx, -w / 2, -slabH * 0.55, w, slabH * 0.78, 16);
      ctx.fillStyle = top;
      ctx.fill();
      ctx.stroke();
      if (scorch && !burnt) {
        ctx.save();
        roundRect(ctx, -w / 2 + 3, -slabH * 0.55 + 3, w - 6, slabH * 0.78 - 6, 14);
        ctx.clip();
        ctx.strokeStyle = 'rgba(120,62,24,0.85)';
        ctx.lineWidth = 8;
        ctx.strokeRect(-w / 2, -slabH * 0.55, w, slabH * 0.78);
        ctx.restore();
      }
      const n = burnt ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const px = (hash01(seed + i * 3.1) - 0.5) * w * 0.72;
        const py = (hash01(seed + i * 5.3 + 1) - 0.55) * slabH * 0.42;
        const rr = 4 + hash01(seed + i * 8) * (scorch ? 9 : 7);
        ctx.beginPath();
        ctx.ellipse(px, py, rr, rr * 0.72, hash01(seed + i) * 3, 0, Math.PI * 2);
        ctx.fillStyle = i % 3 === 0 && !burnt ? '#ddb06a' : spot;
        ctx.fill();
      }
      if (burnt) {
        ctx.strokeStyle = '#6e6258';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-w * 0.22, -slabH * 0.2);
        ctx.lineTo(-w * 0.02, -slabH * 0.02);
        ctx.lineTo(w * 0.16, -slabH * 0.12);
        ctx.moveTo(-w * 0.02, -slabH * 0.02);
        ctx.lineTo(w * 0.04, slabH * 0.16);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawDrip(cx, cy, rx) {
    ctx.save();
    ctx.fillStyle = '#f3d7a6';
    ctx.strokeStyle = '#2e2418';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.78, cy + 8, 12, 20, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawFocusFrame(x, y, w, h, urgent) {
    const pad = 10;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = urgent ? '#ff5a3c' : '#ffe56a';
    ctx.lineWidth = 8;
    ctx.shadowColor = urgent ? '#ff2a1a' : '#ffb000';
    ctx.shadowBlur = 18;
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, 18);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fffef8';
    ctx.lineWidth = 6;
    const L = 26;
    const corners = [
      [x - pad, y - pad, 1, 1],
      [x + w + pad, y - pad, -1, 1],
      [x - pad, y + h + pad, 1, -1],
      [x + w + pad, y + h + pad, -1, -1],
    ];
    for (const [px, py, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(px, py + sy * L);
      ctx.lineTo(px, py);
      ctx.lineTo(px + sx * L, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGradeBanner(st) {
    if (!st.lastGrade || st.revealAge < 0 || st.revealAge > 1.2) return;
    const g = st.lastGrade;
    const hit = Number.isFinite(st.lastHit) ? Math.floor(st.lastHit) : 0;
    const text = `${g.id} +${hit}`;
    let fade = 1;
    if (st.revealAge < 0.08) fade = st.revealAge / 0.08;
    else if (st.revealAge > 0.95) fade = Math.max(0, (1.2 - st.revealAge) / 0.25);
    const cx = st.x + st.w / 2;
    const cy = st.y + st.h - 4;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = `bold 32px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const bw = tw + 28;
    const bh = 46;
    roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 12);
    ctx.fillStyle = 'rgba(16,8,6,0.92)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = g.cls === 'bad' ? '#ff9d9d' : '#ffe08a';
    ctx.stroke();
    ctx.fillStyle = g.cls === 'bad' ? '#ffc1b8' : '#ffe08a';
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
  }

  function travelAnchor(st, hand) {
    const from = { x: st.x + st.w / 2, y: st.y + st.h * 0.46 };
    const b = play.baoge;
    const bw = BAOGE_H * (assets.baoge.width / assets.baoge.height);
    const head = b.y - BAOGE_H;
    const chin = head + BAOGE_H * 0.40;
    const faceL = b.x - bw * 0.30;
    const faceR = b.x + bw * 0.30;
    const half = 86;
    let dropX = from.x;
    if (from.x >= b.x) dropX = Math.max(from.x, faceR + half + 10);
    else dropX = Math.min(from.x, faceL - half - 10);
    const lowY = chin + 28;
    const u = Math.min(1, Math.max(0, st.carryAge) / 0.55);
    if (u < 0.42) {
      const t = u / 0.42;
      if (t < 0.4) {
        const k = t / 0.4;
        return { x: from.x + (dropX - from.x) * k, y: from.y };
      }
      const k = (t - 0.4) / 0.6;
      return { x: dropX, y: from.y + (Math.max(lowY, from.y) - from.y) * k };
    }
    const k = (u - 0.42) / 0.58;
    const ease = k * k * (3 - 2 * k);
    const landY = Math.max(lowY, hand.y);
    return {
      x: dropX + (hand.x - dropX) * ease,
      y: Math.max(lowY, from.y) + (landY - Math.max(lowY, from.y)) * ease,
    };
  }

  function drawSteamer(st) {
    const x = st.x;
    const y = st.y;
    const w = st.w;
    const h = st.h;
    const cx = x + w / 2;
    const cy = y + h * 0.50;
    const rx = w * 0.46;
    const ry = h * 0.36;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, y + h - 6, rx * 0.85, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPotBody(cx, cy, rx, ry, st.kind);

    const traveling = st.state === 'serve' && (st.carried || st.carryAge >= 0);
    const cooking = st.state === 'cooking';
    const showInPot = !cooking && (
      (st.state === 'serve' && !traveling)
      || (st.state === 'cooldown' && st.revealAge >= 0 && st.revealAge < 0.55)
      || (st.ruinedT > 0)
    );
    if (st.overflowed && cooking) drawDrip(cx, cy, rx);
    if (cooking) {
      const stage = cookSteam(st);
      const hop = stage === 'heart' ? Math.abs(Math.sin(vizT * 14)) * 42 : 0;
      drawClosedLid(cx, cy, rx, ry, st.kind, hop);
      drawSteamStage(cx, cy - ry * 0.85 - hop, stage, vizT + (seedOf(st.id) % 5));
    } else {
      drawFrontRim(cx, cy, rx, ry, st.kind);
      drawLid(cx, cy, rx, ry, st.lidOpen == null ? 0.4 : st.lidOpen, st.kind);
      if (st.puffLife > 0 && !traveling) drawPuff(cx, cy - ry * 0.2, st.puffLife);
    }
    if (showInPot) {
      const kuehW = w * KUEH_WIDTH_RATIO;
      const kuehH = kuehW * 0.50;
      const pop = st.scale || 1;
      drawKueh(cx, cy - (pop - 1) * 30, kuehW * pop, kuehH * pop, st.shownProgress, 1, st.id);
      if (st.ruinedT > 0) {
        ctx.save();
        ctx.strokeStyle = '#ff2a2a';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(cx - kuehW * 0.28, cy - kuehH * 0.22);
        ctx.lineTo(cx + kuehW * 0.28, cy + kuehH * 0.22);
        ctx.moveTo(cx + kuehW * 0.28, cy - kuehH * 0.22);
        ctx.lineTo(cx - kuehW * 0.28, cy + kuehH * 0.22);
        ctx.stroke();
        ctx.restore();
      }
    }

    const showingGrade = st.revealAge >= 0 && st.revealAge <= 1.2 && st.lastGrade;
    if (!showingGrade) {
      const chip = chipFor(st);
      drawChip(cx, y + h - 18, chip.icon, chip.label);
    }
    drawDonenessRing(st);
    ctx.restore();
  }

  function drawHeldKueh(st) {
    if (st.state !== 'serve' || !(st.carried || st.carryAge >= 0)) return;
    const ready = play.steamers.filter((s) => s.state === 'serve');
    ready.sort((a, b) => a.serveTimer - b.serveTimer);
    const index = Math.max(0, ready.findIndex((s) => s.id === st.id));
    const hand = handPoint(index, ready.length);
    const pos = st.carried ? hand : travelAnchor(st, hand);
    const kuehW = Math.min(168, st.w * 0.62);
    drawKueh(pos.x, pos.y, kuehW, kuehW * 0.52, st.shownProgress, st.scale || 1, st.id);
    if (st.puffLife > 0.15) drawPuff(pos.x, pos.y - 30, st.puffLife);
  }

  function drawBasketDrop(d) {
    const bx = ZONES.basket.x + ZONES.basket.w * 0.46;
    const by = ZONES.basket.y + ZONES.basket.h * 0.58;
    const u = Math.min(1, d.age / d.dur);
    const ease = u * u * (3 - 2 * u);
    let x = d.x + (bx - d.x) * ease;
    let y = d.y + (by - d.y) * ease - Math.sin(Math.min(1, u) * Math.PI) * 90;
    let alpha = 1;
    let sc = 1 - ease * 0.12;
    if (d.age >= d.dur) {
      const settle = Math.min(1, (d.age - d.dur) / 0.42);
      x = bx;
      y = by + 6;
      sc = 0.78;
      alpha = 1 - settle * 0.15;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    drawKueh(x, y, 156, 82, d.look > 0 ? d.look : 0.62, sc, d.seed || 'drop');
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Layers (wall → stove → fire → fg → steamers → baoge → product in hand)
    if (assets.wall) ctx.drawImage(assets.wall, 0, 0, W, H);
    if (assets.stove) ctx.drawImage(assets.stove, 0, 0, W, H);

    // Fire — full-frame sprite nudged to right stove mouth; screen blend
    if (assets.fire) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const heat = play ? play.heat : 30;
      const flare = play && play.flareT > 0 ? 0.2 : 0;
      const flicker = 0.8 + 0.2 * Math.sin(firePulse * 2) + (fanning ? 0.12 : 0) + flare;
      ctx.globalAlpha = Math.min(1, 0.5 + (heat / 100) * 0.55) * flicker;
      const ox = 40, oy = 30;
      ctx.drawImage(assets.fire, ox, oy, W, H);
      ctx.restore();
    }

    // Foreground crate + fan
    if (assets.fg) ctx.drawImage(assets.fg, 0, 0, W, H);

    if (!(state === 'play' && play)) drawBaoge();

    // Interactive overlays during play
    if (state === 'play' && play) {
      for (const st of play.steamers) {
        if (!st.unlocked) continue;
        drawSteamer(st);
      }
      drawBaoge();
      if (fanning) drawSwingFan();
      drawSparks();

      const action = currentAction();
      const serveHot = action === '出餐';
      drawZone(
        ZONES.basket,
        '出餐',
        serveHot ? 'rgba(255,40,30,0.42)' : 'rgba(180,40,40,0.16)',
        serveHot ? '#ffd0c8' : 'rgba(255,140,120,0.7)',
        serveHot,
        'basket',
      );
      drawZone(
        ZONES.fan,
        fanning ? '搧火中' : '搧火',
        (action === '搧火' || fanning) ? 'rgba(255,170,40,0.34)' : 'rgba(255,160,40,0.14)',
        (action === '搧火' || fanning) ? '#ffe08a' : 'rgba(255,200,80,0.65)',
        action === '搧火' || fanning,
        'fan',
      );

      for (const st of play.steamers) {
        if (!st.unlocked) continue;
        drawHeldKueh(st);
      }
      for (const d of play.drops || []) drawBasketDrop(d);
      drawCritter();
      drawEdgeFlash();

      const focus = focusSteamer();
      for (const st of play.steamers) {
        if (!st.unlocked) continue;
        if (focus && st.id === focus.id) drawFocusFrame(st.x, st.y, st.w, st.h, st.flash > 0);
        drawGradeBanner(st);
      }

      if (play.tutorialT > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W * 0.2, H * 0.82, W * 0.6, 70);
        ctx.fillStyle = '#ffe8c8';
        ctx.font = `bold 28px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('點蒸籠倒漿 → 按住右扇搧火 → 時機到點籠揭開 → 送到左紅籃', W / 2, H * 0.82 + 45);
        ctx.restore();
      }
    } else if (state === 'title' || state === 'boot') {
      // idle preview: stage already layered
    }
  }

  function drawBaoge() {
    if (!assets.baoge) return;
    const bx = play ? play.baoge.x : BAOGE_HOME_X;
    const by = (play ? play.baoge.y : BAOGE_FLOOR) + crouchDrop();
    const bw = BAOGE_H * (assets.baoge.width / assets.baoge.height);
    const sy = fanning ? 0.78 : 1;
    ctx.save();
    // Feet stay put. Scale toward the floor so a crouch does not flip him or hide the face.
    ctx.translate(bx, by);
    ctx.scale(1, sy);
    ctx.drawImage(assets.baoge, -bw / 2, -BAOGE_H, bw, BAOGE_H);
    ctx.restore();
  }

  function drawSwingFan() {
    if (!assets.baoge || !play) return;
    const bx = play.baoge.x;
    const by = play.baoge.y + crouchDrop();
    const bw = BAOGE_H * (assets.baoge.width / assets.baoge.height);
    const sy = 0.78;
    // His right hand is on the viewer's left while he faces the camera.
    const handX = bx - bw * 0.42;
    const handY = by - BAOGE_H * sy * 0.46;
    const swing = Math.sin(vizT * (Math.PI * 2 / 0.3)) * 0.85;
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(0.95 + swing);
    ctx.fillStyle = '#8a5a32';
    ctx.strokeStyle = '#2a211c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-7, 64);
    ctx.lineTo(7, 64);
    ctx.lineTo(7, 0);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -18, 58, 46, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f4e2b8';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,30,0.45)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 8, -30);
      ctx.lineTo(i * 6, 14);
      ctx.stroke();
    }
    ctx.restore();
    // Extra flame tongues at the stove mouth, in front of the fire layer.
    ctx.save();
    const flick = 0.75 + 0.25 * Math.sin(vizT * 24);
    ctx.globalAlpha = 0.85 * flick;
    ctx.fillStyle = '#ffb13a';
    ctx.beginPath();
    ctx.moveTo(790, 640);
    ctx.quadraticCurveTo(810, 560 - flick * 20, 840, 640);
    ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.moveTo(808, 636);
    ctx.quadraticCurveTo(822, 590, 836, 636);
    ctx.fill();
    ctx.restore();
  }

  function drawSparks() {
    if (!play || !play.sparks) return;
    ctx.save();
    for (const sp of play.sparks) {
      const a = Math.max(0, sp.life / sp.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = a > 0.5 ? '#ffe08a' : '#ff7a32';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3 + a * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPreviewTag(x, y) {
    ctx.save();
    ctx.font = `bold 22px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = '預覽';
    const tw = ctx.measureText(text).width;
    roundRect(ctx, x - tw / 2 - 8, y - 16, tw + 16, 32, 8);
    ctx.fillStyle = 'rgba(20,10,8,0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.fillStyle = '#ffe08a';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawCritter() {
    if (!play || !play.critter) return;
    const c = play.critter;
    const p = critterPos(c);
    const bob = Math.sin(vizT * 14) * 4;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    if (c.kind === 'roach') {
      ctx.fillStyle = '#6b3a22';
      ctx.strokeStyle = '#24160f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 6, 46, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(36, -2, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#8a4e2c';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#3a2418';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(44, -14);
      ctx.quadraticCurveTo(62, -32, 70, -18);
      ctx.moveTo(40, -16);
      ctx.quadraticCurveTo(54, -36, 66, -26);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(42, -6, 5, 0, Math.PI * 2);
      ctx.arc(52, -4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#24160f';
      ctx.beginPath();
      ctx.arc(43, -6, 2.2, 0, Math.PI * 2);
      ctx.arc(53, -4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a2418';
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-10 + i * 12, side * 18);
          ctx.lineTo(-22 + i * 14, side * 34);
          ctx.stroke();
        }
      }
    } else {
      ctx.fillStyle = '#d9d3cc';
      ctx.strokeStyle = '#2a241c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(-6, 8, 40, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(28, -4, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f3b7c4';
      ctx.beginPath();
      ctx.arc(16, -24, 12, 0, Math.PI * 2);
      ctx.arc(36, -26, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(24, -6, 5, 0, Math.PI * 2);
      ctx.arc(36, -6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#24160f';
      ctx.beginPath();
      ctx.arc(25, -6, 2.2, 0, Math.PI * 2);
      ctx.arc(37, -6, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2a241c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-40, 10);
      ctx.quadraticCurveTo(-70, -10, -78, 16);
      ctx.stroke();
    }
    ctx.restore();
    drawPreviewTag(p.x, p.y - 58);
  }

  function drawEdgeFlash() {
    if (!play || play.edgeFlash <= 0) return;
    const a = Math.min(0.7, play.edgeFlash * 1.4);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 24, 24, ${a})`;
    ctx.lineWidth = 36;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.restore();
  }

  function drawZone(z, label, fill, stroke, hot, icon) {
    ctx.save();
    const pulse = hot ? 1 + Math.sin(vizT * 5) * 0.03 : 1;
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.translate(-cx, -cy);
    if (hot) {
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 28;
    }
    roundRect(ctx, z.x, z.y, z.w, z.h, 16);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = hot ? 6 : 3;
    if (!hot) ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${hot ? 44 : 30}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (icon) drawIcon(icon, cx - ctx.measureText(label).width / 2 - 26, cy, hot ? 36 : 28);
    ctx.fillText(label, cx + (icon ? 16 : 0), cy);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    vizT += dt;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function bind() {
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);

    $('btn-start').addEventListener('click', () => startRound());
    $('btn-boards').addEventListener('click', () => {
      showScreen('screen-boards');
      state = 'boards';
      renderBoards();
    });
    $('btn-boards-close').addEventListener('click', () => {
      if (pendingRecord) {
        showScreen('screen-results');
        state = 'results';
      } else {
        showScreen('screen-title');
        state = 'title';
      }
    });
    $('btn-submit').addEventListener('click', () => { submitBoard(); });
    $('btn-again').addEventListener('click', () => {
      pendingRecord = null;
      showScreen('screen-title');
      state = 'title';
      // auto-start? Spec says play again — jump to new round with current name field
      $('name-input').value = validName(playerName) ? playerName : (save.playerName || '');
      startRound();
    });
    $('btn-title').addEventListener('click', () => {
      pendingRecord = null;
      showScreen('screen-title');
      state = 'title';
      draw();
    });
  }

  async function main() {
    save = readSave();
    if (validName(save.playerName)) {
      playerName = save.playerName;
      $('name-input').value = playerName;
    }
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      alert('素材載入失敗，請用本地伺服器打開本資料夾。');
    }
    updateHudAvatar();
    bind();
    installTestHook();
    showScreen('screen-title');
    state = 'title';
    requestAnimationFrame(loop);
  }

  function installTestHook() {
    if (!/[?&]e2e=1(?:&|$)/.test(location.search)) return;
    window.__baoji = {
      snapshot() {
        if (!play) return { state, baogeH: BAOGE_H / H };
        const c = play.critter;
        const pos = c ? critterPos(c) : null;
        return {
          state,
          score: play.score,
          combo: play.combo,
          fanning,
          baogeH: BAOGE_H / H,
          baogeX: play.baoge.x,
          baogeY: play.baoge.y,
          avatar: avatarExpr,
          fanSwing: Math.sin(vizT * (Math.PI * 2 / 0.3)),
          edgeFlash: play.edgeFlash,
          critter: c && { kind: c.kind, age: c.age, x: pos.x, y: pos.y, tap: critterTap(), targetId: c.targetId },
          steamers: play.steamers.map((s) => ({
            id: s.id,
            state: s.state,
            progress: s.progress,
            unlocked: s.unlocked,
            steam: s.state === 'cooking' ? cookSteam(s) : null,
          })),
          hint: $('touch-hint').textContent,
          comboText: $('hud-combo').textContent,
        };
      },
      spawn(kind) { spawnCritter(kind); },
      miss() { resolveCritter(false); },
      setScore(n) { play.score = n; updateHud(); },
      setCombo(n) { play.combo = n; updateHud(); },
      cook(id, p) {
        const st = play.steamers.find((s) => s.id === id);
        if (!st) return;
        st.unlocked = true;
        st.state = 'cooking';
        st.progress = p;
        st.lidOpen = 0;
        st.revealAge = -1;
        st.heartPlayed = false;
      },
    };
  }

  main();
})();

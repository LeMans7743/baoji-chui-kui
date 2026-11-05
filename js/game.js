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

  // Steamers unlock over heat/time. Positions over stove / bamboo.
  const STEAMER_DEFS = [
    { id: 'a1', name: '鋁籠·左', x: 720, y: 355, w: 190, h: 145, unlockAt: 0, kind: 'alum' },
    { id: 'a2', name: '鋁籠·中下', x: 930, y: 375, w: 200, h: 155, unlockAt: 0, kind: 'alum' },
    { id: 'a3', name: '鋁籠·中上', x: 945, y: 245, w: 175, h: 130, unlockAt: 18, kind: 'alum' },
    { id: 'b1', name: '竹籠·下', x: 1265, y: 455, w: 210, h: 115, unlockAt: 28, kind: 'bamboo' },
    { id: 'b2', name: '竹籠·中', x: 1275, y: 350, w: 200, h: 105, unlockAt: 42, kind: 'bamboo' },
    { id: 'b3', name: '竹籠·上', x: 1285, y: 250, w: 185, h: 100, unlockAt: 55, kind: 'bamboo' },
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
      baoge: { x: 960, y: 780, tx: 960, ty: 780, facing: 1 },
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
    st.state = 'cooldown';
    st.cookTime = 0.35;
    st.serveTimer = 0;
    setAvatar(AV.proud, 1.0);
    floatText(ZONES.basket.x + ZONES.basket.w / 2, ZONES.basket.y + 40, `出餐 +${add}`, 'bonus');
    updateHud();
  }

  function pourSteamer(st) {
    if (st.state !== 'empty' || !st.unlocked) return;
    st.state = 'cooking';
    st.progress = 0.02;
    st.overflowed = false;
    st.cookTime = 0;
    setAvatar(AV.fire, 0.8);
    floatText(st.x + st.w / 2, st.y + st.h / 2, '倒漿', 'ok');
    // walk toward steamer
    play.baoge.tx = st.x + st.w / 2;
    play.baoge.ty = Math.min(820, st.y + st.h + 80);
  }

  function uncoverSteamer(st) {
    if (st.state !== 'cooking') return;
    const grade = gradeFromProgress(st.progress, play.heat);
    awardUncover(st, grade);
    play.baoge.tx = st.x + st.w / 2;
    play.baoge.ty = Math.min(820, st.y + st.h + 80);
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
    pointers.set(e.pointerId, { x, y });
    const hit = hitTest(x, y);
    if (!hit) return;
    if (hit.type === 'fan') {
      fanning = true;
      play.baoge.tx = ZONES.fan.x + 40;
      play.baoge.ty = 780;
      setAvatar(AV.fire, 0.6);
    } else if (hit.type === 'basket') {
      play.baoge.tx = ZONES.basket.x + ZONES.basket.w / 2;
      play.baoge.ty = 820;
      tryServe();
    } else if (hit.type === 'steamer') {
      const st = hit.st;
      if (st.state === 'empty') pourSteamer(st);
      else if (st.state === 'cooking') uncoverSteamer(st);
      else if (st.state === 'serve') {
        floatText(st.x + st.w / 2, st.y, '先送到左邊紅籃出餐！', 'warn');
        play.baoge.tx = ZONES.basket.x + ZONES.basket.w / 2;
      }
    } else if (hit.type === 'walk') {
      play.baoge.tx = hit.x;
      play.baoge.ty = Math.max(700, Math.min(900, hit.y));
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) fanning = false;
  }

  function onPointerMove(e) {
    if (state !== 'play' || !pointers.has(e.pointerId)) return;
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    pointers.set(e.pointerId, { x, y });
    const f = ZONES.fan;
    if (fanning) {
      const still = x >= f.x - 40 && x <= f.x + f.w + 40 && y >= f.y - 40 && y <= f.y + f.h + 40;
      if (!still) fanning = false;
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
      if (avatarExpr !== AV.fire) setAvatar(AV.fire, 0.5);
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
        // auto fail if way overcooked
        if (st.progress >= 1.15) {
          awardUncover(st, GRADE.JIAOHUI);
        }
      } else if (st.state === 'serve') {
        st.serveTimer -= dt;
        if (st.serveTimer <= 0) {
          // missed serve — no points change, just lose the plate; combo unchanged for serve miss? Spec only resets on uncover fail. Clear.
          st.state = 'empty';
          floatText(st.x + st.w / 2, st.y, '出餐逾時', 'warn');
        }
      } else if (st.state === 'cooldown') {
        st.cookTime -= dt;
        if (st.cookTime <= 0) {
          st.state = 'empty';
          st.progress = 0;
          st.overflowed = false;
        }
      }
      if (st.flash > 0) st.flash -= dt;
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

  function drawDonenessMeter(st) {
    if (st.state !== 'cooking') return;
    const w = heatWindows(play.heat);
    const mx = st.x, my = st.y - 28, mw = st.w, mh = 14;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(mx, my, mw, mh);
    // zones
    const idealX = mx + w.ideal * mw;
    ctx.fillStyle = 'rgba(80,180,80,0.45)';
    ctx.fillRect(idealX - w.qia * mw, my, w.qia * 2 * mw, mh);
    ctx.fillStyle = 'rgba(255,220,60,0.7)';
    ctx.fillRect(idealX - w.hong * mw, my, w.hong * 2 * mw, mh);
    // needle
    const nx = mx + Math.min(1.05, st.progress) * mw;
    ctx.fillStyle = '#fff';
    ctx.fillRect(nx - 2, my - 3, 4, mh + 6);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Layers (wall → stove → fire → fg → baoge)
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

    // Baoge in center walkway
    if (assets.baoge) {
      const bx = play ? play.baoge.x : 960;
      const by = play ? play.baoge.y : 780;
      const bh = H * 0.36;
      const bw = bh * (assets.baoge.width / assets.baoge.height);
      ctx.drawImage(assets.baoge, bx - bw / 2, by - bh, bw, bh);
    }

    // Interactive overlays during play
    if (state === 'play' && play) {
      // steamer highlights
      for (const st of play.steamers) {
        if (!st.unlocked) continue;
        ctx.save();
        let stroke = 'rgba(255,255,255,0.35)';
        let fill = 'rgba(255,255,255,0.06)';
        if (st.state === 'cooking') {
          stroke = 'rgba(255,200,80,0.9)';
          fill = 'rgba(255,180,40,0.12)';
        } else if (st.state === 'serve') {
          stroke = 'rgba(80,220,120,0.95)';
          fill = 'rgba(80,220,120,0.18)';
        } else if (st.state === 'empty') {
          stroke = 'rgba(140,200,255,0.7)';
        }
        if (st.flash > 0) {
          stroke = 'rgba(255,80,60,0.95)';
          fill = `rgba(255,60,40,${0.15 + st.flash * 0.1})`;
        }
        roundRect(ctx, st.x, st.y, st.w, st.h, 12);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        let label = st.name;
        if (st.state === 'empty') label = '倒漿';
        if (st.state === 'cooking') label = '揭籠';
        if (st.state === 'serve') label = `出餐 ${st.serveTimer.toFixed(1)}s`;
        if (st.state === 'cooldown') label = '…';
        ctx.fillText(label, st.x + st.w / 2, st.y + st.h / 2 + 8);
        drawDonenessMeter(st);
        ctx.restore();
      }

      // basket / fan zones
      drawZone(ZONES.basket, '出餐', 'rgba(220,60,60,0.25)', 'rgba(255,120,100,0.85)');
      drawZone(ZONES.fan, fanning ? '搧火中' : '搧火', 'rgba(255,160,40,0.2)', 'rgba(255,200,80,0.9)');

      if (play.tutorialT > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W * 0.2, H * 0.82, W * 0.6, 70);
        ctx.fillStyle = '#ffe8c8';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('點蒸籠倒漿 → 按住右扇搧火 → 時機到點籠揭開 → 送到左紅籃', W / 2, H * 0.82 + 45);
        ctx.restore();
      }
    } else if (state === 'title' || state === 'boot') {
      // idle preview: stage already layered
    }
  }

  function drawZone(z, label, fill, stroke) {
    ctx.save();
    roundRect(ctx, z.x, z.y, z.w, z.h, 16);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2 + 10);
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
    showScreen('screen-title');
    state = 'title';
    requestAnimationFrame(loop);
  }

  main();
})();

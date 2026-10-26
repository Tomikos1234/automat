/*
 * Rozhraní automatu – animace válců, prezentace výher, risk, autospin, zvuky.
 */
(() => {
  'use strict';

  const E = window.SlotEngine;

  const BETS = [10, 20, 50, 100, 200, 500, 1000];
  const START_BALANCE = 1000;
  const REFILL = 1000;
  const BIG_WIN = 15;   // násobek celkové sázky
  const MEGA_WIN = 50;
  const GAMBLE_ROUNDS = 5;
  const LINE_COLORS = ['#ffd54a', '#ff5c8a', '#4dd6ff', '#7cff6b', '#ff9f43', '#c58cff', '#5cffd6', '#ff6b6b', '#7d9bff', '#f2ff5c'];
  const SCATTER_COLOR = '#7fd8ff';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (sel) => document.querySelector(sel);
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('zlata7:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('zlata7:' + key, JSON.stringify(value));
      } catch {
        // Bez úložiště se hraje dál, jen se nic nepamatuje.
      }
    },
  };

  const NO_FS = { active: false, left: 0, total: 0, played: 0, won: 0, bet: 0 };

  function loadFs() {
    const fs = store.get('fs', null);
    if (!fs || !(fs.left > 0) || !BETS.includes(fs.bet)) return { ...NO_FS };
    return { ...NO_FS, ...fs, active: true };
  }

  const savedBalance = Number(store.get('balance', START_BALANCE));
  const savedBet = Number(store.get('betIndex', 1));

  const state = {
    balance: Number.isFinite(savedBalance) && savedBalance >= 0 ? savedBalance : START_BALANCE,
    betIndex: Number.isInteger(savedBet) && savedBet >= 0 && savedBet < BETS.length ? savedBet : 1,
    turbo: store.get('turbo', false) === true,
    sound: store.get('sound', true) !== false,
    phase: 'idle', // idle | spinning | celebrate | gamble
    grid: E.spin().grid,
    lastWin: 0,
    lastSpinWon: false,
    canGamble: false,
    auto: 0,
    fs: loadFs(),
  };

  const el = {
    reels: $('#reels'),
    paylines: $('#paylines'),
    markersLeft: $('#markers-left'),
    markersRight: $('#markers-right'),
    ticker: $('#ticker'),
    srStatus: $('#sr-status'),
    fsBadge: $('#fs-badge'),
    fsCount: $('#fs-count'),
    balance: $('#balance'),
    bet: $('#bet'),
    lineBet: $('#line-bet'),
    win: $('#win'),
    winLabel: $('#win-label'),
    betDown: $('#bet-down'),
    betUp: $('#bet-up'),
    spin: $('#btn-spin'),
    spinLabel: $('#spin-label'),
    auto: $('#btn-auto'),
    autoMenu: $('#auto-menu'),
    risk: $('#btn-risk'),
    turbo: $('#btn-turbo'),
    sound: $('#btn-sound'),
    info: $('#btn-info'),
    refill: $('#btn-refill'),
    dlgPaytable: $('#dlg-paytable'),
    dlgGamble: $('#dlg-gamble'),
    dlgBroke: $('#dlg-broke'),
    celebrate: $('#celebrate'),
    coins: $('#coins'),
    celTitle: $('#cel-title'),
    celAmount: $('#cel-amount'),
    celSub: $('#cel-sub'),
    card: $('#g-card'),
    cardFront: $('#g-front'),
  };

  const currentBet = () => (state.fs.active ? state.fs.bet : BETS[state.betIndex]);

  /* ---------- Zvuky (syntetizované, bez souborů) ---------- */

  const sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let lastStop = 0;

    function ac() {
      if (!state.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, at, dur, { type = 'sine', gain = 0.15, to = 0 } = {}) {
      const c = ac();
      if (!c) return;
      const t = c.currentTime + at;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    function noise(at, dur, { gain = 0.1, freq = 1000, q = 1, to = 0 } = {}) {
      const c = ac();
      if (!c) return;
      const t = c.currentTime + at;
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = q;
      filter.frequency.setValueAtTime(freq, t);
      if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }

    const arp = (notes, gap, dur, opts, start = 0) => notes.forEach((f, i) => tone(f, start + i * gap, dur, opts));

    return {
      unlock: ac,
      click() { tone(880, 0, 0.05, { type: 'square', gain: 0.035 }); },
      spinStart() { noise(0, 0.35, { gain: 0.07, freq: 400, to: 2400, q: 0.8 }); },
      reelStop() {
        const now = performance.now();
        if (now - lastStop < 40) return;
        lastStop = now;
        tone(150, 0, 0.14, { type: 'triangle', gain: 0.28, to: 60 });
        noise(0, 0.06, { gain: 0.06, freq: 2500, q: 2 });
      },
      scatter(i) { arp([1047, 1319, 1568].map((f) => f * (1 + i * 0.06)), 0.05, 0.3, { gain: 0.1 }); },
      tease() { tone(220, 0, 1.1, { type: 'sawtooth', gain: 0.025, to: 440 }); },
      win(ratio) {
        if (ratio >= 5) arp([523, 659, 784, 1047, 1319, 1568], 0.07, 0.3, { type: 'triangle', gain: 0.14 });
        else arp([659, 784, 1047], 0.07, 0.22, { type: 'triangle', gain: 0.12 });
      },
      fanfare() {
        arp([523, 659, 784, 1047], 0.12, 0.3, { type: 'square', gain: 0.05 });
        arp([1047, 1319, 1568, 2093], 0.1, 0.5, { type: 'triangle', gain: 0.1 }, 0.5);
      },
      flip() { noise(0, 0.12, { gain: 0.08, freq: 3000, q: 1.5 }); },
      gambleWin() { arp([784, 1047, 1568], 0.06, 0.25, { type: 'triangle', gain: 0.14 }); },
      gambleLose() { tone(330, 0, 0.5, { type: 'sawtooth', gain: 0.06, to: 110 }); },
    };
  })();

  /* ---------- Čísla na displejích ---------- */

  const shown = new Map();

  function showNumber(node, value, ms = 0) {
    const entry = shown.get(node) || { value, raf: 0 };
    cancelAnimationFrame(entry.raf);
    shown.set(node, entry);
    const from = entry.value;
    if (!ms || from === value || reducedMotion.matches) {
      entry.value = value;
      node.textContent = fmt(value);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      entry.value = p < 1 ? from + (value - from) * (1 - Math.pow(1 - p, 3)) : value;
      node.textContent = fmt(entry.value);
      if (p < 1) entry.raf = requestAnimationFrame(step);
    };
    entry.raf = requestAnimationFrame(step);
  }

  function setBalance(value, ms = 0) {
    state.balance = value;
    showNumber(el.balance, value, ms);
    store.set('balance', value);
  }

  const setWin = (value, ms = 0) => showNumber(el.win, value, ms);
  const saveFs = () => store.set('fs', state.fs.active ? state.fs : null);

  function setTicker(text, amount = 0) {
    el.ticker.classList.toggle('is-win', amount > 0);
    if (amount > 0) {
      const b = document.createElement('b');
      b.textContent = fmt(amount);
      el.ticker.replaceChildren(text, b);
    } else {
      el.ticker.textContent = text;
    }
  }

  /* ---------- Válce ---------- */

  const reelEls = [];

  function makeCell(sym) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.sym = sym;
    cell.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${sym}"/></svg>`;
    return cell;
  }

  function buildReels() {
    for (let r = 0; r < E.REELS; r++) {
      const reel = document.createElement('div');
      reel.className = 'reel';
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.append(...state.grid[r].map(makeCell));
      reel.append(strip);
      el.reels.append(reel);
      reelEls.push({ reel, strip });
    }
  }

  const cellAt = (reel, row) => reelEls[reel].strip.children[row];

  function buildMarkers() {
    [[el.markersLeft, 0], [el.markersRight, E.REELS - 1]].forEach(([container, col]) => {
      const byRow = [[], [], []];
      E.LINES.forEach((rows, i) => byRow[rows[col]].push(i));
      byRow.forEach((ids, row) => ids.forEach((id, k) => {
        const m = document.createElement('button');
        m.type = 'button';
        m.className = 'marker';
        m.dataset.line = id;
        m.textContent = id + 1;
        m.setAttribute('aria-label', `Linie ${id + 1}`);
        m.style.setProperty('--c', LINE_COLORS[id]);
        const y = row + 0.5 + (k - (ids.length - 1) / 2) * 0.26;
        m.style.top = `${(y / E.ROWS) * 100}%`;
        container.append(m);
      }));
    });
  }

  let running = [];

  function animateReels(result) {
    const fast = state.turbo || reducedMotion.matches;
    const base = fast ? 360 : 820;
    const step = fast ? 110 : 240;
    const teaseMs = fast ? 600 : 1300;
    const speed = fast ? 30 : 26; // políček za sekundu

    let extra = 0;
    let stars = 0;
    running = [];
    const done = [];

    for (let r = 0; r < E.REELS; r++) {
      // Dvě hvězdy už leží – další válce se točí déle, ať je napětí
      if (stars >= 2) extra += teaseMs;
      stars += result.grid[r].filter((s) => s === 'star').length;

      const duration = base + r * step + extra;
      const { reel, strip } = reelEls[r];
      const source = E.strips[r];
      const stop = result.stops[r];
      const fill = Math.max(8, Math.round((duration / 1000) * speed));

      // Nahoře nová trojice, pod ní symboly, které "proletí", dole ty současné.
      const fresh = [];
      for (let k = 0; k < E.ROWS + fill; k++) fresh.push(makeCell(source[(stop + k) % source.length]));
      strip.prepend(...fresh);

      const n = strip.children.length;
      const cell = 100 / n;
      const from = -(n - E.ROWS) * cell;
      const anim = strip.animate([
        { transform: `translateY(${from}%)`, easing: 'ease-out' },
        { transform: `translateY(${from - cell * 0.2}%)`, offset: 0.06, easing: 'cubic-bezier(.35, .1, .25, 1)' },
        { transform: `translateY(${cell * 0.16}%)`, offset: 0.93, easing: 'ease-in-out' },
        { transform: 'translateY(0%)' },
      ], { duration });
      running.push(anim);

      const starsUpToHere = stars;
      done.push(anim.finished.then(() => {
        while (strip.children.length > E.ROWS) strip.lastElementChild.remove();
        reel.classList.remove('tease');
        sound.reelStop();
        result.grid[r].forEach((s, row) => {
          if (s !== 'star') return;
          const c = cellAt(r, row);
          c.classList.add('land');
          setTimeout(() => c.classList.remove('land'), 520);
          sound.scatter(r);
        });
        const next = running[r + 1];
        if (starsUpToHere >= 2 && next && next.playState === 'running') {
          reelEls[r + 1].reel.classList.add('tease');
          sound.tease();
        }
      }));
    }
    return Promise.all(done);
  }

  function quickStop() {
    for (const anim of running) if (anim.playState === 'running') anim.finish();
  }

  /* ---------- Prezentace výher ---------- */

  let presentation = null;
  let drawn = [];

  function drawLines(entries, animate = true) {
    drawn = entries;
    const svg = el.paylines;
    svg.replaceChildren();
    svg.classList.remove('reveal');
    if (!entries.length) return;
    if (animate) {
      void svg.getBoundingClientRect();
      svg.classList.add('reveal');
    }
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const width = Math.max(3, box.width / 125);
    for (const e of entries) {
      const pts = E.LINES[e.line].map((row, reel) => {
        const r = cellAt(reel, row).getBoundingClientRect();
        return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
      });
      const all = [[0, pts[0][1]], ...pts, [box.width, pts[pts.length - 1][1]]];
      const points = all.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      for (const cls of ['pl-shadow', 'pl']) {
        const pl = document.createElementNS(SVG_NS, 'polyline');
        pl.setAttribute('points', points);
        pl.setAttribute('class', cls);
        pl.style.setProperty('--c', e.color);
        pl.style.strokeWidth = cls === 'pl' ? width : width + 4;
        svg.append(pl);
      }
    }
  }

  function setMarkers(lines) {
    for (const m of document.querySelectorAll('.marker')) {
      m.classList.toggle('on', lines.includes(Number(m.dataset.line)));
    }
  }

  function highlight(entries) {
    for (const c of el.reels.querySelectorAll('.cell.hit')) c.classList.remove('hit');
    el.reels.classList.add('dim');
    for (const e of entries) {
      for (const [reel, row] of e.positions) {
        const c = cellAt(reel, row);
        c.classList.add('hit');
        c.style.setProperty('--hit', e.color);
      }
    }
    const lines = entries.filter((e) => e.line != null);
    setMarkers(lines.map((e) => e.line));
    drawLines(lines);
  }

  function clearPresentation() {
    if (presentation) clearTimeout(presentation.timer);
    presentation = null;
    el.reels.classList.remove('dim');
    for (const c of el.reels.querySelectorAll('.cell.hit')) c.classList.remove('hit');
    setMarkers([]);
    drawLines([]);
  }

  function buildEntries(res) {
    const entries = res.lines.map((l) => ({
      line: l.index,
      positions: l.positions,
      color: LINE_COLORS[l.index],
      win: l.win,
      text: `Linie ${l.index + 1} · ${l.count}× ${E.SYMBOLS[l.symbol].name}`,
    }));
    if (res.scatter.count >= 3) {
      entries.push({
        line: null,
        positions: res.scatter.positions,
        color: SCATTER_COLOR,
        win: res.scatter.win,
        text: `${res.scatter.count}× Hvězda`,
      });
    }
    return entries;
  }

  // Nejdřív všechny výherní linie najednou, pak jedna po druhé dokola.
  function present(entries, total) {
    clearPresentation();
    if (!entries.length) return;
    presentation = { timer: 0 };
    const showAll = () => {
      highlight(entries);
      setTicker(entries.length > 1 ? 'Výhra' : entries[0].text, total);
    };
    showAll();
    if (entries.length < 2) return;
    let i = -1;
    const tick = () => {
      if (!presentation) return;
      i = (i + 1) % (entries.length + 1);
      if (i === entries.length) showAll();
      else {
        highlight([entries[i]]);
        setTicker(entries[i].text, entries[i].win);
      }
      presentation.timer = setTimeout(tick, i === entries.length ? 1800 : 1300);
    };
    presentation.timer = setTimeout(tick, 1800);
  }

  function previewLine(line) {
    if (presentation || state.phase !== 'idle') return;
    if (line == null) {
      setMarkers([]);
      drawLines([]);
    } else {
      setMarkers([line]);
      drawLines([{ line, color: LINE_COLORS[line] }]);
    }
  }

  /* ---------- Oslava ---------- */

  function coinRain(canvas, intensity) {
    if (reducedMotion.matches) return () => {};
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const coins = [];
    let last = performance.now();
    let raf = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let i = 0; i < 4; i++) {
        if (Math.random() < 0.6 * intensity) {
          coins.push({
            x: Math.random() * w,
            y: -30,
            vx: (Math.random() - 0.5) * 140,
            vy: 120 + Math.random() * 260,
            r: 9 + Math.random() * 10,
            a: Math.random() * Math.PI * 2,
            va: 4 + Math.random() * 8,
          });
        }
      }
      ctx.clearRect(0, 0, w, h);
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.vy += 520 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.a += c.va * dt;
        if (c.y > h + 40) {
          coins.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(Math.max(0.12, Math.abs(Math.cos(c.a))), 1);
        const g = ctx.createRadialGradient(-c.r * 0.3, -c.r * 0.3, 1, 0, 0, c.r);
        g.addColorStop(0, '#fff6c4');
        g.addColorStop(0.5, '#ffc93c');
        g.addColorStop(1, '#b8740a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#8a5400';
        ctx.stroke();
        ctx.fillStyle = 'rgba(138, 84, 0, 0.6)';
        ctx.font = `900 ${c.r}px Rubik, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('7', 0, 1);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, w, h);
    };
  }

  function celebrate(title, amount, sub) {
    return new Promise((resolve) => {
      document.body.classList.add('party');
      el.celTitle.textContent = title;
      el.celSub.textContent = sub || '';
      el.celAmount.hidden = amount == null;
      if (amount != null) {
        shown.delete(el.celAmount);
        showNumber(el.celAmount, 0);
        showNumber(el.celAmount, amount, 1800);
      }
      el.celebrate.hidden = false;
      const stopCoins = coinRain(el.coins, amount != null ? 1 : 0.5);
      sound.fanfare();

      const openedAt = performance.now();
      let closed = false;
      const finish = (byUser) => {
        if (closed || (byUser && performance.now() - openedAt < 500)) return;
        closed = true;
        clearTimeout(timer);
        el.celebrate.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        stopCoins();
        el.celebrate.hidden = true;
        document.body.classList.remove('party');
        resolve();
      };
      const onClick = () => finish(true);
      const onKey = (e) => {
        if (e.code === 'Space' || e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        }
      };
      el.celebrate.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
      const timer = setTimeout(() => finish(false), amount != null ? 4200 : 2600);
    });
  }

  /* ---------- Hlavní smyčka ---------- */

  let flow = 0;

  async function spin() {
    if (state.phase === 'spinning') {
      quickStop();
      return;
    }
    if (state.phase !== 'idle') return;

    const free = state.fs.left > 0;
    const bet = currentBet();
    if (!free && state.balance < bet) {
      stopAuto();
      if (state.balance < BETS[0]) openBroke();
      else setTicker('Málo kreditu – sniž sázku');
      return;
    }

    flow++;
    sound.unlock();
    closeAutoMenu();
    clearPresentation();
    state.canGamble = false;
    state.lastWin = 0;
    if (free) {
      if (state.fs.played === 0) setWin(0);
      state.fs.left--;
      state.fs.played++;
    } else {
      setBalance(state.balance - bet, 250);
      setWin(0);
    }
    saveFs();
    state.phase = 'spinning';
    syncUI();
    setTicker(free ? `Free spin ${state.fs.played} z ${state.fs.total}` : 'Hodně štěstí!');
    sound.spinStart();

    const result = E.spin();
    const res = E.evaluate(result.grid, bet / E.LINES.length, free ? E.FREE_SPIN_MULTIPLIER : 1);
    await animateReels(result);
    state.grid = result.grid;
    state.lastSpinWon = res.total > 0;

    if (res.total > 0) {
      state.lastWin = res.total;
      setBalance(state.balance + res.total, 700);
      if (free) state.fs.won += res.total;
      setWin(free ? state.fs.won : res.total, 700);
      present(buildEntries(res), res.total);
      sound.win(res.total / bet);
      el.srStatus.textContent = `Výhra ${fmt(res.total)}`;
    } else {
      setTicker(free ? `Free spin ${state.fs.played} z ${state.fs.total}` : pick(['Zkus to znovu', 'Příště to vyjde', 'Točíme dál']));
      el.srStatus.textContent = 'Bez výhry';
    }
    saveFs();

    if (res.total >= bet * BIG_WIN) {
      state.phase = 'celebrate';
      syncUI();
      await celebrate(res.total >= bet * MEGA_WIN ? 'Mega výhra' : 'Velká výhra', res.total, `${fmt(res.total / bet)}× sázka`);
    }

    if (res.scatter.freeSpins) {
      state.phase = 'celebrate';
      syncUI();
      if (state.fs.active) {
        state.fs.left += res.scatter.freeSpins;
        state.fs.total += res.scatter.freeSpins;
        saveFs();
        await celebrate(`+${res.scatter.freeSpins} free spinů`, null, 'Hvězdy znovu zabodovaly');
      } else {
        state.fs = { active: true, left: res.scatter.freeSpins, total: res.scatter.freeSpins, played: 0, won: 0, bet };
        saveFs();
        syncUI();
        await celebrate(`${res.scatter.freeSpins} free spinů`, null, `Všechny výhry ×${E.FREE_SPIN_MULTIPLIER}`);
      }
    }

    if (state.fs.active && state.fs.left === 0) {
      state.phase = 'celebrate';
      syncUI();
      await delay(state.lastSpinWon ? 1500 : 700);
      const won = state.fs.won;
      await celebrate('Konec free spinů', won, 'Celková výhra');
      state.fs = { ...NO_FS };
      saveFs();
      setWin(won);
      setTicker('Free spiny vynesly', won);
    }

    state.phase = 'idle';
    state.canGamble = !free && !state.fs.active && res.total > 0 && state.auto === 0;
    syncUI();
    continueFlow();
  }

  async function continueFlow() {
    const token = flow;
    const ready = async (ms) => {
      await delay(ms);
      return token === flow && state.phase === 'idle';
    };

    if (state.fs.left > 0) {
      if (await ready(state.lastSpinWon ? 1500 : 650)) spin();
      return;
    }
    if (state.balance < BETS[0]) {
      stopAuto();
      openBroke();
      return;
    }
    if (state.auto > 0 && (await ready(state.lastSpinWon ? 1200 : 350)) && state.auto > 0) {
      state.auto--;
      spin();
    }
  }

  function onSpinButton() {
    if (state.auto > 0) {
      stopAuto();
      setTicker('Autospin zastaven');
      if (state.phase === 'spinning') quickStop();
      return;
    }
    spin();
  }

  function startAuto(count) {
    if (state.phase !== 'idle' && state.phase !== 'spinning') return;
    sound.unlock();
    state.auto = count;
    state.canGamble = false;
    syncUI();
    if (state.phase === 'idle') {
      state.auto--;
      spin();
    }
  }

  function stopAuto() {
    state.auto = 0;
    syncUI();
  }

  function toggleAutoMenu(open = el.autoMenu.hidden) {
    el.autoMenu.hidden = !open;
    el.auto.setAttribute('aria-expanded', String(open));
  }
  const closeAutoMenu = () => toggleAutoMenu(false);

  function changeBet(delta) {
    if (state.phase !== 'idle' || state.fs.active) return;
    const i = Math.min(BETS.length - 1, Math.max(0, state.betIndex + delta));
    if (i === state.betIndex) return;
    state.betIndex = i;
    store.set('betIndex', i);
    sound.click();
    syncUI();
  }

  function syncUI() {
    const spinning = state.phase === 'spinning';
    const busy = state.phase !== 'idle';
    const fsOn = state.fs.active;
    const stopMode = spinning || state.auto > 0;
    const bet = currentBet();

    el.spin.classList.toggle('is-stop', stopMode);
    el.spin.disabled = state.phase === 'celebrate' || state.phase === 'gamble';
    el.spinLabel.textContent = stopMode ? 'STOP' : fsOn ? 'FREE' : 'TOČIT';
    el.spin.setAttribute('aria-label', stopMode ? 'Zastavit' : 'Točit');

    showNumber(el.bet, bet);
    el.lineBet.textContent = `${E.LINES.length} linií × ${fmt(bet / E.LINES.length)}`;
    el.betDown.disabled = busy || fsOn || state.betIndex === 0;
    el.betUp.disabled = busy || fsOn || state.betIndex === BETS.length - 1;

    el.risk.disabled = !(state.canGamble && state.phase === 'idle');
    el.auto.textContent = state.auto > 0 ? `AUTO ${state.auto === Infinity ? '∞' : state.auto}` : 'AUTO';
    el.auto.classList.toggle('active', state.auto > 0);
    el.auto.disabled = fsOn && state.auto === 0;

    el.fsBadge.hidden = !fsOn;
    el.fsCount.textContent = `${state.fs.played} / ${state.fs.total}`;
    el.winLabel.textContent = fsOn ? 'Free spiny' : 'Výhra';
    document.body.classList.toggle('free-spins', fsOn);

    el.turbo.setAttribute('aria-pressed', String(state.turbo));
    el.sound.setAttribute('aria-pressed', String(state.sound));
  }

  /* ---------- Risk ---------- */

  const SUITS = [
    { s: '♥', red: true },
    { s: '♦', red: true },
    { s: '♠', red: false },
    { s: '♣', red: false },
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const gamble = { stake: 0, round: 0, busy: false, history: [] };

  function renderGamble(message) {
    $('#g-stake').textContent = fmt(gamble.stake);
    $('#g-double').textContent = fmt(gamble.stake * 2);
    $('#g-left').textContent = message || `Zbývá pokusů: ${GAMBLE_ROUNDS - gamble.round}`;
    $('#g-history').replaceChildren(...gamble.history.slice(-7).map((c) => {
      const i = document.createElement('i');
      i.textContent = c.s + '︎';
      if (c.red) i.className = 'red';
      return i;
    }));
    for (const id of ['#g-red', '#g-black', '#g-collect']) $(id).disabled = gamble.busy;
  }

  function openGamble() {
    if (!state.canGamble || state.phase !== 'idle' || state.lastWin <= 0) return;
    flow++;
    clearPresentation();
    state.phase = 'gamble';
    gamble.stake = state.lastWin;
    gamble.round = 0;
    gamble.busy = false;
    el.card.classList.remove('flipped');
    renderGamble('');
    syncUI();
    sound.click();
    el.dlgGamble.showModal();
  }

  // Sázka v riziku zůstává po celou dobu v kreditu – trefa ji přičte znovu,
  // omyl ji odečte. Obnovení stránky uprostřed risku tak nic nerozbije.
  async function guess(red) {
    if (gamble.busy || gamble.stake <= 0) return;
    gamble.busy = true;
    renderGamble('…');

    const suit = SUITS[E.randomInt(SUITS.length)];
    const rank = RANKS[E.randomInt(RANKS.length)];
    el.cardFront.className = 'card-face card-front' + (suit.red ? ' red' : '');
    el.cardFront.innerHTML = `<span class="rank">${rank}</span><span class="suit">${suit.s}&#xFE0E;</span><span class="rank bottom">${rank}</span>`;
    el.card.classList.add('flipped');
    sound.flip();
    await delay(480);
    gamble.history.push(suit);

    if (suit.red === red) {
      setBalance(state.balance + gamble.stake, 500);
      gamble.stake *= 2;
      gamble.round++;
      state.lastWin = gamble.stake;
      setWin(gamble.stake, 500);
      sound.gambleWin();
      const maxed = gamble.round >= GAMBLE_ROUNDS;
      renderGamble(maxed ? 'Maximum pokusů – výhra se vybírá' : `Trefa! Výhra ${fmt(gamble.stake)}`);
      await delay(1100);
      if (maxed) {
        closeGamble('Vybráno z risku', gamble.stake);
        return;
      }
      el.card.classList.remove('flipped');
      await delay(350);
      gamble.busy = false;
      renderGamble('');
    } else {
      setBalance(state.balance - gamble.stake, 500);
      gamble.stake = 0;
      state.lastWin = 0;
      setWin(0, 400);
      sound.gambleLose();
      renderGamble('Smůla – výhra propadla');
      await delay(1300);
      closeGamble('Risk nevyšel');
    }
  }

  function closeGamble(message, amount = 0) {
    gamble.busy = false;
    if (el.dlgGamble.open) el.dlgGamble.close();
    state.phase = 'idle';
    state.canGamble = false;
    setTicker(message, amount);
    syncUI();
    if (state.balance < BETS[0]) openBroke();
  }

  /* ---------- Výplatní tabulka ---------- */

  const symbolSvg = (id) => `<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${id}"/></svg>`;

  function renderPaytable() {
    const bet = currentBet();
    const lineBet = bet / E.LINES.length;
    const pays = (sym, mult) => Object.entries(E.SYMBOLS[sym].pays)
      .sort((a, b) => b[0] - a[0])
      .map(([n, m]) => `<div>${n}× <b>${fmt(m * mult)}</b></div>`)
      .join('');

    $('#pt-note').textContent = `Hodnoty pro aktuální sázku ${fmt(bet)} (${fmt(lineBet)} na linii).`;
    $('#pt-specials').innerHTML = `
      <div class="pt-card pt-special">${symbolSvg('wild')}
        <p><b>Wild</b> – objevuje se na válcích 2–5 a nahrazuje všechny symboly kromě hvězdy.</p>
      </div>
      <div class="pt-card pt-special">${symbolSvg('star')}
        <div>
          <p><b>Hvězda</b> – platí kdekoli. 3+ hvězdy = ${E.FREE_SPINS} free spinů, výhry v nich ×${E.FREE_SPIN_MULTIPLIER}.</p>
          <div class="pt-pays">${pays('star', bet)}</div>
        </div>
      </div>`;
    $('#pt-grid').innerHTML = ['seven', 'bell', 'melon', 'grapes', 'orange', 'lemon', 'cherry'].map((s) => `
      <div class="pt-card">${symbolSvg(s)}
        <div><div class="pt-name">${E.SYMBOLS[s].name}</div><div class="pt-pays">${pays(s, lineBet)}</div></div>
      </div>`).join('');
    $('#pt-lines').innerHTML = E.LINES.map((rows, i) => `
      <div class="pt-line" style="--c:${LINE_COLORS[i]}">
        <span>Linie ${i + 1}</span>
        <div class="mini">${[0, 1, 2].map((row) => rows.map((r) => `<i${r === row ? ' class="on"' : ''}></i>`).join('')).join('')}</div>
      </div>`).join('');
  }

  /* ---------- Kredit ---------- */

  function openBroke() {
    if (!document.querySelector('dialog[open]')) el.dlgBroke.showModal();
  }

  function refill() {
    setBalance(state.balance + REFILL, 600);
    setTicker('Kredit doplněn', REFILL);
    sound.gambleWin();
    if (el.dlgBroke.open) el.dlgBroke.close();
  }

  /* ---------- Události ---------- */

  function wire() {
    el.spin.addEventListener('click', onSpinButton);
    el.betDown.addEventListener('click', () => changeBet(-1));
    el.betUp.addEventListener('click', () => changeBet(1));
    el.risk.addEventListener('click', openGamble);

    el.auto.addEventListener('click', () => {
      if (state.auto > 0) {
        stopAuto();
        setTicker('Autospin zastaven');
        return;
      }
      sound.click();
      toggleAutoMenu();
    });
    el.autoMenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-auto]');
      if (!b) return;
      closeAutoMenu();
      startAuto(Number(b.dataset.auto));
    });
    document.addEventListener('click', (e) => {
      if (!el.autoMenu.hidden && !e.target.closest('.auto-wrap')) closeAutoMenu();
    });

    el.turbo.addEventListener('click', () => {
      state.turbo = !state.turbo;
      store.set('turbo', state.turbo);
      sound.click();
      syncUI();
    });
    el.sound.addEventListener('click', () => {
      state.sound = !state.sound;
      store.set('sound', state.sound);
      sound.click();
      syncUI();
    });
    el.info.addEventListener('click', () => {
      renderPaytable();
      el.dlgPaytable.showModal();
    });
    el.refill.addEventListener('click', refill);
    $('#btn-refill-go').addEventListener('click', refill);

    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => btn.closest('dialog').close());
    }
    el.dlgPaytable.addEventListener('click', (e) => {
      if (e.target === el.dlgPaytable) el.dlgPaytable.close();
    });

    $('#g-red').addEventListener('click', () => guess(true));
    $('#g-black').addEventListener('click', () => guess(false));
    $('#g-collect').addEventListener('click', () => closeGamble('Vybráno', gamble.stake));
    el.dlgGamble.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (!gamble.busy) closeGamble('Vybráno', gamble.stake);
    });

    for (const m of document.querySelectorAll('.marker')) {
      const line = Number(m.dataset.line);
      m.addEventListener('mouseenter', () => previewLine(line));
      m.addEventListener('mouseleave', () => previewLine(null));
      m.addEventListener('click', () => {
        previewLine(line);
        clearTimeout(m._t);
        m._t = setTimeout(() => previewLine(null), 1500);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAutoMenu();
      if (e.code !== 'Space' || e.repeat) return;
      if (!el.celebrate.hidden || document.querySelector('dialog[open]')) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      e.preventDefault();
      // Jinak by mezerník na zaměřeném tlačítku spustil ještě jeho klik
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      onSpinButton();
    });

    new ResizeObserver(() => {
      if (drawn.length) drawLines(drawn, false);
    }).observe(el.reels);
  }

  function init() {
    buildReels();
    buildMarkers();
    wire();
    showNumber(el.balance, state.balance);
    setWin(state.fs.active ? state.fs.won : 0);
    syncUI();

    if (state.fs.active) {
      setTicker('Pokračují rozehrané free spiny');
      continueFlow();
    } else if (state.balance < BETS[0]) {
      openBroke();
    }
  }

  init();
})();

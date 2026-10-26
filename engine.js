/*
 * Herní logika automatu – válce, výherní linie a výplaty.
 * Nezávislé na DOM, takže jde spustit i v Node (simulace RTP).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SlotEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const REELS = 5;
  const ROWS = 3;

  // Výplaty jsou v násobcích sázky na linii, u hvězdy v násobcích celkové sázky.
  const SYMBOLS = {
    seven:  { name: 'Sedmička', pays: { 3: 60, 4: 300, 5: 1500 } },
    bell:   { name: 'Zvonek',   pays: { 3: 30, 4: 100, 5: 400 } },
    melon:  { name: 'Meloun',   pays: { 3: 15, 4: 60, 5: 200 } },
    grapes: { name: 'Hrozny',   pays: { 3: 10, 4: 40, 5: 150 } },
    orange: { name: 'Pomeranč', pays: { 3: 5, 4: 25, 5: 80 } },
    lemon:  { name: 'Citron',   pays: { 3: 5, 4: 20, 5: 60 } },
    cherry: { name: 'Třešně',   pays: { 3: 5, 4: 20, 5: 60 } },
    wild:   { name: 'Wild',     pays: {}, wild: true },
    star:   { name: 'Hvězda',   pays: { 3: 2, 4: 10, 5: 50 }, scatter: true },
  };

  // Řádek (0 = horní) na každém z pěti válců.
  const LINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [1, 0, 1, 2, 1],
  ];

  const FREE_SPINS = 10;
  const FREE_SPIN_MULTIPLIER = 2;

  // Počty symbolů na každém válci. Wild je jen na válcích 2–5.
  // S touto sadou vychází simulované RTP zhruba na 97 %.
  const REEL_COUNTS = [
    { cherry: 5, lemon: 5, orange: 5, grapes: 4, melon: 4, bell: 3, seven: 2, star: 1 },
    { cherry: 5, lemon: 5, orange: 5, grapes: 4, melon: 4, bell: 3, seven: 2, wild: 2, star: 1 },
    { cherry: 5, lemon: 5, orange: 5, grapes: 4, melon: 4, bell: 3, seven: 2, wild: 2, star: 1 },
    { cherry: 5, lemon: 5, orange: 5, grapes: 4, melon: 4, bell: 3, seven: 2, wild: 2, star: 1 },
    { cherry: 5, lemon: 5, orange: 5, grapes: 4, melon: 4, bell: 3, seven: 2, wild: 2, star: 1 },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stejný symbol nesmí být hned pod sebou a speciální symboly musí mít
  // odstup aspoň 3 políčka, aby na válci nebyly vidět dva najednou.
  function isValidStrip(strip) {
    const len = strip.length;
    for (let i = 0; i < len; i++) {
      const s = strip[i];
      if (s === strip[(i + 1) % len]) return false;
      if ((s === 'star' || s === 'wild') && s === strip[(i + 2) % len]) return false;
    }
    return true;
  }

  function buildStrip(counts, rnd) {
    const pool = [];
    for (const [sym, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) pool.push(sym);
    }
    for (let attempt = 0; attempt < 100000; attempt++) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (isValidStrip(pool)) return pool.slice();
    }
    throw new Error('Válec nejde sestavit');
  }

  const STRIPS = REEL_COUNTS.map((counts, i) => buildStrip(counts, mulberry32(7771 + i * 101)));

  function randomInt(n) {
    const c = globalThis.crypto;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n;
      do c.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // grid[válec][řádek]
  function spin(strips = STRIPS, rng = randomInt) {
    const stops = [];
    const grid = [];
    for (let r = 0; r < REELS; r++) {
      const strip = strips[r];
      const stop = rng(strip.length);
      stops.push(stop);
      const col = [];
      for (let row = 0; row < ROWS; row++) col.push(strip[(stop + row) % strip.length]);
      grid.push(col);
    }
    return { stops, grid };
  }

  function evaluateLine(syms) {
    let best = null;

    let wildRun = 0;
    while (wildRun < REELS && syms[wildRun] === 'wild') wildRun++;
    const wildPay = SYMBOLS.wild.pays[wildRun] || 0;
    if (wildPay) best = { symbol: 'wild', count: wildRun, mult: wildPay };

    const base = syms.find((s) => s !== 'wild');
    if (base && !SYMBOLS[base].scatter) {
      let count = 0;
      while (count < REELS && (syms[count] === base || syms[count] === 'wild')) count++;
      const mult = SYMBOLS[base].pays[count] || 0;
      if (mult && (!best || mult > best.mult)) best = { symbol: base, count, mult };
    }
    return best;
  }

  function evaluate(grid, lineBet, multiplier = 1) {
    const totalBet = lineBet * LINES.length;
    const lines = [];

    LINES.forEach((rows, index) => {
      const hit = evaluateLine(rows.map((row, reel) => grid[reel][row]));
      if (!hit) return;
      lines.push({
        index,
        symbol: hit.symbol,
        count: hit.count,
        positions: rows.slice(0, hit.count).map((row, reel) => [reel, row]),
        win: hit.mult * lineBet * multiplier,
      });
    });

    const positions = [];
    grid.forEach((col, reel) => col.forEach((s, row) => {
      if (s === 'star') positions.push([reel, row]);
    }));
    const count = positions.length;
    const scatter = {
      count,
      positions,
      win: (SYMBOLS.star.pays[Math.min(count, REELS)] || 0) * totalBet * multiplier,
      freeSpins: count >= 3 ? FREE_SPINS : 0,
    };

    const total = lines.reduce((sum, l) => sum + l.win, 0) + scatter.win;
    return { lines, scatter, total };
  }

  return {
    REELS,
    ROWS,
    SYMBOLS,
    LINES,
    FREE_SPINS,
    FREE_SPIN_MULTIPLIER,
    REEL_COUNTS,
    strips: STRIPS,
    buildStrip,
    mulberry32,
    spin,
    evaluate,
    randomInt,
  };
});

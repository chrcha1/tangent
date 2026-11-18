// Shaded ASCII for the page: the branches between words, drawn as soft vines
// on a grid of small characters. A vine glows from a dense heart to a faint
// edge ( @ % # * + = - : . ), thick where it leaves a word and fading to a
// point at the next one. Along the way it throws off curled tendrils, and it
// carries small blooms ( . ' * o @ ), most of them around the tips of the
// tree. How strongly a cell is inked decides which of three grey layers it
// lands on. Pure: geometry and a clock in, text out.

import { hash } from './hash.js';

export const RAMP = ' .:-=+*#%@'; // a vine's faint edge to its dense heart
export const BLOOM = ".'*o@"; // a bloom's loose petals to its centre
export const GLYPHS = RAMP.trim() + BLOOM;

const BANDS = [0.09, 0.36, 0.66]; // where faint, mid and strong greys begin
const NOTHING = 0;
const VINE = 1;
const PETAL = 2;

const STEM = 0.8; // em, half-width of a vine leaving a root word
const THINNING = 0.82; // each fork down, vines keep this much of their girth
const FINEST = 0.3; // em, the slimmest a vine starts out
const TIP = 0.12; // em, where a vine reaches its word
const DRIFT = 0.16; // em, how far a vine sways
const BEND = 0.45; // em, how far a vine may bow at rest
const TWINKLE_MS = 800; // how often a petal may change its glyph

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const unit = (seed, salt) => (hash(seed + salt * 7919) % 10000) / 10000; // 0..1, stable
const girth = (depth) => Math.max(FINEST, STEM * THINNING ** depth);

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function heading(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const x = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const y = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

// The four control points of a vine at a moment in time. It sets off downward
// with a lean towards its word, then settles onto the word from above, like
// something hanging. Each is bowed a little by its seed and sways slowly.
function controls(branch, em, time) {
  const { from, to, id } = branch;
  const drop = to.y - from.y;
  const across = to.x - from.x;
  const phase = unit(id, 1) * Math.PI * 2;
  const bowA = (unit(id, 2) - 0.5) * 2 * BEND * em;
  const bowB = (unit(id, 3) - 0.5) * 2 * BEND * em;
  const swayA = Math.sin(time * 0.0011 + phase) * DRIFT * em;
  const swayB = Math.sin(time * 0.0008 + phase * 1.7 + 1.3) * DRIFT * em;
  return [
    from,
    { x: from.x + across * 0.3 + bowA + swayA, y: from.y + drop * 0.35 },
    { x: to.x + bowB + swayB, y: to.y - drop * 0.5 },
    to,
  ];
}

function createCanvas(cols, rows, cellW, cellH, time) {
  const size = cols * rows;
  const values = new Float32Array(size);
  const kinds = new Uint8Array(size);
  const petals = new Array(size);

  const eachCell = (x, y, reach, visit) => {
    const colFrom = Math.max(0, Math.floor((x - reach) / cellW));
    const colTo = Math.min(cols - 1, Math.floor((x + reach) / cellW));
    const rowFrom = Math.max(0, Math.floor((y - reach) / cellH));
    const rowTo = Math.min(rows - 1, Math.floor((y + reach) / cellH));
    for (let row = rowFrom; row <= rowTo; row++) {
      const dy = (row + 0.5) * cellH - y;
      for (let col = colFrom; col <= colTo; col++) {
        const dx = (col + 0.5) * cellW - x;
        const far = (dx * dx + dy * dy) / (reach * reach);
        if (far < 1) visit(row * cols + col, far, col, row);
      }
    }
  };

  // Vine: brightest along its heart, fading to nothing at the edge. A stroke
  // thinner than a cell still marks the cell it passes through, only fainter.
  function glow(x, y, radius, strength) {
    const reach = Math.max(radius, cellH * 0.5);
    const peak = strength * Math.min(1, radius / (cellH * 0.5));
    eachCell(x, y, reach, (index, far) => {
      const value = peak * (1 - far);
      if (kinds[index] === PETAL || value <= values[index]) return;
      values[index] = value;
      kinds[index] = VINE;
    });
  }

  // Bloom: a small ragged clump, its glyphs denser towards the centre. Each
  // petal keeps its own time for trading its glyph with a neighbour's.
  function bloom(x, y, radius, strength) {
    if (radius <= 0) return;
    const top = BLOOM.length - 1;
    eachCell(x, y, Math.max(radius, cellH * 0.6), (index, far, col, row) => {
      const grain = hash(col * 73856093 + row * 19349663);
      const fullness = (1 - far) * (0.55 + 0.8 * ((grain % 1000) / 1000));
      const value = strength * Math.min(1, fullness);
      if (fullness < 0.2 || value <= values[index] * 0.7) return;
      const beat = Math.floor((time + (grain % TWINKLE_MS)) / TWINKLE_MS);
      const twinkle = (hash(grain + beat) % 3) - 1;
      values[index] = value;
      kinds[index] = PETAL;
      petals[index] = BLOOM[clamp(Math.floor(fullness * top) + twinkle, 0, top)];
    });
  }

  return { values, kinds, petals, glow, bloom };
}

function drawBranch(canvas, branch, em, cellW, cellH, time) {
  const { id, strength, grown, depth = 1 } = branch;
  if (grown <= 0) return;
  const points = controls(branch, em, time);
  const beat = unit(id, 4) * Math.PI * 2;
  // Slow swells travel from parent to child, like something passing along.
  const radiusAt = (t) =>
    lerp(girth(depth - 1), TIP, t ** 0.75) * em * (1 + 0.13 * Math.sin(t * 10 - time * 0.003 + beat));
  const span = Math.hypot(branch.to.x - branch.from.x, branch.to.y - branch.from.y);
  const steps = Math.max(8, Math.ceil(span / (cellW * 0.5)));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (t > grown) break;
    const point = cubic(...points, t);
    canvas.glow(point.x, point.y, radiusAt(t), strength);
  }

  // Where something leaves the vine: a point on it and the way out from it.
  const anchor = (at, side) => {
    const base = cubic(...points, at);
    const along = heading(...points, at);
    return { base, along, outward: { x: -along.y * side, y: along.x * side } };
  };
  const unfurled = (at) => clamp((grown - at) * 4, 0, 1); // only once the vine has passed

  // Curled tendrils: fine loops that wind and unwind a little as they sway.
  // Skipped when the grid is too coarse to draw a loop rather than a smudge.
  const curls = 1 + (hash(id) % 2);
  for (let k = 0; k < curls; k++) {
    const at = 0.22 + 0.5 * unit(id, 10 + k);
    const open = unfurled(at);
    if (open <= 0) continue;
    const side = unit(id, 20 + k) < 0.5 ? -1 : 1;
    const { base, outward } = anchor(at, side);
    const size = (0.6 + 0.35 * unit(id, 30 + k)) * em;
    if (size < cellH * 1.6) continue;
    const centre = {
      x: base.x + outward.x * (radiusAt(at) + size * 1.05),
      y: base.y + outward.y * (radiusAt(at) + size * 1.05),
    };
    const turns = 1.05 + 0.2 * unit(id, 40 + k) + 0.1 * Math.sin(time * 0.0015 + unit(id, 50 + k) * 6.28);
    const start = Math.atan2(-outward.y, -outward.x); // begins touching the vine
    const pieces = Math.ceil((size * turns * 5) / cellW) + 6;
    for (let j = 0; j <= pieces * open; j++) {
      const s = j / pieces;
      const angle = start + side * s * turns * Math.PI * 2;
      const radius = size * (1 - 0.5 * s);
      canvas.glow(
        centre.x + Math.cos(angle) * radius,
        centre.y + Math.sin(angle) * radius,
        lerp(0.11, 0.07, s) * em,
        strength * 0.9,
      );
    }
  }

  // Blooms on short stalks: one or two along the way, and a pair beside the
  // tip of a vine that ends the tree (nothing grows beyond its word yet).
  const blooms = [];
  const along = hash(id + 17) % 3; // 0, 1 or 2
  for (let k = 0; k < along; k++) {
    blooms.push({
      at: 0.35 + 0.45 * unit(id, 60 + k),
      side: unit(id, 70 + k) < 0.5 ? -1 : 1,
      size: 0.3 + 0.14 * unit(id, 80 + k),
      out: 0.45 + 0.4 * unit(id, 90 + k),
      salt: k,
    });
  }
  if (branch.tip) {
    blooms.push({ at: 0.82, side: -1, size: 0.42, out: 0.6, salt: 8 });
    blooms.push({ at: 0.9, side: 1, size: 0.36, out: 0.75, salt: 9 });
  }
  for (const flower of blooms) {
    const open = unfurled(flower.at);
    if (open <= 0) continue;
    const { base, along: grain, outward } = anchor(flower.at, flower.side);
    const nod = Math.sin(time * 0.0013 + unit(id, 100 + flower.salt) * 6.28) * 0.07 * em;
    const distance = radiusAt(flower.at) + flower.out * em;
    const centre = {
      x: base.x + outward.x * distance + grain.x * 0.12 * em + nod,
      y: base.y + outward.y * distance + grain.y * 0.12 * em,
    };
    const stalk = { x: centre.x - base.x, y: centre.y - base.y };
    const pieces = Math.max(3, Math.ceil(Math.hypot(stalk.x, stalk.y) / (cellW * 0.6)));
    for (let j = 1; j < pieces; j++) {
      canvas.glow(base.x + (stalk.x * j) / pieces, base.y + (stalk.y * j) / pieces, 0.045 * em, strength * 0.8);
    }
    canvas.bloom(centre.x, centre.y, flower.size * em * open, strength);
  }
}

// Renders all branches onto a `cols` x `rows` grid of `cellW` x `cellH` pixel
// cells. Each branch, in pixels: { id, from: {x, y}, to: {x, y}, strength:
// 0..1, grown: 0..1, depth: how many forks down its word is (1 = hangs from a
// root), tip: whether its word has no branches of its own }. Returns three
// strings (faint, mid, strong), each the full grid with spaces wherever that
// layer has nothing to show.
export function renderField({ cols, rows, cellW, cellH, em, branches, time = 0 }) {
  const canvas = createCanvas(cols, rows, cellW, cellH, time);
  for (const branch of branches) drawBranch(canvas, branch, em, cellW, cellH, time);

  const layers = BANDS.map(() => []);
  const top = RAMP.length - 1;
  for (let row = 0; row < rows; row++) {
    const lines = BANDS.map(() => '');
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const value = canvas.values[index];
      const kind = canvas.kinds[index];
      let band = -1;
      if (kind !== NOTHING) {
        if (value >= BANDS[2]) band = 2;
        else if (value >= BANDS[1]) band = 1;
        else if (value >= BANDS[0]) band = 0;
      }
      let glyph = ' ';
      if (band >= 0) {
        glyph = kind === PETAL ? canvas.petals[index] : RAMP[Math.min(top, 1 + Math.floor(value * top))];
      }
      for (let b = 0; b < lines.length; b++) lines[b] += b === band ? glyph : ' ';
    }
    for (let b = 0; b < lines.length; b++) layers[b].push(lines[b]);
  }
  return layers.map((lines) => lines.join('\n'));
}

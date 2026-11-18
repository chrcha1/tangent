import {
  createForest,
  addRoot,
  addChild,
  replaceEntry,
  countNodes,
  usedWords,
  isValidForest,
} from './tree.js';
import { place, outline, ROW_EM } from './layout.js';
import { renderField } from './field.js';
import { randomColor, toCss, inkFor } from './color.js';
import { getJson, ServiceError } from './services/http.js';
import { createDatamuse } from './services/datamuse.js';
import { createWikipedia } from './services/wikipedia.js';
import { createWordSource, NoRelativesError, SOURCES } from './wordSource.js';
import { reportError, installGlobalHandlers } from './report.js';

const STORAGE_KEY = 'tangent:v1';
const HISTORY_LIMIT = 100;
const MIN_SIZE = 13;
const MAX_SIZE = 160;
const STAGE_PADDING = 24; // keep in step with #stage in styles.css
const MARGIN_EM = 1.5; // room around a grown tree for its tendrils to sway
const LEAVE_EM = 0.3; // gap between a word and the tendril hanging from it
const ARRIVE_EM = 0.3; // gap between a tendril's tip and the word below
const ART_SCALE = 0.34; // size of the art's characters relative to the words
const ART_MIN = 6;
const ART_MAX = 12;
const MAX_CELLS = 60000; // beyond this the art's characters are made larger
const GROW_MS = 560; // time for a new tendril to reach its word
const FRAME_MS = 70; // the art redraws about fourteen times a second
const GHOST_DELAY_MS = 150;
const GHOST_WORD = '...';
const SCRAMBLE_GLYPHS = ".:-=+*#%@'o"; // a new word settles out of vine and bloom
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'),
  world: $('world'),
  tree: $('tree'),
  fields: [...document.querySelectorAll('.field')],
  caption: $('caption'),
  random: $('random'),
  grow: $('grow'),
  plant: $('plant'),
  define: $('define'),
  swap: $('swap'),
  undo: $('undo'),
  copy: $('copy'),
  clear: $('clear'),
  sources: [...document.querySelectorAll('[data-source]')],
};

const words = createWordSource({
  datamuse: createDatamuse({ getJson }),
  wikipedia: createWikipedia({ getJson }),
});

const state = {
  forest: createForest(),
  source: 'all',
  history: [],
  busy: false,
  ghost: null, // { child: parentId } | { replace: nodeId } while a word is on its way
  freshId: null,
  lastHue: null,
};

let charRatio = 0.6;
let captionTimer = null;
let lastG = -Infinity; // when `g` was last pressed, to recognise `gg`
let field = null; // what the art loop is drawing: grid size, cell size, branches
let fieldLoop = 0;
let lastFrame = 0;
const births = new Map(); // word id -> when its tendril started growing
const cellSizes = new Map(); // art font size -> measured character cell

// ---------- persistence ----------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ forest: state.forest, source: state.source }));
  } catch {
    // Storage is full or blocked; the tree still works for this visit.
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved) return;
    if (SOURCES.includes(saved.source)) state.source = saved.source;
    // A lone word is not worth restoring: every visit opens on a fresh one.
    if (isValidForest(saved.forest) && countNodes(saved.forest) > 1) state.forest = saved.forest;
  } catch (err) {
    reportError(err, { where: 'load' });
  }
}

// ---------- state changes ----------

const activeNode = () => state.forest.nodes[state.forest.active] ?? null;

function colored(entry) {
  const color = randomColor(Math.random, state.lastHue);
  state.lastHue = color.h;
  return { ...entry, color };
}

function commit(change) {
  state.history.push(JSON.stringify(state.forest));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  const replacement = change(state.forest);
  if (replacement) state.forest = replacement;
  state.freshId = state.forest.active;
  save();
  paint();
}

function select(id) {
  if (state.busy || !state.forest.nodes[id] || id === state.forest.active) return;
  state.forest.active = id;
  say('');
  save();
  paint();
}

function undo() {
  if (state.busy || !state.history.length) return;
  state.forest = JSON.parse(state.history.pop());
  say('');
  save();
  paint();
}

// ---------- messages ----------

function say(text, { hold = false } = {}) {
  clearTimeout(captionTimer);
  els.caption.textContent = text;
  if (text && !hold) captionTimer = setTimeout(() => (els.caption.textContent = ''), 5000);
}

function explain(err) {
  if (err instanceof NoRelativesError) {
    return `nothing branches from “${err.word}” — press space for a new word`;
  }
  if (err instanceof ServiceError) {
    if (err.kind === 'network') return 'can’t reach the word service — check your connection';
    if (err.kind === 'timeout') return 'the word service is slow to answer — try again';
    return 'the word service gave an odd answer — try again';
  }
  return 'something went wrong — try again';
}

// Runs one networked step. Resolves to its value, or undefined after telling
// the user why it failed. Only one step runs at a time.
async function attempt(ghost, task) {
  if (state.busy) return undefined;
  state.busy = true;
  say('');
  paint();
  const showGhost = setTimeout(() => {
    state.ghost = ghost;
    paint();
  }, GHOST_DELAY_MS);
  try {
    return await task();
  } catch (err) {
    say(explain(err));
    if (!(err instanceof NoRelativesError)) reportError(err, { where: 'attempt' });
    return undefined;
  } finally {
    clearTimeout(showGhost);
    state.busy = false;
    state.ghost = null;
  }
}

// ---------- actions ----------

// Space: a completely new random word. A word standing on its own is swapped
// in place, so tapping space keeps changing it; once a word has grown
// branches (or is one), the new word starts a tree of its own instead.
async function actRandom() {
  const node = activeNode();
  const alone = node && node.parent == null && !node.children.length;
  const entry = await attempt(alone ? { replace: node.id } : null, () =>
    words.random(state.source, usedWords(state.forest)),
  );
  if (!entry) return paint();
  commit((forest) =>
    alone ? replaceEntry(forest, node.id, colored(entry)) : void addRoot(forest, colored(entry)),
  );
}

// Enter: branch a related word off the selected one.
async function actGrow() {
  const node = activeNode();
  if (!node) return;
  const entry = await attempt({ child: node.id }, () =>
    words.related(node, usedWords(state.forest)),
  );
  if (!entry) return paint();
  commit((forest) => void addChild(forest, node.id, colored(entry)));
}

// N: always start a separate tree, keeping the current word as it is.
async function actPlant() {
  const entry = await attempt(null, () => words.random(state.source, usedWords(state.forest)));
  if (!entry) return paint();
  commit((forest) => void addRoot(forest, colored(entry)));
}

// R: trade the word at the tip of a branch for a different relative of its
// parent, so the limb between them stays honest.
function canSwap(node) {
  return Boolean(node) && node.parent != null && !node.children.length;
}

async function actSwap() {
  const node = activeNode();
  if (!canSwap(node)) return;
  const parent = state.forest.nodes[node.parent];
  const entry = await attempt({ replace: node.id }, () =>
    words.related(parent, usedWords(state.forest)),
  );
  if (!entry) return paint();
  commit((forest) => replaceEntry(forest, node.id, colored(entry)));
}

async function actDefine() {
  const node = activeNode();
  if (!node) return;
  const text = await attempt(null, () => words.gloss(node));
  paint();
  if (text === undefined) return;
  if (!text) return say(`no definition found for “${node.word}”`);
  const clipped = text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
  say(`${node.word} — ${clipped}`, { hold: true });
}

async function actCopy() {
  try {
    await navigator.clipboard.writeText(outline(state.forest));
    say('copied');
  } catch (err) {
    say('couldn’t copy — your browser blocked clipboard access');
    reportError(err, { where: 'copy' });
  }
}

async function actClear() {
  const entry = await attempt(null, () => words.random(state.source));
  if (!entry) return paint();
  commit(() => {
    const fresh = createForest();
    addRoot(fresh, colored(entry));
    return fresh;
  });
}

function setSource(source) {
  if (state.busy || source === state.source) return;
  state.source = source;
  save();
  paint();
}

// To the top of the selected word's tree, or down its first branches to the end.
function jump(node, direction) {
  let target = node;
  if (direction === 'top') {
    while (target.parent != null) target = state.forest.nodes[target.parent];
  } else {
    while (target.children.length) target = state.forest.nodes[target.children[0]];
  }
  return target !== node && select(target.id);
}

// Arrow keys follow the picture: up to the parent, down to a child, and
// sideways to whichever word sits nearest on that side.
function move(direction) {
  const node = activeNode();
  if (!node) return false;
  if (direction === 'top' || direction === 'bottom') return jump(node, direction);
  if (direction === 'up') return node.parent != null && select(node.parent);
  if (direction === 'down') {
    return node.children.length > 0 && select(node.children[Math.floor((node.children.length - 1) / 2)]);
  }
  const { spots } = place(state.forest, charRatio);
  const here = spots.get(node.id);
  const sign = direction === 'left' ? -1 : 1;
  let best = null;
  for (const [id, spot] of spots) {
    const across = (spot.centre - here.centre) * sign;
    if (id === node.id || across <= 0) continue;
    const score = across + Math.abs(spot.y - here.y) * 4;
    if (!best || score < best.score) best = { id, score };
  }
  return best ? select(best.id) : false;
}

// ---------- drawing ----------

function viewForest() {
  const { ghost, forest } = state;
  if (!ghost) return { forest, ghostId: null };
  const copy = structuredClone(forest);
  if (ghost.replace != null) {
    copy.nodes[ghost.replace].word = GHOST_WORD;
    return { forest: copy, ghostId: ghost.replace };
  }
  const active = copy.active;
  const ghostId = addChild(copy, ghost.child, { word: GHOST_WORD, kind: 'word' });
  copy.active = active;
  return { forest: copy, ghostId };
}

// Everything the page needs to draw a forest, in ems: where each word goes
// and which tendrils join them.
function buildScene(forest, ghostId) {
  const placed = place(forest, charRatio);
  const margin = countNodes(forest) > 1 ? MARGIN_EM : 0;
  const lineage = new Set(); // the selected word and its ancestors
  for (let id = forest.active; id != null; id = forest.nodes[id]?.parent) lineage.add(id);

  const depthOf = (id) => {
    let depth = 0;
    for (let up = forest.nodes[id].parent; up != null; up = forest.nodes[up].parent) depth += 1;
    return depth;
  };

  const links = [];
  for (const node of Object.values(forest.nodes)) {
    if (node.parent == null) continue;
    const above = placed.spots.get(node.parent);
    const below = placed.spots.get(node.id);
    links.push({
      id: node.id,
      depth: depthOf(node.id),
      tip: node.children.length === 0,
      from: { x: margin + above.centre, y: margin + above.y + ROW_EM + LEAVE_EM },
      to: { x: margin + below.centre, y: margin + below.y - ARRIVE_EM },
      strength: node.id === ghostId ? 0.4 : lineage.has(node.id) ? 1 : 0.72,
    });
  }
  return {
    spots: placed.spots,
    margin,
    lineage,
    links,
    width: placed.width + margin * 2,
    height: placed.height + margin * 2,
  };
}

function wordElement(node, spot, scene, ghostId) {
  const isGhost = node.id === ghostId;
  const element = document.createElement(isGhost ? 'span' : 'button');
  element.textContent = node.word;
  element.style.left = `${(scene.margin + spot.x).toFixed(3)}em`;
  element.style.top = `${(scene.margin + spot.y).toFixed(3)}em`;
  if (isGhost) {
    element.className = 'ghost';
    return element;
  }
  const selected = node.id === state.forest.active;
  element.type = 'button';
  element.className = scene.lineage.has(node.id) && !selected ? 'word kin' : 'word';
  element.dataset.id = node.id;
  element.setAttribute('aria-label', node.word);
  if (selected) element.setAttribute('aria-current', 'true');
  return element;
}

// A new word arrives as a flicker of branch glyphs that settles left to right.
function scrambleIn(element, word, delayMs) {
  if (reducedMotion.matches) return;
  const letters = [...word];
  const duration = Math.min(420, 140 + letters.length * 26);
  const startAt = performance.now() + delayMs;
  const noise = () => SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
  let lastTick = 0;
  if (delayMs > 0) element.textContent = ' '.repeat(letters.length);

  const frame = (now) => {
    if (!element.isConnected) return; // repainted since; nothing to finish
    const progress = (now - startAt) / duration;
    if (progress >= 1) {
      element.textContent = word;
      return;
    }
    if (progress >= 0 && now - lastTick > 36) {
      lastTick = now;
      const settled = Math.floor(progress * letters.length);
      element.textContent = letters
        .map((ch, i) => (i < settled || ch === ' ' ? ch : noise()))
        .join('');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// The largest word size at which the whole scene fits the stage.
function fit(scene) {
  const availableWidth = els.stage.clientWidth - STAGE_PADDING * 2;
  const availableHeight = els.stage.clientHeight - STAGE_PADDING * 2;
  const ceiling = Math.min(MAX_SIZE, window.innerWidth * 0.16);
  return Math.max(
    MIN_SIZE,
    Math.min(ceiling, availableWidth / scene.width, availableHeight / scene.height),
  );
}

// The real size of one art character at a given font size. Measured rather
// than assumed, because browsers may enforce a minimum font size.
function cellSize(fontSize) {
  if (!cellSizes.has(fontSize)) {
    const probe = document.createElement('span');
    probe.className = 'probe';
    probe.style.fontSize = `${fontSize}px`;
    probe.textContent = '0'.repeat(40);
    document.body.append(probe);
    const cellWidth = probe.getBoundingClientRect().width / 40;
    probe.remove();
    cellSizes.set(fontSize, { width: cellWidth, height: Math.round((cellWidth / charRatio) * 1.15) });
  }
  return cellSizes.get(fontSize);
}

// Sizes the character grid behind the words and converts the scene's
// tendrils to pixels for it.
function setUpField(scene, size) {
  if (!scene.links.length) {
    field = null;
    return;
  }
  const widthPx = scene.width * size;
  const heightPx = scene.height * size;
  let artSize = Math.round(Math.min(ART_MAX, Math.max(ART_MIN, size * ART_SCALE)));
  let cell = cellSize(artSize);
  while ((widthPx / cell.width) * (heightPx / cell.height) > MAX_CELLS && artSize < 16) {
    artSize += 1;
    cell = cellSize(artSize);
  }
  for (const layer of els.fields) {
    layer.style.fontSize = `${artSize}px`;
    layer.style.lineHeight = `${cell.height}px`;
  }
  const px = (point) => ({ x: point.x * size, y: point.y * size });
  field = {
    cols: Math.ceil(widthPx / cell.width),
    rows: Math.ceil(heightPx / cell.height),
    cellW: cell.width,
    cellH: cell.height,
    em: size,
    branches: scene.links.map((link) => ({ ...link, from: px(link.from), to: px(link.to) })),
  };
}

// Draws one frame of the art: tendrils at their current growth and sway.
function drawField(now) {
  if (!field) {
    for (const layer of els.fields) layer.textContent = '';
    return;
  }
  const still = reducedMotion.matches;
  const branches = field.branches.map((branch) => {
    const age = (now - (births.get(branch.id) ?? -Infinity)) / GROW_MS;
    const grown = still || age >= 1 ? 1 : 1 - (1 - Math.max(0, age)) ** 3; // ease out
    return { ...branch, grown };
  });
  const layers = renderField({ ...field, branches, time: still ? 0 : now });
  layers.forEach((text, i) => {
    if (els.fields[i].textContent !== text) els.fields[i].textContent = text;
  });
}

function runField() {
  cancelAnimationFrame(fieldLoop);
  drawField(performance.now()); // right away, so the art never lags a repaint
  if (!field || reducedMotion.matches) return;
  const tick = (now) => {
    fieldLoop = requestAnimationFrame(tick);
    if (now - lastFrame < FRAME_MS) return;
    lastFrame = now;
    drawField(now);
  };
  fieldLoop = requestAnimationFrame(tick);
}

function paint() {
  const hadFocus = els.tree.contains(document.activeElement);
  const { forest, ghostId } = viewForest();
  const scene = buildScene(forest, ghostId);
  const fresh = state.freshId;
  state.freshId = null;
  const now = performance.now();

  // A tendril starts growing when its word (or the placeholder for it) first
  // appears, and keeps its age while the placeholder becomes the real word.
  for (const id of [...births.keys()]) if (!forest.nodes[id]) births.delete(id);
  for (const id of [fresh, ghostId]) {
    if (id != null && forest.nodes[id]?.parent != null && !births.has(id)) births.set(id, now);
  }

  const size = fit(scene);
  document.documentElement.style.setProperty('--size', `${size.toFixed(2)}px`);
  els.world.style.width = `${scene.width.toFixed(3)}em`;
  els.world.style.height = `${scene.height.toFixed(3)}em`;

  els.tree.replaceChildren(
    ...Object.values(forest.nodes).map((node) =>
      wordElement(node, scene.spots.get(node.id), scene, ghostId),
    ),
  );
  els.tree.classList.toggle('solo', countNodes(forest) === 1);

  const node = activeNode();
  if (node) {
    const root = document.documentElement.style;
    root.setProperty('--bg', toCss(node.color));
    root.setProperty('--ink', inkFor(node.color));
    state.lastHue = node.color.h;
  }

  if (fresh != null && state.forest.nodes[fresh]) {
    const arrival = els.tree.querySelector(`.word[data-id="${fresh}"]`);
    const born = births.get(fresh);
    const wait = born == null ? 0 : Math.max(0, GROW_MS * 0.7 - (now - born));
    if (arrival) scrambleIn(arrival, state.forest.nodes[fresh].word, wait);
  }

  const grown = countNodes(state.forest) > 1;
  for (const button of [els.random, els.grow, els.plant, els.define, els.swap]) {
    button.disabled = state.busy;
  }
  els.swap.hidden = !canSwap(node);
  els.undo.hidden = !state.history.length;
  els.copy.hidden = !grown;
  els.clear.hidden = !grown;
  for (const button of els.sources) {
    button.setAttribute('aria-pressed', String(button.dataset.source === state.source));
  }

  setUpField(scene, size);
  runField();

  const current = els.tree.querySelector('[aria-current="true"]');
  if (hadFocus) current?.focus();
  (els.tree.querySelector('.ghost') ?? current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function measureCharacter() {
  const probe = document.createElement('span');
  probe.className = 'probe';
  probe.textContent = '0'.repeat(20);
  document.body.append(probe);
  const ratio = probe.getBoundingClientRect().width / 20 / 100;
  probe.remove();
  if (ratio > 0.3 && ratio < 1) charRatio = ratio;
}

// ---------- wiring ----------

function onClick(element, handler) {
  element.addEventListener('click', (event) => {
    // After a mouse or touch press, hand the keyboard back to the page so
    // space and enter keep meaning "random" and "branch".
    if (event.detail > 0) element.blur();
    handler(event);
  });
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
    return;
  }
  if (event.altKey) return;
  // Space and enter belong to whichever button has keyboard focus, except the
  // already-selected word: there they act on that word like anywhere else.
  const onButton =
    event.target instanceof Element &&
    event.target.closest('button:not(.word[aria-current="true"])');
  const actions = {
    ' ': () => !onButton && actRandom(),
    Enter: () => !onButton && actGrow(),
    n: actPlant,
    r: actSwap,
    d: actDefine,
    '?': actDefine,
    c: actCopy,
    z: undo,
    Backspace: undo,
    ArrowLeft: () => move('left') !== false,
    ArrowRight: () => move('right') !== false,
    ArrowUp: () => move('up') !== false,
    ArrowDown: () => move('down') !== false,
    // For vim hands: the same actions under the keys they already know.
    h: () => move('left') !== false,
    j: () => move('down') !== false,
    k: () => move('up') !== false,
    l: () => move('right') !== false,
    o: actGrow, // open a line below
    u: undo,
    y: actCopy, // yank
    K: actDefine, // look up the word under the cursor
    G: () => move('bottom') !== false,
    g: () => {
      const again = event.timeStamp - lastG < 600; // gg
      lastG = again ? -Infinity : event.timeStamp;
      return again && move('top') !== false;
    },
  };
  // Shifted letters are their own keys (K, G); everything else ignores case.
  const key = event.key.length === 1 && !actions[event.key] ? event.key.toLowerCase() : event.key;
  const action = actions[key];
  if (!action) return;
  if (action() !== false) event.preventDefault();
}

async function start() {
  installGlobalHandlers(window);
  measureCharacter();
  load();
  if (!countNodes(state.forest)) addRoot(state.forest, colored(await words.random('all')));

  onClick(els.random, actRandom);
  onClick(els.grow, actGrow);
  onClick(els.plant, actPlant);
  onClick(els.define, actDefine);
  onClick(els.swap, actSwap);
  onClick(els.undo, undo);
  onClick(els.copy, actCopy);
  onClick(els.clear, actClear);
  for (const button of els.sources) onClick(button, () => setSource(button.dataset.source));
  els.tree.addEventListener('click', (event) => {
    const word = event.target instanceof Element && event.target.closest('.word');
    if (!word) return;
    // Same hand-back as onClick: a pressed word must not keep keyboard focus,
    // or enter would re-select it instead of continuing from it.
    if (event.detail > 0) word.blur();
    select(Number(word.dataset.id));
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', paint);

  paint();

  // Warm up today's topics so "anything" can include them. If this fails the
  // local lists carry on alone, and choosing "now" will surface the error.
  words.preload().catch((err) => reportError(err, { where: 'preload' }));
}

start().catch((err) => {
  reportError(err, { where: 'start' });
  say('something went wrong while starting — reload to try again', { hold: true });
});

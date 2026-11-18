import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForest, addRoot, addChild, replaceEntry, usedWords, isValidForest } from '../src/tree.js';
import { randomColor } from '../src/color.js';
import { THINGS, IDEAS, RARE } from '../src/words.js';

const entry = (word) => ({ word, kind: 'word', color: { l: 0.8, c: 0.1, h: 120 } });

function sample() {
  const forest = createForest();
  const ocean = addRoot(forest, entry('ocean'));
  const tide = addChild(forest, ocean, entry('tide'));
  addChild(forest, tide, entry('moon'));
  return { forest, ocean, tide };
}

test('new words become active and replacing keeps the place in the tree', () => {
  const { forest, ocean, tide } = sample();
  replaceEntry(forest, tide, entry('wave'));
  assert.equal(forest.active, tide);
  assert.deepEqual(forest.nodes[ocean].children, [tide]);
  assert.deepEqual([...usedWords(forest)].sort(), ['moon', 'ocean', 'wave']);
});

test('a saved tree survives a JSON round trip', () => {
  const { forest } = sample();
  assert.equal(isValidForest(JSON.parse(JSON.stringify(forest))), true);
});

test('damaged saved trees are rejected', () => {
  const broken = [
    null,
    'tree',
    {},
    createForest(),
    (() => { const { forest } = sample(); forest.active = 99; return forest; })(),
    (() => { const { forest, tide } = sample(); forest.nodes[tide].children.push(42); return forest; })(),
    (() => { const { forest, tide } = sample(); forest.nodes[tide].parent = null; return forest; })(),
    (() => { const { forest, tide } = sample(); delete forest.nodes[tide].color; return forest; })(),
    (() => { const { forest, tide } = sample(); forest.nodes[tide].word = 7; return forest; })(),
    (() => { const { forest } = sample(); forest.nextId = 1; return forest; })(),
  ];
  for (const forest of broken) assert.equal(isValidForest(forest), false);
});

test('colours stay out of the low-contrast middle and move away from the last hue', () => {
  for (let i = 0; i < 500; i++) {
    const previous = Math.random() * 360;
    const { l, c, h } = randomColor(Math.random, previous);
    assert.ok(l <= 0.48 || l >= 0.74, `lightness ${l}`);
    assert.ok(c >= 0.05 && c <= 0.2);
    assert.ok(h >= 0 && h < 360);
    const gap = Math.abs(h - previous) % 360;
    assert.ok(Math.min(gap, 360 - gap) >= 44, `hue gap ${gap}`);
  }
});

test('word lists are clean: single lowercase words, no repeats', () => {
  const all = [...THINGS, ...IDEAS, ...RARE];
  for (const word of all) assert.match(word, /^[a-z]{3,}$/);
  const repeats = all.filter((word, i) => all.indexOf(word) !== i);
  assert.deepEqual(repeats, []);
  assert.ok(all.length > 700);
});

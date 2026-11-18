// Where every word sits. Trees hang downward: a word's children spread out in
// a row beneath it, each centred over its own subtree, and separate trees
// stand side by side. Positions are in ems of the word size. Pure.

export const ROW_EM = 1.3; // height of the row a word sits in

const GAP = 3; // character cells between neighbouring subtrees
const TREE_GAP = 6; // character cells between separate trees
const DROP_MIN = 5; // ems from a word down to its children
const DROP_MAX = 10;
const DROP_PER_REACH = 0.5; // extra drop per em the widest child sits off to the side

const width = (text) => [...text].length;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Returns `spots` (word id -> { x, y, width, centre }: left edge, top edge,
// word width and horizontal centre) and the overall `width` and `height`.
// `charEm` is the width of one character relative to the font size.
export function place(forest, charEm = 0.6) {
  // Width each subtree needs, in character cells.
  const span = new Map();
  const measure = (id) => {
    const node = forest.nodes[id];
    const kids = node.children.reduce((sum, kid, i) => sum + measure(kid) + (i ? GAP : 0), 0);
    const needed = Math.max(width(node.word), kids);
    span.set(id, needed);
    return needed;
  };

  // Horizontal centre of each word: children side by side, parent above their middle.
  const centre = new Map();
  const settle = (id, left) => {
    const node = forest.nodes[id];
    const own = width(node.word);
    const total = span.get(id);
    const kids = node.children;
    if (!kids.length) {
      centre.set(id, left + total / 2);
      return;
    }
    const kidsWidth = kids.reduce((sum, kid, i) => sum + span.get(kid) + (i ? GAP : 0), 0);
    let cursor = left + (total - kidsWidth) / 2;
    for (const kid of kids) {
      settle(kid, cursor);
      cursor += span.get(kid) + GAP;
    }
    const middle = (centre.get(kids[0]) + centre.get(kids[kids.length - 1])) / 2;
    centre.set(id, clamp(middle, left + own / 2, left + total - own / 2));
  };

  let cursor = 0;
  forest.roots.forEach((root, i) => {
    measure(root);
    if (i > 0) cursor += TREE_GAP;
    settle(root, cursor);
    cursor += span.get(root);
  });

  // Depth: the further a word's children fan out, the more room their
  // branches get to curve on the way down.
  const spots = new Map();
  let height = ROW_EM;
  const descend = (id, top) => {
    const node = forest.nodes[id];
    const own = width(node.word);
    const middle = centre.get(id);
    spots.set(id, {
      x: (middle - own / 2) * charEm,
      y: top,
      width: own * charEm,
      centre: middle * charEm,
    });
    height = Math.max(height, top + ROW_EM);
    if (!node.children.length) return;
    const reach = Math.max(...node.children.map((kid) => Math.abs(centre.get(kid) - middle))) * charEm;
    const drop = clamp(DROP_MIN + DROP_PER_REACH * reach, DROP_MIN, DROP_MAX);
    for (const kid of node.children) descend(kid, top + drop);
  };
  for (const root of forest.roots) descend(root, 0);

  return { spots, width: Math.max(1, cursor) * charEm, height };
}

// The forest as an indented outline: what "copy" puts on the clipboard.
export function outline(forest) {
  const lines = [];
  const walk = (id, depth) => {
    const node = forest.nodes[id];
    lines.push('  '.repeat(depth) + node.word);
    for (const kid of node.children) walk(kid, depth + 1);
  };
  forest.roots.forEach((root, i) => {
    if (i > 0) lines.push('');
    walk(root, 0);
  });
  return lines.join('\n');
}

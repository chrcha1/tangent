// The word tree: a forest of chains. A line between two words always means
// "these are related"; unrelated words start their own root.

const KINDS = new Set(['word', 'topic']);

export function createForest() {
  return { nodes: {}, roots: [], active: null, nextId: 1 };
}

function insert(forest, entry, parent) {
  const id = forest.nextId++;
  forest.nodes[id] = {
    id,
    parent,
    children: [],
    word: entry.word,
    kind: entry.kind,
    title: entry.title ?? null,
    color: entry.color,
  };
  forest.active = id;
  return id;
}

export function addRoot(forest, entry) {
  const id = insert(forest, entry, null);
  forest.roots.push(id);
  return id;
}

export function addChild(forest, parentId, entry) {
  const parent = forest.nodes[parentId];
  if (!parent) throw new Error(`No node ${parentId} to branch from`);
  const id = insert(forest, entry, parentId);
  parent.children.push(id);
  return id;
}

export function replaceEntry(forest, id, entry) {
  const node = forest.nodes[id];
  if (!node) throw new Error(`No node ${id} to replace`);
  node.word = entry.word;
  node.kind = entry.kind;
  node.title = entry.title ?? null;
  node.color = entry.color;
  forest.active = id;
}

export function countNodes(forest) {
  return Object.keys(forest.nodes).length;
}

export function usedWords(forest) {
  return new Set(Object.values(forest.nodes).map((n) => n.word.toLowerCase()));
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function isValidNode(node, key, nodes) {
  if (!node || typeof node !== 'object') return false;
  if (String(node.id) !== key) return false;
  if (typeof node.word !== 'string' || !node.word.trim()) return false;
  if (!KINDS.has(node.kind)) return false;
  if (node.title != null && typeof node.title !== 'string') return false;
  const c = node.color;
  if (!c || !isNumber(c.l) || !isNumber(c.c) || !isNumber(c.h)) return false;
  if (!Array.isArray(node.children)) return false;
  if (node.parent != null && !nodes[node.parent]?.children?.includes(node.id)) return false;
  return node.children.every((kid) => nodes[kid]?.parent === node.id);
}

// Guards anything read back from storage: a half-written or hand-edited tree
// is discarded rather than rendered.
export function isValidForest(forest) {
  if (!forest || typeof forest !== 'object') return false;
  const { nodes, roots, active, nextId } = forest;
  if (!nodes || typeof nodes !== 'object' || !Array.isArray(roots) || !roots.length) return false;
  const keys = Object.keys(nodes);
  if (!keys.every((key) => isValidNode(nodes[key], key, nodes))) return false;
  if (!roots.every((id) => nodes[id] && nodes[id].parent == null)) return false;
  const rootless = keys.filter((key) => nodes[key].parent == null).length;
  if (rootless !== roots.length || new Set(roots).size !== roots.length) return false;
  if (!nodes[active]) return false;
  return isNumber(nextId) && keys.every((key) => Number(key) < nextId);
}

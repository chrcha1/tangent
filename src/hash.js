// Stable per-word variety: the same word id always yields the same number, so
// its branch keeps its shape and ornaments from one redraw to the next.
export function hash(seed) {
  let h = Math.imul(seed + 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

// Random backgrounds in OKLCH. Hue is fully random; lightness skips the muddy
// middle band so the ink colour always has strong contrast.

const round = (value, places) => Number(value.toFixed(places));

export function randomColor(rng = Math.random, previousHue = null) {
  // Land at least 45 degrees from the last hue so every change is visible.
  const h = previousHue == null ? rng() * 360 : (previousHue + 45 + rng() * 270) % 360;
  const dark = rng() < 0.4;
  const l = dark ? 0.24 + rng() * 0.24 : 0.74 + rng() * 0.2;
  const c = 0.05 + rng() * 0.15;
  return { l: round(l, 3), c: round(c, 3), h: Math.round(h) % 360 };
}

export const toCss = ({ l, c, h }) => `oklch(${l} ${c} ${h})`;

export function inkFor({ l, c, h }) {
  return l > 0.6
    ? `oklch(0.22 ${Math.min(c, 0.06)} ${h})`
    : `oklch(0.96 ${Math.min(c, 0.04)} ${h})`;
}

export function rng(seed = 17) {
  let a = Number(seed) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(items, seed = 17) {
  const out = [...items],
    r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const groupBy = (rows, key) => {
  const out = new Map();
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
};
export function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const i = (a.length - 1) * p,
    lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}

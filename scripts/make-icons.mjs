// Generates the app icons from the "Neon V" mark (the same art as the Logo component in src/components/icons.tsx).
// Run with:  node scripts/make-icons.mjs
// Only needed again if the mark changes; the PNGs are committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const V = "M16 18l16 28 16-28";
const TILE = "#0d1018";
const DEFS = `
  <defs>
    <linearGradient id="vr-neon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c084fc"/><stop offset=".5" stop-color="#6d83ff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <filter id="vr-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter>
  </defs>`;
const GLOW = `<path d="${V}" fill="none" stroke="url(#vr-neon)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#vr-glow)" opacity=".9"/>`;
const STROKE = `<path d="${V}" fill="none" stroke="url(#vr-neon)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The mark as drawn in the app: the rounded tile with its gradient border; the glow only when `glow`. */
function tile(size, { glow }) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${DEFS}
  <rect x="1.5" y="1.5" width="61" height="61" rx="17" fill="${TILE}" stroke="url(#vr-neon)" stroke-width="3"/>
  ${glow ? GLOW : ""}${STROKE}
</svg>`);
}

/**
 * Full bleed: the whole square #0d1018, no border, no rounded corners, the V scaled about the centre. For the maskable
 * icon (Android crops it to its own shape; everything must sit in the central 80% circle) and the Apple touch icon
 * (iOS rounds the corners itself and shows transparency as black).
 */
function bleed(size, scale) {
  const t = `translate(32 32) scale(${scale}) translate(-32 -32)`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${DEFS}
  <rect width="64" height="64" fill="${TILE}"/>
  <g transform="${t}">${GLOW}${STROKE}</g>
</svg>`);
}

/** Android's status-bar badge: the V alone, white on transparent. */
function badge(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <g transform="translate(32 32) scale(1.25) translate(-32 -32)"><path d="${V}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`);
}

// The V's farthest point from the centre (a top end, plus half the stroke) is 21.3 + 3.5 = 24.8 of 64 units, 39% of
// the size; at scale 0.85 it is 33%, well inside the maskable safe zone's 40% radius, glow included.
const jobs = [
  ["public/icons/icon-192.png", tile(192, { glow: true })],
  ["public/icons/icon-512.png", tile(512, { glow: true })],
  ["public/icons/icon-maskable-512.png", bleed(512, 0.85)],
  ["src/app/apple-icon.png", bleed(180, 1)],
  ["src/app/icon.png", tile(64, { glow: false })],
  ["public/icons/badge-96.png", badge(96)],
];

await mkdir("public/icons", { recursive: true });
for (const [file, svg] of jobs) {
  await sharp(svg).png().toFile(file);
  console.log("wrote", file);
}

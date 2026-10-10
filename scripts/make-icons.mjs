// Generates the app icons. Run with:  node scripts/make-icons.mjs
// Only needed again if the icon design changes; the PNGs are committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const TEAL = "#17695a";

// `pad` is the share of the canvas kept clear around the letters. Maskable
// icons need more, because Android crops them to a circle or squircle.
function svg({ size, radius, pad, background = TEAL, foreground = "#ffffff" }) {
  const fontSize = size * (1 - pad * 2) * 0.62;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-weight="800" font-size="${fontSize}" letter-spacing="${-fontSize * 0.04}" fill="${foreground}">VR</text>
</svg>`);
}

await mkdir("public/icons", { recursive: true });

const jobs = [
  ["public/icons/icon-192.png", { size: 192, radius: 40, pad: 0.12 }],
  ["public/icons/icon-512.png", { size: 512, radius: 108, pad: 0.12 }],
  ["public/icons/icon-maskable-512.png", { size: 512, radius: 0, pad: 0.22 }],
  ["src/app/apple-icon.png", { size: 180, radius: 0, pad: 0.14 }],
  ["src/app/icon.png", { size: 64, radius: 14, pad: 0.08 }],
];
for (const [file, options] of jobs) {
  await sharp(svg(options)).png().toFile(file);
  console.log("wrote", file);
}

// Android status-bar badge: white on transparent.
await sharp(svg({ size: 96, radius: 0, pad: 0.05, background: "none", foreground: "#ffffff" }))
  .png()
  .toFile("public/icons/badge-96.png");
console.log("wrote public/icons/badge-96.png");

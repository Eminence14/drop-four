// Generates PWA icons, favicon and social image from SVG. Run: npm run icons
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const BOARD = '#2b3a8f', C1 = '#ff6b4a', C2 = '#3d7bfd', HOLE = '#e9e3d6';
const mark = (s = 1, ox = 0, oy = 0) => `
  <g transform="translate(${ox} ${oy}) scale(${s})">
    <circle cx="20" cy="44" r="9.5" fill="${C1}"/><circle cx="44" cy="44" r="9.5" fill="${C2}"/>
    <circle cx="44" cy="20" r="9.5" fill="${C1}"/><circle cx="20" cy="20" r="9.5" fill="${HOLE}"/>
    <circle cx="17" cy="41" r="3" fill="#fff" opacity=".35"/><circle cx="41" cy="41" r="3" fill="#fff" opacity=".35"/><circle cx="41" cy="17" r="3" fill="#fff" opacity=".35"/>
  </g>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${BOARD}"/>${mark()}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BOARD}"/>${mark(0.7, 9.6, 9.6)}</svg>`;
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f5f1e8"/>
  <rect x="90" y="155" width="320" height="320" rx="75" fill="${BOARD}"/>${mark(5, 90, 155)}
  <text x="480" y="300" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-size="110" font-weight="900" fill="#1b1d2a">Drop Four</text>
  <text x="484" y="380" font-family="Arial, sans-serif" font-size="40" fill="#5d6070">Line up four. Play a friend, the AI, or online.</text></svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', icon);
const png = (svg, size, out) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(out);
await png(icon, 192, 'public/icons/icon-192.png');
await png(icon, 512, 'public/icons/icon-512.png');
await png(maskable, 192, 'public/icons/maskable-192.png');
await png(maskable, 512, 'public/icons/maskable-512.png');
await png(maskable, 180, 'public/apple-touch-icon.png');
await sharp(Buffer.from(og)).resize(1200, 630).png().toFile('public/og-image.png');
console.log('icons done');

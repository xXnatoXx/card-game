import { PALETTE } from '../scene/retro.js';

// The HUD cards get the same look as the 3D scene: a tiny image, ordered-dithered to the game's
// palette, then scaled up with hard pixels by CSS (image-rendering: pixelated).

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const RGB = PALETTE.map((hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as const);

function nearest(r: number, g: number, b: number): readonly [number, number, number] {
  let best = RGB[0]!;
  let bestD = Infinity;
  for (const c of RGB) {
    const d = 0.3 * (r - c[0]) ** 2 + 0.55 * (g - c[1]) ** 2 + 0.15 * (b - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A card face lit by the lamp: bright paper with a glossy highlight in the top-left corner,
 * falling off into a warm shadow toward the bottom-right, all broken into dither dots.
 */
function cardImage(w: number, h: number, glow: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const paper = [242, 230, 196];
  const shade = [150, 128, 86];
  const shine = [255, 248, 222];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      // Light from the lamp above and to the left.
      let light = Math.min(1, Math.max(0, 1.25 + glow * 0.3 - 0.55 * u - 0.6 * v));
      // Darken the very edges a little so the card reads as a raised object.
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge === 0) light *= 0.85;
      let r = mix(shade[0]!, paper[0]!, light);
      let g = mix(shade[1]!, paper[1]!, light);
      let b = mix(shade[2]!, paper[2]!, light);
      // A glossy streak across the top-left corner.
      const streak = Math.max(0, 1 - Math.abs(u + v * 0.7 - 0.28) / 0.12) * (0.9 + glow * 0.4);
      r = mix(r, shine[0]!, Math.min(1, streak));
      g = mix(g, shine[1]!, Math.min(1, streak));
      b = mix(b, shine[2]!, Math.min(1, streak));

      const t = (BAYER_4X4[(y % 4) * 4 + (x % 4)]! / 16 - 0.5) * 34;
      const [pr, pg, pb] = nearest(r + t, g + t, b + t);
      const i = (y * w + x) * 4;
      img.data[i] = pr;
      img.data[i + 1] = pg;
      img.data[i + 2] = pb;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/**
 * A tile of grime for panels: near-black with sparse felt-green and rust specks, thresholded by
 * the Bayer pattern over a lumpy noise so it clumps like dirt rather than spreading evenly.
 */
function panelTile(size: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // Coarse random grid, smoothly interpolated and wrapped, so the tile repeats seamlessly.
  const cells = 6;
  const grid = Array.from({ length: cells * cells }, () => Math.random());
  const g = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const sx = fx - ix;
      const sy = fy - iy;
      const n = mix(mix(g(ix, iy), g(ix + 1, iy), sx), mix(g(ix, iy + 1), g(ix + 1, iy + 1), sx), sy);
      const threshold = BAYER_4X4[(y % 4) * 4 + (x % 4)]! / 16;
      const speck = n * 0.42 > threshold + 0.1;
      const rust = speck && Math.random() < 0.08;
      const [r, gr, b] = rust ? [46, 28, 20] : speck ? [26, 34, 22] : [10, 12, 8];
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = 232;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** Builds the dithered card faces and panel grime once, exposed to CSS as custom properties. */
export function installCardDither(): void {
  const root = document.documentElement.style;
  // Half the CSS size, so each dither pixel becomes a crisp 2x2 block.
  root.setProperty('--card-bg', `url(${cardImage(30, 43, 0)})`);
  root.setProperty('--card-bg-lit', `url(${cardImage(30, 43, 1)})`);
  root.setProperty('--panel-tex', `url(${panelTile(48)})`);
}

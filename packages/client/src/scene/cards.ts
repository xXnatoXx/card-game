import type { Card } from '@bluff/rules';
import { BoxGeometry, CanvasTexture, Mesh, MeshStandardMaterial, SRGBColorSpace, type Material } from 'three';
import { addWobble } from './retro.js';

export const CARD_W = 0.28;
export const CARD_D = 0.4;
export const CARD_T = 0.012;

export const SUIT_SYMBOL = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const;
export const isRed = (card: Card) => card.suit === 'hearts' || card.suit === 'diamonds';

const geometry = new BoxGeometry(CARD_W, CARD_T, CARD_D);

function material(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): MeshStandardMaterial {
  const w = 56;
  const h = 80;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const mat = new MeshStandardMaterial({ map, roughness: 0.85 });
  addWobble(mat);
  return mat;
}

const edge = new MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.9 });
addWobble(edge);

const back = material((ctx, w, h) => {
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6a1c14';
  ctx.fillRect(4, 4, w - 8, h - 8);
  ctx.strokeStyle = '#a8402a';
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 4);
    ctx.lineTo(i + h, h - 4);
    ctx.moveTo(i + h, 4);
    ctx.lineTo(i, h - 4);
    ctx.stroke();
  }
});

const faces = new Map<string, MeshStandardMaterial>();

function faceMaterial(card: Card): MeshStandardMaterial {
  const inverted = !!card.deck;
  const key = `${card.rank}${card.suit}${inverted ? 'x' : ''}`;
  let mat = faces.get(key);
  if (!mat) {
    mat = material((ctx, w, h) => {
      ctx.fillStyle = '#f2e6c4';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = isRed(card) ? '#a8281c' : '#141410';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 30px Georgia, serif';
      ctx.fillText(card.rank, w / 2, h * 0.34);
      ctx.font = '30px Georgia, serif';
      ctx.fillText(SUIT_SYMBOL[card.suit], w / 2, h * 0.72);
      if (inverted) {
        // x2 mode: the second deck is a colour negative of the first.
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    });
    faces.set(key, mat);
  }
  return mat;
}

/** A face-down card. Its top (+y) shows the back; its underside shows the face once known. */
export function makeCard(): Mesh {
  // Box face order: +x, -x, +y, -y, +z, -z.
  const mesh = new Mesh(geometry, [edge, edge, back, edge, edge, edge]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function showFace(mesh: Mesh, card: Card): void {
  (mesh.material as Material[])[3] = faceMaterial(card);
}

import {
  AmbientLight,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PointLight,
  RepeatWrapping,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  TorusGeometry,
  type Scene,
} from 'three';
import { addWobble } from './retro.js';
import { linear, tween } from './tween.js';

const LAMP_HEIGHT = 3.1;
const LAMP_INTENSITY = 40;

function feltTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2f5a2a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const g = 70 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${g - 40}, ${g}, ${g - 45}, ${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.floor(Math.random() * size), Math.floor(Math.random() * size), 1, 1);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.magFilter = NearestFilter;
  return tex;
}

/** The felt table, the single hanging lamp, and the faint green bounce light off the felt. */
export class Table {
  radius = 2.4;
  private readonly group = new Group();
  private readonly lamp = new Group();
  private readonly spot: SpotLight;
  private readonly bulb: Mesh;
  private readonly feltMat = new MeshStandardMaterial({ map: feltTexture(), roughness: 1 });
  private readonly rimMat = new MeshStandardMaterial({ color: 0x3a2214, roughness: 0.7 });
  /** Red light that sweeps round the room when a bluff is caught. Off until then. */
  private readonly alarmLight = new SpotLight(0xff2a14, 0, 0, 0.6, 0.5, 1.5);
  private top: Mesh | null = null;
  private rim: Mesh | null = null;
  private flickering = false;

  constructor(scene: Scene) {
    scene.add(this.group, this.lamp);
    addWobble(this.feltMat);
    addWobble(this.rimMat);

    const base = new Mesh(new CylinderGeometry(0.35, 0.6, 1.4, 12), new MeshStandardMaterial({ color: 0x1a120c }));
    base.position.y = -0.78;
    this.group.add(base);

    // Lamp: shade, bulb, cord, and the spotlight that makes the pool of light.
    const shade = new Mesh(
      new ConeGeometry(0.5, 0.38, 16, 1, true),
      new MeshStandardMaterial({ color: 0x24301c, roughness: 0.5, metalness: 0.4, side: DoubleSide }),
    );
    shade.position.y = LAMP_HEIGHT + 0.12;
    this.bulb = new Mesh(new SphereGeometry(0.09, 10, 8), new MeshBasicMaterial({ color: 0xfff0c0 }));
    this.bulb.position.y = LAMP_HEIGHT;
    const cord = new Mesh(new CylinderGeometry(0.012, 0.012, 4, 4), new MeshBasicMaterial({ color: 0x0a0a08 }));
    cord.position.y = LAMP_HEIGHT + 2.2;

    this.spot = new SpotLight(0xffd58a, LAMP_INTENSITY, 0, 0.62, 0.55, 2);
    this.spot.position.y = LAMP_HEIGHT - 0.05;
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.bias = -0.0004;
    this.spot.target.position.set(0, 0, 0);
    this.lamp.add(shade, this.bulb, cord, this.spot, this.spot.target);

    // Light bouncing off the felt: a little glow near the table, and green light from below on faces.
    const bounce = new PointLight(0x7a9a4a, 1.2, 6, 2);
    bounce.position.set(0, 0.2, 0);
    // Soft ambient fill so the room and the animals never sink to pure black.
    scene.add(bounce, new HemisphereLight(0x000000, 0x3a5a2a, 2.2), new AmbientLight(0x6e6a54, 0.95));

    this.alarmLight.position.set(0, 2.6, 0);
    scene.add(this.alarmLight, this.alarmLight.target);

    this.setRadius(this.radius);
  }

  /** Drives the sweeping red alarm light; level 0 turns it off. */
  setAlarm(level: number, time: number): void {
    this.alarmLight.intensity = level * 70;
    const a = time * 0.005;
    this.alarmLight.target.position.set(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2);
  }

  setRadius(radius: number): void {
    this.radius = radius;
    for (const mesh of [this.top, this.rim]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.top = new Mesh(new CylinderGeometry(radius, radius * 0.97, 0.1, 48), this.feltMat);
    this.top.position.y = -0.05;
    this.top.receiveShadow = true;
    this.rim = new Mesh(new TorusGeometry(radius, 0.08, 6, 48), this.rimMat);
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = -0.01;
    this.rim.receiveShadow = true;
    this.group.add(this.top, this.rim);
  }

  /** The lamp stutters, as when a bluff is called. */
  async flicker(ms: number): Promise<void> {
    if (this.flickering) return;
    this.flickering = true;
    const bulb = this.bulb.material as MeshBasicMaterial;
    await tween(
      ms,
      (k) => {
        const on = k >= 1 || Math.random() > 0.45;
        this.spot.intensity = on ? LAMP_INTENSITY * (0.7 + Math.random() * 0.3) : LAMP_INTENSITY * 0.08;
        bulb.color.setHex(on ? 0xfff0c0 : 0x4a3a20);
      },
      linear,
    );
    this.spot.intensity = LAMP_INTENSITY;
    bulb.color.setHex(0xfff0c0);
    this.flickering = false;
  }

  update(time: number): void {
    // A slow sway, as if a draught moves the lamp.
    this.lamp.rotation.z = Math.sin(time * 0.0005) * 0.025;
    this.lamp.rotation.x = Math.cos(time * 0.00037) * 0.02;
  }
}

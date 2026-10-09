import type { Animal } from '@bluff/protocol';
import {
  AdditiveBlending,
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh as ThreeMesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type AnimationAction,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { addWobble } from './retro.js';
import { tween } from './tween.js';

const loader = new GLTFLoader();
const cache = new Map<Animal, Promise<GLTF>>();

function load(animal: Animal): Promise<GLTF> {
  let gltf = cache.get(animal);
  if (!gltf) {
    gltf = loader.loadAsync(`${import.meta.env.BASE_URL}models/animals/animal-${animal}.glb`);
    cache.set(animal, gltf);
  }
  return gltf;
}

export const AVATAR_SCALE = 0.95;
/** Height of the avatar's root below the table top, so heads rise just above the felt. */
export const AVATAR_Y = -0.5;
/** Roughly where the head sits above the root, for name labels. */
export const HEAD_HEIGHT = 1.55;
/** The Kenney models face +z; the seat group's +z points at the table centre. */
const MODEL_YAW = 0;

/** Every Cube Pet shares one head layout: pupils sit here, on the front of the face (model space). */
const EYES = [new Vector3(-0.22, 0.89, 0.645), new Vector3(0.22, 0.89, 0.645)];
const eyeGeometry = new PlaneGeometry(0.1, 0.1);

export type Reaction = 'gesture-positive' | 'gesture-negative' | 'eat';

/** One seated animal: its model, animations, turn glow, and lean. */
export class Avatar {
  readonly root = new Group();
  private readonly body = new Group();
  private mixer: AnimationMixer | null = null;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly materials: MeshStandardMaterial[] = [];
  private current: AnimationAction | null = null;
  private lit = false;
  private disposed = false;
  private readonly eyeMat = new MeshBasicMaterial({
    color: 0xd8f29a,
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly glowPhase = Math.random() * Math.PI * 2;
  /** Head turn: toward a point (e.g. you, on your turn) or straight at the table. */
  private yaw = 0;
  private targetYaw = 0;
  private readonly turnSpeed = 2.5 + Math.random() * 3;

  constructor(readonly animal: Animal) {
    this.root.add(this.body);
    void this.load();
  }

  private async load(): Promise<void> {
    const gltf = await load(this.animal);
    if (this.disposed) return;
    const model = gltf.scene.clone(true);
    model.rotation.y = MODEL_YAW;
    model.scale.setScalar(AVATAR_SCALE);
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const copy = (m as MeshStandardMaterial).clone();
        copy.emissiveMap = copy.map;
        addWobble(copy);
        this.materials.push(copy);
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!;
    });
    this.body.add(model);
    this.addEyes(model);

    this.mixer = new AnimationMixer(model);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', () => this.play('idle'));
    const idle = this.play('idle');
    if (idle) idle.time = Math.random() * idle.getClip().duration;
    this.setLit(this.lit);
  }

  private play(name: string, once = false): AnimationAction | null {
    const action = this.actions.get(name);
    if (!action) return null;
    action.reset();
    action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = false;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.25, false);
    action.play();
    this.current = action;
    return action;
  }

  /** Small glowing dots on the pupils, like eyes catching the lamp in the dark. They follow the head's animation. */
  private addEyes(model: Group): void {
    const head = model.getObjectByName('body') ?? model;
    model.updateMatrixWorld(true);
    for (const eye of EYES) {
      const glow = new ThreeMesh(eyeGeometry, this.eyeMat);
      const world = model.localToWorld(eye.clone());
      glow.position.copy(head.worldToLocal(world));
      glow.renderOrder = 2;
      head.add(glow);
    }
  }

  /** Turn to face a world point, or back to the table with null. */
  lookAt(point: Vector3 | null): void {
    if (!point) {
      this.targetYaw = 0;
      return;
    }
    const local = this.root.worldToLocal(point.clone());
    this.targetYaw = Math.max(-1.3, Math.min(1.3, Math.atan2(local.x, local.z)));
  }

  react(reaction: Reaction): void {
    this.play(reaction, true);
  }

  dance(): void {
    this.play('dance');
  }

  calm(): void {
    if (this.current !== this.actions.get('idle')) this.play('idle');
  }

  /** Brightens the animal while it is their turn. */
  setLit(on: boolean): void {
    this.lit = on;
    // A faint glow always, so faces never vanish into the dark; much brighter on their turn.
    for (const m of this.materials) {
      if (on) m.emissive.setRGB(0.5, 0.42, 0.24);
      else m.emissive.setRGB(0.07, 0.08, 0.05);
    }
  }

  /** Leans in over the table for a moment, as when inspecting. */
  async lean(): Promise<void> {
    const forward = new Vector3(0, -0.1, 0.45);
    await tween(400, (k) => this.body.position.copy(forward).multiplyScalar(k));
    await tween(900, () => {});
    await tween(500, (k) => this.body.position.copy(forward).multiplyScalar(1 - k));
  }

  update(dt: number, time: number): void {
    this.mixer?.update(dt);
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * this.turnSpeed);
    this.body.rotation.y = this.yaw;
    // A slow shimmer; brighter while it's their turn.
    const shimmer = 0.85 + 0.15 * Math.sin(time / 700 + this.glowPhase);
    this.eyeMat.opacity = (this.lit ? 0.95 : 0.45) * shimmer;
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    this.eyeMat.dispose();
  }
}

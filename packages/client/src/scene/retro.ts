import { ShaderMaterial, Vector2, Vector3, type Material, type Object3D, type Texture } from 'three';

/**
 * The whole image is reduced to these colours (sRGB): near-black, felt greens, lamp yellows,
 * pale tones, and two alarm reds for when a bluff is caught.
 */
export const PALETTE = [
  0x050504, 0x0f120d, 0x1a2216, 0x253420, 0x34502a, 0x4c6e34, 0x6f8f45, 0x2e1c14,
  0x5a3420, 0x8a5a2e, 0x9a2a1e, 0xc9a14a, 0xe8c86a, 0xf2e6c4, 0x8c8c7c, 0x4a5a6a,
  0x4a1010, 0xd84a34,
];

const vertexShader = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 lowRes;
  uniform float pixelScale;
  uniform vec3 palette[${PALETTE.length}];
  uniform float spread;
  uniform float exposure;
  uniform float time;
  uniform float vignette;    // edge darkening, 0..1
  uniform float grain;       // film grain strength
  uniform float glitch;      // 0..1: rows tear sideways, colour channels split
  uniform sampler2D tCrack;  // r = crack lines, gb = shard offset (0.5 = none)
  uniform float crack;       // 0..1: how broken the screen is
  uniform vec3 tint;         // alarm colour
  uniform float tintAmount;
  uniform float danger;      // 0..1: red pulse at the edges
  uniform float flash;

  // Ordered 4x4 Bayer threshold in [0, 1).
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec2 px = floor(gl_FragCoord.xy / pixelScale);
    vec2 uv = (px + 0.5) / lowRes;

    // Glitch: bands of rows jump sideways for a frame or two.
    float frame = floor(time * 24.0);
    float band = floor(px.y / 5.0);
    float tear = step(1.0 - glitch * 0.5, hash(vec2(band, frame)));
    uv.x += tear * (hash(vec2(frame, band)) - 0.5) * 0.14 * glitch;

    // Broken screen: each shard of glass shifts the picture its own way.
    vec4 cr = texture2D(tCrack, uv);
    uv += (cr.gb - 0.5) * 0.05 * crack;

    // Colour channels drift apart during glitches.
    float split = glitch * 0.012 + crack * 0.004;
    vec3 c = vec3(
      texture2D(tScene, uv + vec2(split, 0.0)).r,
      texture2D(tScene, uv).g,
      texture2D(tScene, uv - vec2(split, 0.0)).b
    ) * exposure;

    // Alarm: the room washes red.
    float lum = dot(c, vec3(0.3, 0.55, 0.15));
    c = mix(c, lum * tint * 2.6, tintAmount);

    // Vignette, and the red heartbeat creeping in from the edges.
    vec2 q = (uv - 0.5) * vec2(lowRes.x / lowRes.y, 1.0);
    float vig = smoothstep(1.1, 0.25, length(q));
    c *= mix(1.0, vig, vignette);
    c = mix(c, vec3(0.3, 0.015, 0.01), (1.0 - vig) * danger);

    c = toSRGB(aces(c));
    c += flash;
    c += (hash(px + fract(time * 7.0) * 61.0) - 0.5) * grain;
    c = mix(c, vec3(0.95, 0.93, 0.85), cr.r * crack); // crack edges catch the lamp
    c += (bayer4(px) - 0.5) * spread;

    vec3 best = palette[0];
    float bestD = 1e9;
    for (int i = 0; i < ${PALETTE.length}; i++) {
      vec3 d = c - palette[i];
      float dist = dot(d * d, vec3(0.3, 0.55, 0.15));
      if (dist < bestD) { bestD = dist; best = palette[i]; }
    }
    gl_FragColor = vec4(best, 1.0);
  }
`;

/** Palette as raw sRGB triples, which is what the shader compares against. */
function srgbPalette(): Vector3[] {
  return PALETTE.map((hex) => new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255));
}

/** Full-screen pass: upscales the low-res scene with hard pixels and dithers it to the palette. */
export function ditherMaterial(scene: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tScene: { value: scene },
      lowRes: { value: new Vector2(320, 240) },
      pixelScale: { value: 1 },
      palette: { value: srgbPalette() },
      spread: { value: 0.1 },
      exposure: { value: 1.45 },
      time: { value: 0 },
      vignette: { value: 0.6 },
      grain: { value: 0.035 },
      glitch: { value: 0 },
      tCrack: { value: null },
      crack: { value: 0 },
      tint: { value: new Vector3(1, 0.12, 0.06) },
      tintAmount: { value: 0 },
      danger: { value: 0 },
      flash: { value: 0 },
    },
  });
}

/** Shared by every wobbling material: the low-res size vertices snap to. */
export const snapUniform = { value: new Vector2(320, 240) };

/** PS1-style vertex snapping: positions jump between low-res pixels, so edges jitter as things move. */
export function addWobble(material: Material): void {
  if (material.userData.wobble) return;
  material.userData.wobble = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.snapRes = snapUniform;
    shader.vertexShader = `uniform vec2 snapRes;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec2 half_ = snapRes * 0.5;
       gl_Position.xy = floor(gl_Position.xy / gl_Position.w * half_ + 0.5) / half_ * gl_Position.w;`,
    );
  };
  material.customProgramCacheKey = () => 'wobble';
  material.needsUpdate = true;
}

export function addWobbleDeep(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Object3D & { material?: Material | Material[] };
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) addWobble(m);
  });
}

import { Color3, DynamicTexture, Scene, StandardMaterial, Texture } from "@babylonjs/core";

export type Kind = "concrete" | "floor" | "metal" | "crate" | "ceiling" | "brick" | "tile";
const SIZE = 64;

/** Детерминированный генератор случайных чисел (mulberry32). */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

export function noise(c: Ctx, r: Rnd, base: number[], amp: number, size = SIZE) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (r() - 0.5) * amp;
      c.fillStyle = `rgb(${(base[0] + n) | 0},${(base[1] + n) | 0},${(base[2] + n) | 0})`;
      c.fillRect(x, y, 1, 1);
    }
}

const DRAW: Record<Kind, (c: Ctx, r: Rnd) => void> = {
  concrete: (c, r) => {
    noise(c, r, [74, 72, 66], 22);
    c.fillStyle = "#2a2926";
    c.fillRect(0, 0, SIZE, 2); c.fillRect(0, 0, 2, SIZE); c.fillRect(0, SIZE / 2, SIZE, 1);
  },
  floor: (c, r) => {
    noise(c, r, [52, 52, 56], 16);
    c.fillStyle = "#1c1c20";
    c.fillRect(0, 0, SIZE, 2); c.fillRect(0, 0, 2, SIZE);
    c.fillRect(0, SIZE / 2, SIZE, 1); c.fillRect(SIZE / 2, 0, 1, SIZE);
  },
  metal: (c, r) => {
    noise(c, r, [96, 102, 108], 14);
    c.fillStyle = "#3a3f44";
    c.fillRect(0, 0, SIZE, 3); c.fillRect(0, SIZE - 3, SIZE, 3);
    c.fillStyle = "#c8cdd2";
    for (const [x, y] of [[6, 6], [SIZE - 8, 6], [6, SIZE - 9], [SIZE - 8, SIZE - 9]]) c.fillRect(x, y, 2, 2);
  },
  // Ящик: рамка, доски и симметричный крест из двух диагоналей. Мапится целиком на каждую грань.
  crate: (c, r) => {
    noise(c, r, [118, 82, 44], 20);
    c.fillStyle = "#5a3a1a";
    for (const y of [16, 32, 48]) c.fillRect(0, y, SIZE, 1);
    c.fillStyle = "#4a2f14";
    c.fillRect(0, 0, SIZE, 5); c.fillRect(0, SIZE - 5, SIZE, 5);
    c.fillRect(0, 0, 5, SIZE); c.fillRect(SIZE - 5, 0, 5, SIZE);
    for (let i = 0; i < SIZE; i++) { c.fillRect(i - 1, i - 1, 3, 3); c.fillRect(SIZE - 2 - i, i - 1, 3, 3); }
  },
  ceiling: (c, r) => {
    noise(c, r, [70, 70, 78], 14);
    c.fillStyle = "#1e1e24";
    c.fillRect(0, 0, SIZE, 3); c.fillRect(0, 0, 3, SIZE);
    c.fillRect(0, SIZE / 2, SIZE, 2); c.fillRect(SIZE / 2, 0, 2, SIZE);
    c.fillStyle = "#9a9aa8";
    for (const [x, y] of [[8, 8], [SIZE / 2 + 6, 8], [8, SIZE / 2 + 6], [SIZE / 2 + 6, SIZE / 2 + 6]]) c.fillRect(x, y, 2, 2);
  },
  brick: (c, r) => {
    c.fillStyle = "#3a302c"; c.fillRect(0, 0, SIZE, SIZE); // раствор
    for (let row = 0; row < 4; row++)
      for (let col = -1; col < 2; col++) {
        const x = col * 32 + (row % 2 ? 16 : 0), y = row * 16, sh = (r() - 0.5) * 34;
        c.fillStyle = `rgb(${(138 + sh) | 0},${(60 + sh * 0.5) | 0},${(44 + sh * 0.4) | 0})`;
        c.fillRect(x + 1, y + 1, 30, 14);
      }
    c.fillStyle = "#2a1c18";
    for (let i = 0; i < 90; i++) c.fillRect((r() * SIZE) | 0, (r() * SIZE) | 0, 1, 1);
  },
  tile: (c, r) => {
    noise(c, r, [196, 206, 208], 14);
    c.fillStyle = "#6b777a";
    c.fillRect(0, 0, SIZE, 2); c.fillRect(0, 0, 2, SIZE);
    c.fillRect(0, SIZE / 2, SIZE, 2); c.fillRect(SIZE / 2, 0, 2, SIZE);
  },
};

const cache = new WeakMap<Scene, Map<Kind, DynamicTexture>>();

/** Текстуры создаются один раз на сцену (NEAREST — без сглаживания, WRAP — тайлинг). */
function textures(scene: Scene) {
  let map = cache.get(scene);
  if (!map) {
    const fresh = new Map<Kind, DynamicTexture>();
    (Object.keys(DRAW) as Kind[]).forEach((kind, i) => {
      const tex = new DynamicTexture(`tex_${kind}`, { width: SIZE, height: SIZE }, scene, false, Texture.NEAREST_SAMPLINGMODE);
      DRAW[kind](tex.getContext() as unknown as Ctx, rng(1000 + i));
      tex.wrapU = Texture.WRAP_ADDRESSMODE; // DynamicTexture по умолчанию CLAMP
      tex.wrapV = Texture.WRAP_ADDRESSMODE;
      tex.update();
      fresh.set(kind, tex);
    });
    cache.set(scene, fresh);
    map = fresh;
  }
  return map;
}

/** Набор материалов; tint — оттенок этажа, glow — слабая собственная подсветка. */
export function createMaterials(scene: Scene, tint: Color3 = Color3.White(), glow: Color3 = Color3.Black()) {
  const texs = textures(scene);
  const out = {} as Record<Kind, StandardMaterial>;
  (Object.keys(DRAW) as Kind[]).forEach((kind) => {
    const mat = new StandardMaterial(`mat_${kind}`, scene);
    mat.diffuseTexture = texs.get(kind)!;
    mat.diffuseColor = tint;
    mat.emissiveColor = glow;
    mat.specularColor = Color3.Black();
    out[kind] = mat;
  });
  return out;
}

/** Холст-текстура для табло, кнопок и неба (без сглаживания). */
export function canvasTexture(scene: Scene, w: number, h: number) {
  const tex = new DynamicTexture("ui_tex", { width: w, height: h }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  return { tex, ctx: tex.getContext() as unknown as CanvasRenderingContext2D };
}

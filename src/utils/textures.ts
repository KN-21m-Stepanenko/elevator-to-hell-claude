import { Color3, DynamicTexture, Scene, StandardMaterial, Texture } from "@babylonjs/core";

export type Kind =
  | "concrete" | "floor" | "metal" | "crate" | "ceiling" | "brick" | "tile"
  | "vent" | "bamboo" | "darkwood" | "tarp" | "camo";

/**
 * Виды, у которых рамка нарисована на самой текстуре. Такая текстура мапится целиком на каждую грань бокса
 * (см. addBox), поэтому рамка идёт ровно по периметру грани, а не повторяется по мировой сетке.
 * Рамка плоская: ни полигонов, ни отдельных мешей.
 */
export const FIT_KINDS: ReadonlySet<Kind> = new Set<Kind>(["crate", "vent", "bamboo", "darkwood"]);
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

const BORDER_THICKNESS = 5;

/** Рисует непрерывную рамку по внешнему периметру текстуры. */
function drawPerimeterBorder(
  c: Ctx,
  borderColor: string,
  bevelColor?: string,
) {
  const b = BORDER_THICKNESS;

  c.fillStyle = borderColor;
  c.fillRect(0, 0, SIZE, b);                 // верх
  c.fillRect(0, SIZE - b, SIZE, b);          // низ
  c.fillRect(0, 0, b, SIZE);                 // левая сторона
  c.fillRect(SIZE - b, 0, b, SIZE);          // правая сторона

  // Тонкий симметричный блик по внутреннему краю рамки.
  // Углы не перекрашиваются, поэтому внешний контур остаётся цельным.
  if (bevelColor) {
    c.fillStyle = bevelColor;
    c.fillRect(b, b - 1, SIZE - 2 * b, 1);
    c.fillRect(b, SIZE - b, SIZE - 2 * b, 1);
    c.fillRect(b - 1, b, 1, SIZE - 2 * b);
    c.fillRect(SIZE - b, b, 1, SIZE - 2 * b);
  }
}

/**
 * Рамка на текстуре строго по периметру: w px тела, внешний контур 1 px,
 * скос внутреннего края (свет сверху и слева, тень снизу и справа).
 */
function drawFrame(c: Ctx, w: number, body: string, edge: string, light: string, shade: string) {
  const S = SIZE;
  c.fillStyle = body;
  c.fillRect(0, 0, S, w); c.fillRect(0, S - w, S, w); c.fillRect(0, 0, w, S); c.fillRect(S - w, 0, w, S);
  c.fillStyle = light;
  c.fillRect(w, w - 1, S - 2 * w, 1); c.fillRect(w - 1, w, 1, S - 2 * w);
  c.fillStyle = shade;
  c.fillRect(w, S - w, S - 2 * w, 1); c.fillRect(S - w, w, 1, S - 2 * w);
  c.fillStyle = edge;
  c.fillRect(0, 0, S, 1); c.fillRect(0, S - 1, S, 1); c.fillRect(0, 0, 1, S); c.fillRect(S - 1, 0, 1, S);
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

  // ---------- Новые текстуры 64×64: tarp и camo бесшовные; vent, bamboo, darkwood с рамкой на самой текстуре (FIT_KINDS) ----------

  /** Жалюзи вентиляции: 8 пластин, металлическая рамка по периметру и вертикальная перегородка посередине. */
  vent: (c, r) => {
    c.fillStyle = "#101315"; c.fillRect(0, 0, SIZE, SIZE); // тёмный проём между пластинами
    for (let y = 0; y < SIZE; y += 8) {
      for (let x = 0; x < SIZE; x++) {
        const n = (r() - 0.5) * 14;
        c.fillStyle = `rgb(${(88 + n) | 0},${(99 + n) | 0},${(110 + n) | 0})`;
        c.fillRect(x, y + 1, 1, 5);
      }
      c.fillStyle = "#9aa6b2"; c.fillRect(0, y, SIZE, 1);     // блик верхней кромки
      c.fillStyle = "#2b3238"; c.fillRect(0, y + 6, SIZE, 1); // скос вниз
      if (r() > 0.55) { c.fillStyle = "#6b4a30"; c.fillRect((r() * 44) | 0, y + 2 + ((r() * 3) | 0), ((r() * 12) | 0) + 3, 1); }
    }
    drawFrame(c, 5, "#3a4148", "#14181b", "#8a97a4", "#1b2025");
    const mx = SIZE / 2 - 2; // перегородка 4 px строго по центру, между верхней и нижней рамкой
    c.fillStyle = "#3a4148"; c.fillRect(mx, 5, 4, SIZE - 10);
    c.fillStyle = "#8a97a4"; c.fillRect(mx, 5, 1, SIZE - 10);
    c.fillStyle = "#1b2025"; c.fillRect(mx + 3, 5, 1, SIZE - 10);
  },

  /** Бамбуковый щит: 8 стеблей с узлами и тёмная обожжённая рамка по периметру. */
  bamboo: (c, r) => {
    for (let s = 0; s < 8; s++) {
      const x0 = s * 8, sh = (r() - 0.5) * 30;
      c.fillStyle = "#2a1c0c"; c.fillRect(x0 + 7, 0, 1, SIZE);
      for (let y = 0; y < SIZE; y++) {
        const g = (r() - 0.5) * 10;
        c.fillStyle = `rgb(${(168 + sh + g) | 0},${(140 + sh * 0.8 + g) | 0},${(66 + sh * 0.5) | 0})`;
        c.fillRect(x0, y, 7, 1);
      }
      c.fillStyle = "rgba(255,240,170,0.35)"; c.fillRect(x0 + 1, 0, 1, SIZE);
      c.fillStyle = "rgba(65, 44, 13, 0.35)"; c.fillRect(x0 + 5, 0, 1, SIZE);
      const ny = (s * 19 + 7) % 32;
      for (const y of [ny, ny + 32]) {
        c.fillStyle = "#8c6a2c"; c.fillRect(x0, y - 1, 7, 1);
        c.fillStyle = "#6b4c1c"; c.fillRect(x0, y, 7, 2);
      }
    }
    drawFrame(c, 5, "#352315", "#2a1c11", "#4b3822", "#3c2f24");
    for (let i = 0; i < 140; i++) { // обугленная фактура: пятна копоти и редкие тлеющие точки только на рамке
      const x = (r() * SIZE) | 0, y = (r() * SIZE) | 0;
      if (x >= 5 && x < SIZE - 5 && y >= 5 && y < SIZE - 5) continue;
      c.fillStyle = r() > 0.88 ? "#7a3010" : r() > 0.5 ? "#2e1f11" : "#4c3523";
      c.fillRect(x, y, 1, 1);
    }
  },

  /** Старые доски из тёмного дерева: металлическая рамка по периметру и заклёпки (симметрично). */
  darkwood: (c, r) => {
    c.fillStyle = "#0b0602"; c.fillRect(0, 0, SIZE, SIZE);
    for (let b = 0; b < 4; b++) {
      const x0 = b * 16, tone = (r() - 0.5) * 22;
      for (let px = 0; px < 14; px++) {
        const g = (r() - 0.5) * 20;
        c.fillStyle = `rgb(${(58 + tone + g) | 0},${(34 + tone * 0.6 + g * 0.6) | 0},${(14 + tone * 0.3) | 0})`;
        c.fillRect(x0 + px, 0, 1, SIZE);
      }
      const kx = x0 + 3 + ((r() * 7) | 0), ky = 8 + ((r() * 46) | 0); // сучок
      c.fillStyle = "#45260e"; c.fillRect(kx, ky, 3, 5);
      c.fillStyle = "#1a0e05"; c.fillRect(kx + 1, ky + 1, 1, 3);
      for (let i = 0; i < 10; i++) { // царапины и трещины
        c.fillStyle = r() > 0.5 ? "#3e1f0c" : "#050200";
        c.fillRect(x0 + ((r() * 14) | 0), (r() * SIZE) | 0, 1, ((r() * 5) | 0) + 1);
      }
    }
    drawFrame(c, 5, "#44474d", "#16181b", "#8d9199", "#222428");
    // Заклёпки 2×2 по центру полосы рамки: позиции зеркальны относительно центра (p и SIZE-2-p).
    for (const p of [6, 20, 42, 56]) {
      for (const [x, y] of [[p, 2], [p, SIZE - 4], [2, p], [SIZE - 4, p]]) {
        c.fillStyle = "#2a2c30"; c.fillRect(x, y, 2, 2);
        c.fillStyle = "#b9bdc6"; c.fillRect(x, y, 1, 1);
      }
    }
  },

  /** Брезент, стянутый верёвками в сетку: верёвки каждые 16 px, узлы на каждом пересечении. */
  tarp: (c, r) => {
    noise(c, r, [62, 80, 48], 9);
    c.fillStyle = "rgba(0,0,0,0.07)"; // еле заметное плетение
    for (let y = 0; y < SIZE; y += 2) for (let x = (y / 2) % 2 ? 1 : 0; x < SIZE; x += 2) c.fillRect(x, y, 1, 1);
    c.fillStyle = "rgba(0,0,0,0.16)"; // мягкие складки
    for (let i = 0; i < 8; i++) { const sx = (r() * SIZE) | 0, sy = (r() * SIZE) | 0; c.fillRect(sx, sy, 12, 1); c.fillRect(sx + 1, sy + 1, 8, 1); }
    for (let i = 0; i < SIZE; i += 16) {
      c.fillStyle = "#a8975c"; c.fillRect(0, i, SIZE, 2); c.fillRect(i, 0, 2, SIZE);
      c.fillStyle = "#6f6238"; c.fillRect(0, i + 1, SIZE, 1); c.fillRect(i + 1, 0, 1, SIZE);
    }
    for (let i = 0; i < SIZE; i += 16)
      for (let j = 0; j < SIZE; j += 16)
        for (const ox of [0, SIZE]) for (const oy of [0, SIZE]) { // узлы; копии через край — для бесшовности
          c.fillStyle = "#7d6e3e"; c.fillRect(i - 1 + ox, j - 1 + oy, 4, 4);
          c.fillStyle = "#cdbd82"; c.fillRect(i - 1 + ox, j - 1 + oy, 2, 2);
        }
  },

  /** Маскировочная сетка болотных оттенков: пятна (бесшовно, через край) и ромбы диагональной сетки. */
  camo: (c, r) => {
    noise(c, r, [42, 58, 34], 12);
    const colors = ["#3a4a20", "#5a3a1a", "#2a3a15", "#1a2a0a", "#4a5a30", "#6a6a3a"];
    for (let i = 0; i < 46; i++) {
      const x = (r() * SIZE) | 0, y = (r() * SIZE) | 0, w = ((r() * 10) | 0) + 5, h = ((r() * 8) | 0) + 4;
      c.fillStyle = colors[(r() * colors.length) | 0];
      for (const ox of [0, -SIZE]) for (const oy of [0, -SIZE]) {
        c.fillRect(x + ox, y + oy, w, h);
        c.fillRect(x + ox + 2, y + oy - 2, w - 3, h);
      }
    }
    c.fillStyle = "rgba(8,16,4,0.42)";
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if ((x + y) % 8 === 0 || (x - y + SIZE) % 8 === 0) c.fillRect(x, y, 1, 1);
  },
};

/** Нужно для проверки и предпросмотра текстур вне игры. */
export const TEXTURE_DRAWERS = DRAW;

const cache = new WeakMap<Scene, Map<Kind, DynamicTexture>>();

/** Текстуры создаются один раз на сцену (NEAREST — без сглаживания, WRAP — тайлинг). */
function textures(scene: Scene) {
  let map = cache.get(scene);
  if (!map) {
    const fresh = new Map<Kind, DynamicTexture>();
    (Object.keys(DRAW) as Kind[]).forEach((kind, i) => {
      const tex = new DynamicTexture(`tex_${kind}`, { width: SIZE, height: SIZE }, scene, false, Texture.NEAREST_SAMPLINGMODE);
      DRAW[kind](tex.getContext() as unknown as Ctx, rng(1000 + i));
      // Тайлящиеся — WRAP; текстуры с рамкой (мапятся целиком на грань) — CLAMP, чтобы край не подмешивал противоположный.
      const mode = FIT_KINDS.has(kind) ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
      tex.wrapU = mode;
      tex.wrapV = mode;
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

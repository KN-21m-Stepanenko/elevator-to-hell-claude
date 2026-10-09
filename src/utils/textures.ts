import { Color3, DynamicTexture, Scene, StandardMaterial, Texture } from "@babylonjs/core";

// Добавлены новые типы: "vent" | "bamboo" | "darkwood" | "tarp" | "camo"
export type Kind = "concrete" | "floor" | "metal" | "crate" | "ceiling" | "brick" | "tile" | "vent" | "bamboo" | "darkwood" | "tarp" | "camo";
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

    // =========================================================
  // НОВЫЕ ТЕКСТУРЫ
  // =========================================================

    /** 1. Горизонтальные жалюзи вентиляции с непрерывной рамкой по краям */
  vent: (c, r) => {
    // Тёмное основание.
    c.fillStyle = "#111416";
    c.fillRect(0, 0, SIZE, SIZE);

    // Горизонтальные жалюзи. Не доходят до краёв текстуры.
    for (let y = 5; y < SIZE - 5; y += 8) {
      c.fillStyle = "#2a3035";
      c.fillRect(3, y + 6, SIZE - 6, 2);

      c.fillStyle = "#5a6570";
      c.fillRect(3, y, SIZE - 6, 5);

      c.fillStyle = "#8a95a0";
      c.fillRect(3, y, SIZE - 6, 1);

      c.fillStyle = "#20272d";
      c.fillRect(3, y + 4, SIZE - 6, 1);

      // Небольшие царапины на металле.
      if (r() > 0.5) {
        c.fillStyle = "#414b54";
        const x = 5 + ((r() * (SIZE - 15)) | 0);
        c.fillRect(x, y + 2, 2 + ((r() * 5) | 0), 1);
      }
    }

    // Центральная вертикальная разделительная полоса.
    c.fillStyle = "#171c21";
    c.fillRect(SIZE / 2 - 2, 3, 4, SIZE - 6);

    c.fillStyle = "#69747d";
    c.fillRect(SIZE / 2 - 2, 3, 1, SIZE - 6);

    c.fillStyle = "#080a0c";
    c.fillRect(SIZE / 2 + 1, 3, 1, SIZE - 6);

    // Тонкая окантовка по периметру — рисуется последней.
    c.fillStyle = "#252a30";
    c.fillRect(0, 0, SIZE, 3);
    c.fillRect(0, SIZE - 3, SIZE, 3);
    c.fillRect(0, 0, 3, SIZE);
    c.fillRect(SIZE - 3, 0, 3, SIZE);

    // Едва заметный металлический блик.
    c.fillStyle = "#4a5560";
    c.fillRect(0, 0, SIZE, 1);
    c.fillRect(0, 0, 1, SIZE);
  },

  /** 2. Бамбуковый щит с тёмной окантовкой по периметру */
  bamboo: (c, r) => {
    // Основа.
    c.fillStyle = "#1b1008";
    c.fillRect(0, 0, SIZE, SIZE);

    // Поверхность щита.
    noise(c, r, [165, 140, 70], 18);

    // Стебли бамбука внутри периметра.
    for (let x = 3; x < SIZE - 3; x += 8) {
      const width = Math.min(7, SIZE - 3 - x);
      const shade = (r() - 0.5) * 28;

      const red = Math.max(0, Math.min(255, 165 + shade)) | 0;
      const green = Math.max(0, Math.min(255, 132 + shade * 0.7)) | 0;
      const blue = Math.max(0, Math.min(255, 61 + shade * 0.3)) | 0;

      c.fillStyle = `rgb(${red},${green},${blue})`;
      c.fillRect(x, 3, width, SIZE - 6);

      // Тень и блик по краям стебля.
      c.fillStyle = "#59401d";
      c.fillRect(x, 3, 1, SIZE - 6);

      if (width > 3) {
        c.fillStyle = "#c4a65c";
        c.fillRect(x + 1, 3, 1, SIZE - 6);
      }

      // Узлы бамбука.
      for (let y = 16; y < SIZE - 3; y += 16) {
        c.fillStyle = "#4d3719";
        c.fillRect(x, y, width, 2);

        c.fillStyle = "#b49a54";
        c.fillRect(x, y, width, 1);
      }
    }

    // Тонкая обожжённая окантовка по периметру.
    c.fillStyle = "#29170b";
    c.fillRect(0, 0, SIZE, 3);
    c.fillRect(0, SIZE - 3, SIZE, 3);
    c.fillRect(0, 0, 3, SIZE);
    c.fillRect(SIZE - 3, 0, 3, SIZE);

    // Тонкий обожжённый блик внутреннего края.
    c.fillStyle = "#633719";
    c.fillRect(3, 3, SIZE - 6, 1);
    c.fillRect(3, 3, 1, SIZE - 6);

    // Почти чёрная внешняя кромка.
    c.fillStyle = "#0c0704";
    c.fillRect(0, 0, SIZE, 1);
    c.fillRect(0, 0, 1, SIZE);
    c.fillRect(0, SIZE - 1, SIZE, 1);
    c.fillRect(SIZE - 1, 0, 1, SIZE);
  },

  /** 3. Старые доски из тёмного дерева с металлической рамкой и заклёпками */
  darkwood: (c, r) => {
    // Тёмная основа.
    c.fillStyle = "#0f0802";
    c.fillRect(0, 0, SIZE, SIZE);

    // Вертикальные доски внутри будущей рамки.
    for (let x = 3; x < SIZE - 3; x += 14) {
      const width = Math.min(13, SIZE - 3 - x);

      const shade = (r() - 0.5) * 24;
      const red = Math.max(0, Math.min(255, 52 + shade)) | 0;
      const green = Math.max(0, Math.min(255, 28 + shade * 0.55)) | 0;
      const blue = Math.max(0, Math.min(255, 10 + shade * 0.25)) | 0;

      c.fillStyle = `rgb(${red},${green},${blue})`;
      c.fillRect(x, 3, width, SIZE - 6);

      // Шов между досками.
      c.fillStyle = "#100905";
      c.fillRect(x, 3, 1, SIZE - 6);

      // Вертикальные волокна и царапины.
      for (let i = 0; i < 10; i++) {
        const gx = x + 2 + ((r() * Math.max(1, width - 3)) | 0);
        const gy = 5 + ((r() * (SIZE - 12)) | 0);
        const h = 2 + ((r() * 7) | 0);

        c.fillStyle = r() > 0.5 ? "#35200f" : "#050200";
        c.fillRect(gx, gy, 1, Math.min(h, SIZE - 3 - gy));
      }

      // Тонкие светлые прожилки.
      if (width > 5) {
        c.fillStyle = "#392313";
        const gx = x + 2 + ((r() * (width - 4)) | 0);
        const gy = 5 + ((r() * (SIZE - 12)) | 0);
        c.fillRect(gx, gy, 1, 5);
      }
    }

    // Металлическая окантовка строго по четырём краям.
    c.fillStyle = "#3a3a3e";
    c.fillRect(0, 0, SIZE, 3);
    c.fillRect(0, SIZE - 3, SIZE, 3);
    c.fillRect(0, 0, 3, SIZE);
    c.fillRect(SIZE - 3, 0, 3, SIZE);

    // Блик сверху и слева.
    c.fillStyle = "#68686e";
    c.fillRect(0, 0, SIZE, 1);
    c.fillRect(0, 0, 1, SIZE);

    // Тёмный край снизу и справа.
    c.fillStyle = "#17171a";
    c.fillRect(0, SIZE - 1, SIZE, 1);
    c.fillRect(SIZE - 1, 0, 1, SIZE);

    // Заклёпки небольшие, расположены вдоль периметра.
    const rivets = [10, 25, 40, 55];

    for (const p of rivets) {
      // Левая и правая стороны.
      c.fillStyle = "#111216";
      c.fillRect(0, p, 3, 2);
      c.fillRect(SIZE - 3, p, 3, 2);

      c.fillStyle = "#8a8a90";
      c.fillRect(1, p, 1, 1);
      c.fillRect(SIZE - 2, p, 1, 1);

      // Верхняя и нижняя стороны.
      c.fillStyle = "#111216";
      c.fillRect(p, 0, 2, 3);
      c.fillRect(p, SIZE - 3, 2, 3);

      c.fillStyle = "#8a8a90";
      c.fillRect(p, 1, 1, 1);
      c.fillRect(p, SIZE - 2, 1, 1);
    }
  },

  /** 4. Брезентовое полотно, стянутое веревками в сетку (менее пестрое, светлые веревки) */
  tarp: (c, r) => {
    // Уменьшена амплитуда шума (10 вместо 22) для более гладкой, менее "пиксельной" поверхности
    noise(c, r, [45, 75, 40], 10);

    const step = 16;
    // Веревки (сетка) - значительно светлее
    for (let i = 0; i <= SIZE; i += step) {
      c.fillStyle = "#7e7745"; // Светлая оливковая/бежевая веревка
      c.fillRect(0, i, SIZE, 2);
      c.fillRect(i, 0, 2, SIZE);

      // Узел на пересечении
      c.fillStyle = "#7a865a"; // Тень узла
      c.fillRect(i, i, 3, 3);
      c.fillStyle = "#bdc89a"; // Яркий блик на узле
      c.fillRect(i, i, 1, 1);
    }

    // Складки на ткани (мягкие, не портят общую картину)
    c.fillStyle = "rgba(0, 0, 0, 0.15)";
    for (let i = 0; i < 8; i++) {
      const sx = (r() * SIZE) | 0;
      const sy = (r() * SIZE) | 0;
      c.fillRect(sx, sy, 12, 1);
      c.fillRect(sx + 1, sy + 1, 8, 1);
    }
  },

  /** 5. Маскировочная сетка болотных оттенков */
  camo: (c, r) => {
    noise(c, r, [40, 60, 30], 15);
    const colors = ["#3a4a20", "#5a3a1a", "#2a3a15", "#1a2a0a", "#4a5a30"];
    for (let i = 0; i < 50; i++) {
      const x = (r() * SIZE) | 0;
      const y = (r() * SIZE) | 0;
      const w = (r() * 8 + 4) | 0;
      const h = (r() * 8 + 4) | 0;
      c.fillStyle = colors[(r() * colors.length) | 0];
      c.fillRect(x, y, w, h);
      if (r() > 0.5) c.fillRect(x + 2, y - 2, w - 2, h);
      if (r() > 0.5) c.fillRect(x - 2, y + 2, w, h - 2);
    }
    c.fillStyle = "rgba(10, 20, 5, 0.4)";
    for (let i = 0; i < SIZE; i += 8) {
      c.fillRect(i, 0, 1, SIZE);
      c.fillRect(0, i, SIZE, 1);
    }
  }
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

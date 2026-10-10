import { Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector4, VertexBuffer } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Kind } from "../utils/textures";

export type Mats = Record<Kind, StandardMaterial>;

/** Параметры наложения текстуры: tile — метров на один повтор; local — рисунок начинается от угла бокса, а не от мирового нуля. */
export interface BoxOpts { tile?: number; local?: boolean }

/**
 * Бокс с коллизиями. UV считаются по реальным координатам вершин (1 повтор = tile метров),
 * поэтому текстура не растягивается. Ящики ("crate") мапятся целиком на каждую грань.
 */
export function addBox(
  scene: Scene, mats: Mats, kind: Kind, name: string,
  [w, h, d]: number[], [x, y, z]: number[], parent?: TransformNode, opts?: BoxOpts,
): Mesh {
  const t = opts?.tile ?? CONFIG.level.tile, fit = kind === "crate", local = !!opts?.local;
  const box = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  const pos = box.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = box.getVerticesData(VertexBuffer.NormalKind)!;
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const px = fit ? (pos[i] + w / 2) / w : local ? (pos[i] + w / 2) / t : (pos[i] + x) / t;
    const py = fit ? (pos[i + 1] + h / 2) / h : local ? (pos[i + 1] + h / 2) / t : (pos[i + 1] + y) / t;
    const pz = fit ? (pos[i + 2] + d / 2) / d : local ? (pos[i + 2] + d / 2) / t : (pos[i + 2] + z) / t;
    if (Math.abs(nor[i]) > 0.5) uv.push(pz, py);          // грани ±x
    else if (Math.abs(nor[i + 1]) > 0.5) uv.push(px, pz); // верх и низ
    else uv.push(px, py);                                  // грани ±z
  }
  box.setVerticesData(VertexBuffer.UVKind, uv);
  box.position.set(x, y, z);
  box.material = mats[kind];
  box.checkCollisions = true;
  if (parent) box.parent = parent;
  return box;
}

/** Цилиндр с коллизиями (резервуары, трубы, мачты); axis — направление оси лёжа. */
export function addCylinder(
  scene: Scene, mats: Mats, kind: Kind, name: string, diameter: number, height: number,
  [x, y, z]: number[], axis?: "x" | "z",
): Mesh {
  const t = CONFIG.level.tile;
  const side = new Vector4(0, 0, Math.max(1, Math.round((Math.PI * diameter) / t)), Math.max(1, height / t));
  const cap = new Vector4(0, 0, 1, 1);
  const c = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: 12, faceUV: [cap, side, cap] }, scene);
  c.position.set(x, y, z);
  if (axis === "z") c.rotation.x = Math.PI / 2;
  else if (axis === "x") c.rotation.z = Math.PI / 2;
  c.material = mats[kind];
  c.checkCollisions = true;
  return c;
}

/**
 * Заклёпки: один скрытый «мастер»-бокс и его копии-инстансы (одна отрисовка на весь набор).
 * Копии без коллизий, поэтому за них нельзя зацепиться.
 */
function rivetFactory(scene: Scene, mats: Mats, root: TransformNode, name: string) {
  const master = MeshBuilder.CreateBox(`${name}_rivet`, { size: 0.05 }, scene);
  master.material = mats.metal;
  master.parent = root;
  master.isVisible = false;
  master.isPickable = false;
  master.checkCollisions = false;
  let n = 0;
  return (px: number, py: number, pz: number) => {
    const r = master.createInstance(`${name}_rivet_${n++}`);
    r.parent = root;
    r.position.set(px, py, pz);
    r.isPickable = false;
  };
}

/** Равномерные позиции вдоль отрезка длиной len (по центру отрезка), шаг ≈ step. */
const spaced = (len: number, step = 0.42) => {
  const n = Math.max(2, Math.round(len / step));
  return Array.from({ length: n }, (_, i) => -len / 2 + (len * (i + 0.5)) / n);
};

export interface PanelOpts {
  frame: Kind;          // материал рамы: "metal" или "burnt"
  frameWidth?: number;  // ширина рамы, м (по умолчанию 0.09)
  tile?: number;        // метров на один повтор текстуры полотна (по умолчанию 1)
  divider?: boolean;    // вертикальная перегородка посередине (вентиляция)
  rivets?: boolean;     // заклёпки на раме
  rotY?: number;        // поворот щита вокруг вертикали, рад
}

/**
 * Плоский щит в раме. Рама, перегородка и заклёпки — геометрия модели (отдельные боксы), а не рисунок на текстуре,
 * поэтому окантовка идёт строго по периметру щита любого размера. Полотно утоплено, рама выступает над ним.
 * size = [ширина, высота, толщина]; щит стоит в плоскости XY, лицевые стороны смотрят по ±z; pos — центр.
 */
export function addPanel(
  scene: Scene, mats: Mats, kind: Kind, name: string,
  [w, h, d]: number[], [x, y, z]: number[], opts: PanelOpts, parent?: TransformNode,
): TransformNode {
  const fw = opts.frameWidth ?? 0.09, tile = opts.tile ?? 1;
  const root = new TransformNode(name, scene);
  root.position.set(x, y, z);
  root.rotation.y = opts.rotY ?? 0;
  if (parent) root.parent = parent;
  const part = (k: Kind, n: string, size: number[], p: number[], o?: BoxOpts) => addBox(scene, mats, k, `${name}_${n}`, size, p, root, o);

  // Полотно чуть заходит под раму, чтобы не было щелей.
  part(kind, "fill", [w - 2 * fw + 0.04, h - 2 * fw + 0.04, d * 0.55], [0, 0, 0], { tile, local: true });

  const sideH = h - 2 * fw, ox = w / 2 - fw / 2, oy = h / 2 - fw / 2;
  part(opts.frame, "top", [w, fw, d], [0, oy, 0]);
  part(opts.frame, "bottom", [w, fw, d], [0, -oy, 0]);
  part(opts.frame, "left", [fw, sideH, d], [-ox, 0, 0]);
  part(opts.frame, "right", [fw, sideH, d], [ox, 0, 0]);
  if (opts.divider) part(opts.frame, "divider", [fw * 0.8, sideH, d * 0.9], [0, 0, 0]);

  if (opts.rivets) {
    const rivet = rivetFactory(scene, mats, root, name);
    for (const face of [1, -1]) {
      const fz = face * (d / 2 + 0.01);
      spaced(w - 2 * fw).forEach((px) => { rivet(px, oy, fz); rivet(px, -oy, fz); });
      spaced(sideH).forEach((py) => { rivet(-ox, py, fz); rivet(ox, py, fz); });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) rivet(sx * ox, sy * oy, fz); // углы рамы
    }
  }
  return root;
}

export interface FrameOpts {
  frame: Kind;          // материал рамы
  frameWidth?: number;  // сечение рамы, м (по умолчанию 0.09, но не больше четверти меньшего размера)
  tile?: number;        // метров на один повтор текстуры стенок (по умолчанию 1)
  divider?: boolean;    // вертикальная перегородка посередине каждой боковой стенки
  rivets?: boolean;     // заклёпки на раме
}

/**
 * Бокс с рамой по рёбрам (12 брусьев) — для ящиков, стеллажей, вентиляционных коробов.
 * Рама, перегородки и заклёпки — геометрия модели, поэтому окантовка идёт строго по периметру
 * каждой грани, а текстура стенок остаётся чистой и бесшовной. Габариты модели равны size.
 */
export function addFramedBox(
  scene: Scene, mats: Mats, kind: Kind, name: string,
  [w, h, d]: number[], [x, y, z]: number[], opts: FrameOpts, parent?: TransformNode,
): TransformNode {
  const fw = Math.min(opts.frameWidth ?? 0.09, Math.min(w, h, d) / 4), rec = fw * 0.4, tile = opts.tile ?? 1;
  const root = new TransformNode(name, scene);
  root.position.set(x, y, z);
  if (parent) root.parent = parent;
  const part = (k: Kind, n: string, size: number[], p: number[], o?: BoxOpts) => addBox(scene, mats, k, `${name}_${n}`, size, p, root, o);

  // Стенки утоплены на rec, брусья рамы выступают над ними.
  part(kind, "core", [w - 2 * rec, h - 2 * rec, d - 2 * rec], [0, 0, 0], { tile, local: true });

  const ox = w / 2 - fw / 2, oy = h / 2 - fw / 2, oz = d / 2 - fw / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(opts.frame, `post${sx}${sz}`, [fw, h, fw], [sx * ox, 0, sz * oz]);
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) part(opts.frame, `railx${sy}${sz}`, [w - 2 * fw, fw, fw], [0, sy * oy, sz * oz]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) part(opts.frame, `railz${sx}${sy}`, [fw, fw, d - 2 * fw], [sx * ox, sy * oy, 0]);

  if (opts.divider) {
    for (const s of [-1, 1]) {
      part(opts.frame, `divz${s}`, [fw * 0.8, h - 2 * fw, rec], [0, 0, s * (d / 2 - rec / 2)]);
      part(opts.frame, `divx${s}`, [rec, h - 2 * fw, fw * 0.8], [s * (w / 2 - rec / 2), 0, 0]);
    }
  }

  if (opts.rivets) {
    const rivet = rivetFactory(scene, mats, root, name);
    const ys = spaced(h - 2 * fw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ys.forEach((py) => { // вертикальные брусья: обе внешние грани
      rivet(sx * (w / 2 + 0.01), py, sz * oz);
      rivet(sx * ox, py, sz * (d / 2 + 0.01));
    });
    for (const sy of [-1, 1]) {
      spaced(w - 2 * fw).forEach((px) => { rivet(px, sy * oy, d / 2 + 0.01); rivet(px, sy * oy, -d / 2 - 0.01); }); // верх/низ, лицо и тыл
      spaced(d - 2 * fw).forEach((pz) => { rivet(w / 2 + 0.01, sy * oy, pz); rivet(-w / 2 - 0.01, sy * oy, pz); }); // верх/низ, бока
    }
  }
  return root;
}

/** Стиль рамы по виду текстуры: любой бокс этих видов в уровне автоматически получает раму-модель. */
export const FRAME_STYLES: Partial<Record<Kind, FrameOpts>> = {
  vent: { frame: "metal", divider: true, tile: 0.8 }, // жалюзи, металлическая рама, перегородка посередине
  bamboo: { frame: "burnt" },                        // бамбуковый щит, обожжённая рама
  darkwood: { frame: "metal", rivets: true },        // старые доски, металлическая рама, заклёпки
};

/** Вентиляционная решётка (плоская): жалюзи, металлическая рама и вертикальная перегородка посередине. */
export const addVent = (scene: Scene, mats: Mats, name: string, size: number[], pos: number[], rotY = 0, parent?: TransformNode) =>
  addPanel(scene, mats, "vent", name, size, pos, { frame: "metal", divider: true, rotY, tile: 0.8 }, parent);

/** Бамбуковый щит (плоский) с обожжённой рамой по периметру. */
export const addBambooShield = (scene: Scene, mats: Mats, name: string, size: number[], pos: number[], rotY = 0, parent?: TransformNode) =>
  addPanel(scene, mats, "bamboo", name, size, pos, { frame: "burnt", rotY }, parent);

/** Щит (плоский) из старых тёмных досок в металлической раме с заклёпками. */
export const addPlankShield = (scene: Scene, mats: Mats, name: string, size: number[], pos: number[], rotY = 0, parent?: TransformNode) =>
  addPanel(scene, mats, "darkwood", name, size, pos, { frame: "metal", rivets: true, rotY }, parent);

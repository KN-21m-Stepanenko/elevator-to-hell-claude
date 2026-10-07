import { Color3, HemisphericLight, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { createCabin } from "../elevator/CabinShell";
import { Door } from "../elevator/Door";
import { createMaterials, Kind } from "../utils/textures";
import { addBox, addCylinder } from "./builders";
import { createSky } from "./Sky";
import { LavaShaft } from "./LavaShaft";

type B = {
  box: (k: Kind, n: string, s: number[], p: number[]) => void;
  cyl: (k: Kind, n: string, d: number, h: number, p: number[], axis?: "x" | "z") => void;
};
interface Lamp { pos: number[]; color: Color3; i: number; range: number }
interface Theme {
  wall: Kind; floor: Kind; ceil: Kind | null; tint: Color3; glow: Color3; H: number; lamps: Lamp[]; props: (b: B) => void;
}
const C = (r: number, g: number, b: number) => new Color3(r, g, b);
const CRATE = [1.2, 1.2, 1.2];

/**
 * Темы этажей. Правило для будущих этапов: полоса x∈[-1.5; 1.5] перед лифтом всегда свободна.
 * 0 — холл, 1 — склад, 2 — лаборатория, 3 — котельная, 4 — крыша (выше, без потолка).
 */
const THEMES: Record<number, Theme> = {
  0: {
    wall: "concrete", floor: "floor", ceil: "ceiling", tint: Color3.White(), glow: Color3.Black(), H: 4,
    lamps: [{ pos: [0, 3.5, -3], color: C(1, 0.7, 0.4), i: 0.9, range: 16 }, { pos: [0, 3.5, 5], color: C(1, 0.85, 0.7), i: 0.7, range: 12 }],
    props: (b) => {
      b.box("concrete", "pillar_a", [1, 4, 1], [-5, 2, -2]);
      b.box("concrete", "pillar_b", [1, 4, 1], [5, 2, -2]);
      b.box("crate", "crate_a", CRATE, [7.5, 0.6, -5.5]);
      b.box("crate", "crate_b", CRATE, [8.8, 0.6, -5.5]);
      b.box("crate", "crate_c", CRATE, [8.1, 1.8, -5.5]);
    },
  },
  1: {
    wall: "brick", floor: "floor", ceil: "ceiling", tint: C(1, 0.9, 0.75), glow: Color3.Black(), H: 4,
    lamps: [{ pos: [0, 3.5, -3], color: C(1, 0.82, 0.45), i: 0.9, range: 16 }, { pos: [0, 3.5, 5], color: C(1, 0.8, 0.5), i: 0.7, range: 12 }],
    props: (b) => {
      for (const z of [-5.5, -1.5, 2.5]) b.box("metal", "shelf", [0.7, 2.4, 2.4], [-9.4, 1.2, z]);
      b.box("crate", "cr1", CRATE, [8.6, 0.6, -5]); b.box("crate", "cr2", CRATE, [8.6, 0.6, -3.6]);
      b.box("crate", "cr3", CRATE, [8.6, 1.8, -4.3]); b.box("crate", "cr4", CRATE, [8.6, 0.6, 1]);
      b.box("crate", "cr5", CRATE, [7.2, 0.6, 1.4]);
      b.box("concrete", "pallet_a", [2, 0.3, 2], [-4, 0.15, -6]); b.box("crate", "cr6", CRATE, [-4, 0.9, -6]);
      b.box("concrete", "pallet_b", [2, 0.3, 2], [4, 0.15, -6]);
    },
  },
  2: {
    wall: "tile", floor: "tile", ceil: "ceiling", tint: C(0.82, 0.95, 1), glow: C(0.02, 0.03, 0.04), H: 4,
    lamps: [{ pos: [0, 3.5, -3], color: C(0.75, 0.95, 1), i: 1.0, range: 16 }, { pos: [0, 3.5, 5], color: C(0.8, 1, 1), i: 0.8, range: 12 }],
    props: (b) => {
      for (const [x, z] of [[-5, -4], [5, -4], [-5, 1.5], [5, 1.5]]) b.box("metal", "table", [3, 0.9, 1.1], [x, 0.45, z]);
      for (const z of [-6, -4.8, -3.6, -2.4]) b.box("metal", "locker", [0.6, 2, 1], [-9.5, 1, z]);
      b.cyl("tile", "tank", 1.2, 2.4, [8.6, 1.2, 5.5]);
    },
  },
  3: {
    wall: "metal", floor: "metal", ceil: "metal", tint: C(1, 0.74, 0.62), glow: Color3.Black(), H: 4,
    lamps: [{ pos: [0, 3.5, -3], color: C(1, 0.45, 0.22), i: 1.0, range: 16 }, { pos: [0, 3.5, 5], color: C(1, 0.4, 0.2), i: 0.8, range: 12 }],
    props: (b) => {
      for (const [x, z] of [[-6.5, -3], [6.5, -3], [-6.5, 3.5]]) b.cyl("metal", "boiler", 2.6, 3.6, [x, 1.8, z]);
      for (const x of [-3.5, 3.5]) b.cyl("metal", "pipe", 0.4, 15.6, [x, 3.5, 0], "z");
      b.box("metal", "furnace", [2, 1.6, 3], [8.5, 0.8, -2]);
    },
  },
  4: {
    wall: "concrete", floor: "concrete", ceil: null, tint: C(0.75, 0.85, 1.1), glow: C(0.03, 0.04, 0.07), H: CONFIG.level.roofHeight,
    lamps: [{ pos: [0, 7, -2], color: C(0.6, 0.72, 1), i: 0.6, range: 30 }, { pos: [0, 3.5, 6], color: C(1, 0.85, 0.6), i: 0.6, range: 10 }],
    props: (b) => {
      b.cyl("metal", "mast", 0.3, 7, [-8.2, 3.5, -6.2]);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box("metal", "leg", [0.3, 1, 0.3], [7 + x, 0.5, -4 + z]);
      b.cyl("metal", "watertank", 3, 2.4, [7, 2.2, -4]);
      b.box("concrete", "vent_a", [1.6, 1, 1.6], [-7, 0.5, 5]);
      b.box("metal", "vent_b", [1.2, 1.8, 1.2], [-8, 0.9, 1]);
      b.box("crate", "cr_a", CRATE, [8.6, 0.6, 3]); b.box("crate", "cr_b", CRATE, [8.6, 0.6, 4.3]);
    },
  },
};

/** Комната этажа: холл и стена с проёмом лифта. Возвращает дверь шахты и все меши комнаты. */
function buildRoom(scene: Scene, floor: number) {
  const th = THEMES[floor];
  const mats = createMaterials(scene, th.tint, th.glow);
  const { halfX: hx, halfZ: hz, wallThickness: T } = CONFIG.level;
  const { doorWidth: dw, cabinHeight: dh, floorHeight } = CONFIG.elevator;
  const H = th.H, y0 = floor * floorHeight, outer = 2 * (hx + T);
  const meshes: Mesh[] = [];
  const box: B["box"] = (k, n, s, p) => { meshes.push(addBox(scene, mats, k, `${n}_${floor}`, s, [p[0], p[1] + y0, p[2]])); };
  const cyl: B["cyl"] = (k, n, d, h, p, axis) => { meshes.push(addCylinder(scene, mats, k, `${n}_${floor}`, d, h, [p[0], p[1] + y0, p[2]], axis)); };

  // Пол и потолок заходят под стены, чтобы не было щелей. У крыши потолка нет.
  box(th.floor, "floor", [outer, 0.3, 2 * hz + 2 * T], [0, -0.15, 0]);
  if (th.ceil) box(th.ceil, "ceiling", [outer, 0.3, 2 * hz + 2 * T], [0, H + 0.15, 0]);
  box(th.wall, "wall_s", [outer, H, T], [0, H / 2, -(hz + T / 2)]);
  box(th.wall, "wall_w", [T, H, 2 * hz], [-(hx + T / 2), H / 2, 0]);
  box(th.wall, "wall_e", [T, H, 2 * hz], [hx + T / 2, H / 2, 0]);

  // Север: стена с проёмом под двери лифта.
  const sideW = hx + T - dw / 2, sideX = dw / 2 + sideW / 2;
  box(th.wall, "wall_n_l", [sideW, H, T], [-sideX, H / 2, hz + T / 2]);
  box(th.wall, "wall_n_r", [sideW, H, T], [sideX, H / 2, hz + T / 2]);
  box(th.wall, "wall_n_top", [dw, H - dh, T], [0, dh + (H - dh) / 2, hz + T / 2]);

  th.props({ box, cyl });

  // Дверь шахты: открыта только когда кабина стоит на этом этаже.
  const door = new Door(scene, mats, `landing_${floor}`, [0, y0, hz - 0.04], dw, dh);
  door.setInstant(floor === CONFIG.elevator.startFloor);
  meshes.push(...door.meshes);
  return { door, meshes };
}

/** Весь уровень: комнаты этажей 0–4, кабина, свет, небо крыши. */
export function buildWorld(scene: Scene) {
  const baseMats = createMaterials(scene);
  const { halfZ: hz, wallThickness: T } = CONFIG.level;
  const { floorHeight, cabinSize } = CONFIG.elevator;
  const landing = new Map<number, Door>();

  for (const f of [0, 1, 2, 3, 4]) {
    const { door, meshes } = buildRoom(scene, f);
    landing.set(f, door);
    // Лампы этажа светят только на свой этаж: так у каждого материала не больше 4 источников.
    THEMES[f].lamps.forEach((l, i) => {
      const lamp = new PointLight(`lamp_${f}_${i}`, new Vector3(l.pos[0], l.pos[1] + f * floorHeight, l.pos[2]), scene);
      lamp.diffuse = l.color; lamp.intensity = l.i; lamp.range = l.range;
      lamp.includedOnlyMeshes = meshes;
    });
  }

  const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.4;
  hemi.groundColor = new Color3(0.05, 0.05, 0.07);

  // Красный маячок на мачте крыши.
  const beacon = MeshBuilder.CreateBox("beacon", { size: 0.4 }, scene);
  const bm = new StandardMaterial("beacon_mat", scene);
  bm.diffuseColor = Color3.Black(); bm.emissiveColor = new Color3(1, 0.1, 0.05);
  beacon.material = bm; beacon.isPickable = false;
  beacon.position.set(-8.2, 4 * floorHeight + 7.2, -6.2);

  createSky(scene);

  // Кабина стоит сразу за северной стеной: стенка (0.2) + половина кабины.
  const cabin = createCabin(scene, baseMats, new Vector3(0, 0, hz + T + 0.2 + cabinSize / 2));
  const lava = new LavaShaft(scene, cabin.root.position);
  return { mats: baseMats, cabin, landing, lava, spawn: new Vector3(0, 0, 0), spawnYaw: 0 };
}

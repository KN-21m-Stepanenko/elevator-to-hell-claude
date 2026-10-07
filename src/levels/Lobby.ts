import { Color3, HemisphericLight, PointLight, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { createCabin } from "../elevator/CabinShell";
import { createMaterials, Kind } from "../utils/textures";
import { addBox } from "./builders";

/** Комната 0 этажа: холл, стена с проёмом лифта, кабина за стеной. */
export function buildLobby(scene: Scene) {
  const mats = createMaterials(scene);
  const { halfX: hx, halfZ: hz, wallHeight: H, wallThickness: T } = CONFIG.level;
  const { doorWidth: dw, cabinHeight: dh, cabinSize } = CONFIG.elevator;
  const add = (k: Kind, n: string, s: number[], p: number[]) => addBox(scene, mats, k, n, s, p);
  const outer = 2 * (hx + T);

  // Пол и потолок заходят под стены, чтобы не было щелей.
  add("floor", "floor", [outer, 0.3, 2 * hz + 2 * T], [0, -0.15, 0]);
  add("ceiling", "ceiling", [outer, 0.3, 2 * hz + 2 * T], [0, H + 0.15, 0]);

  // Стены: юг, запад, восток.
  add("concrete", "wall_s", [outer, H, T], [0, H / 2, -(hz + T / 2)]);
  add("concrete", "wall_w", [T, H, 2 * hz], [-(hx + T / 2), H / 2, 0]);
  add("concrete", "wall_e", [T, H, 2 * hz], [hx + T / 2, H / 2, 0]);

  // Север: стена с проёмом под двери лифта.
  const sideW = hx + T - dw / 2;
  const sideX = dw / 2 + sideW / 2;
  add("concrete", "wall_n_l", [sideW, H, T], [-sideX, H / 2, hz + T / 2]);
  add("concrete", "wall_n_r", [sideW, H, T], [sideX, H / 2, hz + T / 2]);
  add("concrete", "wall_n_top", [dw, H - dh, T], [0, dh + (H - dh) / 2, hz + T / 2]);

  // Колонны и ящики для антуража и укрытий.
  add("concrete", "pillar_a", [1, H, 1], [-5, H / 2, -2]);
  add("concrete", "pillar_b", [1, H, 1], [5, H / 2, -2]);
  add("crate", "crate_a", [1.2, 1.2, 1.2], [7.5, 0.6, -5.5]);
  add("crate", "crate_b", [1.2, 1.2, 1.2], [8.8, 0.6, -5.5]);
  add("crate", "crate_c", [1.2, 1.2, 1.2], [8.1, 1.8, -5.5]);

  // Свет: тусклый общий + две лампы (вместе с лампой кабины — 4 источника).
  const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.35;
  hemi.groundColor = new Color3(0.05, 0.05, 0.07);
  const lampA = new PointLight("lamp_a", new Vector3(0, 3.5, -3), scene);
  lampA.diffuse = new Color3(1, 0.7, 0.4); lampA.intensity = 0.9; lampA.range = 16;
  const lampB = new PointLight("lamp_b", new Vector3(0, 3.5, 5), scene);
  lampB.diffuse = new Color3(1, 0.85, 0.7); lampB.intensity = 0.7; lampB.range = 12;

  // Кабина стоит сразу за северной стеной: стенка (0.2) + половина кабины.
  const cabin = createCabin(scene, mats, new Vector3(0, 0, hz + T + 0.2 + cabinSize / 2));

  return { mats, cabin, spawn: new Vector3(0, 0, 0), spawnYaw: 0 };
}

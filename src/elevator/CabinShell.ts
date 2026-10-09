import { Color3, PointLight, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { addBox, Mats } from "../levels/Builders";
import { Door } from "./Door";

/**
 * Каркас кабины 5×5 м: пол, потолок, три стены и передняя стенка с проёмом.
 * Всё привязано к корневому узлу, чтобы на этапе 2 двигать кабину целиком.
 * Начало координат узла — центр пола внутри кабины, передняя сторона — к -z.
 */
export function createCabin(scene: Scene, mats: Mats, pos: Vector3): { root: TransformNode; door: Door } {
  const { cabinSize: s, cabinHeight: h, doorWidth: dw } = CONFIG.elevator;
  const root = new TransformNode("cabin", scene);
  root.position.copyFrom(pos);

  const half = s / 2, wall = 0.2, full = s + 2 * wall;
  const part = (n: string, size: number[], p: number[]) => addBox(scene, mats, "metal", `cabin_${n}`, size, p, root);

  part("floor", [full, 0.2, full], [0, -0.1, 0]);
  part("ceiling", [full, 0.2, full], [0, h + 0.1, 0]);
  part("back", [full, h, wall], [0, h / 2, half + wall / 2]);
  part("left", [wall, h, full], [-(half + wall / 2), h / 2, 0]);
  part("right", [wall, h, full], [half + wall / 2, h / 2, 0]);
  const fw = half - dw / 2; // ширина боковых частей передней стенки
  part("front_l", [fw, h, wall], [-(dw / 2 + fw / 2), h / 2, -(half + wall / 2)]);
  part("front_r", [fw, h, wall], [dw / 2 + fw / 2, h / 2, -(half + wall / 2)]);

  // Дверь кабины — с внутренней стороны передней стенки; в начале открыта.
  const door = new Door(scene, mats, "cabin_door", [0, 0, -half + 0.04], dw, h, root);
  door.setInstant(true);

  const light = new PointLight("cabin_light", new Vector3(0, h - 0.4, 0), scene);
  light.parent = root;
  light.diffuse = new Color3(0.75, 0.85, 1);
  light.intensity = 0.8;
  light.range = 9;
  return { root, door };
}

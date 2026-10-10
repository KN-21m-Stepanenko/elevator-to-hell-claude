import { Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector4, VertexBuffer } from "@babylonjs/core";
import { CONFIG } from "../config";
import { FIT_KINDS, type Kind } from "../utils/textures";

export type Mats = Record<Kind, StandardMaterial>;

/**
 * Бокс с коллизиями. UV считаются по реальным координатам вершин (1 повтор = tile метров),
 * поэтому текстура не растягивается. Виды из FIT_KINDS (ящики, щиты с рамкой на текстуре) мапятся целиком на каждую грань.
 */
export function addBox(
  scene: Scene, mats: Mats, kind: Kind, name: string,
  [w, h, d]: number[], [x, y, z]: number[], parent?: TransformNode,
): Mesh {
  const t = CONFIG.level.tile, fit = FIT_KINDS.has(kind);
  const box = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  const pos = box.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = box.getVerticesData(VertexBuffer.NormalKind)!;
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const px = fit ? (pos[i] + w / 2) / w : (pos[i] + x) / t;
    const py = fit ? (pos[i + 1] + h / 2) / h : (pos[i + 1] + y) / t;
    const pz = fit ? (pos[i + 2] + d / 2) / d : (pos[i + 2] + z) / t;
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

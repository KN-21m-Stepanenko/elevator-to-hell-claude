import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

export type WeaponType =
  | "SHOTGUN"
  | "MACHINE_GUN"
  | "QUAD_SHOTGUN"
  | "ROCKET_LAUNCHER"
  | "RAILGUN";

export const WEAPON_LABELS: Record<WeaponType, string> = {
  SHOTGUN: "ДРОБОВИК",
  MACHINE_GUN: "КУЛЕМЕТ",
  QUAD_SHOTGUN: "КВАДРО-ШОТГАН",
  ROCKET_LAUNCHER: "РАКЕТНИЦЯ",
  RAILGUN: "РЕЛЬСОТРОН",
};

export interface WeaponVisual {
  root: TransformNode;
  muzzleZ: number;
}

function createMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive = Color3.Black(),
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = emissive;
  material.specularColor = Color3.Black();
  return material;
}

function box(
  scene: Scene,
  parent: TransformNode,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  color: Color3,
  emissive = Color3.Black(),
  firstPerson = false,
) {
  const mesh = MeshBuilder.CreateBox(
    name,
    {
      width: size[0],
      height: size[1],
      depth: size[2],
    },
    scene,
  );

  mesh.parent = parent;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.material = createMaterial(scene, `${name}_mat`, color, emissive);
  mesh.isPickable = false;
  mesh.renderingGroupId = firstPerson ? 1 : 0;

  return mesh;
}

function cylinder(
  scene: Scene,
  parent: TransformNode,
  name: string,
  diameter: number,
  height: number,
  position: [number, number, number],
  color: Color3,
  firstPerson = false,
) {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    {
      diameter,
      height,
      tessellation: 8,
    },
    scene,
  );

  mesh.parent = parent;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.x = Math.PI / 2;
  mesh.material = createMaterial(scene, `${name}_mat`, color);
  mesh.isPickable = false;
  mesh.renderingGroupId = firstPerson ? 1 : 0;

  return mesh;
}

/** Создаёт low-poly модель оружия. Ствол всегда направлен по +Z. */
export function buildWeaponVisual(
  scene: Scene,
  type: WeaponType,
  firstPerson = false,
): WeaponVisual {
  const root = new TransformNode(`weapon_model_${type.toLowerCase()}`, scene);

  const steel = new Color3(0.18, 0.20, 0.23);
  const darkSteel = new Color3(0.07, 0.08, 0.10);
  const black = new Color3(0.025, 0.025, 0.03);
  const brown = new Color3(0.30, 0.16, 0.07);
  const orange = new Color3(0.8, 0.22, 0.03);
  const red = new Color3(0.8, 0.04, 0.02);
  const blue = new Color3(0.05, 0.28, 0.70);
  const cyan = new Color3(0.05, 0.7, 0.95);

  if (firstPerson) {
    root.scaling.setAll(0.58);
  } else {
    root.scaling.setAll(0.92);
  }

  switch (type) {
    case "SHOTGUN": {
      box(scene, root, "shotgun_body", [0.18, 0.20, 0.50], [0, -0.02, 0], steel, Color3.Black(), firstPerson);
      box(scene, root, "shotgun_barrel", [0.07, 0.07, 1.00], [0, 0.04, 0.68], darkSteel, Color3.Black(), firstPerson);
      box(scene, root, "shotgun_pump", [0.13, 0.10, 0.28], [0, -0.08, 0.52], brown, Color3.Black(), firstPerson);
      box(scene, root, "shotgun_stock", [0.10, 0.16, 0.36], [0, -0.09, -0.38], brown, Color3.Black(), firstPerson);
      return { root, muzzleZ: 1.18 };
    }

    case "MACHINE_GUN": {
      box(scene, root, "mg_receiver", [0.18, 0.22, 0.52], [0, 0, 0], darkSteel, Color3.Black(), firstPerson);
      box(scene, root, "mg_barrel", [0.07, 0.07, 1.15], [0, 0.04, 0.76], steel, Color3.Black(), firstPerson);
      box(scene, root, "mg_handguard", [0.12, 0.12, 0.50], [0, -0.02, 0.46], black, Color3.Black(), firstPerson);
      box(scene, root, "mg_magazine", [0.15, 0.30, 0.22], [0, -0.23, 0.04], steel, Color3.Black(), firstPerson);
      box(scene, root, "mg_stock", [0.10, 0.17, 0.35], [0, -0.08, -0.38], brown, Color3.Black(), firstPerson);
      box(scene, root, "mg_sight", [0.05, 0.09, 0.13], [0, 0.15, 0.10], steel, Color3.Black(), firstPerson);
      return { root, muzzleZ: 1.35 };
    }

    case "QUAD_SHOTGUN": {
        // Центральный корпус.
        box(
            scene,
            root,
            "quad_receiver",
            [0.42, 0.28, 0.48],
            [0, -0.01, -0.05],
            steel,
            Color3.Black(),
            firstPerson,
        );

        // Четыре ствола квадратом 2x2.
        const barrelOffset = 0.105;

        const barrelPositions: [number, number][] = [
            [-barrelOffset, barrelOffset],
            [barrelOffset, barrelOffset],
            [-barrelOffset, -barrelOffset],
            [barrelOffset, -barrelOffset],
        ];

        barrelPositions.forEach(([x, y], index) => {
            box(
            scene,
            root,
            `quad_barrel_${index}`,
            [0.08, 0.08, 1.00],
            [x, y, 0.68],
            darkSteel,
            Color3.Black(),
            firstPerson,
            );
        });

        // Передняя перемычка стволов.
        box(
            scene,
            root,
            "quad_muzzle_block",
            [0.30, 0.30, 0.12],
            [0, 0, 1.18],
            steel,
            Color3.Black(),
            firstPerson,
        );

        // Деревянное цевьё.
        box(
            scene,
            root,
            "quad_foregrip",
            [0.30, 0.22, 0.38],
            [0, -0.12, 0.45],
            brown,
            Color3.Black(),
            firstPerson,
        );

        // Рукоять.
        box(
            scene,
            root,
            "quad_grip",
            [0.15, 0.35, 0.16],
            [0, -0.31, -0.06],
            brown,
            Color3.Black(),
            firstPerson,
        );

        // Приклад.
        box(
            scene,
            root,
            "quad_stock",
            [0.18, 0.20, 0.38],
            [0, -0.10, -0.42],
            brown,
            Color3.Black(),
            firstPerson,
        );

        return {
            root,
            muzzleZ: 1.24,
        };
    }

    case "ROCKET_LAUNCHER": {
      cylinder(scene, root, "rocket_tube", 0.32, 1.55, [0, 0.03, 0.32], steel, firstPerson);
      box(scene, root, "rocket_grip", [0.13, 0.42, 0.13], [0, -0.28, 0.02], brown, Color3.Black(), firstPerson);
      box(scene, root, "rocket_rear", [0.38, 0.32, 0.16], [0, 0.03, -0.48], darkSteel, Color3.Black(), firstPerson);
      box(scene, root, "rocket_sight", [0.08, 0.12, 0.15], [0, 0.23, 0.14], red, red.scale(0.2), firstPerson);

      return { root, muzzleZ: 1.15 };
    }

    case "RAILGUN": {
      box(scene, root, "rail_body", [0.24, 0.28, 0.82], [0, 0, 0], darkSteel, Color3.Black(), firstPerson);

      box(scene, root, "rail_top", [0.10, 0.10, 1.45], [0, 0.10, 0.58], cyan, cyan.scale(0.35), firstPerson);
      box(scene, root, "rail_bottom", [0.10, 0.10, 1.45], [0, -0.10, 0.58], blue, blue.scale(0.25), firstPerson);

      box(scene, root, "rail_grip", [0.14, 0.38, 0.14], [0, -0.30, -0.04], brown, Color3.Black(), firstPerson);

      box(scene, root, "rail_coil_1", [0.36, 0.12, 0.16], [0, 0, 0.20], cyan, cyan.scale(0.4), firstPerson);
      box(scene, root, "rail_coil_2", [0.36, 0.12, 0.16], [0, 0, 0.42], cyan, cyan.scale(0.4), firstPerson);
      box(scene, root, "rail_coil_3", [0.36, 0.12, 0.16], [0, 0, 0.64], cyan, cyan.scale(0.4), firstPerson);

      return { root, muzzleZ: 1.38 };
    }
  }
}
import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import {
  buildWeaponVisual,
  WeaponType,
} from "./WeaponModels";

/** Оружие, лежащее в определённой точке этажа. */
export class WeaponPickup {
  readonly type: WeaponType;
  readonly root: TransformNode;

  private readonly baseY: number;
  private readonly ring: Mesh;
  private time = Math.random() * Math.PI * 2;
  private consumed = false;
  constructorFloor!: number;

  constructor(
    private readonly scene: Scene,
    type: WeaponType,
    position: Vector3,
    readonly floor: number,
  ) {
    this.type = type;

    const visual = buildWeaponVisual(scene, type, false);
    this.root = visual.root;

    this.root.position.copyFrom(position);
    this.root.rotation.y = Math.random() * Math.PI * 2;

    this.baseY = position.y;

    this.root.metadata = {
      weaponPickup: this.type,
    };

    const ringMaterial = new StandardMaterial(
      `pickup_${type}_ring_mat`,
      scene,
    );

    ringMaterial.diffuseColor = Color3.Black();
    ringMaterial.emissiveColor = new Color3(0.05, 0.55, 0.9);

    this.ring = MeshBuilder.CreateTorus(
      `pickup_${type}_ring`,
      {
        diameter: 1.0,
        thickness: 0.035,
        tessellation: 8,
      },
      scene,
    );

    this.ring.parent = this.root;
    this.ring.position.y = -0.36;
    this.ring.material = ringMaterial;
    this.ring.isPickable = false;
  }

  get alive() {
    return !this.consumed;
  }

  update(dt: number) {
    if (this.consumed) return;

    this.time += dt;

    this.root.rotation.y += dt * 0.8;
    this.root.position.y =
      this.baseY + Math.sin(this.time * 2.5) * 0.08;

    const pulse = 0.9 + Math.sin(this.time * 3.5) * 0.1;
    this.ring.scaling.setAll(pulse);
  }

    distanceTo(position: Vector3) {
        // Оружие другого этажа никогда не считается доступным.
        if (
            Math.abs(
            this.root.getAbsolutePosition().y -
            position.y,
            ) > 2.0
        ) {
            return Number.POSITIVE_INFINITY;
        }

        return Math.hypot(
            this.root.getAbsolutePosition().x -
            position.x,

            this.root.getAbsolutePosition().z -
            position.z,
        );
    }

  consume() {
    if (this.consumed) return;

    this.consumed = true;
    this.root.setEnabled(false);
  }
}
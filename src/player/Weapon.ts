import {
  AbstractMesh,
  Color3,
  MeshBuilder,
  Ray,
  Scene,
  Matrix,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Monster } from "../monsters/Monster";
import type { Player } from "./Player";

import {
  buildWeaponVisual,
  WeaponType,
  WEAPON_LABELS,
} from "./WeaponModels";

import { WeaponPickup } from "./WeaponPickup";

type DamageTarget = Npc | Monster;

// Дополнительный допуск только для расчёта попадания рельсотрона.
// Геометрия/хитбокс монстров при этом не изменяется.
const RAILGUN_CALCULATION_RADIUS = 0.05;

interface RocketProjectile {
  root: TransformNode;
  position: Vector3;
  velocity: Vector3;
  age: number;
  trail: ReturnType<typeof MeshBuilder.CreateLines>;
}

interface ExplosionFx {
  mesh: ReturnType<typeof MeshBuilder.CreateSphere>;
  material: StandardMaterial;
  life: number;
}

interface RailTrail {
  mesh: ReturnType<typeof MeshBuilder.CreateLines>;
  life: number;
  duration: number;
}

/**
 * Универсальное оружие игрока.
 *
 * По умолчанию — дробовик.
 * Подобранное оружие заменяет текущее.
 *
 * 1 этаж — пулемёт
 * 2 этаж — квадро-шотган
 * 3 этаж — ракетница
 * 4 этаж — рельсотрон
 */
export class Weapon {
  drawn = false;

  private activeType: WeaponType = "SHOTGUN";

  private root!: TransformNode;
  private flash!: ReturnType<typeof MeshBuilder.CreateSphere>;

  private pose = 0;
  private cooldown = 0;
  private kick = 0;
  private flashT = 0;
  private muzzleZ = 1.0;

  private readonly pickups: WeaponPickup[] = [];
  private readonly rockets: RocketProjectile[] = [];
  private readonly explosions: ExplosionFx[] = [];
  private readonly railTrails: RailTrail[] = [];

  onPickup: (type: WeaponType) => void = () => {};

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
  ) {
    scene.setRenderingAutoClearDepthStencil(1, true);

    const pickupDefs = Object.entries(CONFIG.weapon.pickups) as Array<[
      string,
      {
        type: WeaponType;
        position: [number, number];
        height: number;
      },
    ]>;

    for (const [floor, definition] of pickupDefs) {
      const y =
        Number(floor) * CONFIG.elevator.floorHeight + definition.height;

      this.pickups.push(
        new WeaponPickup(
          scene,
          definition.type,
          new Vector3(
            definition.position[0],
            y,
            definition.position[1],
          ),
          Number(floor)
        ),
      );
    }

    this.rebuildHeldModel();
  }

  get currentType() {
    return this.activeType;
  }

  get currentName() {
    return WEAPON_LABELS[this.activeType];
  }

  getPickupHint(): string | null {
    if (!this.player.alive) return null;

    const playerPosition = this.player.getWorldPosition();

    const pickup = this.findNearestPickup(playerPosition);

    if (!pickup) return null;

    return `E — взяти: ${WEAPON_LABELS[pickup.type]}`;
  }

  /**
   * Пытается подобрать ближайшее оружие.
   * true означает, что взаимодействие было использовано pickup'ом.
   */
  interact() {
    if (!this.player.alive) return false;

    const pickup = this.findNearestPickup(
      this.player.getWorldPosition(),
    );

    if (!pickup) return false;

    this.activeType = pickup.type;
    pickup.consume();

    this.rebuildHeldModel();
    this.onPickup(this.activeType);

    return true;
  }

  toggle() {
    if (!this.player.alive) return;

    this.drawn = !this.drawn;
  }

  /** Принудительно убрать оружие при смерти/окончании игры. */
  hide() {
    this.drawn = false;
    this.pose = 0;
    this.flashT = 0;
    this.cooldown = 0;

    this.root.setEnabled(false);
    this.flash.setEnabled(false);

    for (const rocket of this.rockets) {
      rocket.root.dispose();
      rocket.trail.dispose();
    }

    this.rockets.length = 0;

    for (const trail of this.railTrails) {
      trail.mesh.dispose();
    }

    this.railTrails.length = 0;

    for (const explosion of this.explosions) {
      explosion.mesh.dispose();
      explosion.material.dispose();
    }

    this.explosions.length = 0;
  }

  fire() {
    if (
      !this.player.alive ||
      !this.drawn ||
      this.cooldown > 0 ||
      this.pose < 0.8
    ) {
      return;
    }

    switch (this.activeType) {
      case "SHOTGUN":
        this.fireShotgun();
        break;

      case "MACHINE_GUN":
        this.fireMachineGun();
        break;

      case "QUAD_SHOTGUN":
        this.fireQuadShotgun();
        break;

      case "ROCKET_LAUNCHER":
        this.fireRocketLauncher();
        break;

      case "RAILGUN":
        this.fireRailgun();
        break;
    }
  }

  update(dt: number) {
    for (const pickup of this.pickups) {
      pickup.update(dt);
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateRailgunGlow();
    this.kick = Math.max(0, this.kick - dt * 5);

    this.flashT -= dt;
    this.flash.setEnabled(this.flashT > 0);

    this.pose +=
      ((this.drawn ? 1 : 0) - this.pose) *
      Math.min(1, dt * 9);

    this.root.setEnabled(this.pose > 0.03);

    this.root.position.set(
      0.26,
      -0.25 - (1 - this.pose) * 0.5,
      0.55 - this.kick * 0.12,
    );

    this.root.rotation.set(
      -this.kick * 0.18 + (1 - this.pose) * 0.6,
      -0.05,
      0,
    );

    this.updateRockets(dt);
    this.updateExplosions(dt);
    this.updateRailTrails(dt);
  }

  private findNearestPickup(position: Vector3) {
    let nearest: WeaponPickup | null = null;
    let distance = CONFIG.weapon.pickupRange;

    const currentFloor = Math.round(
      position.y / CONFIG.elevator.floorHeight,
    );

    for (const pickup of this.pickups) {
      if (
        !pickup.alive ||
        pickup.floor !== currentFloor
      ) {
        continue;
      }

      const pickupPosition =
        pickup.root.getAbsolutePosition();

      const d = Vector3.Distance(
        pickupPosition,
        position,
      );

      if (d >= distance) {
        continue;
      }

      // Оружие должно находиться в поле зрения.
      if (!this.isPickupInView(pickupPosition)) {
        continue;
      }

      // Между игроком и оружием не должно быть стены/объекта.
      if (!this.hasPickupLineOfSight(pickupPosition)) {
        continue;
      }

      distance = d;
      nearest = pickup;
    }

    return nearest;
  }

  private isPickupInView(position: Vector3) {
    const camera = this.player.camera;

    const screen = Vector3.Project(
      position,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        this.scene.getEngine().getRenderWidth(),
        this.scene.getEngine().getRenderHeight(),
      ),
    );

    const width =
      this.scene.getEngine().getRenderWidth();

    const height =
      this.scene.getEngine().getRenderHeight();

    return (
      screen.z >= 0 &&
      screen.z <= 1 &&
      screen.x >= 0 &&
      screen.x <= width &&
      screen.y >= 0 &&
      screen.y <= height
    );
  }

  private hasPickupLineOfSight(
    position: Vector3,
  ) {
    const ray =
      this.player.getEyeRay(
        Vector3.Distance(
          this.player.getWorldPosition(),
          position,
        ),
      );

    const direction =
      position.subtract(ray.origin);

    const distance = direction.length();

    if (distance < 0.01) {
      return true;
    }

    const hit =
      this.scene.pickWithRay(
        new Ray(
          ray.origin,
          direction.normalize(),
          distance,
        ),
        (mesh) =>
          mesh.isVisible &&
          mesh.isEnabled() &&
          mesh.isPickable &&
          !mesh.metadata?.weaponPickup &&
          !mesh.metadata?.npc &&
          !mesh.metadata?.monster &&
          !mesh.metadata?.player,
      );

    return !hit?.hit;
  }

  private rebuildHeldModel() {
    this.root?.dispose();

    const visual = buildWeaponVisual(
      this.scene,
      this.activeType,
      true,
    );

    this.root = visual.root;
    this.root.parent = this.player.camera;

    this.flash = MeshBuilder.CreateSphere(
      `muzzle_flash_${this.activeType}`,
      {
        diameter: 0.18,
        segments: 6,
      },
      this.scene,
    );

    this.muzzleZ = visual.muzzleZ;

    this.flash.parent = this.root;
    this.flash.position.set(0, 0.02, visual.muzzleZ);

    const flashMaterial = new StandardMaterial(
      `muzzle_flash_${this.activeType}_mat`,
      this.scene,
    );

    flashMaterial.diffuseColor = new Color3(1, 0.62, 0.08);
    flashMaterial.emissiveColor = new Color3(1, 0.45, 0.05);

    this.flash.material = flashMaterial;
    this.flash.isPickable = false;
    this.flash.renderingGroupId = 1;
    this.flash.setEnabled(false);

    this.root.setEnabled(false);

    this.pose = 0;
  }

  private beginShot(
    cooldown: number,
    recoil: number,
  ) {
    this.cooldown = cooldown;
    this.kick = 1;
    this.flashT = 0.055;

    this.player.addPitch(-recoil);
  }

  private fireShotgun() {
    const W = CONFIG.weapon.shotgun;

    this.beginShot(W.cooldown, W.recoil);

    const base = this.player.getEyeRay(W.range);

    const right = Vector3.Cross(
      Vector3.Up(),
      base.direction,
    ).normalize();

    const up = Vector3.Cross(
      base.direction,
      right,
    );

    for (let i = 0; i < W.pellets; i++) {
      const dir = base.direction
        .add(
          right.scale(
            (Math.random() * 2 - 1) * W.spread,
          ),
        )
        .add(
          up.scale(
            (Math.random() * 2 - 1) * W.spread,
          ),
        )
        .normalize();

      const ray = new Ray(
        base.origin,
        dir,
        W.range,
      );

      const hit = this.scene.pickWithRay(
        ray,
        (mesh) =>
          mesh.isVisible &&
          mesh.isEnabled() &&
          mesh.isPickable,
      );

      this.damagePickedTarget(hit?.pickedMesh, W.damage);
    }
  }

  private fireMachineGun() {
    const W = CONFIG.weapon.machineGun;

    this.beginShot(W.cooldown, W.recoil);

    const base = this.player.getEyeRay(W.range);

    const right = Vector3.Cross(
      Vector3.Up(),
      base.direction,
    ).normalize();

    const up = Vector3.Cross(
      base.direction,
      right,
    );

    const dir = base.direction
      .add(
        right.scale(
          (Math.random() * 2 - 1) * W.spread,
        ),
      )
      .add(
        up.scale(
          (Math.random() * 2 - 1) * W.spread,
        ),
      )
      .normalize();

    const hit = this.scene.pickWithRay(
      new Ray(base.origin, dir, W.range),
      (mesh) =>
        mesh.isVisible &&
        mesh.isEnabled() &&
        mesh.isPickable,
    );

    this.damagePickedTarget(
      hit?.pickedMesh,
      W.damage,
    );
  }

  private fireQuadShotgun() {
    const W = CONFIG.weapon.quadShotgun;

    this.beginShot(
      W.cooldown,
      W.recoil,
    );

    const base = this.player.getEyeRay(
      W.range,
    );

    const right = Vector3.Cross(
      Vector3.Up(),
      base.direction,
    ).normalize();

    const up = Vector3.Cross(
      base.direction,
      right,
    );

    // Четыре одновременно летящих боевых заряда.
    for (let i = 0; i < W.pellets; i++) {
      const angle =
        (Math.PI * 2 * i) /
        W.pellets;

      const radial =
        Math.cos(angle) * 0.65;

      const vertical =
        Math.sin(angle) * 0.65;

      const dir = base.direction
        .add(
          right.scale(
            radial * W.spread,
          ),
        )
        .add(
          up.scale(
            vertical * W.spread,
          ),
        )
        .normalize();

      const hit =
        this.scene.pickWithRay(
          new Ray(
            base.origin,
            dir,
            W.range,
          ),
          (mesh) =>
            mesh.isVisible &&
            mesh.isEnabled() &&
            mesh.isPickable,
        );

      this.damagePickedTarget(
        hit?.pickedMesh,
        W.damage,
      );
    }
  }
  /**
   * Ракета — настоящий движущийся снаряд.
   * Она имеет скорость, небольшую гравитацию и сталкивается
   * с геометрией уровня.
   */
  private fireRocketLauncher() {
    const W = CONFIG.weapon.rocketLauncher;

    this.beginShot(W.cooldown, W.recoil);

    const aimRay = this.player.getEyeRay(80);
    const muzzlePosition = this.getMuzzleWorldPosition();
    const aimPoint = aimRay.origin.add(
      aimRay.direction.scale(80),
    );
    const launchDirection = aimPoint
      .subtract(muzzlePosition)
      .normalize();

    const root = new TransformNode(
      "rocket_projectile",
      this.scene,
    );

    const bodyMaterial = new StandardMaterial(
      `rocket_projectile_mat_${Date.now()}`,
      this.scene,
    );

    bodyMaterial.diffuseColor = new Color3(
      0.25,
      0.27,
      0.30,
    );

    bodyMaterial.emissiveColor = new Color3(
      0.06,
      0.01,
      0.005,
    );

    const body = MeshBuilder.CreateCylinder(
      "rocket_body",
      {
        diameter: 0.16,
        height: 0.60,
        tessellation: 8,
      },
      this.scene,
    );

    body.parent = root;
    body.rotation.x = Math.PI / 2;
    body.material = bodyMaterial;
    body.isPickable = false;

    const noseMaterial = new StandardMaterial(
      `rocket_nose_mat_${Date.now()}`,
      this.scene,
    );

    noseMaterial.diffuseColor = new Color3(
      0.75,
      0.12,
      0.02,
    );

    noseMaterial.emissiveColor = new Color3(
      0.40,
      0.025,
      0.005,
    );

    noseMaterial.specularColor = Color3.Black();

    const nose = MeshBuilder.CreateCylinder(
      "rocket_nose",
      {
        diameterTop: 0,
        diameterBottom: 0.17,
        height: 0.20,
        tessellation: 8,
      },
      this.scene,
    );

    nose.parent = root;
    nose.position.z = 0.40;
    nose.rotation.x = Math.PI / 2;
    nose.material = noseMaterial;
    nose.isPickable = false;

    const flameMaterial = new StandardMaterial(
      `rocket_flame_mat_${Date.now()}`,
      this.scene,
    );

    flameMaterial.diffuseColor = new Color3(
      1,
      0.20,
      0.01,
    );

    flameMaterial.emissiveColor = new Color3(
      1,
      0.08,
      0.005,
    );

    flameMaterial.specularColor = Color3.Black();

    const flame = MeshBuilder.CreateBox(
      "rocket_flame",
      {
        width: 0.11,
        height: 0.11,
        depth: 0.32,
      },
      this.scene,
    );

    flame.parent = root;
    flame.position.z = -0.42;
    flame.material = flameMaterial;
    flame.isPickable = false;

    const position = muzzlePosition.add(
      launchDirection.scale(0.85),
    );

    root.position.copyFrom(position);
    root.lookAt(position.add(launchDirection));

    const trail = MeshBuilder.CreateLines(
      `rocket_trail_${Date.now()}`,
      {
        points: [
          position,
          position.subtract(
            launchDirection.scale(
              this.getRocketTrailLength(),
            ),
          ),
        ],
      },
      this.scene,
    );

    trail.color = new Color3(
      1.0,
      0.16,
      0.015,
    );
    trail.alpha = 0.8;
    trail.isPickable = false;

    this.rockets.push({
      root,
      position,
      velocity: launchDirection.scale(
        W.projectileSpeed,
      ),
      age: 0,
      trail,
    });
  }

  private fireRailgun() {
    const W = CONFIG.weapon.railgun;

    this.beginShot(
      W.cooldown,
      W.recoil,
    );

    const base = this.player.getEyeRay(
      W.range,
    );

    const hits =
      this.scene.multiPickWithRay(
        new Ray(
          base.origin,
          base.direction,
          W.range,
        ),
        (mesh) =>
          mesh.isVisible &&
          mesh.isEnabled() &&
          mesh.isPickable,
      ) ?? [];

    hits.sort(
      (a, b) => a.distance - b.distance,
    );

    // Для визуального следа рельсотрона берём
    // первую твёрдую геометрию за пределами целей.
    let trailEnd = base.origin.add(
      base.direction.scale(W.range),
    );

    for (const hit of hits) {
      if (!hit.hit || !hit.pickedMesh) {
        continue;
      }

      const target = this.getTarget(
        hit.pickedMesh,
      );

      if (!target) {
        trailEnd =
          hit.pickedPoint ??
          trailEnd;
        break;
      }
    }

    this.createRailTrail(
      this.getMuzzleWorldPosition(),
      trailEnd,
    );

    const railTargets = this.findRailgunTargets(
      base.origin,
      base.direction,
      trailEnd,
      RAILGUN_CALCULATION_RADIUS,
    );

    let targetsHit = 0;

    for (const target of railTargets) {
      if (!target.alive) continue;

      target.damage(W.damage);
      targetsHit++;

      if (targetsHit >= W.maxTargets) {
        break;
      }
    }
  }

  /**
   * Расширяет только математическую область попадания рельсотрона.
   * Визуальный луч и реальные hitbox монстров не изменяются.
   */
  private findRailgunTargets(
    origin: Vector3,
    direction: Vector3,
    end: Vector3,
    extraRadius: number,
  ): DamageTarget[] {
    const maxDistance = Vector3.Distance(origin, end);
    const candidates = new Map<DamageTarget, number>();

    for (const mesh of this.scene.meshes) {
      const target = this.getTarget(mesh);

      if (!target || !target.alive || candidates.has(target)) {
        continue;
      }

      mesh.computeWorldMatrix(true);

      const sphere =
        mesh.getBoundingInfo().boundingSphere;
      const center = sphere.centerWorld;

      const toCenter = center.subtract(origin);
      const along = Vector3.Dot(
        toCenter,
        direction,
      );

      if (along < 0 || along > maxDistance) {
        continue;
      }

      const closest = origin.add(
        direction.scale(along),
      );

      const perpendicularDistance =
        Vector3.Distance(closest, center);

      // Не меняем bounding sphere. Просто добавляем математический допуск
      // вокруг центральной линии выстрела.
      if (
        perpendicularDistance >
        sphere.radiusWorld + extraRadius
      ) {
        continue;
      }

      candidates.set(target, along);
    }

    return [...candidates.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([target]) => target);
  }

  private updateRockets(dt: number) {
    const W = CONFIG.weapon.rocketLauncher;

    for (
      let i = this.rockets.length - 1;
      i >= 0;
      i--
    ) {
      const rocket =
        this.rockets[i];

      rocket.age += dt;

      if (
        rocket.age >
        W.maxFlightTime
      ) {
        this.explodeRocket(
          rocket.position,
        );
        rocket.root.dispose();
        rocket.trail.dispose();
        this.rockets.splice(i, 1);
        continue;
      }

      rocket.velocity.y +=
        W.projectileGravity * dt;

      const movement =
        rocket.velocity.scale(dt);

      const oldPosition =
        rocket.position.clone();

      const distance =
        movement.length();

      // Proximity fuse:
      // проверяем не только текущую точку ракеты,
      // а весь отрезок её движения за текущий кадр.
      const fuseRadius =
        this.getRocketFuseRadius();

      const proximityPoint =
        this.findRocketProximityPoint(
          oldPosition,
          oldPosition.add(movement),
          fuseRadius,
        );

      if (proximityPoint) {
        rocket.position.copyFrom(
          proximityPoint,
        );

        this.explodeRocket(
          rocket.position,
        );

        rocket.root.dispose();
        rocket.trail.dispose();
        this.rockets.splice(i, 1);
        continue;
      }

      if (distance > 0.001) {
        const direction =
          movement.normalize().clone();

        const hit =
          this.scene.pickWithRay(
            new Ray(
              rocket.position,
              direction,
              distance,
            ),
            (mesh) =>
              mesh.isVisible &&
              mesh.isEnabled() &&
              mesh.isPickable &&
              !mesh.metadata?.weaponPickup,
          );

        if (
          hit?.hit &&
          hit.pickedPoint
        ) {
          rocket.position.copyFrom(
            hit.pickedPoint,
          );

          this.explodeRocket(
            rocket.position,
            hit.pickedMesh,
          );

          rocket.root.dispose();
          rocket.trail.dispose();
          this.rockets.splice(i, 1);
          continue;
        }
      }

      rocket.position.addInPlace(
        movement,
      );

      rocket.root.position.copyFrom(
        rocket.position,
      );

      rocket.root.lookAt(
        rocket.position.add(
          rocket.velocity,
        ),
      );

      // Обновляем яркий огненный след за ракетой.
      const trailDirection =
        rocket.velocity.normalize();

      const trailEnd =
        rocket.position.subtract(
          trailDirection.scale(
            this.getRocketTrailLength(),
          ),
        );

      MeshBuilder.CreateLines(
        rocket.trail.name,
        {
          points: [
            rocket.position,
            trailEnd,
          ],
          instance: rocket.trail,
        },
        this.scene,
      );
    }
  }

  private getRocketFuseRadius() {
    const configured =
      (
        CONFIG.weapon.rocketLauncher as
          typeof CONFIG.weapon.rocketLauncher & {
            proximityFuseRadius?: number;
          }
      ).proximityFuseRadius;

    // Уменьшаем текущее эффективное значение на треть.
    return (configured ?? 1.8) * (1 / 3);
  }

  private getRocketTrailLength() {
    const configured =
      (
        CONFIG.weapon.rocketLauncher as
          typeof CONFIG.weapon.rocketLauncher & {
            trailLength?: number;
          }
      ).trailLength;

    return configured ?? 1.15;
  }

  /**
   * Возвращает ближайшую точку траектории ракеты
   * к любой живой цели в пределах радиуса proximity fuse.
   */
  private findRocketProximityPoint(
    start: Vector3,
    end: Vector3,
    radius: number,
  ) {
    const segment = end.subtract(start);
    const segmentLengthSquared =
      segment.lengthSquared();

    if (segmentLengthSquared < 0.000001) {
      return null;
    }

    let bestPoint: Vector3 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const checkedTargets = new Set<DamageTarget>();

    for (const mesh of this.scene.meshes) {
      const target = this.getTarget(mesh);

      if (
        !target ||
        !target.alive ||
        checkedTargets.has(target)
      ) {
        continue;
      }

      checkedTargets.add(target);

      // Проверяем не только центр существа, а bounding sphere каждой
      // части его модели. Поэтому попадание рядом с головой, крылом и т.п.
      // тоже вызывает proximity fuse.
      mesh.computeWorldMatrix(true);
      const sphere =
        mesh.getBoundingInfo().boundingSphere;
      const targetCenter =
        sphere.centerWorld;
      const targetRadius =
        sphere.radiusWorld;

      const toTarget =
        targetCenter.subtract(start);

      const t = Math.max(
        0,
        Math.min(
          1,
          Vector3.Dot(
            toTarget,
            segment,
          ) / segmentLengthSquared,
        ),
      );

      const closest = start.add(
        segment.scale(t),
      );

      const distance =
        Vector3.Distance(
          closest,
          targetCenter,
        );

      const hitRadius =
        radius + targetRadius;

      if (
        distance <= hitRadius &&
        distance < bestDistance
      ) {
        bestDistance = distance;

        // Взрыв происходит на траектории ракеты, а не
        // телепортируется внутрь центра модели.
        bestPoint = closest;
      }
    }

    return bestPoint;
  }

  private getMuzzleWorldPosition() {
    return Vector3.TransformCoordinates(
      new Vector3(0, 0.02, this.muzzleZ),
      this.root.getWorldMatrix(),
    );
  }

  private createRailTrail(
    from: Vector3,
    to: Vector3,
  ) {
    const W = CONFIG.weapon.railgun;

    const direction = to.subtract(from);
    const length = direction.length();

    if (length < 0.01) {
      return;
    }

    direction.normalize();

    let right = Vector3.Cross(
      direction,
      Vector3.Up(),
    );

    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Cross(
        direction,
        Vector3.Right(),
      );
    }

    right.normalize();

    const up = Vector3.Cross(
      right,
      direction,
    ).normalize();

    /*
    * Главное отличие:
    * число витков зависит от длины луча,
    * а не наоборот.
    */
    const pitch =
      W.trailPitch ?? 0.65;

    const turns = Math.max(
      1,
      length / pitch,
    );

    const segmentsPerTurn =
      W.trailSegmentsPerTurn ?? 8;

    const segments = Math.max(
      12,
      Math.ceil(
        turns * segmentsPerTurn,
      ),
    );

    const radius =
      W.trailRadius ?? 0.10;

    const points: Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;

      const distanceAlongBeam =
        length * t;

      // Фиксированный шаг спирали:
      // каждые pitch метров — полный оборот.
      const angle =
        (distanceAlongBeam / pitch) *
        Math.PI *
        2;

      /*
      * Небольшое затухание у начала и конца,
      * чтобы спираль красиво сходилась.
      */
      // const endFade =
      //   Math.sin(Math.PI * t);

      // const currentRadius =
      //   radius * endFade;
      const currentRadius = radius;

      const center =
        Vector3.Lerp(
          from,
          to,
          t,
        );

      points.push(
        center
          .add(
            right.scale(
              Math.cos(angle) *
                currentRadius,
            ),
          )
          .add(
            up.scale(
              Math.sin(angle) *
                currentRadius,
            ),
          ),
      );
    }

    const mesh =
      MeshBuilder.CreateLines(
        `railgun_trail_${Date.now()}`,
        {
          points,
        },
        this.scene,
      );

    mesh.color =
      new Color3(
        0.10,
        0.78,
        1.0,
      );

    mesh.alpha = 0.95;
    mesh.isPickable = false;

    this.railTrails.push({
      mesh,
      life: W.trailDuration ?? 0.28,
      duration: W.trailDuration ?? 0.28,
    });

    // Центральная линия.
    const core =
      MeshBuilder.CreateLines(
        `railgun_core_${Date.now()}`,
        {
          points: [from, to],
        },
        this.scene,
      );

    core.color =
      new Color3(
        0.78,
        0.96,
        1.0,
      );

    core.alpha = 1;
    core.isPickable = false;

    this.railTrails.push({
      mesh: core,
      life: 0.20,
      duration: 0.20,
    });
  }

  private updateRailgunGlow() {
    if (this.activeType !== "RAILGUN") {
      return;
    }

    const ready = this.cooldown <= 0;

    const glowColor = ready
      ? new Color3(0.05, 0.7, 0.95)   // готов
      : new Color3(1.0, 0.03, 0.02);   // перезарядка

    const glowPower = ready ? 0.55 : 0.45;

    for (const mesh of this.root.getChildMeshes()) {
      if (
        mesh.name.startsWith("rail_coil_")
      ) {
        const material = mesh.material;

        if (
          material instanceof StandardMaterial
        ) {
          material.emissiveColor =
            glowColor.scale(glowPower);
        }
      }
    }
  }

  private explodeRocket(
    position: Vector3,
    directHit?: AbstractMesh | null,
  ) {
    const W = CONFIG.weapon.rocketLauncher;

    const directTarget =
      this.getTarget(directHit);

      if (directTarget?.alive) {
        directTarget.damage(
          W.directDamage,
        );
      }

    const alreadyDamaged =
      new Set<DamageTarget>();

    if (directTarget) {
      alreadyDamaged.add(directTarget);
    }

    for (const mesh of this.scene.meshes) {
      const target = this.getTarget(mesh);

      if (
        !target ||
        !target.alive ||
        alreadyDamaged.has(target)
      ) {
        continue;
      }

      const d =
        Vector3.Distance(
          target.getWorldPosition(),
          position,
        );

      if (d > W.explosionRadius) {
        continue;
      }

      const factor =
        1 - d / W.explosionRadius;

      target.damage(
        Math.max(
          1,
          Math.round(
            W.splashDamage * factor,
          ),
        ),
      );

      alreadyDamaged.add(target);
    }

    this.createExplosionFx(position);
  }

  private createExplosionFx(position: Vector3) {
    const mesh = MeshBuilder.CreateSphere(
      "rocket_explosion",
      {
        diameter: 1,
        segments: 8,
      },
      this.scene,
    );

    const material = new StandardMaterial(
      "rocket_explosion_mat",
      this.scene,
    );

    material.diffuseColor = new Color3(
      1,
      0.16,
      0.02,
    );

    material.emissiveColor = new Color3(
      1,
      0.08,
      0.01,
    );

    material.specularColor = Color3.Black();

    mesh.material = material;
    mesh.isPickable = false;
    mesh.position.copyFrom(position);

    mesh.scaling.setAll(0.2);

    this.explosions.push({
      mesh,
      material,
      life: 0.28,
    });
  }

  private updateExplosions(dt: number) {
    for (
      let i = this.explosions.length - 1;
      i >= 0;
      i--
    ) {
      const explosion = this.explosions[i];

      explosion.life -= dt;

      const progress =
        1 -
        Math.max(
          0,
          explosion.life / 0.28,
        );

      const scale =
        0.2 + progress * 3.4;

      explosion.mesh.scaling.setAll(
        scale,
      );

      explosion.material.alpha =
        1 - progress;

      if (explosion.life <= 0) {
        explosion.mesh.dispose();
        explosion.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  private updateRailTrails(dt: number) {
    for (
      let i = this.railTrails.length - 1;
      i >= 0;
      i--
    ) {
      const trail =
        this.railTrails[i];

      trail.life -= dt;

      trail.mesh.alpha =
        Math.max(
          0,
          trail.life /
            trail.duration,
        );

      if (trail.life <= 0) {
        trail.mesh.dispose();
        this.railTrails.splice(i, 1);
      }
    }
  }

  private damagePickedTarget(
    mesh: AbstractMesh | null | undefined,
    damage: number,
  ) {
    const target = this.getTarget(mesh);

    if (target?.alive) {
      target.damage(damage);
    }
  }

  private getTarget(
    mesh: AbstractMesh | null | undefined,
  ): DamageTarget | null {
    if (!mesh?.metadata) {
      return null;
    }

    return (
      mesh.metadata.npc ??
      mesh.metadata.monster ??
      null
    );
  }

  private hasLineOfSight(
    from: Vector3,
    to: Vector3,
  ) {
    const delta = to.subtract(from);
    const distance = delta.length();

    if (distance < 0.01) {
      return true;
    }

    const ray = new Ray(
      from,
      delta.normalize(),
      distance,
    );

    const hit = this.scene.pickWithRay(
      ray,
      (mesh) =>
        mesh.isVisible &&
        mesh.isEnabled() &&
        mesh.isPickable &&
        !mesh.metadata?.npc &&
        !mesh.metadata?.monster &&
        !mesh.metadata?.weaponPickup,
    );

    return !hit?.hit;
  }

  fireHeld() {
    if (
      this.activeType === "MACHINE_GUN" ||
      this.activeType === "QUAD_SHOTGUN"
    ) {
      this.fire();
    }
  }
}
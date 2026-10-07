import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";

export type MonsterKind = "walker" | "flying";

export interface DamageTarget {
  alive: boolean;
  damage(amount: number): void;
  getWorldPosition(): Vector3;
}

/** Базовый класс противника: HP, попадание, смерть, труп и общие коллизии. */
export abstract class Monster {
  alive = true;
  protected hp: number;
  protected hitFlash = 0;
  protected readonly materials: StandardMaterial[] = [];
  readonly root: TransformNode;

  private deathStarted = false;
  private deathProgress = 0;
  private deathStartY = 0;
  private deathTargetY = 0;
  private readonly deathRotationDirection: number;
  private peerProvider: () => Monster[] = () => [];
  // Сторона обхода препятствия выбирается один раз для каждого монстра,
// чтобы он не метался влево-вправо при каждом кадре.
private readonly groundDetourSign: 1 | -1 = Math.random() < 0.5 ? 1 : -1;

  protected constructor(
    protected readonly scene: Scene,
    readonly kind: MonsterKind,
    position: Vector3,
    hp: number,
    deathTargetY = position.y,
  ) {
    this.hp = hp;
    this.root = new TransformNode(`${kind}_monster`, scene);
    this.root.position.copyFrom(position);
    this.deathStartY = position.y;
    this.deathTargetY = deathTargetY;
    this.deathRotationDirection = Math.random() < 0.5 ? 1 : -1;
  }

  setPeerProvider(provider: () => Monster[]) {
    this.peerProvider = provider;
  }

  damage(amount: number) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.12;
    if (this.hp <= 0) this.die();
  }

  protected die() {
    if (!this.alive) return;
    this.alive = false;
    this.deathStarted = true;
    this.deathProgress = 0;
    this.deathStartY = this.root.position.y;
    this.materials.forEach((m) => (m.emissiveColor = Color3.Black()));
    this.root.getChildMeshes().forEach((mesh) => (mesh.checkCollisions = false));
  }

  /** Длительность анимации смерти, с (потомки переопределяют). */
  protected get deathDuration() { return 0.35; }
  /** Поза суставов во время смерти; t — прогресс 0..1. */
  protected onDeathPose(_t: number) {}
  /** Доля заваливания тела (0..1) от прогресса; по умолчанию плавная. */
  protected toppleFraction(t: number) { return t * t * (3 - 2 * t); }

  protected updateCorpse(dt: number) {
    if (!this.deathStarted) return;
    this.deathProgress = Math.min(1, this.deathProgress + dt / this.deathDuration);
    const t = this.deathProgress;
    this.onDeathPose(t);
    const k = this.toppleFraction(t);
    this.root.position.y = this.deathStartY + (this.deathTargetY - this.deathStartY) * Math.min(1, k);
    this.root.rotation.x = this.deathRotationDirection * k * (Math.PI / 2);
  }

  get deathFinished() {
    return this.deathStarted && this.deathProgress >= 1;
  }

  protected createPart(
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    color: Color3,
    emissive = Color3.Black(),
    parent?: TransformNode,
  ): Mesh {
    const mat = new StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = emissive;
    mat.specularColor = Color3.Black();
    this.materials.push(mat);

    const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.parent = parent ?? this.root;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.material = mat;
    mesh.isPickable = true;
    mesh.checkCollisions = true;
    mesh.metadata = { monster: this };
    return mesh;
  }

  protected updateHitFlash(dt: number) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const on = this.hitFlash > 0;
    this.materials.forEach((m) => (m.emissiveColor = on ? new Color3(0.65, 0.03, 0.02) : Color3.Black()));
  }

  getWorldPosition() {
    return this.root.getAbsolutePosition().clone();
  }

  /** Проверяет статические коллайдеры сцены в горизонтальной плоскости. */
  protected canOccupyGround(position: Vector3, radius: number, height: number) {
    const minY = position.y + 0.05;
    const maxY = position.y + height;

    for (const mesh of this.scene.meshes) {
      if (!mesh.isEnabled() || !mesh.checkCollisions || mesh.metadata?.monster || mesh.metadata?.npc || mesh.metadata?.player) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      if (box.maximumWorld.y <= minY || box.minimumWorld.y >= maxY) continue;

      const nx = Math.max(box.minimumWorld.x, Math.min(position.x, box.maximumWorld.x));
      const nz = Math.max(box.minimumWorld.z, Math.min(position.z, box.maximumWorld.z));
      const dx = position.x - nx;
      const dz = position.z - nz;
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  }

  /** Двигает наземного монстра с обходом препятствий. */
protected moveGround(targetX: number, targetZ: number, radius: number, height: number) {
  const p = this.root.position;
  const current = p.clone();

  const direct = new Vector3(targetX, p.y, targetZ);

  // Прямой путь свободен — идём напрямую.
  if (this.canOccupyGround(direct, radius, height)) {
    p.x = targetX;
    p.z = targetZ;
    return;
  }

  const dx = targetX - p.x;
  const dz = targetZ - p.z;
  const len = Math.hypot(dx, dz);

  if (len < 0.001) return;

  const dirX = dx / len;
  const dirZ = dz / len;

  // Перпендикуляр к направлению движения.
  // Один и тот же знак сохраняется для конкретного монстра,
  // поэтому при столкновении он последовательно огибает объект с одной стороны.
  const sideX = -dirZ * this.groundDetourSign;
  const sideZ = dirX * this.groundDetourSign;

  const normalize = (x: number, z: number) => {
    const l = Math.hypot(x, z);
    return l < 0.001 ? null : [x / l, z / l] as const;
  };

  // Сначала пробуем мягкий диагональный обход,
  // затем более резкий, затем движение вдоль препятствия.
  const directions = [
    normalize(dirX + sideX * 0.9, dirZ + sideZ * 0.9),
    normalize(dirX + sideX * 1.8, dirZ + sideZ * 1.8),
    normalize(sideX, sideZ),

    // Если выбранная сторона упёрлась в тупик,
    // разрешаем попробовать противоположную.
    normalize(dirX - sideX * 0.9, dirZ - sideZ * 0.9),
    normalize(dirX - sideX * 1.8, dirZ - sideZ * 1.8),
  ];

  for (const direction of directions) {
    if (!direction) continue;

    const candidate = new Vector3(
      p.x + direction[0] * len,
      p.y,
      p.z + direction[1] * len,
    );

    if (!this.canOccupyGround(candidate, radius, height)) continue;

    p.x = candidate.x;
    p.z = candidate.z;
    return;
  }

  // Ничего безопасного не найдено — остаёмся на исходной позиции.
  p.copyFrom(current);
}

  /** Раздвигает наземных монстров/NPC/игрока, не позволяя им проходить друг через друга. */
  protected separateGround(
    radius: number,
    targets: Array<{ target: DamageTarget; radius: number }>,
    height: number,
  ) {
    let x = this.root.position.x;
    let z = this.root.position.z;

    const push = (other: Vector3, otherRadius: number) => {
      if (Math.abs(other.y - this.root.position.y) > height) return;
      const dx = x - other.x;
      const dz = z - other.z;
      const d2 = dx * dx + dz * dz;
      const minDist = radius + otherRadius;
      if (d2 >= minDist * minDist) return;
      if (d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      const pushDistance = minDist - d;
      const nx = dx / d;
      const nz = dz / d;
      const candidate = new Vector3(x + nx * pushDistance * 0.7, this.root.position.y, z + nz * pushDistance * 0.7);
      if (this.canOccupyGround(candidate, radius, height)) {
        x = candidate.x;
        z = candidate.z;
      }
    };

    for (const peer of this.peerProvider()) {
      if (peer === this || !peer.alive || peer.kind !== "walker") continue;
      push(peer.getWorldPosition(), CONFIG.monsters.walker.radius);
    }
    for (const target of targets) {
      if (!target.target.alive) continue;
      push(target.target.getWorldPosition(), target.radius);
    }

    this.root.position.x = x;
    this.root.position.z = z;
  }

  /** Проверяет свободное место для летающего монстра в 3D, не учитывая динамические сущности. */
  protected canOccupyAir(position: Vector3, radius: number) {
    const min = new Vector3(position.x - radius, position.y - radius, position.z - radius);
    const max = new Vector3(position.x + radius, position.y + radius, position.z + radius);

    for (const mesh of this.scene.meshes) {
      if (!mesh.isEnabled() || !mesh.checkCollisions || mesh.metadata?.monster || mesh.metadata?.npc || mesh.metadata?.player) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      if (max.x < box.minimumWorld.x || min.x > box.maximumWorld.x) continue;
      if (max.y < box.minimumWorld.y || min.y > box.maximumWorld.y) continue;
      if (max.z < box.minimumWorld.z || min.z > box.maximumWorld.z) continue;
      return false;
    }
    return true;
  }

  /** Перемещает воздушного монстра по сегменту маленькими шагами, чтобы он не пролетал сквозь тонкую стену. */
  protected moveAir(target: Vector3, radius: number, stepSize = 0.28) {
    const start = this.root.position.clone();
    const delta = target.subtract(start);
    const distance = delta.length();
    if (distance < 0.001) return true;

    const steps = Math.max(1, Math.ceil(distance / stepSize));
    let lastSafe = start.clone();
    for (let i = 1; i <= steps; i++) {
      const point = start.add(delta.scale(i / steps));
      if (!this.canOccupyAir(point, radius)) {
        this.root.position.copyFrom(lastSafe);
        return false;
      }
      lastSafe.copyFrom(point);
    }
    this.root.position.copyFrom(lastSafe);
    return true;
  }

  protected clampToRoom(position = this.root.position) {
    position.x = Math.max(-CONFIG.level.halfX + 0.8, Math.min(CONFIG.level.halfX - 0.8, position.x));
    position.z = Math.max(-CONFIG.level.halfZ + 0.8, Math.min(CONFIG.level.halfZ - 0.8, position.z));
  }

  abstract update(dt: number): void;
}

export function randomInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function randomFloat(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function horizontalDistance(a: Vector3, b: Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function clampToRoom(position: Vector3) {
  position.x = Math.max(-CONFIG.level.halfX + 0.8, Math.min(CONFIG.level.halfX - 0.8, position.x));
  position.z = Math.max(-CONFIG.level.halfZ + 0.8, Math.min(CONFIG.level.halfZ - 0.8, position.z));
}

import { Color3, Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { DamageTarget, horizontalDistance, Monster, randomFloat } from "./Monster";
import type { NavGrid, Point } from "./NavGrid";
import { isRobust, releaseThrow, ThrowRequest, Thrower } from "./GrenadeDirector";

export type WalkerState = "CHASE" | "ATTACK" | "DEAD";

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Суставы монстра: каждый — точка вращения (TransformNode), к ней прикреплены части тела. */
interface Rig {
  hips: TransformNode; spine: TransformNode; neck: TransformNode;
  thighL: TransformNode; thighR: TransformNode; kneeL: TransformNode; kneeR: TransformNode;
  armL: TransformNode; armR: TransformNode; elbowL: TransformNode; elbowR: TransformNode;
  grenade: Mesh; // граната в руке во время замаха
}

/**
 * Наземный монстр: преследует ближайшую живую цель, не проходит сквозь объекты и атакует с замахом.
 * Модель собрана из частей на суставах (как NPC, но детальнее): таз, ноги с коленями, корпус с бронёй
 * и рюкзаком, голова с рогами и светящимися глазами, руки с локтями и когтями.
 * Анимации: покой (дыхание, осмотр), ходьба (шаг, раскачка, подпрыгивание), атака, реакция на попадание, смерть.
 */
export class WalkerMonster extends Monster implements Thrower {
  state: WalkerState = "CHASE";
  private attackTimer = randomFloat(0.2, CONFIG.monsters.walker.attackCooldown);
  private attackProgress = -1;
  private attackHit = false;
  private attackSwing = 0; // 0..1 — насколько руки сейчас выброшены вперёд
  private moving = false;
  private walkBlend = 0;   // плавный переход покой ↔ ходьба
  private walkPhase = Math.random() * Math.PI * 2;
  private idleTime = Math.random() * 10;
  private flinch = 0;      // «вздрагивание» после попадания
  private readonly player: Player;
  private readonly npcs: Npc[];
  private readonly rig: Rig;
  private readonly nav: NavGrid;
  /** Текущая цель и место вокруг неё (раздаёт AttackSlots, чтобы монстры не сбивались в кучу). */
  currentTarget: DamageTarget | null = null;
  slot: Point | null = null;
  private throwReq: ThrowRequest | null = null;
  private throwT = -1;
  private throwReleased = false;
  private throwPoint: Point | null = null; // позиция броска на осевой линии этажа
  private throwWalkT = 0;
  private path: Point[] = [];   // обход препятствий: путь A* до цели
  private repath = 0;
  private goal: Point = { x: 1e9, z: 1e9 };
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(scene: Scene, position: Vector3, floor: number, player: Player, npcs: Npc[], color: Color3, nav: NavGrid) {
    // Лёжа тело опирается на спину/грудь, поэтому труп приподнят над полом.
    super(scene, "walker", position, CONFIG.monsters.walker.hp, position.y + 0.36);
    this.player = player;
    this.npcs = npcs;
    this.nav = nav;
    this.lastX = position.x;
    this.lastZ = position.z;
    this.rig = this.buildRig(color);
  }

  private buildRig(color: Color3): Rig {
    const steel = new Color3(0.26, 0.28, 0.31), dark = new Color3(0.11, 0.12, 0.14), bone = new Color3(0.72, 0.66, 0.52);
    const hot = new Color3(0.85, 0.08, 0.03), core = new Color3(0.95, 0.4, 0.06);
    const node = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(`walker_${name}`, this.scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };
    // Сталкиваются с игроком только таз, бедро и корпус; руки/голова — только для попаданий.
    const part = (name: string, size: [number, number, number], pos: [number, number, number], c: Color3, parent: TransformNode, collide = false, glow = Color3.Black()) => {
      const m = this.createPart(`walker_${name}`, size, pos, c, glow, parent);
      m.checkCollisions = collide;
      return m;
    };

    const hips = node("hips", this.root, 0, 0.95, 0);
    part("pelvis", [0.62, 0.22, 0.4], [0, 0, 0], dark, hips, true);

    const leg = (s: number) => {
      const thigh = node("thigh", hips, s * 0.2, -0.05, 0);
      part("thigh_m", [0.28, 0.5, 0.3], [0, -0.22, 0], dark, thigh, true);
      const knee = node("knee", thigh, 0, -0.46, 0);
      part("shin", [0.24, 0.46, 0.27], [0, -0.21, 0], steel, knee);
      part("foot", [0.3, 0.14, 0.44], [0, -0.37, 0.07], dark, knee);
      return { thigh, knee };
    };
    const L = leg(-1), R = leg(1);

    const spine = node("spine", hips, 0, 0.1, 0);
    part("torso", [0.78, 0.72, 0.46], [0, 0.38, 0], color, spine, true);
    part("chest", [0.6, 0.4, 0.08], [0, 0.42, 0.26], steel, spine);
    part("core", [0.14, 0.14, 0.04], [0, 0.46, 0.31], core, spine, false, core);
    part("pack", [0.42, 0.5, 0.2], [0, 0.4, -0.33], steel, spine);
    part("pipe", [0.1, 0.34, 0.1], [0.15, 0.78, -0.33], dark, spine);
    for (const s of [-1, 1]) part("pad", [0.34, 0.18, 0.4], [s * 0.56, 0.7, 0], steel, spine);

    const neck = node("neck", spine, 0, 0.74, 0);
    part("head", [0.48, 0.44, 0.46], [0, 0.24, 0], new Color3(0.34, 0.35, 0.33), neck);
    part("jaw", [0.38, 0.1, 0.42], [0, 0.03, 0.03], dark, neck);
    for (const s of [-1, 1]) {
      part("eye", [0.11, 0.07, 0.04], [s * 0.12, 0.3, 0.24], hot, neck, false, hot);
      part("horn", [0.09, 0.26, 0.09], [s * 0.2, 0.56, -0.04], bone, neck).rotation.z = -s * 0.35;
    }

    const arm = (s: number) => {
      const shoulder = node("shoulder", spine, s * 0.5, 0.62, 0);
      part("arm_u", [0.2, 0.4, 0.22], [0, -0.18, 0], color, shoulder);
      const elbow = node("elbow", shoulder, 0, -0.38, 0);
      part("arm_f", [0.18, 0.4, 0.2], [0, -0.2, 0], color, elbow);
      part("hand", [0.22, 0.14, 0.24], [0, -0.44, 0.02], dark, elbow);
      for (const c of [-1, 1]) part("claw", [0.04, 0.16, 0.04], [c * 0.06, -0.56, 0.08], bone, elbow);
      return { shoulder, elbow };
    };
    const aL = arm(-1), aR = arm(1);
    const grenade = part("held_grenade", [0.17, 0.17, 0.17], [0, -0.6, 0.12], new Color3(0.24, 0.3, 0.12), aR.elbow, false, new Color3(0.08, 0.1, 0.04));
    grenade.setEnabled(false);

    return {
      hips, spine, neck, thighL: L.thigh, thighR: R.thigh, kneeL: L.knee, kneeR: R.knee,
      armL: aL.shoulder, armR: aR.shoulder, elbowL: aL.elbow, elbowR: aR.elbow, grenade,
    };
  }

  update(dt: number) {
    if (!this.alive) {
      this.state = "DEAD";
      this.updateCorpse(dt);
      return;
    }
    this.updateHitFlash(dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.moving = false;
    this.think(dt);
    this.animate(dt);
  }

  damage(amount: number) {
    const wasAlive = this.alive;
    super.damage(amount);
    if (wasAlive && this.alive) this.flinch = 0.18;
  }

  protected die() {
    if (this.throwReq && !this.throwReleased) this.throwReq.fail();
    this.throwReq = null;
    this.throwT = -1;
    this.rig.grenade.setEnabled(false);
    super.die();
    this.attackProgress = -1;
    this.attackSwing = 0;
    this.moving = false;
  }

  /** Поведение: выбор цели, преследование, атака. Выставляет this.moving для анимации. */
  private think(dt: number) {
    const target = this.findTarget();
    this.currentTarget = target;
    if (this.throwReq) {
      this.updateThrow(dt);
      return;
    }
    if (!target) {
      this.attackSwing = 0;
      return;
    }

    const from = this.getWorldPosition();
    const to = target.getWorldPosition();
    const distance = horizontalDistance(from, to);

    if (this.attackProgress >= 0) {
      this.updateAttack(dt, target);
      this.face(to, dt);
      return;
    }

    if (distance <= CONFIG.monsters.walker.attackRange) {
      this.state = "ATTACK";
      this.face(to, dt);
      if (this.attackTimer <= 0) this.startAttack();
      return;
    }

    this.state = "CHASE";
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;

    // Идём в свой слот вокруг цели (если он назначен), иначе прямо к цели.
    const goal = this.slot ?? { x: to.x, z: to.z };
    const goalVec = new Vector3(goal.x, to.y, goal.z);
    const goalDist = Math.hypot(goal.x - from.x, goal.z - from.z);
    const desiredGap = this.slot ? 0.2 : CONFIG.monsters.walker.radius + 0.45;
    const step = Math.min(CONFIG.monsters.walker.speed * dt, Math.max(0, (this.slot ? goalDist : len) - desiredGap));
    if (step <= 0) {
      this.separate();
      this.face(to, dt);
      return;
    }
    // Идём по прямой, если путь свободен, иначе по маршруту вокруг препятствий.
    const steer = this.steerPoint(from, goalVec, dt);
    const sx = steer.x - from.x, sz = steer.z - from.z, sl = Math.hypot(sx, sz) || 1;
    const tx = this.root.position.x + (sx / sl) * step;
    const tz = this.root.position.z + (sz / sl) * step;
    this.moveGround(tx, tz, CONFIG.monsters.walker.radius, CONFIG.monsters.walker.bodyHeight);
    this.moving = true;
    this.watchStuck(dt);

    this.clampToRoom();
    this.separate();
    this.face(new Vector3(steer.x, 0, steer.z), dt);
  }

  /** Точка, к которой идти сейчас: цель, если путь прямой свободен, иначе очередная вершина маршрута. */
  private steerPoint(from: Vector3, to: Vector3, dt: number): Point {
    if (this.nav.lineFree(from.x, from.z, to.x, to.z)) {
      this.path.length = 0;
      this.goal = { x: 1e9, z: 1e9 };
      return to;
    }
    this.repath -= dt;
    if (this.repath <= 0 || Math.hypot(to.x - this.goal.x, to.z - this.goal.z) > 1.0) {
      this.repath = 0.4 + Math.random() * 0.2;
      this.goal = { x: to.x, z: to.z };
      this.path = this.nav.findPath(from.x, from.z, to.x, to.z) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - from.x, this.path[0].z - from.z) < 0.4) this.path.shift();
    return this.path[0] ?? to;
  }

  /** Если монстр почти не продвигается, сбрасываем маршрут и строим заново. */
  private watchStuck(dt: number) {
    this.stuckT += dt;
    if (this.stuckT < 0.6) return;
    const p = this.root.position;
    if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) < 0.2) { this.repath = 0; this.path.length = 0; }
    this.lastX = p.x; this.lastZ = p.z; this.stuckT = 0;
  }

  // ----- Гранаты: интерфейс для GrenadeDirector -----
  canThrow(): boolean {
    if (!this.alive || this.throwReq || this.attackProgress >= 0) return false;
    const t = this.currentTarget;
    return !t || horizontalDistance(this.getWorldPosition(), t.getWorldPosition()) > CONFIG.monsters.walker.attackRange * 1.3;
  }

  /** Точка, откуда вылетает граната: на уровне поднятой руки, чуть впереди монстра. */
  getThrowOrigin(): Vector3 {
    const p = this.getWorldPosition(), yaw = this.root.rotation.y;
    return new Vector3(p.x + Math.sin(yaw) * 0.35, p.y + 1.9, p.z + Math.cos(yaw) * 0.35);
  }

  startThrow(req: ThrowRequest): boolean {
    if (!this.canThrow()) return false;
    const point = this.pickThrowPoint(req);
    if (!point) return false;
    this.throwReq = req;
    this.throwPoint = point;
    this.throwWalkT = 0;
    this.throwT = -1; // сначала идём на позицию, затем замах
    this.throwReleased = false;
    return true;
  }

  /**
   * Для броска в лифт — точка на осевой линии комнаты напротив двери, подальше от стены
   * (вблизи стены дуга упирается в косяк и стену). Для броска в укрытие — текущее место.
   */
  private pickThrowPoint(req: ThrowRequest): Point | null {
    const here = this.getWorldPosition();
    if (req.target.z < CONFIG.level.halfZ - 0.5) return req.plan(this.getThrowOrigin()) ? { x: here.x, z: here.z } : null;
    // Сначала дальние позиции (8.5–12.5 м от двери), ближняя 6.5 м — только если дальних нет.
    for (const group of [[8.5, 10.5, 12.5], [6.5]]) {
      let best: Point | null = null, bestDist = Infinity;
      for (const d of group) {
        for (const jx of [0, -0.6, 0.6]) {
          const p = { x: req.target.x + jx, z: CONFIG.level.halfZ - d };
          if (!this.nav.freeAt(p.x, p.z)) continue;
          if (!isRobust(req, new Vector3(p.x, here.y + 1.9, p.z + 0.35))) continue;
          const dist = Math.hypot(p.x - here.x, p.z - here.z);
          if (dist < bestDist) { bestDist = dist; best = p; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Идёт к точке по маршруту с обходом препятствий; true — пришёл. */
  private walkTo(goal: Point, speed: number, dt: number): boolean {
    const from = this.getWorldPosition();
    const d = Math.hypot(goal.x - from.x, goal.z - from.z);
    if (d < 0.35) return true;
    this.state = "CHASE";
    const steer = this.steerPoint(from, new Vector3(goal.x, from.y, goal.z), dt);
    const sx = steer.x - from.x, sz = steer.z - from.z, sl = Math.hypot(sx, sz) || 1, step = Math.min(speed * dt, d);
    this.moveGround(this.root.position.x + (sx / sl) * step, this.root.position.z + (sz / sl) * step, CONFIG.monsters.walker.radius, CONFIG.monsters.walker.bodyHeight);
    this.moving = true;
    this.watchStuck(dt);
    this.clampToRoom();
    this.separate();
    this.face(new Vector3(steer.x, 0, steer.z), dt);
    return false;
  }

  private updateThrow(dt: number) {
    const G = CONFIG.grenade, req = this.throwReq!;
    if (this.throwT < 0) {
      this.throwWalkT += dt;
      if (this.walkTo(this.throwPoint!, CONFIG.monsters.walker.speed * 1.3, dt)) this.throwT = 0;
      else if (this.throwWalkT > 12) { req.fail(); this.throwReq = null; this.throwPoint = null; }
      return;
    }
    this.throwT += dt;
    this.state = "ATTACK";
    this.face(new Vector3(req.target.x, 0, req.target.z), dt);
    if (!this.throwReleased && this.throwT >= G.windup) {
      this.throwReleased = true;
      const hand = this.getThrowOrigin();
      releaseThrow(req, hand);
    }
    if (this.throwT >= G.throwDuration) {
      this.throwT = -1;
      this.throwReq = null;
      this.throwPoint = null;
      this.attackTimer = Math.max(this.attackTimer, 0.6);
    }
  }

  /** Поза правой руки и корпуса при броске: замах за голову, бросок вперёд, возврат. */
  private applyThrowPose() {
    const G = CONFIG.grenade, r = this.rig;
    const wu = clamp01(this.throwT / G.windup);
    const rel = clamp01((this.throwT - G.windup) / (G.throwDuration - G.windup));
    let arm: number, elbow: number, twist: number, lean: number;
    if (this.throwT < G.windup) {
      arm = -3.4 * smooth(wu); elbow = -1.0 * smooth(wu); twist = 0.4 * smooth(wu); lean = -0.25 * smooth(wu);
    } else {
      const fwd = smooth(clamp01(rel * 2.5)), back = smooth(clamp01((rel - 0.4) / 0.6));
      arm = (-3.4 + 2.4 * fwd) * (1 - back);
      elbow = (-1.0 + 0.8 * fwd) * (1 - back);
      twist = (0.4 - 0.8 * fwd) * (1 - back);
      lean = (-0.25 + 0.55 * fwd) * (1 - back);
    }
    r.armR.rotation.x = arm;
    r.armR.rotation.z = 0.1;
    r.elbowR.rotation.x = elbow;
    r.spine.rotation.y = twist;
    r.spine.rotation.x = 0.04 + lean;
    r.armL.rotation.x = 0.5 * wu * (1 - rel); // левая рука уравновешивает
    r.grenade.setEnabled(!this.throwReleased);
  }

  private separate() {
    this.separateGround(
      CONFIG.monsters.walker.radius,
      [{ target: this.player, radius: 0.45 }, ...this.npcs.map((npc) => ({ target: npc, radius: 0.38 }))],
      2.0,
    );
  }

  private startAttack() {
    this.attackProgress = 0;
    this.attackHit = false;
    this.state = "ATTACK";
  }

  private updateAttack(dt: number, target: DamageTarget) {
    const W = CONFIG.monsters.walker;
    this.attackProgress += dt / W.attackDuration;
    const t = Math.min(1, this.attackProgress);

    // Руки резко идут вперёд в середине замаха и возвращаются назад (рисуется в animate).
    this.attackSwing = Math.sin(t * Math.PI);

    if (!this.attackHit && this.attackProgress >= W.attackHitTime / W.attackDuration) {
      this.attackHit = true;
      const currentDistance = horizontalDistance(this.getWorldPosition(), target.getWorldPosition());
      if (target.alive && currentDistance <= W.attackRange + 0.15) {
        if (target === this.player) this.player.damage(W.damage, this.getWorldPosition());
        else target.damage(W.damage);
      }
    }

    if (this.attackProgress >= 1) {
      this.attackProgress = -1;
      this.attackTimer = W.attackCooldown;
      this.attackSwing = 0;
      this.state = "CHASE";
    }
  }

  /** Все суставы рассчитываются из трёх «слоёв»: покой, ходьба, атака (+ вздрагивание от попадания). */
  private animate(dt: number) {
    const r = this.rig, W = CONFIG.monsters.walker;
    this.idleTime += dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.walkBlend += ((this.moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 8);
    if (this.moving) this.walkPhase += dt * W.speed * W.walkAnimRate;

    const w = this.walkBlend, idle = 1 - w, a = this.attackSwing, ph = this.walkPhase, it = this.idleTime;
    const sL = Math.sin(ph), sR = -sL, f = this.flinch / 0.18;

    // Ноги: бедро качается, колено сгибается, когда нога идёт вперёд.
    r.thighL.rotation.x = -sL * 0.72 * w;
    r.thighR.rotation.x = -sR * 0.72 * w;
    r.kneeL.rotation.x = Math.max(0, Math.cos(ph)) * 0.9 * w;
    r.kneeR.rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * w;
    r.hips.position.y = 0.95 + Math.abs(sL) * 0.05 * w;
    r.hips.rotation.y = sL * 0.1 * w;

    // Корпус: дыхание в покое, наклон вперёд при беге, замах при атаке, откидывание от попадания.
    r.spine.rotation.x = 0.04 + 0.1 * w + 0.28 * a - 0.35 * f;
    r.spine.rotation.z = sL * 0.05 * w + Math.sin(it * 0.9) * 0.02 * idle;
    r.spine.rotation.y = -sL * 0.12 * w - 0.2 * a;
    r.spine.scaling.y = 1 + Math.sin(it * 2.2) * 0.015 * idle;

    // Голова: в покое осматривается, на ходу смотрит вперёд, при атаке подаётся вперёд.
    r.neck.rotation.y = Math.sin(it * 0.6) * 0.5 * idle - r.spine.rotation.y * 0.5;
    r.neck.rotation.x = 0.05 + 0.15 * a - 0.4 * f + Math.sin(it * 1.7) * 0.02 * idle;

    // Руки: противофаза с ногами, лёгкое покачивание в покое, выброс вперёд при атаке.
    const sway = (p: number) => Math.sin(it * 1.3 + p) * 0.05 * idle;
    r.armL.rotation.x = sL * 0.55 * w + sway(0) - 1.45 * a;
    r.armR.rotation.x = sR * 0.55 * w + sway(1) - 1.45 * a;
    r.armL.rotation.z = -0.1 - 0.12 * a;
    r.armR.rotation.z = 0.1 + 0.12 * a;
    const bend = -0.3 - 0.25 * w * Math.abs(sL) - 0.5 * a;
    r.elbowL.rotation.x = bend;
    r.elbowR.rotation.x = bend;

    if (this.throwT >= 0) this.applyThrowPose();
    else r.grenade.setEnabled(false);
  }

  // ----- Смерть: ноги подгибаются, руки и голова запрокидываются, затем тело заваливается -----
  protected get deathDuration() { return CONFIG.monsters.walker.deathTime; }

  protected onDeathPose(t: number) {
    const r = this.rig, b = smooth(clamp01(t / 0.4));
    r.thighL.rotation.x = -0.7 * b;
    r.thighR.rotation.x = -0.35 * b;
    r.kneeL.rotation.x = 1.25 * b;
    r.kneeR.rotation.x = 1.0 * b;
    r.hips.position.y = 0.95 - 0.3 * b;
    r.spine.rotation.x = -0.3 * b;
    r.spine.rotation.z = 0.15 * b;
    r.neck.rotation.x = -0.5 * b;
    r.neck.rotation.y = 0.4 * b;
    r.armL.rotation.x = 0.9 * b;
    r.armR.rotation.x = 0.5 * b;
    r.armL.rotation.z = -1.0 * b;
    r.armR.rotation.z = 1.1 * b;
    r.elbowL.rotation.x = -0.3 - 0.2 * b;
    r.elbowR.rotation.x = -0.3 - 0.2 * b;
  }

  /** Заваливание начинается после подгибания ног и слегка «отскакивает» от пола. */
  protected toppleFraction(t: number) {
    const u = clamp01((t - 0.3) / 0.7);
    return smooth(u) + Math.sin(u * Math.PI) * 0.06;
  }

  private findTarget(): DamageTarget | null {
    const candidates: Array<{ target: DamageTarget; pos: Vector3 }> = [];
    if (this.player.alive && Math.abs(this.player.getWorldPosition().y - this.root.position.y) < 2) {
      candidates.push({ target: this.player, pos: this.player.getWorldPosition() });
    }
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const p = npc.getWorldPosition();
      if (Math.abs(p.y - this.root.position.y) < 2) candidates.push({ target: npc, pos: p });
    }
    if (!candidates.length) return null;
    // Цели в лифте недостижимы: выбираем их, только если других нет.
    const key = (c: { pos: Vector3 }) => horizontalDistance(this.root.position, c.pos) + (c.pos.z > CONFIG.level.halfZ - 0.3 ? 1000 : 0);
    candidates.sort((a, b) => key(a) - key(b));
    return horizontalDistance(this.root.position, candidates[0].pos) <= CONFIG.monsters.walker.sightRange ? candidates[0].target : null;
  }

  private face(target: Vector3, dt: number) {
    const wanted = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    let delta = wanted - this.root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.root.rotation.y += delta * Math.min(1, dt * 8);
  }
}

import { Color3, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { DamageTarget, horizontalDistance, Monster, randomFloat } from "./Monster";

export type WalkerState = "CHASE" | "ATTACK" | "DEAD";

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Суставы монстра: каждый — точка вращения (TransformNode), к ней прикреплены части тела. */
interface Rig {
  hips: TransformNode; spine: TransformNode; neck: TransformNode;
  thighL: TransformNode; thighR: TransformNode; kneeL: TransformNode; kneeR: TransformNode;
  armL: TransformNode; armR: TransformNode; elbowL: TransformNode; elbowR: TransformNode;
}

/**
 * Наземный монстр: преследует ближайшую живую цель, не проходит сквозь объекты и атакует с замахом.
 * Модель собрана из частей на суставах (как NPC, но детальнее): таз, ноги с коленями, корпус с бронёй
 * и рюкзаком, голова с рогами и светящимися глазами, руки с локтями и когтями.
 * Анимации: покой (дыхание, осмотр), ходьба (шаг, раскачка, подпрыгивание), атака, реакция на попадание, смерть.
 */
export class WalkerMonster extends Monster {
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

  constructor(scene: Scene, position: Vector3, floor: number, player: Player, npcs: Npc[], color: Color3) {
    // Лёжа тело опирается на спину/грудь, поэтому труп приподнят над полом.
    super(scene, "walker", position, CONFIG.monsters.walker.hp, position.y + 0.36);
    this.player = player;
    this.npcs = npcs;
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

    return {
      hips, spine, neck, thighL: L.thigh, thighR: R.thigh, kneeL: L.knee, kneeR: R.knee,
      armL: aL.shoulder, armR: aR.shoulder, elbowL: aL.elbow, elbowR: aR.elbow,
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
    super.die();
    this.attackProgress = -1;
    this.attackSwing = 0;
    this.moving = false;
  }

  /** Поведение: выбор цели, преследование, атака. Выставляет this.moving для анимации. */
  private think(dt: number) {
    const target = this.findTarget();
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

    const desiredGap = CONFIG.monsters.walker.radius + 0.45;
    const step = Math.min(CONFIG.monsters.walker.speed * dt, Math.max(0, len - desiredGap));
    if (step <= 0) {
      this.separate();
      this.face(to, dt);
      return;
    }
    const tx = this.root.position.x + (dx / len) * step;
    const tz = this.root.position.z + (dz / len) * step;
    this.moveGround(tx, tz, CONFIG.monsters.walker.radius, CONFIG.monsters.walker.bodyHeight);
    this.moving = true;

    this.clampToRoom();
    this.separate();
    this.face(to, dt);
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
    candidates.sort((a, b) => horizontalDistance(this.root.position, a.pos) - horizontalDistance(this.root.position, b.pos));
    return horizontalDistance(this.root.position, candidates[0].pos) <= CONFIG.monsters.walker.sightRange ? candidates[0].target : null;
  }

  private face(target: Vector3, dt: number) {
    const wanted = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    let delta = wanted - this.root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.root.rotation.y += delta * Math.min(1, dt * 8);
  }
}

import { Color3, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import type { ThrowRequest, Thrower } from "./GrenadeDirector";
import { DamageTarget, horizontalDistance, Monster, randomFloat } from "./Monster";

export type FlyingState = "ORBIT" | "DIVE" | "RECOVER" | "THROW" | "DEAD";

/** Летающий монстр крыши: кружит, активно машет крыльями и пикирует на цель. */
export class FlyingMonster extends Monster implements Thrower {
  state: FlyingState = "ORBIT";
  private readonly player: Player;
  private readonly npcs: Npc[];
  private readonly center: Vector3;
  private readonly floorY: number;
  private readonly orbitRadius: number;
  private readonly wingL: Mesh;
  private readonly wingR: Mesh;
  private angle: number;
  private wingPhase = Math.random() * Math.PI * 2;
  private diveTimer = randomFloat(0.8, CONFIG.monsters.flying.diveInterval);
  private attackTimer = 0;
  private diveTarget = new Vector3();
  private diveVictim: DamageTarget | null = null;
  private throwReq: ThrowRequest | null = null;
  private throwPhase = 0;       // 0 — подъём над стеной, 1 — снижение к двери, 2 — замах, 3 — отдача
  private throwT = 0;
  private throwStuck = 0;
  private highPoint = new Vector3();
  private throwPoint = new Vector3();
  private readonly heldGrenade: Mesh;

  constructor(scene: Scene, position: Vector3, center: Vector3, player: Player, npcs: Npc[], color: Color3) {
    super(scene, "flying", position, CONFIG.monsters.flying.hp, center.y + CONFIG.monsters.flying.deathDropHeight);
    this.player = player;
    this.npcs = npcs;
    this.center = center.clone();
    this.floorY = center.y;
    this.orbitRadius = randomFloat(CONFIG.monsters.flying.orbitRadiusMin, CONFIG.monsters.flying.orbitRadiusMax);
    this.angle = Math.atan2(position.z - center.z, position.x - center.x);
    this.root.scaling.setAll(0.9);

    this.createPart("fly_body", [0.7, 0.45, 1.2], [0, 0, 0], color);
    this.wingL = this.createPart("fly_wing_l", [1.4, 0.08, 0.5], [-0.8, 0, 0], new Color3(0.15, 0.18, 0.2));
    this.wingR = this.createPart("fly_wing_r", [1.4, 0.08, 0.5], [0.8, 0, 0], new Color3(0.15, 0.18, 0.2));
    this.heldGrenade = this.createPart("fly_grenade", [0.2, 0.2, 0.2], [0, -0.32, 0.25], new Color3(0.24, 0.3, 0.12), new Color3(0.08, 0.1, 0.04));
    this.heldGrenade.setEnabled(false);
    this.createPart("fly_eye", [0.16, 0.16, 0.08], [0, 0.02, 0.62], new Color3(0.8, 0.06, 0.02), new Color3(0.8, 0.06, 0.02));
  }

  update(dt: number) {
    if (!this.alive) {
      this.state = "DEAD";
      this.updateCorpse(dt);
      return;
    }

    this.updateHitFlash(dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.wingPhase += CONFIG.monsters.flying.wingFlapSpeed * dt;
    const flap = Math.sin(this.wingPhase) * 0.28;
    this.wingL.rotation.z = flap;
    this.wingR.rotation.z = -flap;

    switch (this.state) {
      case "ORBIT": this.updateOrbit(dt); break;
      case "DIVE": this.updateDive(dt); break;
      case "RECOVER": this.updateRecover(dt); break;
      case "THROW": this.updateThrow(dt); break;
    }
  }

  // ----- Гранаты: интерфейс для GrenadeDirector -----
  canThrow(): boolean {
    return this.alive && this.state === "ORBIT" && !this.throwReq;
  }

  getThrowOrigin(): Vector3 {
    const p = this.getWorldPosition(), yaw = this.root.rotation.y;
    return new Vector3(p.x + Math.sin(yaw) * 0.5, p.y - 0.3, p.z + Math.cos(yaw) * 0.5);
  }

  /**
   * Летающий монстр подлетает к проёму двери (над стеной, затем вниз к уровню проёма на расстоянии
   * от кабины), замахивается и бросает гранату по дуге в кабину.
   */
  startThrow(req: ThrowRequest): boolean {
    if (!this.canThrow()) return false;
    this.throwReq = req;
    this.throwPhase = 0;
    this.throwT = 0;
    this.throwStuck = 0;
    const x = req.target.x + randomFloat(-0.6, 0.6);
    const z = req.target.z - (CONFIG.elevator.cabinSize / 2 + 3.8); // перед дверью, внутри комнаты
    this.highPoint.set(x, this.floorY + 5.2, z);
    this.throwPoint.set(x, this.floorY + 2.2, z);
    this.state = "THROW";
    return true;
  }

  private abortThrow() {
    this.throwReq?.fail();
    this.throwReq = null;
    this.heldGrenade.setEnabled(false);
    this.state = "RECOVER";
  }

  private updateThrow(dt: number) {
    const req = this.throwReq;
    if (!req) { this.state = "RECOVER"; return; }
    const G = CONFIG.grenade;
    const here = this.getWorldPosition();

    const flyTo = (to: Vector3, speed: number) => {
      const delta = to.subtract(here), d = delta.length();
      if (d < 0.35) return true;
      const ok = this.moveAir(here.add(delta.normalize().scale(Math.min(speed * dt, d))), 0.65);
      this.throwStuck = ok ? 0 : this.throwStuck + dt;
      this.root.rotation.y = Math.atan2(delta.x, delta.z);
      return false;
    };

    if (this.throwPhase === 0 && flyTo(this.highPoint, CONFIG.monsters.flying.recoverSpeed * 1.5)) this.throwPhase = 1;
    else if (this.throwPhase === 1 && flyTo(this.throwPoint, CONFIG.monsters.flying.recoverSpeed)) {
      this.throwPhase = 2;
      this.throwT = 0;
      this.heldGrenade.setEnabled(true);
    } else if (this.throwPhase === 2) {
      this.throwT += dt;
      this.root.rotation.y = Math.atan2(req.target.x - here.x, req.target.z - here.z);
      this.root.rotation.x = -0.25 * Math.min(1, this.throwT / G.windup); // морда вверх на замахе
      if (this.throwT >= G.windup) {
        const hand = this.getThrowOrigin();
        const plan = req.plan(hand);
        this.heldGrenade.setEnabled(false);
        if (plan) req.launch(hand, plan); else req.fail();
        this.throwReq = null;
        this.throwPhase = 3;
        this.throwT = 0;
      }
    } else if (this.throwPhase === 3) {
      this.throwT += dt;
      this.root.rotation.x = 0.4 * Math.sin(Math.min(1, this.throwT / 0.35) * Math.PI); // отдача
      if (this.throwT >= 0.35) { this.root.rotation.x = 0; this.state = "RECOVER"; }
    }

    if (this.throwStuck > 2) this.abortThrow();
  }

  protected die() {
    if (this.throwReq) this.throwReq.fail();
    this.throwReq = null;
    this.heldGrenade.setEnabled(false);
    super.die();
  }

  private updateOrbit(dt: number) {
    this.angle += CONFIG.monsters.flying.orbitSpeed * dt;
    this.diveTimer -= dt;
    const y = this.center.y + CONFIG.monsters.flying.orbitHeight + Math.sin(this.angle * 1.7) * 0.6;
    const desired = new Vector3(
      this.center.x + Math.cos(this.angle) * this.orbitRadius,
      y,
      this.center.z + Math.sin(this.angle) * this.orbitRadius,
    );
    if (!this.moveAir(desired, 0.65)) {
      // У стены разворачиваем орбиту, чтобы монстр не «проникал» в помещение.
      this.angle -= CONFIG.monsters.flying.orbitSpeed * dt * 2;
      this.moveAir(new Vector3(
        this.center.x + Math.cos(this.angle) * this.orbitRadius,
        y,
        this.center.z + Math.sin(this.angle) * this.orbitRadius,
      ), 0.65);
    }
    this.root.rotation.y = -this.angle + Math.PI / 2;

    if (this.diveTimer <= 0) {
      this.state = "DIVE";
      this.diveTimer = CONFIG.monsters.flying.diveInterval + randomFloat(-0.7, 0.7);
      const target = this.findTarget();
      this.diveVictim = target?.target ?? null;
      this.diveTarget = target ? target.position.add(new Vector3(0, 0.7, 0)) : this.center.add(new Vector3(0, 1, 0));
    }
  }

  private updateDive(dt: number) {
    const target = this.diveTarget;
    const here = this.getWorldPosition();
    const delta = target.subtract(here);
    const distance = delta.length();
    if (distance < CONFIG.monsters.flying.attackRange || distance < 0.2) {
      this.attackTarget();
      this.state = "RECOVER";
      return;
    }

    const step = Math.min(CONFIG.monsters.flying.diveSpeed * dt, distance);
    const desired = here.add(delta.normalize().scale(step));
    if (!this.moveAir(desired, 0.65)) {
      this.state = "RECOVER";
      this.diveVictim = null;
      return;
    }
    this.root.rotation.y = Math.atan2(delta.x, delta.z);
    this.root.rotation.x = Math.min(0.65, Math.max(-0.65, -delta.y * 0.12));
  }

  private updateRecover(dt: number) {
    const desired = new Vector3(
      this.center.x + Math.cos(this.angle) * this.orbitRadius,
      this.center.y + CONFIG.monsters.flying.orbitHeight,
      this.center.z + Math.sin(this.angle) * this.orbitRadius,
    );
    const here = this.getWorldPosition();
    const delta = desired.subtract(here);
    if (delta.length() < 0.25) {
      this.root.rotation.x = 0;
      this.state = "ORBIT";
      return;
    }
    const step = Math.min(CONFIG.monsters.flying.recoverSpeed * dt, delta.length());
    if (!this.moveAir(here.add(delta.normalize().scale(step)), 0.65)) {
      this.angle += 0.6;
    }
    this.root.rotation.x *= 0.85;
  }

  private findTarget(): { target: DamageTarget; position: Vector3 } | null {
    const targets = this.findTargets();
    if (!targets.length) return null;
    targets.sort((a, b) => horizontalDistance(this.getWorldPosition(), a.position) - horizontalDistance(this.getWorldPosition(), b.position));
    return targets[0];
  }

  private attackTarget() {
    if (this.attackTimer > 0) return;
    this.attackTimer = CONFIG.monsters.flying.attackCooldown;
    const victim = this.diveVictim;
    this.diveVictim = null;
    if (!victim || !victim.alive) return;

    const victimPosition = victim.getWorldPosition();
    if (horizontalDistance(this.getWorldPosition(), victimPosition) < CONFIG.monsters.flying.hitRadius) {
      if (victim === this.player) this.player.damage(CONFIG.monsters.flying.damage, this.getWorldPosition());
      else victim.damage(CONFIG.monsters.flying.damage);
    }
  }

  private findTargets(): Array<{ target: DamageTarget; position: Vector3 }> {
    const result: Array<{ target: DamageTarget; position: Vector3 }> = [];
    if (this.player.alive) {
      const p = this.player.getWorldPosition();
      if (Math.abs(p.y - this.floorY) < 2) result.push({ target: this.player, position: p });
    }
    for (const npc of this.npcs) if (npc.alive) {
      const p = npc.getWorldPosition();
      if (Math.abs(p.y - this.floorY) < 2) result.push({ target: npc, position: p });
    }
    return result;
  }
}

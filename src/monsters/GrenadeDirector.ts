import { Ray, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Player } from "../player/Player";
import { GrenadeSystem, planThrow, ThrowPlan } from "./Grenades";
import type { Monster } from "./Monster";
import { staticBoxes } from "./NavGrid";

/** Заявка на бросок: монстр сам подходит, замахивается и в момент броска просит план у режиссёра. */
export interface ThrowRequest {
  target: Vector3;
  plan(from: Vector3): ThrowPlan | null;
  launch(from: Vector3, plan: ThrowPlan): void;
  fail(): void;
}

/** Монстр, умеющий бросать гранаты (ходячие и летающие). */
export interface Thrower {
  alive: boolean;
  kind: "walker" | "flying";
  canThrow(): boolean;
  getThrowOrigin(): Vector3;
  startThrow(req: ThrowRequest): boolean;
}

export const isThrower = (m: Monster): m is Monster & Thrower => typeof (m as unknown as Thrower).startThrow === "function";

/**
 * Решает, когда монстрам пора бросить гранату.
 * Игрок «засел», если он ≥ campTime секунд находится в лифте (двери открыты, кабина на этом этаже)
 * либо почти не двигается в укрытии (ни один монстр его не видит). После броска все монстры этажа
 * ждут cooldown секунд. Метание в лифт — и ходячие, и летающие; в укрытие — ходячие.
 */
export class GrenadeDirector {
  private camp = 0;
  private cooldown = 0;
  private retry = 0;
  private pending = false;
  private anchor: Vector3 | null = null;
  private hidden = false;
  private losT = 0;

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly cabin: TransformNode,
    private readonly system: GrenadeSystem,
    private readonly say: (text: string, ms?: number) => void,
    private readonly doorOpen: () => boolean,
  ) {}

  get campSeconds() { return this.camp; }

  reset() { this.camp = 0; this.anchor = null; this.hidden = false; }

  update(dt: number, floor: number, monsters: Monster[]) {
    const G = CONFIG.grenade;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.retry = Math.max(0, this.retry - dt);

    const alive = monsters.filter((m) => m.alive);
    if (!alive.length || !this.player.alive) { this.reset(); return; }

    const floorY = floor * CONFIG.elevator.floorHeight;
    const p = this.player.getWorldPosition();
    const docked = Math.abs(this.cabin.position.y - floorY) < 0.1;
    const insideCabin = docked && this.playerInCabin(p);
    const inLift = insideCabin && this.doorOpen();

    if (insideCabin && !inLift) { this.reset(); return; } // двери закрыты — граната не залетит

    if (inLift) {
      this.camp += dt;
      this.anchor = null;
    } else {
      this.losT -= dt;
      if (this.losT <= 0) { this.losT = 0.3; this.hidden = this.isHidden(alive); }
      if (this.hidden) {
        if (!this.anchor || Math.hypot(p.x - this.anchor.x, p.z - this.anchor.z) > G.stillRadius) {
          this.anchor = p.clone();
          this.camp = 0;
        } else this.camp += dt;
      } else { this.camp = 0; this.anchor = null; }
    }

    if (this.camp < G.campTime || this.cooldown > 0 || this.retry > 0 || this.pending) return;
    this.tryThrow(floorY, inLift, p, alive);
  }

  /** Игрок в пределах кабины (как Elevator.playerInside, но по положению кабины на этаже). */
  private playerInCabin(p: Vector3) {
    const half = CONFIG.elevator.cabinSize / 2, c = this.cabin.position;
    return Math.abs(p.x - c.x) < half && p.z > c.z - half + 0.3 && p.z < c.z + half;
  }

  /** Укрытие: ни один монстр не видит игрока, и никто не стоит вплотную. */
  private isHidden(monsters: Monster[]) {
    const eye = this.player.getEyeRay(1).origin;
    for (const m of monsters) {
      const from = m.getWorldPosition().add(new Vector3(0, m.kind === "walker" ? 1.7 : 0, 0));
      const dir = eye.subtract(from), dist = dir.length();
      if (dist < 3) return false;
      dir.normalize();
      const hit = this.scene.pickWithRay(new Ray(from, dir, dist - 0.1), (mesh) =>
        mesh.checkCollisions && !mesh.metadata?.monster && !mesh.metadata?.npc && !mesh.metadata?.player);
      if (!hit?.hit) return false;
    }
    return true;
  }

  private tryThrow(floorY: number, inLift: boolean, p: Vector3, monsters: Monster[]) {
    const G = CONFIG.grenade;
    const c = this.cabin.position;
    const target = inLift ? new Vector3(c.x, floorY + 0.5, c.z) : new Vector3(p.x, floorY + 0.5, p.z);
    const boxes = staticBoxes(this.scene, true);

    // В укрытие, если прямой навес невозможен (высокая стенка/потолок), бросаем чуть ближе к монстру:
    // осколки взрыва достанут через радиус, а сама стенка ослабит урон.
    const aims = (from: Vector3) => {
      const list = [target];
      if (!inLift) {
        const dx = from.x - target.x, dz = from.z - target.z, len = Math.hypot(dx, dz) || 1;
        for (const off of [1.4, 2.6]) list.push(new Vector3(target.x + (dx / len) * off, target.y, target.z + (dz / len) * off));
      }
      return list;
    };

    const req: ThrowRequest = {
      target,
      plan: (from) => {
        for (const aim of aims(from)) {
          const plan = planThrow(boxes, from, aim);
          if (plan) return plan;
        }
        return null;
      },
      launch: (from, plan) => {
        this.system.spawn(from, plan.velocity);
        this.cooldown = G.cooldown;
        this.pending = false;
        this.say("ГРАНАТА!", 1400);
      },
      fail: () => { this.pending = false; this.retry = G.retryDelay; },
    };

    // Ходячие: нужна свободная дуга от их текущего места. Летающие сами займут позицию у двери (только в лифт).
    const ready = monsters.filter(isThrower).filter((t) => t.canThrow())
      .filter((t) => (t.kind === "flying" ? inLift : req.plan(t.getThrowOrigin()) !== null));
    if (!ready.length) { this.retry = 1; return; }

    const thrower = ready[Math.floor(Math.random() * ready.length)];
    this.pending = true; // до вызова: бросок может состояться сразу, и launch() сбросит флаг
    if (!thrower.startThrow(req)) { this.pending = false; this.retry = 1; }
  }
}

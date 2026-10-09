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

const NUDGES = [[0, 0, 0], [0.3, 0, 0], [-0.3, 0, 0], [0, 0.25, 0], [0, -0.25, 0], [0, 0, 0.3], [0, 0, -0.3]].map((a) => new Vector3(a[0], a[1], a[2]));

/** Бросок надёжен: дуга свободна не только из самой точки, но и при небольшом смещении (монстр не встаёт идеально). */
export function isRobust(req: ThrowRequest, origin: Vector3): boolean {
  return NUDGES.every((n) => req.plan(origin.add(n)) !== null);
}

/** Запускает гранату из руки; при необходимости чуть сдвигает точку вылета. false — дуги нет. */
export function releaseThrow(req: ThrowRequest, hand: Vector3): boolean {
  for (const n of NUDGES) {
    const origin = hand.add(n), plan = req.plan(origin);
    if (plan) { req.launch(origin, plan); return true; }
  }
  req.fail();
  return false;
}

export const isThrower = (m: Monster): m is Monster & Thrower => typeof (m as unknown as Thrower).startThrow === "function";

/**
 * Решает, когда монстрам пора бросить гранату.
 * Игрок «засел», если он ≥ campTime секунд находится в лифте (двери открыты, кабина на этом этаже)
 * либо почти не двигается в укрытии (ни один монстр его не видит). Таймер один на этаж и общий для
 * всех монстров: после каждого броска он обнуляется, то есть гранаты летят не чаще раза в campTime секунд. Метание в лифт — и ходячие, и летающие; в укрытие — ходячие.
 */
export class GrenadeDirector {
  private camp = 0;
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
    private readonly doorOpen: () => boolean,
  ) {}

  get campSeconds() { return this.camp; }

  reset() { this.camp = 0; this.anchor = null; this.hidden = false; }

  update(dt: number, floor: number, monsters: Monster[]) {
    const G = CONFIG.grenade;
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

    if (this.camp < G.campTime || this.retry > 0 || this.pending) return;
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
        this.camp = 0; // общий таймер этажа: следующая граната — после ещё campTime секунд «засидки»
        this.pending = false;
      },
      fail: () => { this.pending = false; this.retry = G.retryDelay; },
    };

    // В лифт бросают и ходячие, и летающие: они сами выбирают позицию на осевой линии этажа, подальше от стены
    // (startThrow вернёт false, если оттуда не пролетит дуга). В укрытие — только ходячие, прямо с места.
    const ready = monsters.filter(isThrower).filter((t) => t.canThrow() && (inLift || t.kind === "walker"))
      .sort(() => Math.random() - 0.5);
    for (const thrower of ready) {
      this.pending = true; // до вызова: бросок может состояться сразу, и launch() сбросит флаг
      if (thrower.startThrow(req)) return;
      this.pending = false;
    }
    this.retry = G.retryDelay;
  }
}

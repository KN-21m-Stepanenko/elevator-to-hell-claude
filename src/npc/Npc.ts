import { Color3, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Elevator } from "../elevator/Elevator";
import type { NavGrid, Point } from "../monsters/NavGrid";
import type { Player } from "../player/Player";
import type { Weapon } from "../player/Weapon";

const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const rf = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const RED = new Color3(0.6, 0.05, 0.05), BLACK = Color3.Black();

export interface NpcEnv {
  cabin: TransformNode; scene: Scene; player: Player; weapon: Weapon; elevator: Elevator; npcs: Npc[];
  /** Навигационная сетка этажа: по ней NPC выбирают места в открытой части комнаты и обходят предметы. */
  nav?: (floor: number) => NavGrid | null;
}
export type NpcState = "CALM" | "PANIC" | "DEAD";
export type DeathCause = "weapon" | "lava" | "impact" | "crush";
const CHAR = new Color3(0.05, 0.04, 0.04);

/** Пассажир. Автомат состояний: CALM → PANIC → DEAD. */
export class Npc {
  state: NpcState = "CALM";
  alive = true;
  inCabin = true;
  env!: NpcEnv;
  readonly root: TransformNode;
  private hp = CONFIG.npc.hp;
  private locked = false; // паника от событий (лава, обрыв тросов, монстры) не снимается
  private mats: StandardMaterial[] = [];
  private parts: Mesh[] = [];
  private baseColors: Color3[] = [];
  private deathCause: DeathCause = "weapon";
  private deathT = 0;
  private flash = 0;
  private flashOn = false;
  private fall = 0;
  private lookT = rf(0.5, 2);
  private lookYaw: number;
  private los = false;
  private losT = Math.random() * 0.25;
  private calmT = 0;
  private retarget = 0;
  private tl = { x: 0, z: -2.1 }; // цель метаний внутри кабины (локально)
  private tw = { x: 0, z: 0 };    // динамическая цель убегания (мировая)
  /** Место, куда NPC убегает снаружи кабины (у каждого своё, подальше от стен и от остальных). */
  fleeGoal: Point | null = null;
  private path: Point[] = [];
  private pathT = 0;
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;
  private fleeSeed = Math.random() * Math.PI * 2;
  private arms: TransformNode[] = [];
  private moving = false;
  private armT = Math.random() * 10;
  private runPhase = 0;
  /** У каждого NPC своя полоса бегства, чтобы группа не стекалась в одну точку. */
  private readonly fleeLane = rf(-1.15, 1.15);

  constructor(scene: Scene, parent: TransformNode, readonly weight: number, pos: number[], yaw: number, color: Color3) {
    this.root = new TransformNode("npc", scene);
    this.root.parent = parent;
    this.root.position.set(pos[0], 0, pos[1]);
    this.root.rotation.y = yaw;
    this.lookYaw = yaw;
    const k = 0.85 + ((weight - 60) / 40) * 0.3; // полнее — шире
    this.root.scaling.set(k, 1, k);

    const part = (n: string, w: number, h: number, d: number, p: number[], c: Color3, collide: boolean, parent: TransformNode = this.root) => {
      const m = new StandardMaterial("npc_mat", scene);
      m.diffuseColor = c; m.specularColor = BLACK;
      const b = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
      b.parent = parent; b.position.set(p[0], p[1], p[2]); b.material = m; b.checkCollisions = collide;
      b.metadata = { npc: this };
      this.mats.push(m); this.parts.push(b); this.baseColors.push(c);
    };
    part("npc_legs", 0.4, 0.8, 0.28, [0, 0.4, 0], new Color3(0.12, 0.12, 0.16), true);
    part("npc_torso", 0.5, 0.6, 0.3, [0, 1.1, 0], color, true);
    part("npc_head", 0.26, 0.28, 0.26, [0, 1.54, 0], new Color3(0.75, 0.58, 0.45), false);
    part("npc_visor", 0.2, 0.06, 0.03, [0, 1.58, 0.14], new Color3(0.05, 0.05, 0.08), false); // «лицо» — спереди (+z)

    // Руки в том же блочном стиле: рукав цвета куртки (чуть темнее) и кисть цвета лица.
    // Каждая рука висит на «плечевом» узле, чтобы её можно было качать при беге и поднимать в панике.
    const skin = new Color3(0.75, 0.58, 0.45), sleeve = color.scale(0.8);
    for (const s of [-1, 1]) {
      const shoulder = new TransformNode("npc_shoulder", scene);
      shoulder.parent = this.root;
      shoulder.position.set(s * 0.31, 1.38, 0);
      part("npc_arm", 0.12, 0.5, 0.14, [0, -0.22, 0], sleeve, false, shoulder);
      part("npc_hand", 0.1, 0.1, 0.12, [0, -0.5, 0.01], skin, false, shoulder);
      this.arms.push(shoulder);
    }
  }

  /** Паника от событий (лава, обрыв тросов, монстры): ничем не снимается. */
  scare() { if (this.alive) { this.locked = true; this.state = "PANIC"; } }

  damage(d: number) {
    if (!this.alive) return;
    this.hp -= d;
    this.flash = 0.15;
    if (this.hp <= 0) this.die("weapon");
  }

  /** Мгновенная смерть от среды: лава, удар кабины о дно шахты, створки дверей. */
  kill(cause: DeathCause) {
    if (this.alive) this.die(cause);
  }

  private die(cause: DeathCause) {
    this.alive = false; this.state = "DEAD";
    this.deathCause = cause; this.deathT = 0;
    this.parts.forEach((p) => (p.checkCollisions = false));
    this.root.position.y += 0.16; // лежит на полу, а не в нём
    this.setFlash(false);
  }

  /** Падение после смерти + эффект причины: обугливание в лаве, сминание при ударе. */
  private updateDeath(dt: number) {
    this.deathT += dt;
    const dur = this.deathCause === "weapon" ? 0.35 : 0.5;
    this.fall = Math.min(1, this.fall + dt / dur);
    this.root.rotation.x = this.fall * (Math.PI / 2);
    this.arms.forEach((a, i) => { a.rotation.x = -0.4 * this.fall; a.rotation.z = (i === 0 ? -1 : 1) * 0.9 * this.fall; });

    if (this.deathCause === "lava" && this.deathT < 1.6) {
      const k = Math.max(0, 1 - this.deathT / 1.4), c = Math.min(1, this.deathT / 1.2);
      this.mats.forEach((m, i) => {
        m.emissiveColor = new Color3(k, 0.38 * k, 0.05 * k); // раскалённое свечение гаснет
        m.diffuseColor = Color3.Lerp(this.baseColors[i], CHAR, c); // и тело чернеет
      });
    } else if ((this.deathCause === "impact" || this.deathCause === "crush") && this.deathT < 0.8) {
      const k = Math.max(0, 1 - this.deathT / 0.6);
      this.mats.forEach((m) => (m.emissiveColor = new Color3(0.55 * k, 0.02 * k, 0.02 * k)));
      this.root.scaling.y = 1 - 0.3 * this.fall; // тело складывается от удара
    }
  }

  /** Мировые координаты в плоскости пола. */
  world() {
    const p = this.root.position, c = this.root.parent ? this.env.cabin.position : null;
    return { x: p.x + (c ? c.x : 0), z: p.z + (c ? c.z : 0) };
  }

  /** Полная мировая позиция для боевой системы. */
  getWorldPosition() {
    return this.root.getAbsolutePosition().clone();
  }

  /** frozen — игра окончена: живые замирают, мёртвые доигрывают падение. */
  update(dt: number, frozen = false) {
    if (this.state === "DEAD") { this.updateDeath(dt); return; }
    if (frozen) return;
    this.moving = false;
    this.flash = Math.max(0, this.flash - dt);
    this.setFlash(this.flash > 0);

    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.25; this.los = this.checkLos(); }

    // Видит оружие — паника; в движущейся кабине успокаиваются; убрал оружие — успокаиваются.
    const threat = this.env.weapon.drawn && this.los;
    const scared = this.locked || (threat && !(this.inCabin && this.env.elevator.moving));
    if (scared) { this.calmT = 0; this.state = "PANIC"; }
    else if (this.state === "PANIC") { this.calmT += dt; if (this.calmT > 1) this.state = "CALM"; }

    if (this.state === "PANIC") this.runAround(dt); else this.idle(dt);
    this.separate();
    this.constrain();
    this.animateArms(dt);
  }

  /** Руки: в покое чуть покачиваются, при беге машут в противофазе, в панике на месте — вскинуты и дрожат. */
  private animateArms(dt: number) {
    this.armT += dt;
    if (this.moving) this.runPhase += dt * 12;
    const k = Math.min(1, dt * 14), panic = this.state === "PANIC";
    this.arms.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      let x: number, z: number;
      if (panic && this.moving) { x = Math.sin(this.runPhase + (i ? Math.PI : 0)) * 0.95; z = s * 0.12; }
      else if (panic) { x = -2.1 + Math.sin(this.armT * 14 + i * 2) * 0.35; z = s * 0.35; }
      else { x = Math.sin(this.armT * 1.3 + i * 1.7) * 0.05; z = s * 0.05; }
      a.rotation.x += (x - a.rotation.x) * k;
      a.rotation.z += (z - a.rotation.z) * k;
    });
  }

  private setFlash(on: boolean) {
    if (on === this.flashOn) return;
    this.flashOn = on;
    this.mats.forEach((m) => (m.emissiveColor = on ? RED : BLACK));
  }

  private idle(dt: number) {
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookT = rf(1.5, 3.5); this.lookYaw = this.root.rotation.y + rf(-1.8, 1.8); }
    this.faceTo(this.lookYaw, dt, 2.5);
  }

  private runAround(dt: number) {
    const env = this.env, sp = CONFIG.npc.runSpeed;
    const now = this.getWorldPosition();

    // Снаружи кабины: разбегаемся по открытой части комнаты по маршруту, а не жмёмся к стенам цепочкой.
    const nav = this.inCabin ? null : env.nav?.(Math.round(this.root.position.y / CONFIG.elevator.floorHeight)) ?? null;
    if (nav) { this.fleeOutside(dt, now, nav, sp); return; }

    this.retarget -= dt;
    if (this.retarget <= 0 || Math.hypot(this.tw.x - now.x, this.tw.z - now.z) < 0.45) {
      this.retarget = rf(0.45, 0.9);
      const threat = this.findNearestThreat();
      this.tw = this.chooseFleeTarget(now, threat);
      this.fleeSeed += rf(0.7, 1.8);
    }
    this.step(this.tw.x, this.tw.z, sp * this.queueFactor(now), dt);
  }

  /** В дверях не толкаются: тот, кто позади в той же полосе, притормаживает и пропускает передних. */
  private queueFactor(me: { x: number; z: number }): number {
    if (!this.inCabin || !this.env.elevator.exitOpen()) return 1;
    for (const o of this.env.npcs) {
      if (o === this || !o.alive || !o.inCabin) continue;
      const q = o.world();
      if (q.z < me.z && me.z - q.z < 1.3 && Math.abs(q.x - me.x) < 0.55) return 0.45;
    }
    return 1;
  }

  /**
   * Бегство снаружи. Цель — свободная клетка в открытой части комнаты (не у стены, далеко от угрозы,
   * не рядом с целями других NPC); к ней ведёт маршрут A*, обходящий предметы.
   * Если NPC застрял или угроза приблизилась, цель выбирается заново.
   */
  private fleeOutside(dt: number, now: { x: number; z: number }, nav: NavGrid, sp: number) {
    const threat = this.findNearestThreat();
    this.retarget -= dt;
    this.pathT -= dt;
    const goalNearThreat = !!(this.fleeGoal && threat && Math.hypot(this.fleeGoal.x - threat.x, this.fleeGoal.z - threat.z) < 5);
    const threatClose = !!(threat && Math.hypot(now.x - threat.x, now.z - threat.z) < 6);

    if (!this.fleeGoal || (this.retarget <= 0 && (goalNearThreat || threatClose))) {
      this.retarget = 1.2;
      this.fleeGoal = this.pickFleeCell(now, threat, nav);
      this.pathT = 0;
    }

    // Маршрут обновляется раз в ~0.8 с.
    const goal = this.fleeGoal;
    if (goal && this.pathT <= 0) {
      this.pathT = 0.8;
      this.path = nav.findPath(now.x, now.z, goal.x, goal.z) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - now.x, this.path[0].z - now.z) < 0.5) this.path.shift();

    const arrived = !!goal && Math.hypot(goal.x - now.x, goal.z - now.z) < 0.6;
    if (goal && !arrived) {
      const wp = this.path[0] ?? goal;
      this.step(wp.x, wp.z, sp, dt);
      // Почти не продвигаемся — выбираем другое место.
      this.stuckT += dt;
      if (this.stuckT > 0.7) {
        if (Math.hypot(now.x - this.lastX, now.z - this.lastZ) < 0.35) { this.fleeGoal = null; this.path = []; }
        this.lastX = now.x; this.lastZ = now.z; this.stuckT = 0;
      }
    }
  }

  private pickFleeCell(me: { x: number; z: number }, threat: Vector3 | null, nav: NavGrid): Point {
    const others = this.env.npcs.filter((o) => o !== this && o.alive && !o.inCabin && o.fleeGoal).map((o) => o.fleeGoal!);
    let best: Point | null = null, bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const p = { x: rf(-9, 9), z: rf(-7, 7) };
      if (!nav.freeAt(p.x, p.z)) continue;
      const dThreat = threat ? Math.hypot(p.x - threat.x, p.z - threat.z) : 6;
      const wall = Math.min(CONFIG.level.halfX - Math.abs(p.x), CONFIG.level.halfZ - Math.abs(p.z));
      let score = Math.min(dThreat, 12) + Math.min(wall, 3) * 1.5 - Math.hypot(p.x - me.x, p.z - me.z) * 0.15;
      if (dThreat < 5) score -= 20;
      if (others.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 2.5)) score -= 6;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best ?? { x: clamp(me.x, -9, 9), z: clamp(me.z, -7, 7) };
  }

  private findNearestThreat(): Vector3 | null {
    const me = this.getWorldPosition();
    let nearest: Vector3 | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    if (this.env.player.alive && this.env.weapon.drawn) {
      const playerPos = this.env.player.getWorldPosition();
      const d = Math.hypot(playerPos.x - me.x, playerPos.z - me.z);
      if (d < nearestDistance && d <= CONFIG.npc.sightRange * 1.5) {
        nearest = playerPos;
        nearestDistance = d;
      }
    }

    // Монстров ищем через metadata дочерних примитивов, не связывая NPC с Monster напрямую.
    const seen = new Set<object>();
    for (const mesh of this.env.scene.meshes) {
      const monster = mesh.metadata?.monster as { alive: boolean; getWorldPosition(): Vector3 } | undefined;
      if (!monster || !monster.alive || seen.has(monster)) continue;
      seen.add(monster);
      const position = monster.getWorldPosition();
      if (Math.abs(position.y - me.y) > 2.5) continue;
      const d = Math.hypot(position.x - me.x, position.z - me.z);
      if (d < nearestDistance && d < 20) {
        nearest = position;
        nearestDistance = d;
      }
    }
    return nearest;
  }

  private chooseFleeTarget(me: Vector3, threat: Vector3 | null) {
    const cab = this.env.cabin.position;

    // Основное направление всегда от угрозы. Боковое смещение ограничено,
    // поэтому случайность не может развернуть NPC обратно к угрозе.
    let awayX = Math.cos(this.fleeSeed);
    let awayZ = Math.sin(this.fleeSeed);
    if (threat) {
      const dx = me.x - threat.x;
      const dz = me.z - threat.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        awayX = dx / d;
        awayZ = dz / d;
      }
    }

    const sideX = -awayZ;
    const sideZ = awayX;
    // Каждый NPC получает свой знак и силу бокового ухода.
    const side = (this.fleeLane >= 0 ? 1 : -1) * rf(0.35, 0.8);
    let dirX = awayX + sideX * side;
    let dirZ = awayZ + sideZ * side;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

    if (this.inCabin && this.env.elevator.exitOpen()) {
      // Выход общий, но точки входа в дверь и дальнейшего движения различаются.
      const lane = clamp(this.fleeLane + rf(-0.3, 0.3), -1.0, 1.0);
      const lateral = lane + side * 0.45;
      return {
        x: cab.x + clamp(lateral, -1.05, 1.05),
        z: cab.z - 3.55,
      };
    }

    if (this.inCabin) {
      const distance = rf(1.0, 2.0);
      return {
        x: cab.x + clamp(this.root.position.x + dirX * distance + sideX * rf(0.4, 1.0), -2.0, 2.0),
        z: cab.z + clamp(this.root.position.z + dirZ * distance + sideZ * rf(0.4, 1.0), -2.0, 2.0),
      };
    }

    // Снаружи выбираем разные дальние точки, но все они находятся дальше от угрозы.
    const distance = rf(4.0, 7.0);
    return {
      x: clamp(me.x + dirX * distance + sideX * rf(-1.5, 1.5), -9.3, 9.3),
      z: clamp(me.z + dirZ * distance + sideZ * rf(-1.5, 1.5), -7.5, 7.5),
    };
  }

  private step(tx: number, tz: number, speed: number, dt: number) {
    const w = this.world(), dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    this.moving = true;
    let ax = dx / d, az = dz / d;

    // Огибаем соседей: отталкиваемся от близких, а тех, кто прямо по ходу, обходим сбоку
    // (каждый NPC в свою сторону), чтобы не упираться друг в друга и не идти колонной.
    const side = this.fleeLane >= 0 ? 1 : -1;
    for (const o of this.env.npcs) {
      if (o === this || !o.alive) continue;
      const q = o.world(), ox = w.x - q.x, oz = w.z - q.z, od = Math.hypot(ox, oz);
      if (od > 1.1 || od < 1e-3) continue;
      const k = (1.1 - od) / 1.1;
      ax += (ox / od) * k * 1.4;
      az += (oz / od) * k * 1.4;
      if (od < 0.95 && (-ox * (dx / d) - oz * (dz / d)) / od > 0.5) { // сосед впереди по ходу
        ax += -(dz / d) * side * k * 1.2;
        az += (dx / d) * side * k * 1.2;
      }
    }
    const len = Math.hypot(ax, az) || 1;
    ax /= len; az /= len;

    const s = Math.min(speed * dt, d);
    this.setWorld(w.x + ax * s, w.z + az * s);
    this.faceTo(Math.atan2(ax, az), dt, 10);
  }

  private setWorld(x: number, z: number) {
    const c = this.root.parent ? this.env.cabin.position : null;
    this.root.position.x = x - (c ? c.x : 0);
    this.root.position.z = z - (c ? c.z : 0);
  }

  private faceTo(yaw: number, dt: number, rate: number) {
    let d = yaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, rate * dt);
  }

  /** Не даём NPC слипаться друг с другом и с игроком. */
  private separate() {
    const me = this.world();
    let x = me.x, z = me.z;
    const push = (ox: number, oz: number, r: number) => {
      const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { x += (dx / d) * (r - d) * 0.5; z += (dz / d) * (r - d) * 0.5; }
    };
    for (const o of this.env.npcs) if (o !== this && o.alive) { const q = o.world(); push(q.x, q.z, 0.6); }
    const pp = this.env.player.body.position;
    push(pp.x, pp.z, 0.8);
    this.setWorld(x, z);
  }

  /** Границы кабины/комнаты; при пересечении порога NPC покидает кабину. */
  private constrain() {
    const p = this.root.position;
    if (this.root.parent === this.env.cabin) {
      const exit = this.env.elevator.exitOpen() && Math.abs(p.x) < (CONFIG.elevator.doorWidth * 0.5 - 0.08);
      p.x = clamp(p.x, -2.2, 2.2);
      p.z = clamp(p.z, exit ? -9 : -2.2, 2.2);
      if (p.z < -2.45) { this.root.setParent(null); this.inCabin = false; }
    } else {
      p.x = clamp(p.x, -9.3, 9.3);
      p.z = clamp(p.z, -7.5, 7.5);
    }
  }

  /** Прямая видимость до глаз игрока (стены и закрытые двери перекрывают). */
  private checkLos(): boolean {
    const env = this.env, w = this.world();
    const y = (this.root.parent ? env.cabin.position.y : this.root.position.y) + 1.5;
    const head = new Vector3(w.x, y, w.z);
    const dir = env.player.getEyeRay(1).origin.subtract(head);
    const dist = dir.length();
    if (dist > CONFIG.npc.sightRange) return false;
    dir.normalize();
    const hit = env.scene.pickWithRay(new Ray(head, dir, dist - 0.1), (m) => m.checkCollisions && !m.metadata?.npc);
    return !hit?.hit;
  }
}

const SLOTS = [[-1.7, 1.9], [0, 1.9], [1.7, 1.9], [-1.7, 0.5], [1.7, 0.5], [-1.7, -0.9], [0.9, 0.4]];
const COLORS = [new Color3(0.6, 0.15, 0.12), new Color3(0.15, 0.3, 0.55), new Color3(0.2, 0.45, 0.22), new Color3(0.55, 0.45, 0.15), new Color3(0.4, 0.4, 0.42)];

/** Расставляет 3–5 NPC со случайным весом по свободным местам в кабине. */
export function spawnNpcs(scene: Scene, cabin: TransformNode): Npc[] {
  const [minN, maxN] = CONFIG.elevator.npcCount;
  const [minW, maxW] = CONFIG.elevator.npcWeight;
  const slots = [...SLOTS].sort(() => Math.random() - 0.5).slice(0, rnd(minN, maxN));
  return slots.map((p) => new Npc(scene, cabin, rnd(minW, maxW), p, Math.random() * Math.PI * 2, COLORS[rnd(0, COLORS.length - 1)]));
}

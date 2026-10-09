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
/** Места NPC в кабине (локальные x, z): решётка 3×3 с шагом 1,6 м — соседние места не ближе 1,6 м друг к другу. */
const CABIN_SLOTS = [[-1.6, 1.6], [0, 1.6], [1.6, 1.6], [-1.6, 0], [0, 0], [1.6, 0], [-1.6, -1.4], [0, -1.4], [1.6, -1.4]];
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
  private fleeSeed = Math.random() * Math.PI * 2;
  private arms: TransformNode[] = [];
  private moving = false;
  private armT = Math.random() * 10;
  private runPhase = rf(0, Math.PI * 2);
  private readonly runRate = rf(10.5, 13.5);
  private static nextId = 0;
  readonly id = Npc.nextId++;
  /** Дошёл до своего места и стоит на нём. Читают и другие NPC, чтобы не выбирать то же место. */
  settled = false;
  private goalT = 0;              // время с выбора текущей цели
  private progT = 0;              // таймер проверки прогресса
  private progRem = Infinity;     // оставшийся путь на прошлой проверке
  private settleT = 0;            // сколько уже стоит на месте
  private nextActT = 0;           // до следующей смены позы / шага / взгляда
  private style = rnd(0, 3);      // поза паники на месте (0 руки вверх, 1 закрылся, 2 присел, 3 машет)
  private faceBias = rf(-0.5, 0.5);
  private crouch = 0;
  private readonly armRate = rf(10.5, 17);   // у каждого своя частота дрожи
  private readonly armAmp = rf(0.22, 0.48);
  private readonly armPhase = rf(0, Math.PI * 2);
  /** Личное место в кабине (индекс в CABIN_SLOTS), -1 — не выбрано. */
  private cabinSlot = -1;
  private slotT = 0;                    // пауза между пересмотрами места
  private cabinOff = { x: 0, z: 0 };    // небольшое смещение от места («переминается»)
  private readonly exitLane = this.id % 2 ? 0.55 : -0.55; // своя полоса у выхода из кабины
  private speed = 0;                    // сглаженная реальная скорость, м/с
  private hdgX = 0;                     // сглаженное направление взгляда
  private hdgZ = 1;
  /** У каждого NPC своя полоса бегства, чтобы группа не стекалась в одну точку. */
  private readonly fleeLane = rf(-1.15, 1.15);

  constructor(scene: Scene, parent: TransformNode, readonly weight: number, pos: number[], yaw: number, color: Color3) {
    this.root = new TransformNode("npc", scene);
    this.root.parent = parent;
    this.root.position.set(pos[0], 0, pos[1]);
    this.root.rotation.y = yaw;
    this.lookYaw = yaw;
    this.hdgX = Math.sin(yaw); this.hdgZ = Math.cos(yaw);
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
    this.root.scaling.y = 1; // мог умереть в приседе
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
    this.flash = Math.max(0, this.flash - dt);
    this.setFlash(this.flash > 0);

    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.25; this.los = this.checkLos(); }

    // Видит оружие — паника; в движущейся кабине успокаиваются; убрал оружие — успокаиваются.
    const threat = this.env.weapon.drawn && this.los;
    const scared = this.locked || (threat && !(this.inCabin && this.env.elevator.moving));
    if (scared) { this.calmT = 0; this.state = "PANIC"; }
    else if (this.state === "PANIC") { this.calmT += dt; if (this.calmT > 1) this.state = "CALM"; }

    const par =
      this.root.parent instanceof TransformNode
        ? this.root.parent
        : null; 
    const px = this.root.position.x, pz = this.root.position.z;
    if (this.state === "PANIC") this.runAround(dt);
    else { this.idle(dt); this.settled = false; this.fleeGoal = null; this.path = []; }
    this.separate();
    this.constrain();
    this.trackMotion(dt, par, px, pz);
    this.animateArms(dt);
  }

  /**
   * «Движется» определяется по реальному смещению за кадр (со сглаживанием и гистерезисом), а не по намерению идти.
   * Иначе в тесноте NPC упирается в стену или соседа, флаг мигает, и руки дёргаются между бегом и позой паники.
   */
  private trackMotion(dt: number, par: TransformNode | null, px: number, pz: number) {
    if (this.root.parent === par) { // при выходе из кабины система координат меняется — этот кадр пропускаем
      const v = Math.hypot(this.root.position.x - px, this.root.position.z - pz) / Math.max(dt, 1e-3);
      this.speed += (v - this.speed) * Math.min(1, dt * 8);
    }
    if (this.moving ? this.speed < 0.35 : this.speed > 0.8) this.moving = !this.moving;
  }

  /**
   * Руки: в покое чуть покачиваются, при беге машут в противофазе. В панике на месте у каждого NPC своя
   * поза (руки вверх / закрылся / присел / машет), своя частота и фаза дрожи, поза периодически меняется.
   */
  private animateArms(dt: number) {
    this.armT += dt;
    if (this.moving) this.runPhase += dt * this.runRate;
    const panic = this.state === "PANIC", still = panic && !this.moving;
    const k = Math.min(1, dt * (still ? 9 : 14));
    this.crouch += ((still && this.settled && this.style === 2 ? 1 : 0) - this.crouch) * Math.min(1, dt * 6);
    this.root.scaling.y += (1 - 0.16 * this.crouch - this.root.scaling.y) * Math.min(1, dt * 8);
    this.arms.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      const t = this.armT * this.armRate + this.armPhase + i * 2.1;  // у каждой руки своя фаза
      const drift = Math.sin(this.armT * 0.9 + this.armPhase * 1.7); // медленный дрейф ломает строгую периодичность
      let x: number, z: number;
      if (panic && this.moving) { x = Math.sin(this.runPhase + (i ? Math.PI : 0)) * 0.95; z = s * 0.12; }
      else if (panic) {
        switch (this.style) {
          case 1:  x = -1.95 + Math.sin(t) * 0.12; z = -s * (0.5 + 0.12 * drift); break;                  // закрыл лицо
          case 2:  x = -2.7 + Math.sin(t) * 0.18 + Math.sin(t * 1.9) * 0.05; z = -s * 0.2; break;          // присел, руки над головой
          case 3:  x = -1.6 + Math.sin(this.armT * (4.5 + this.armAmp * 4) + this.armPhase + i * Math.PI) * 0.9;
                   z = s * (0.55 + 0.25 * Math.sin(t * 0.5)); break;                                      // машет руками
          default: x = -2.1 + Math.sin(t) * this.armAmp + Math.sin(t * 1.9) * 0.05; z = s * (0.35 + 0.1 * drift); // руки вверх
        }
      }
      else { x = Math.sin(this.armT * 1.3 + this.armPhase + i * 1.7) * 0.05; z = s * 0.05; }
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
    if (this.inCabin) { this.cabinPanic(dt, sp); return; }
    const now = this.getWorldPosition();

    // Снаружи кабины: разбегаемся по открытой части комнаты по маршруту, а не жмёмся к стенам цепочкой.
    const nav = env.nav?.(Math.round(this.root.position.y / CONFIG.elevator.floorHeight)) ?? null;
    if (nav) { this.fleeOutside(dt, now, nav, sp); return; }

    this.retarget -= dt;
    if (this.retarget <= 0 || Math.hypot(this.tw.x - now.x, this.tw.z - now.z) < 0.45) {
      this.retarget = rf(0.45, 0.9);
      const threat = this.findNearestThreat();
      this.tw = this.chooseSpacedTarget(now, threat);
      this.fleeSeed += rf(0.7, 1.8);
    }
    this.step(this.tw.x, this.tw.z, sp, dt);
  }

  /**
   * Несколько вариантов цели; берём ту, что дальше всех от позиций и целей остальных NPC. Иначе все бегут
   * в одну и ту же точку, упираются друг в друга и кружат рядом.
   */
  private chooseSpacedTarget(me: Vector3, threat: Vector3 | null) {
    const others = this.env.npcs.filter((o) => o !== this && o.alive);
    let best = this.chooseFleeTarget(me, threat), bestScore = -Infinity;
    for (let k = 0; k < 6; k++) {
      const c = k === 0 ? best : this.chooseFleeTarget(me, threat);
      let score = 3;
      for (const o of others) {
        const q = o.world();
        score = Math.min(score, Math.hypot(q.x - c.x, q.z - c.z));
        if (o.state === "PANIC" && (o.tw.x !== 0 || o.tw.z !== 0)) score = Math.min(score, Math.hypot(o.tw.x - c.x, o.tw.z - c.z));
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /**
   * Паника в кабине. Кабина тесная, поэтому никакой беготни: у каждого NPC своё место на решётке, он идёт
   * на него и там переминается и меняет позы. Если выход открыт — выходят двумя полосами, по очереди.
   */
  private cabinPanic(dt: number, sp: number) {
    const P = CONFIG.npc.panic, p = this.root.position;
    if (this.env.elevator.exitOpen()) { this.cabinExit(dt, sp); return; }

    // Игрок стоит на моём месте — занимаю другое (игрок толкается, и NPC дёргался бы взад-вперёд).
    this.slotT -= dt;
    const pl = this.playerInCabin();
    if (this.cabinSlot >= 0 && pl && this.slotT <= 0) {
      const cs = CABIN_SLOTS[this.cabinSlot];
      if (Math.hypot(cs[0] - pl.x, cs[1] - pl.z) < 1.0) { this.cabinSlot = -1; this.cabinOff = { x: 0, z: 0 }; }
    }
    if (this.cabinSlot < 0) { this.cabinSlot = this.claimCabinSlot(pl); this.slotT = 1.5; }
    const s = CABIN_SLOTS[this.cabinSlot], tx = s[0] + this.cabinOff.x, tz = s[1] + this.cabinOff.z;
    const d = Math.hypot(tx - p.x, tz - p.z);
    const nudging = this.cabinOff.x !== 0 || this.cabinOff.z !== 0;
    if (d > 0.1) this.cabinStep(dt, tx, tz, sp * P.cabinSpeed * (nudging && d < 0.8 ? 0.4 : 1));

    this.settled = d < 0.6;
    if (!this.settled) return;
    // На месте: оглядывается / смотрит на угрозу, раз в несколько секунд меняет позу и переминается.
    this.settleT += dt;
    this.nextActT -= dt;
    const w = this.world(), threat = this.findNearestThreat();
    if (d <= 0.1) {
      if (threat) this.faceTo(Math.atan2(threat.x - w.x, threat.z - w.z) + this.faceBias, dt, 4);
      else {
        this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = rf(0.8, 2); this.lookYaw = this.root.rotation.y + rf(-1.8, 1.8); }
        this.faceTo(this.lookYaw, dt, 5);
      }
    }
    if (this.nextActT > 0) return;
    this.nextActT = rf(P.actInterval[0], P.actInterval[1]);
    this.style = (this.style + rnd(1, 3)) % 4;
    this.faceBias = rf(-0.6, 0.6);
    this.cabinOff = Math.random() < 0.5 ? { x: rf(-P.cabinOffset, P.cabinOffset), z: rf(-P.cabinOffset, P.cabinOffset) } : { x: 0, z: 0 };
  }

  /** Локальная позиция игрока, если он в кабине (иначе null). */
  private playerInCabin(): { x: number; z: number } | null {
    const env = this.env, pl = env.player;
    if (!pl.alive) return null;
    const pp = pl.body.position, c = env.cabin.position;
    if (Math.abs(pp.y - c.y) > 3 || Math.abs(pp.x - c.x) > 2.6 || Math.abs(pp.z - c.z) > 2.6) return null;
    return { x: pp.x - c.x, z: pp.z - c.z };
  }

  /** Свободное место в кабине, ближайшее к текущей позиции (не под игроком). */
  private claimCabinSlot(pl: { x: number; z: number } | null): number {
    const taken = new Set<number>();
    for (const o of this.env.npcs) if (o !== this && o.alive && o.inCabin && o.cabinSlot >= 0) taken.add(o.cabinSlot);
    const p = this.root.position;
    let best = 0, bd = Infinity;
    CABIN_SLOTS.forEach((s, i) => {
      if (taken.has(i) || (pl && Math.hypot(s[0] - pl.x, s[1] - pl.z) < 1.0)) return;
      const d = Math.hypot(s[0] - p.x, s[1] - p.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Выход из кабины: у каждого своя полоса (±0,55 м от оси двери), задний притормаживает за передним. */
  private cabinExit(dt: number, sp: number) {
    const p = this.root.position;
    let k = 1;
    for (const o of this.env.npcs) {
      if (o === this || !o.alive || !o.inCabin) continue;
      const q = o.root.position;
      if (q.z < p.z && p.z - q.z < 1.1 && Math.abs(q.x - p.x) < 0.5) k = 0.4;
    }
    this.settled = false;
    this.cabinSlot = -1; // после выхода/закрытия двери выберет место заново
    this.cabinOff = { x: 0, z: 0 };
    this.cabinStep(dt, this.exitLane, -3.2, sp * k);
  }

  /** Шаг внутри кабины в локальных координатах (кабина может трястись и ехать — NPC едет вместе с ней). */
  private cabinStep(dt: number, tx: number, tz: number, speed: number) {
    const p = this.root.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.03) return;
    let ax = dx / d, az = dz / d;
    for (const o of this.env.npcs) {
      if (o === this || !o.alive || !o.inCabin) continue;
      const q = o.root.position, ox = p.x - q.x, oz = p.z - q.z, od = Math.hypot(ox, oz);
      if (od > 1.0 || od < 1e-3) continue;
      const k = 1 - od;
      ax += (ox / od) * k * 1.2;
      az += (oz / od) * k * 1.2;
    }
    const pl = this.playerInCabin();
    if (pl) {
      const ox = p.x - pl.x, oz = p.z - pl.z, od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 1e-3) { ax += (ox / od) * (1.1 - od) * 1.2; az += (oz / od) * (1.1 - od) * 1.2; }
    }
    const len = Math.hypot(ax, az) || 1;
    ax /= len; az /= len;
    const s = Math.min(speed * dt, d);
    p.x += ax * s;
    p.z += az * s;
    this.faceHeading(ax, az, dt);
  }

  /** Плавный разворот по направлению движения (без дёрганья от смены сил отталкивания). */
  private faceHeading(ax: number, az: number, dt: number) {
    const k = Math.min(1, dt * 7);
    this.hdgX += (ax - this.hdgX) * k;
    this.hdgZ += (az - this.hdgZ) * k;
    if (Math.hypot(this.hdgX, this.hdgZ) > 0.05) this.faceTo(Math.atan2(this.hdgX, this.hdgZ), dt, 10);
  }

  /**
   * Бегство снаружи. Цель — свободная клетка в открытой части комнаты (не у стены, далеко от угрозы,
   * на расстоянии от целей и позиций других NPC); к ней ведёт маршрут A*, обходящий предметы.
   * Цель меняется, если угроза приблизилась, место заняли, либо NPC не приближается к нему (кружит).
   * Дойдя до места, NPC не замирает: меняет позу, поворачивается к угрозе, переступает.
   */
  private fleeOutside(dt: number, now: { x: number; z: number }, nav: NavGrid, sp: number) {
    const P = CONFIG.npc.panic;
    const threat = this.findNearestThreat();
    this.retarget -= dt;
    this.pathT -= dt;
    this.goalT += dt;
    const goalNearThreat = !!(this.fleeGoal && threat && Math.hypot(this.fleeGoal.x - threat.x, this.fleeGoal.z - threat.z) < 5);
    const threatClose = !!(threat && Math.hypot(now.x - threat.x, now.z - threat.z) < 6);

    if (!this.fleeGoal || (this.retarget <= 0 && (goalNearThreat || threatClose))) {
      this.assignGoal(now, threat, nav, null);
    } else if (this.goalT > 0.4 && !this.settled && this.goalTaken(now, this.fleeGoal)) {
      this.assignGoal(now, threat, nav, this.fleeGoal); // моё место занял другой — иду в другое
    }
    const goal = this.fleeGoal;
    if (!goal) return;

    // Маршрут обновляется раз в ~0.8 с.
    if (this.pathT <= 0) {
      this.pathT = 0.8;
      this.path = nav.findPath(now.x, now.z, goal.x, goal.z) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - now.x, this.path[0].z - now.z) < 0.5) this.path.shift();

    const dGoal = Math.hypot(goal.x - now.x, goal.z - now.z);
    if (this.settled && dGoal > P.arriveRadius + 1.2) this.settled = false; // вытолкнули с места
    if (!this.settled && dGoal < P.arriveRadius) this.settle();

    if (this.settled) { this.settledBehavior(dt, now, threat, nav); return; }

    const wp = this.path[0] ?? goal;
    this.step(wp.x, wp.z, sp, dt);

    // Раз в секунду проверяем, сокращается ли оставшийся путь. Если нет — NPC топчется или кружит
    // вокруг другого NPC (смещение при этом большое, поэтому сравнивать надо путь до цели, а не позицию).
    this.progT += dt;
    if (this.progT >= 1) {
      this.progT = 0;
      const rem = this.remaining(now, goal);
      if (this.progRem - rem < P.minProgress) {
        if (rem < P.settleNear && nav.freeAt(now.x, now.z)) {
          this.fleeGoal = { x: now.x, z: now.z }; // уже рядом, но место занято — остаёмся, где стоим
          this.settle();
        } else {
          this.assignGoal(now, threat, nav, goal);
        }
      } else this.progRem = rem;
    }
  }

  private settle() {
    this.settled = true;
    this.settleT = 0;
    this.nextActT = rf(CONFIG.npc.panic.actInterval[0], CONFIG.npc.panic.actInterval[1]);
  }

  private assignGoal(now: { x: number; z: number }, threat: Vector3 | null, nav: NavGrid, avoid: Point | null) {
    this.fleeGoal = this.pickFleeCell(now, threat, nav, avoid);
    this.retarget = 1.2;
    this.pathT = 0;
    this.goalT = 0;
    this.progT = 0;
    this.progRem = Infinity;
    this.settled = false;
    this.path = [];
  }

  /** Длина оставшегося пути до цели (по точкам маршрута). */
  private remaining(now: { x: number; z: number }, goal: Point): number {
    let rem = 0, px = now.x, pz = now.z;
    for (const p of this.path) { rem += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
    return rem + Math.hypot(goal.x - px, goal.z - pz);
  }

  /** Место занято: другой NPC уже стоит у цели ближе меня, либо его цель почти совпала с моей (уступает младший id). */
  private goalTaken(now: { x: number; z: number }, goal: Point): boolean {
    const P = CONFIG.npc.panic, mine = Math.hypot(goal.x - now.x, goal.z - now.z);
    for (const o of this.env.npcs) {
      if (o === this || !o.alive || o.inCabin) continue;
      const q = o.world(), dq = Math.hypot(q.x - goal.x, q.z - goal.z);
      if (dq < P.goalSpacing * 0.5 && dq < mine) return true;
      if (o.fleeGoal && Math.hypot(o.fleeGoal.x - goal.x, o.fleeGoal.z - goal.z) < P.goalSpacing * 0.75 && (o.settled || o.id < this.id)) return true;
    }
    return false;
  }

  /** Стоит на месте в панике: оглядывается / поворачивается к угрозе, иногда меняет позу, переступает или перебегает. */
  private settledBehavior(dt: number, now: { x: number; z: number }, threat: Vector3 | null, nav: NavGrid) {
    const P = CONFIG.npc.panic;
    this.settleT += dt;
    this.nextActT -= dt;
    if (threat) this.faceTo(Math.atan2(threat.x - now.x, threat.z - now.z) + this.faceBias, dt, 4);
    else {
      this.lookT -= dt;
      if (this.lookT <= 0) { this.lookT = rf(0.8, 2); this.lookYaw = this.root.rotation.y + rf(-1.8, 1.8); }
      this.faceTo(this.lookYaw, dt, 5);
    }
    if (this.nextActT > 0) return;
    this.nextActT = rf(P.actInterval[0], P.actInterval[1]);
    this.style = (this.style + rnd(1, 3)) % 4; // другая поза, чем сейчас
    this.faceBias = rf(-0.6, 0.6);
    const r = Math.random();
    if (r < P.relocateChance && this.settleT > P.relocateAfter) this.assignGoal(now, threat, nav, this.fleeGoal);
    else if (r < 0.55) this.nudge(now, nav);
  }

  /** Короткий шаг в сторону на свободное место (не вплотную к другим NPC и их целям). */
  private nudge(now: { x: number; z: number }, nav: NavGrid) {
    const P = CONFIG.npc.panic;
    const others = this.env.npcs.filter((o) => o !== this && o.alive && !o.inCabin);
    for (let i = 0; i < 8; i++) {
      const a = rf(0, Math.PI * 2), d = rf(P.nudgeRange[0], P.nudgeRange[1]);
      const p = { x: now.x + Math.cos(a) * d, z: now.z + Math.sin(a) * d };
      if (!nav.freeAt(p.x, p.z) || !nav.lineFree(now.x, now.z, p.x, p.z)) continue;
      if (others.some((o) => {
        const q = o.world(), g = o.fleeGoal;
        return Math.hypot(q.x - p.x, q.z - p.z) < 1.2 || (!!g && Math.hypot(g.x - p.x, g.z - p.z) < 1.2);
      })) continue;
      this.fleeGoal = p;
      this.settled = false;
      this.goalT = 0; this.progT = 0; this.progRem = Infinity;
      this.path = []; this.pathT = 0.8; // короткий шаг — маршрут не нужен
      return;
    }
  }

  private pickFleeCell(me: { x: number; z: number }, threat: Vector3 | null, nav: NavGrid, avoid: Point | null = null): Point {
    const P = CONFIG.npc.panic;
    // Занятые места: цели и текущие позиции остальных NPC снаружи.
    const taken: Point[] = [];
    for (const o of this.env.npcs) {
      if (o === this || !o.alive || o.inCabin) continue;
      taken.push(o.world());
      if (o.fleeGoal) taken.push(o.fleeGoal);
    }
    let best: Point | null = null, bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const p = { x: rf(-9, 9), z: rf(-7, 7) };
      if (!nav.freeAt(p.x, p.z)) continue;
      const dThreat = threat ? Math.hypot(p.x - threat.x, p.z - threat.z) : 6;
      const wall = Math.min(CONFIG.level.halfX - Math.abs(p.x), CONFIG.level.halfZ - Math.abs(p.z));
      let score = Math.min(dThreat, 12) + Math.min(wall, 3) * 1.5 - Math.hypot(p.x - me.x, p.z - me.z) * 0.15;
      if (dThreat < 5) score -= 20;
      if (taken.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < P.goalSpacing)) score -= 100; // почти запрет; остаётся лишь как запасной вариант
      if (avoid && Math.hypot(avoid.x - p.x, avoid.z - p.z) < P.avoidRadius) score -= 100;
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
    // + «веер» по id: разным NPC достаются разные углы ухода от угрозы.
    const side = (this.fleeLane >= 0 ? 1 : -1) * rf(0.35, 0.8) + ((this.id % 5) - 2) * 0.25;
    let dirX = awayX + sideX * side;
    let dirZ = awayZ + sideZ * side;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

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
    let ax = dx / d, az = dz / d;

    // Огибаем соседей: отталкиваемся от близких, а тех, кто прямо по ходу, обходим сбоку
    // (каждый NPC в свою сторону), чтобы не упираться друг в друга и не идти колонной.
    const side = this.fleeLane >= 0 ? 1 : -1, hx = dx / d, hz = dz / d;
    for (const o of this.env.npcs) {
      if (o === this || !o.alive) continue;
      const q = o.world(), ox = w.x - q.x, oz = w.z - q.z, od = Math.hypot(ox, oz);
      if (od > 1.1 || od < 1e-3) continue;
      const k = (1.1 - od) / 1.1;
      ax += (ox / od) * k * 1.4;
      az += (oz / od) * k * 1.4;
      if (od < 0.95 && (-ox * hx - oz * hz) / od > 0.5) { // сосед впереди по ходу
        // Обходим с той стороны, куда я уже смещён относительно линии хода: так встречные расходятся,
        // а не уходят в одну сторону зеркально. Свой знак (fleeLane) — только если сосед ровно по курсу.
        const lat = ox * -hz + oz * hx;
        const sg = Math.abs(lat) > 0.12 ? Math.sign(lat) : side;
        ax += -hz * sg * k * 1.2;
        az += hx * sg * k * 1.2;
      }
    }
    const len = Math.hypot(ax, az) || 1;
    ax /= len; az /= len;

    const s = Math.min(speed * dt, d);
    this.setWorld(w.x + ax * s, w.z + az * s);
    this.faceHeading(ax, az, dt);
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

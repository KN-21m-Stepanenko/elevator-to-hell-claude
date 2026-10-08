import { Color3, Scene, TransformNode, Vector3 } from "@babylonjs/core";

import { CONFIG } from "../config";

import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";

import { AttackSlots } from "./AttackSlots";
import { FlyingMonster } from "./FlyingMonster";
import { GrenadeDirector } from "./GrenadeDirector";
import { GrenadeSystem } from "./Grenades";
import { Monster, randomInt } from "./Monster";
import { isAirFree, NavGrid, staticBoxes } from "./NavGrid";
import { WalkerMonster } from "./WalkerMonster";

const WALKER_COLORS = [
  new Color3(0.32, 0.34, 0.31),
  new Color3(0.42, 0.24, 0.2),
  new Color3(0.28, 0.31, 0.38),
];

/** Управляет волной монстров после прибытия лифта на боевой этаж. */
export class MonsterManager {
  private monsters: Monster[] = [];
  private startedFloors = new Set<number>();
  private waveMonsters = new Map<number, Monster[]>();
  private victory = false;
  private frozen = false;
  private activeFloor: number | null = null;
  private readonly navs = new Map<number, NavGrid>();
  private readonly slots = new AttackSlots();
  private slotTimer = 0;
  private readonly grenades: GrenadeSystem;
  private readonly director: GrenadeDirector;
  private doorOpen: () => boolean = () => false;

  onVictory: (floor: number) => void = () => {};

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly npcs: Npc[],
    private readonly cabin: TransformNode,
    private readonly say: (text: string, ms?: number) => void,
  ) {
    this.grenades = new GrenadeSystem(scene, player, npcs);
    this.director = new GrenadeDirector(scene, player, cabin, this.grenades, say, () => this.doorOpen());
  }

  /** Открыты ли двери кабины на этаже: граната может залететь в лифт только через открытую дверь. */
  setDoorOpenProvider(fn: () => boolean) {
    this.doorOpen = fn;
  }

  update(dt: number) {
    if (!this.frozen) this.grenades.update(dt);

    for (const monster of this.monsters) {
      if (!this.frozen || !monster.alive) monster.update(dt);
    }

    this.monsters = this.monsters.filter((m) => m.alive || !m.deathFinished);

    // Раздача мест вокруг целей и решения о бросках гранат — только пока идёт бой.
    if (!this.frozen && !this.victory && this.activeFloor !== null) {
      const wave = this.waveMonsters.get(this.activeFloor) ?? [];
      this.slotTimer -= dt;
      if (this.slotTimer <= 0) {
        this.slotTimer = 0.3;
        const nav = this.navs.get(this.activeFloor);
        if (nav) this.slots.assign(wave.filter((m): m is WalkerMonster => m instanceof WalkerMonster), nav);
      }
      this.director.update(dt, this.activeFloor, wave);
    }

    for (const [floor, group] of this.waveMonsters) {
      const aliveOnFloor = group.filter((m) => m.alive);

      this.waveMonsters.set(
        floor,
        aliveOnFloor.concat(group.filter((m) => !m.alive)),
      );

      if (this.player.alive && !this.victory && aliveOnFloor.length === 0) {
        this.victory = true;
        this.onVictory(floor);
      }
    }
  }

  freezeLiving() {
    this.frozen = true;
  }

  spawnForFloor(floor: number) {
    if (
      this.startedFloors.has(floor) ||
      floor < 1 ||
      floor > 4 ||
      !this.player.alive
    ) {
      return;
    }

    this.startedFloors.add(floor);
    this.activeFloor = floor;
    this.director.reset();
    this.npcs.forEach((n) => n.scare());

    const before = this.monsters.length;

    if (floor === 4) this.spawnFlying();
    else this.spawnWalking(floor);

    const wave = this.monsters.slice(before);

    wave.forEach((m) => m.setPeerProvider(() => this.monsters));
    this.waveMonsters.set(floor, wave);
  }

  /** Навигационная сетка этажа строится один раз, когда уровень уже собран. */
  private navFor(floor: number) {
    let nav = this.navs.get(floor);
    if (!nav) {
      const W = CONFIG.monsters.walker;
      nav = new NavGrid(staticBoxes(this.scene), floor * CONFIG.elevator.floorHeight, W.radius + 0.12, W.bodyHeight);
      this.navs.set(floor, nav);
    }
    return nav;
  }

  private spawnWalking(floor: number) {
    const count = randomInt(CONFIG.monsters.walker.count[0], CONFIG.monsters.walker.count[1]);
    const nav = this.navFor(floor);
    // Только свободные клетки, достижимые от лифта: не внутри объектов, не в замкнутых нишах.
    const points = nav.pickSpawns(count, { x: 0, z: CONFIG.level.halfZ - 0.5 }, 6, 3.5);
    const y = floor * CONFIG.elevator.floorHeight;
    points.forEach((p, i) => {
      this.monsters.push(new WalkerMonster(
        this.scene,
        new Vector3(p.x + (Math.random() - 0.5) * 0.2, y, p.z + (Math.random() - 0.5) * 0.2),
        floor,
        this.player,
        this.npcs,
        WALKER_COLORS[i % WALKER_COLORS.length],
        nav,
      ));
    });
  }

  private spawnFlying() {
    const F = CONFIG.monsters.flying;
    const count = randomInt(F.count[0], F.count[1]);
    const center = this.cabin.position.clone();
    const baseY = center.y + F.orbitHeight;
    const boxes = staticBoxes(this.scene);

    for (let i = 0; i < count; i++) {
      // Точка появления свободна от стен и предметов: при занятости сдвигаем угол и поднимаем выше.
      let position = new Vector3();
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35 + attempt * 0.4;
        const radius = F.orbitRadiusMin + Math.random() * (F.orbitRadiusMax - F.orbitRadiusMin);
        position = new Vector3(center.x + Math.cos(angle) * radius, baseY + attempt * 0.4, center.z + Math.sin(angle) * radius);
        if (isAirFree(boxes, position, 0.8)) break;
      }
      this.monsters.push(new FlyingMonster(
        this.scene, position, center, this.player, this.npcs, new Color3(0.2 + i * 0.08, 0.22, 0.24),
      ));
    }
  }

  get aliveCount() {
    return this.monsters.filter((m) => m.alive).length;
  }
}
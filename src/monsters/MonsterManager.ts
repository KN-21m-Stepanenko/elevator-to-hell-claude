import { Color3, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { FlyingMonster } from "./FlyingMonster";
import { Monster, randomInt } from "./Monster";
import { WalkerMonster } from "./WalkerMonster";

const WALKER_COLORS = [
  new Color3(0.32, 0.34, 0.31),
  new Color3(0.42, 0.24, 0.2),
  new Color3(0.28, 0.31, 0.38),
];

const WALKER_SPAWN = [
  [-6.5, -5.5], [0, -5.8], [6.5, -5.5],
  [-7, 1.5], [7, 1.5], [-5, 5.2], [5, 5.2],
];

/** Управляет волной монстров после прибытия лифта на боевой этаж. */
export class MonsterManager {
  private monsters: Monster[] = [];
  private startedFloors = new Set<number>();
  private waveMonsters = new Map<number, Monster[]>();
  private victory = false;
  private frozen = false;

  onVictory: (floor: number) => void = () => {};

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly npcs: Npc[],
    private readonly cabin: TransformNode,
    private readonly say: (text: string, ms?: number) => void,
  ) {}

  update(dt: number) {
    for (const monster of this.monsters) {
      if (!this.frozen || !monster.alive) monster.update(dt);
    }

    this.monsters = this.monsters.filter((m) => m.alive || !m.deathFinished);

    for (const [floor, group] of this.waveMonsters) {
      const aliveOnFloor = group.filter((m) => m.alive);
      this.waveMonsters.set(floor, aliveOnFloor.concat(group.filter((m) => !m.alive)));
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
    if (this.startedFloors.has(floor) || floor < 1 || floor > 4 || !this.player.alive) return;

    this.startedFloors.add(floor);
    this.npcs.forEach((n) => n.scare());

    const before = this.monsters.length;
    if (floor === 4) this.spawnFlying();
    else this.spawnWalking(floor);
    const wave = this.monsters.slice(before);
    wave.forEach((m) => m.setPeerProvider(() => this.monsters));
    this.waveMonsters.set(floor, wave);

    const count = wave.length;
  }

  private spawnWalking(floor: number) {
    const count = randomInt(CONFIG.monsters.walker.count[0], CONFIG.monsters.walker.count[1]);
    const points = WALKER_SPAWN.slice().sort(() => Math.random() - 0.5);
    const y = floor * CONFIG.elevator.floorHeight;
    for (let i = 0; i < count; i++) {
      const [x, z] = points[i % points.length];
      this.monsters.push(new WalkerMonster(
        this.scene,
        new Vector3(x, y, z),
        floor,
        this.player,
        this.npcs,
        WALKER_COLORS[i % WALKER_COLORS.length],
      ));
    }
  }

  private spawnFlying() {
    const count = randomInt(CONFIG.monsters.flying.count[0], CONFIG.monsters.flying.count[1]);
    const center = this.cabin.position.clone();
    const baseY = center.y + CONFIG.monsters.flying.orbitHeight;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35;
      const radius = CONFIG.monsters.flying.orbitRadiusMin + Math.random() * (CONFIG.monsters.flying.orbitRadiusMax - CONFIG.monsters.flying.orbitRadiusMin);
      const position = new Vector3(
        center.x + Math.cos(angle) * radius,
        baseY,
        center.z + Math.sin(angle) * radius,
      );
      this.monsters.push(new FlyingMonster(
        this.scene,
        position,
        center,
        this.player,
        this.npcs,
        new Color3(0.2 + i * 0.08, 0.22, 0.24),
      ));
    }
  }

  get aliveCount() {
    return this.monsters.filter((m) => m.alive).length;
  }
}

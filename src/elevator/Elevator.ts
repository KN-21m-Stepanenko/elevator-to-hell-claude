import { Color3, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { DeathCause, Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { CabinPanel, ButtonKey } from "./CabinPanel";
import { Door } from "./Door";

/** Конечный автомат лифта, включая лаву и аварийное падение (этап 5). */
export type ElevatorState =
  | "IDLE" | "CLOSING" | "OVERLOADED" | "MOVING" | "OPENING"
  | "LAVA" | "EMERGENCY_WAIT" | "EMERGENCY_BREAK" | "EMERGENCY_FALL" | "EMERGENCY_CRASHED";

export class Elevator {
  state: ElevatorState = "IDLE";
  floor = CONFIG.elevator.startFloor;
  weight = 0;
  onArrived: (floor: number) => void = () => {};
  private selected: number | null = null;
  private readonly panel: CabinPanel;
  private time = 0;
  private readonly root: TransformNode;
  private readonly door: Door;
  private fatalTimer = 0;
  private emergencyVelocity = 0;
  private emergencyFallDistance = 0;
  private shakeTime = 0;
  private baseX = 0;
  private baseZ = 0;
  private prevShakeX = 0;
  private prevShakeZ = 0;
  private readonly cables: Mesh[] = [];
  private readonly cableBaseY: number[] = [];
  private readonly emergencyLight: PointLight;
  private cableBreakProgress = 0;
  /** Игрок едет в кабине в опасном режиме: его жёстко удерживаем внутри. */
  private rideLock = false;
  private wasHazard = false;
  private lavaPanic = false;
  private lavaTouched = false;

  constructor(
    private readonly scene: Scene,
    cabin: { root: TransformNode; door: Door }, private readonly landing: Map<number, Door>,
    private readonly player: Player, private readonly npcs: Npc[], private readonly say: (t: string) => void,
  ) {
    this.root = cabin.root;
    this.door = cabin.door;
    this.panel = new CabinPanel(scene, cabin.root);
    this.emergencyLight = new PointLight("emergency_red_light", new Vector3(0, CONFIG.elevator.cabinHeight - 0.25, 0), scene);
    this.emergencyLight.parent = this.root;
    this.emergencyLight.diffuse = new Color3(1, 0.03, 0.02);
    this.emergencyLight.specular = Color3.Black();
    this.emergencyLight.range = 8;
    this.emergencyLight.intensity = 0;
    this.createEmergencyCables();
  }

  get moving() { return this.state === "MOVING"; }

  /** Двери открыты и кабина не находится в опасном режиме. */
  exitOpen(): boolean {
    if (this.state === "LAVA" || this.state.startsWith("EMERGENCY")) return false;
    const l = this.landing.get(this.floor);
    return this.door.open > 0.7 && !!l && l.open > 0.7;
  }

  playerInside(): boolean {
    const E = CONFIG.elevator, p = this.player.body.position, r = this.root.position, half = E.cabinSize / 2;
    const feet = p.y - CONFIG.player.ellipsoid.y;
    return Math.abs(p.x - r.x) < half && p.z > r.z - half + 0.5 && p.z < r.z + half && feet > r.y - 0.3 && feet < r.y + E.cabinHeight;
  }

  private computeWeight(): number {
    const npcW = this.npcs.reduce((sum, n) => sum + (n.alive && n.inCabin ? n.weight : 0), 0);
    return npcW + (this.playerInside() ? CONFIG.elevator.playerWeight : 0);
  }

  pickKey(): ButtonKey | null {
    if (!this.playerInside() || this.state.startsWith("EMERGENCY") || this.state === "LAVA") return null;
    const ray = this.player.getEyeRay(CONFIG.elevator.reach);
    const hit = this.scene.pickWithRay(ray, (m) => m.metadata?.button !== undefined);
    return hit?.hit && hit.pickedMesh ? (hit.pickedMesh.metadata.button as ButtonKey) : null;
  }

  press(key: ButtonKey) {
    if (key === "stop") {
      this.triggerEmergencyStop();
      return;
    }
    if (this.state === "EMERGENCY_WAIT" || this.state === "EMERGENCY_BREAK" || this.state === "EMERGENCY_FALL" || this.state === "EMERGENCY_CRASHED" || this.state === "LAVA") return;
    if (this.state === "MOVING") return;

    const here = this.landing.get(this.floor);
    if (key === this.floor) {
      if ((this.state === "CLOSING" || this.state === "OVERLOADED") && here) {
        this.selected = null; this.panel.setSelected(null);
        this.state = "OPENING"; this.door.setOpen(true); here.setOpen(true);
      }
      return;
    }

    this.selected = key;
    this.panel.setSelected(key);
    if (this.state === "IDLE" || this.state === "OPENING") {
      this.state = "CLOSING";
      this.door.setOpen(false);
      here?.setOpen(false);
    }
  }

  update(dt: number) {
    const E = CONFIG.elevator;
    this.time += dt;
    this.door.update(dt);
    this.landing.forEach((d) => d.update(dt));
    this.weight = this.computeWeight();
    this.updateRideLock();
    this.checkCrush();

    switch (this.state) {
      case "CLOSING": this.updateClosing(E); break;
      case "OVERLOADED": if (this.weight <= E.weightLimit) this.state = "MOVING"; break;
      case "MOVING": this.move(dt); break;
      case "OPENING": this.updateOpening(); break;
      case "LAVA": this.updateLava(dt); break;
      case "EMERGENCY_WAIT": this.updateEmergencyWait(dt); break;
      case "EMERGENCY_BREAK": this.updateEmergencyBreak(dt); break;
      case "EMERGENCY_FALL": this.updateEmergencyFall(dt); break;
      case "EMERGENCY_CRASHED": this.updateShake(dt); break;
    }

    const travelling = this.state === "MOVING" && this.selected !== null;
    const shown = travelling
      ? (this.selected === CONFIG.lava.floor ? CONFIG.lava.floor : Math.round(this.root.position.y / E.floorHeight))
      : this.floor;
    const dir = travelling ? Math.sign(this.selected! * E.floorHeight - this.root.position.y) : 0;
    const alarm = this.state === "OVERLOADED";
    const emergency = this.state === "EMERGENCY_WAIT" || this.state === "EMERGENCY_BREAK" || this.state === "EMERGENCY_FALL" || this.state === "EMERGENCY_CRASHED";
    const flashOn = Math.floor(this.time * 4.5) % 2 === 0;
    const glitchTick = Math.floor(this.time * 12);
    this.emergencyLight.intensity = emergency ? (flashOn ? 4.8 : 0.35) : 0;
    this.panel.setBoard(this.weight, E.weightLimit, alarm, Math.floor(this.time * 2.5) % 2 === 0, String(shown), dir, emergency, glitchTick);
    this.checkVoid();
  }

  private updateClosing(E: typeof CONFIG.elevator) {
    const here = this.landing.get(this.floor);
    if (!this.door.isClosed || (here && !here.isClosed)) return;
    if (this.weight > E.weightLimit) {
      this.state = "OVERLOADED";
      this.say(`Перевантаження! Ліфт не поїде, поки вага більше ${E.weightLimit} кг`);
    } else {
      this.state = "MOVING";
    }
  }

  private updateOpening() {
    const here = this.landing.get(this.floor);
    if (this.door.isOpen && (!here || here.isOpen)) this.state = "IDLE";
  }

  private move(dt: number) {
    const E = CONFIG.elevator;
    const targetY = this.selected === CONFIG.lava.floor ? CONFIG.lava.cabinTargetY : this.selected! * E.floorHeight;
    const left = targetY - this.root.position.y;
    const dy = Math.sign(left) * Math.min(E.speed * dt, Math.abs(left));
    this.moveCabinVertically(dy);
    this.updateLavaContact();

    if (Math.abs(targetY - this.root.position.y) < 1e-4) {
      this.floor = this.selected!;
      this.selected = null;
      this.panel.setSelected(null);
      this.onArrived(this.floor);

      if (this.floor === CONFIG.lava.floor) {
        this.state = "LAVA";
        this.fatalTimer = CONFIG.lava.deathDelay;
        this.door.setOpen(false);
      } else {
        const arrived = this.landing.get(this.floor);
        if (arrived) {
          this.state = "OPENING";
          this.door.setOpen(true);
          arrived.setOpen(true);
        } else {
          this.state = "IDLE";
        }
      }
    }
  }

  private updateLava(dt: number) {
    this.fatalTimer -= dt;
    if (this.fatalTimer <= 0) {
      this.killCabinOccupants();
      this.state = "EMERGENCY_CRASHED";
    }
  }

  private triggerEmergencyStop() {
    if (this.state === "EMERGENCY_WAIT" || this.state === "EMERGENCY_BREAK" || this.state === "EMERGENCY_FALL" || this.state === "EMERGENCY_CRASHED" || this.state === "LAVA") return;
    this.selected = null;
    this.panel.setSelected(null);
    // Двери не захлопываются полностью: перед падением кабина приоткрыта,
    // поэтому игрок видит шахту и направление движения.
    this.door.setOpenAmount(CONFIG.emergency.doorOpenBeforeFall);
    this.landing.get(this.floor)?.setOpen(false);
    this.state = "EMERGENCY_WAIT";
    this.fatalTimer = CONFIG.emergency.waitTime;
    this.emergencyVelocity = 0;
    this.emergencyFallDistance = 0;
    this.shakeTime = 0;
    this.baseX = this.root.position.x;
    this.baseZ = this.root.position.z;
    this.prevShakeX = 0;
    this.prevShakeZ = 0;
    this.npcs.forEach((n) => n.scare());
    this.cableBreakProgress = 0;
  }

  private updateEmergencyWait(dt: number) {
    // Первые пять секунд кабина ещё стоит: NPC паникуют, свет мигает, табло искажено.
    this.fatalTimer -= dt;
    if (this.fatalTimer <= 0) {
      this.state = "EMERGENCY_BREAK";
      this.cableBreakProgress = 0;
      this.shakeTime = 0;
      this.prevShakeX = 0;
      this.prevShakeZ = 0;
      this.door.setOpenAmount(CONFIG.emergency.doorOpenDuringFall);
      this.player.startCameraShake(
        CONFIG.emergency.cameraShakeAmplitude,
        CONFIG.emergency.cableBreakDuration + 1.25,
        CONFIG.emergency.cameraShakeFrequency,
      );
    }
  }

  private updateEmergencyBreak(dt: number) {
    this.updateShake(dt);
    if (this.cableBreakProgress >= 1) {
      this.state = "EMERGENCY_FALL";
      this.emergencyVelocity = 0;
      this.emergencyFallDistance = 0;
    }
  }

  private updateEmergencyFall(dt: number) {
    this.emergencyVelocity += CONFIG.emergency.gravity * dt;
    // Ограничиваем падение дном шахты: пол кабины не может пройти ниже этой отметки.
    const shaftBottom = CONFIG.lava.shaftBottomY;
    const cabinBottomClearance = 0.22;
    const minRootY = shaftBottom + cabinBottomClearance;
    const maxDropByShaft = Math.max(0, this.root.position.y - minRootY);
    const remainingByImpact = CONFIG.emergency.impactDistance - this.emergencyFallDistance;
    const maxRemaining = Math.min(remainingByImpact, maxDropByShaft);
    const dy = -Math.min(this.emergencyVelocity * dt, Math.max(0, maxRemaining));
    this.moveCabinVertically(dy);
    this.emergencyFallDistance += -dy;
    this.updateShake(dt);

    if (this.emergencyFallDistance >= CONFIG.emergency.impactDistance - 1e-4 || Math.abs(this.root.position.y - (CONFIG.lava.shaftBottomY + 0.22)) < 1e-4) {
      this.killCabinOccupants();
      this.state = "EMERGENCY_CRASHED";
    }
  }

  private updateShake(dt: number) {
    this.shakeTime += dt * CONFIG.emergency.shakeFrequency;
    const amp = CONFIG.emergency.shakeAmplitude * (this.state === "EMERGENCY_FALL" ? 1.8 : 1.0);
    const sx = Math.sin(this.shakeTime * 1.7) * amp + Math.sin(this.shakeTime * 3.1) * amp * 0.35;
    const sz = Math.cos(this.shakeTime * 2.3) * amp * 0.8 + Math.sin(this.shakeTime * 4.0) * amp * 0.25;
    // Кабина полностью остаётся внутри вертикальной шахты даже при максимальной тряске.
    const shaftHalf = CONFIG.lava.shaftWidth / 2;
    const cabinHalf = CONFIG.elevator.cabinSize / 2;
    const horizontalMargin = Math.max(0.15, shaftHalf - cabinHalf - 0.2);
    const clampedX = Math.max(-horizontalMargin, Math.min(horizontalMargin, sx));
    const clampedZ = Math.max(-horizontalMargin, Math.min(horizontalMargin, sz));
    const dx = clampedX - this.prevShakeX;
    const dz = clampedZ - this.prevShakeZ;
    const carry = this.rideLock || this.playerInside();
    this.root.position.x = this.baseX + clampedX;
    this.root.position.z = this.baseZ + clampedZ;
    this.syncCabin();
    if (carry) {
      this.player.body.position.x += dx;
      this.player.body.position.z += dz;
    }
    this.prevShakeX = clampedX;
    this.prevShakeZ = clampedZ;
    this.updateEmergencyCables(dt);
  }

  private createEmergencyCables() {
    const mat = new StandardMaterial("emergency_cable_mat", this.scene);
    mat.diffuseColor = new Color3(0.12, 0.12, 0.14);
    mat.specularColor = new Color3(0.35, 0.35, 0.38);
    const half = CONFIG.elevator.cabinSize / 2 - 0.35;
    const h = 1.15;
    const points: [number, number][] = [[-half, -half], [half, -half], [-half, half], [half, half]];
    points.forEach(([x, z], i) => {
      const cable = MeshBuilder.CreateCylinder(`emergency_cable_${i}`, { height: h, diameter: 0.045, tessellation: 6 }, this.scene);
      cable.parent = this.root;
      cable.position.set(x, CONFIG.elevator.cabinHeight + h / 2 - 0.08, z);
      cable.material = mat;
      cable.isPickable = false;
      this.cables.push(cable);
      this.cableBaseY.push(cable.position.y);
    });
  }

  private updateEmergencyCables(dt: number) {
    if (this.state !== "EMERGENCY_BREAK" && this.state !== "EMERGENCY_FALL" && this.state !== "EMERGENCY_CRASHED") {
      this.cables.forEach((c, i) => { c.setEnabled(true); c.position.y = this.cableBaseY[i]; c.rotation.z = 0; c.rotation.x = 0; });
      return;
    }

    this.cableBreakProgress = Math.min(1, this.cableBreakProgress + dt / CONFIG.emergency.cableBreakDuration);
    const t = this.cableBreakProgress;
    const ease = t * t * (3 - 2 * t);
    this.cables.forEach((c, i) => {
      c.setEnabled(t < 0.98);
      const side = i % 2 === 0 ? -1 : 1;
      const phase = this.shakeTime * 0.12 + i * 1.7;
      c.position.y = this.cableBaseY[i] + ease * (0.45 + i * 0.07) + Math.sin(phase) * 0.05;
      c.rotation.z = Math.sin(phase * 2.2) * (0.08 + ease * 0.45) * side;
      c.rotation.x = Math.cos(phase * 1.8) * (0.06 + ease * 0.35);
    });
  }

  private moveCabinVertically(dy: number) {
    const carry = this.rideLock || this.playerInside();
    this.root.position.y += dy;
    if (carry) this.player.body.position.y += dy;
    this.syncCabin();
  }

  /** Пересчёт мировых матриц кабины, чтобы коллизии не отставали на кадр (иначе игрок «проваливается»). */
  private syncCabin() {
    this.root.getChildMeshes().forEach((m) => m.computeWorldMatrix(true));
  }

  private updateRideLock() {
    const hazard = this.state === "MOVING" || this.state === "OVERLOADED" || this.state === "LAVA" || this.state.startsWith("EMERGENCY");
    if (hazard && !this.wasHazard) this.rideLock = this.playerInside();
    if (!hazard) { this.rideLock = false; this.lavaPanic = false; this.lavaTouched = false; }
    this.wasHazard = hazard;
  }

  /**
   * Вызывать после Player.update: пока кабина едет, тонет или падает, игрок физически
   * удерживается внутри стен и на полу кабины (в том числе при приоткрытых дверях и тряске).
   */
  constrainPlayer() {
    if (!this.rideLock || !this.player.alive) return;
    const half = CONFIG.elevator.cabinSize / 2, lim = half - CONFIG.player.ellipsoid.x - 0.05;
    const r = this.root.position, p = this.player.body.position;
    p.x = Math.max(r.x - lim, Math.min(r.x + lim, p.x));
    p.z = Math.max(r.z - lim, Math.min(r.z + lim, p.z));
    p.y = r.y + CONFIG.player.ellipsoid.y + 0.01;
  }

  /** Створки дверей раздавливают игрока и NPC, оказавшихся в проёме при закрытии. */
  private checkCrush() {
    const doors: Door[] = [this.door];
    const here = this.landing.get(this.floor);
    if (here) doors.push(here);
    const closing = doors.filter((d) => d.closing);
    if (!closing.length) return;

    if (this.player.alive) {
      const p = this.player.body.position, feet = p.y - CONFIG.player.ellipsoid.y;
      if (closing.some((d) => d.squeezes(p.x, p.z, feet))) this.player.kill("WRONG PLACE, WRONG TIME");
    }
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const w = n.world(), y = n.getWorldPosition().y;
      if (closing.some((d) => d.squeezes(w.x, w.z, y, 0.3))) n.kill("crush");
    }
  }

  /** Страховка: игрок вне кабины ниже нулевого этажа — он упал в шахту. */
  private checkVoid() {
    if (!this.player.alive || this.rideLock) return;
    const feet = this.player.body.position.y - CONFIG.player.ellipsoid.y;
    if (feet < CONFIG.safety.voidY) this.player.kill("CALL FOR EMERGENCY");
  }

  /** Погружение в лаву: за пару метров NPC паникуют, при касании пола лавы — сгорают. */
  private updateLavaContact() {
    if (this.selected !== CONFIG.lava.floor) return;
    const y = this.root.position.y, L = CONFIG.lava;
    if (!this.lavaPanic && y <= L.surfaceY + 3) {
      this.lavaPanic = true;
      this.npcs.forEach((n) => n.scare());
    }
    if (!this.lavaTouched && y <= L.surfaceY + 0.1) {
      this.lavaTouched = true;
      for (const n of this.npcs) if (n.alive && n.inCabin) n.kill("lava");
    }
  }

  /** Гибель пассажиров: в лаве — от огня, при падении кабины — от удара. */
  private killCabinOccupants() {
    const cause: DeathCause = this.state === "LAVA" ? "lava" : "impact";
    for (const npc of this.npcs) {
      if (npc.alive && npc.inCabin) npc.kill(cause);
    }
    if ((this.rideLock || this.playerInside()) && this.player.alive) {
      this.player.kill(cause === "lava" ? "OVERCOOCKED" : "CRUSHED ON YOU");
    }
  }
}

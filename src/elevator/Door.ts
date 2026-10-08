import { Mesh, Scene, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import { addBox, Mats } from "../levels/builders";

/** Двустворчатая раздвижная дверь. open: 0 — закрыта, 1 — открыта. */
export class Door {
  open = 0;
  private target = 0;
  private panels: Mesh[] = [];

  constructor(scene: Scene, mats: Mats, name: string, private pos: number[], private width: number, private height: number, private parent?: TransformNode) {
    for (const s of [-1, 1]) {
      const panel = addBox(scene, mats, "metal", `${name}_${s}`, [width / 2, height, 0.08],
        [pos[0] + (s * width) / 4, pos[1] + height / 2, pos[2]], parent);
      panel.metadata = { door: true }; // створки не участвуют в навигационной сетке
      this.panels.push(panel);
    }
  }

  get meshes() { return this.panels; }

  /** Створки сейчас сходятся. */
  get closing() { return this.target < this.open - 1e-6; }

  /**
   * Попадает ли тело (центр px,pz; ноги feetY) между сходящимися створками:
   * центр в плоскости двери, в проёме, а зазор уже ширины тела.
   */
  squeezes(px: number, pz: number, feetY: number, r = CONFIG.safety.bodyHalfWidth): boolean {
    if (!this.closing) return false;
    const o = this.parent ? this.parent.position : null; // кабина не поворачивается
    const cx = (o ? o.x : 0) + this.pos[0], cz = (o ? o.z : 0) + this.pos[2], base = (o ? o.y : 0) + this.pos[1];
    if (feetY > base + this.height - 0.2 || feetY < base - 0.5) return false;
    if (Math.abs(pz - cz) > CONFIG.safety.crushDistance) return false;
    const dx = Math.abs(px - cx);
    return dx < this.width / 2 && dx + r > (this.open * this.width) / 2;
  }
  setOpen(v: boolean) { this.target = v ? 1 : 0; }

  /** Открыть дверь на произвольную долю хода, чтобы частично приоткрыть её. */
  setOpenAmount(amount: number) {
    this.target = Math.max(0, Math.min(1, amount));
  }

  setInstant(v: boolean) { this.open = this.target = v ? 1 : 0; this.place(); }
  get isClosed() { return this.open <= 0.001; }
  get isOpen() { return this.open >= 0.999; }

  update(dt: number) {
    if (this.open === this.target) return;
    const step = dt / CONFIG.elevator.doorTime;
    const d = this.target - this.open;
    this.open = Math.abs(d) <= step ? this.target : this.open + Math.sign(d) * step;
    this.place();
  }

  private place() {
    [-1, 1].forEach((s, i) => (this.panels[i].position.x = this.pos[0] + s * (this.width / 4 + (this.open * this.width) / 2)));
  }
}

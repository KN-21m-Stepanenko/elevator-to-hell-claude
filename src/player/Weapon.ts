import { Color3, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Monster } from "../monsters/Monster";
import type { Player } from "./Player";

/** Дробовик игрока: модель от первого лица, доставание (Q), выстрел (ЛКМ), бесконечные патроны. */
export class Weapon {
  drawn = false;
  private root: TransformNode;
  private flash: Mesh;
  private pose = 0; // 0 — убран, 1 — в руках
  private cooldown = 0;
  private kick = 0;
  private flashT = 0;

  constructor(private scene: Scene, private player: Player) {
    this.root = new TransformNode("shotgun", scene);
    this.root.parent = player.camera;
    this.root.scaling.setAll(0.6);
    scene.setRenderingAutoClearDepthStencil(1, true); // оружие рисуется поверх стен

    const part = (n: string, w: number, h: number, d: number, p: number[], c: Color3, glow = 0.25) => {
      const m = new StandardMaterial(`${n}_mat`, scene);
      m.diffuseColor = c; m.emissiveColor = c.scale(glow); m.specularColor = Color3.Black();
      const b = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
      b.parent = this.root; b.position.set(p[0], p[1], p[2]); b.material = m;
      b.isPickable = false; b.renderingGroupId = 1;
      return b;
    };
    const steel = new Color3(0.22, 0.23, 0.26), wood = new Color3(0.42, 0.26, 0.12);
    part("gun_barrel", 0.06, 0.06, 0.9, [0, 0.02, 0.45], steel);
    part("gun_mag", 0.05, 0.05, 0.7, [0, -0.04, 0.35], steel);
    part("gun_pump", 0.11, 0.09, 0.28, [0, -0.06, 0.5], wood);
    part("gun_body", 0.11, 0.13, 0.42, [0, -0.02, -0.05], steel);
    part("gun_stock", 0.09, 0.15, 0.3, [0, -0.08, -0.35], wood);
    this.flash = part("gun_flash", 0.18, 0.18, 0.18, [0, 0.02, 1.0], new Color3(1, 0.85, 0.3), 1);
    this.flash.setEnabled(false);
    this.root.setEnabled(false);
  }

  /** Принудительно убирает оружие, например при смерти игрока. */
  hide() {
    this.drawn = false;
    this.pose = 0;
    this.flashT = 0;
    this.root.setEnabled(false);
    this.flash.setEnabled(false);
  }

  toggle() {
    if (!this.player.alive) return;
    this.drawn = !this.drawn;
  }

  /** Выстрел дробью: несколько лучей с разбросом, урон получают NPC. */
  fire() {
    if (!this.player.alive || !this.drawn || this.cooldown > 0 || this.pose < 0.8) return;
    const W = CONFIG.weapon;
    this.cooldown = W.cooldown; this.kick = 1; this.flashT = 0.06;
    this.player.addPitch(-W.recoil);

    const base = this.player.getEyeRay(W.range);
    const d = base.direction;
    const right = Vector3.Cross(Vector3.Up(), d).normalize();
    const up = Vector3.Cross(d, right);
    for (let i = 0; i < W.pellets; i++) {
      const dir = d.add(right.scale((Math.random() * 2 - 1) * W.spread)).add(up.scale((Math.random() * 2 - 1) * W.spread)).normalize();
      const hit = this.scene.pickWithRay(new Ray(base.origin, dir, W.range), (m) => m.isVisible && m.isEnabled() && m.isPickable);
      const picked = hit?.pickedMesh;
      const npc = picked?.metadata?.npc as Npc | undefined;
      const monster = picked?.metadata?.monster as Monster | undefined;
      if (npc) npc.damage(W.damage);
      else if (monster) monster.damage(W.damage);
    }
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt * 5);
    this.flashT -= dt;
    this.flash.setEnabled(this.flashT > 0);
    this.pose += ((this.drawn ? 1 : 0) - this.pose) * Math.min(1, dt * 9);
    this.root.setEnabled(this.pose > 0.03);
    this.root.position.set(0.26, -0.25 - (1 - this.pose) * 0.5, 0.55 - this.kick * 0.12);
    this.root.rotation.set(-this.kick * 0.18 + (1 - this.pose) * 0.6, -0.05, 0);
  }
}

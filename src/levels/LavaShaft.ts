import { Color3, DynamicTexture, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";

/** Визуальная шахта под нулевым этажом: лавовое море + процедурное свечение и искры. */
export class LavaShaft {
  readonly lavaY = CONFIG.lava.surfaceY;
  private readonly texture: DynamicTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly light: PointLight;
  private readonly sparks: Array<{ mesh: Mesh; phase: number; speed: number; life: number }> = [];
  private time = 0;
  private frame = 0;

  constructor(scene: Scene, center: Vector3) {
    const width = CONFIG.lava.shaftWidth;
    const depth = CONFIG.lava.shaftDepth;

    // Тёмная шахта. Высота ниже нулевого этажа — только пространство самого провала.
    const wallMaterial = new StandardMaterial("lava_shaft_wall_mat", scene);
    wallMaterial.diffuseColor = new Color3(0.025, 0.018, 0.018);
    wallMaterial.specularColor = Color3.Black();

    const wallY = (CONFIG.lava.shaftBottomY + CONFIG.lava.shaftTopY) / 2;
    const wallHeight = CONFIG.lava.shaftTopY - CONFIG.lava.shaftBottomY;
    for (const [name, pos, size] of [
      ["x1", [center.x - width / 2, wallY, center.z] as number[], [0.22, wallHeight, depth] as number[]],
      ["x2", [center.x + width / 2, wallY, center.z] as number[], [0.22, wallHeight, depth] as number[]],
      ["z1", [center.x, wallY, center.z - depth / 2] as number[], [width, wallHeight, 0.22] as number[]],
      ["z2", [center.x, wallY, center.z + depth / 2] as number[], [width, wallHeight, 0.22] as number[]],
    ] as Array<[string, number[], number[]]>) {
      const wall = MeshBuilder.CreateBox(`lava_shaft_${name}`, {
        width: size[0], height: size[1], depth: size[2],
      }, scene);
      wall.position.set(pos[0], pos[1], pos[2]);
      wall.material = wallMaterial;
      wall.checkCollisions = true;
    }

    this.texture = new DynamicTexture("lava_texture", { width: 128, height: 128 }, scene, false);
    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    this.texture.wrapU = this.texture.wrapV = 1;
    const mat = new StandardMaterial("lava_mat", scene);
    mat.diffuseTexture = this.texture;
    mat.emissiveTexture = this.texture;
    mat.emissiveColor = new Color3(1, 0.42, 0.08);
    mat.specularColor = Color3.Black();

    const lava = MeshBuilder.CreateGround("lava", { width, height: depth, subdivisions: 1 }, scene);
    lava.position.set(center.x, this.lavaY, center.z);
    lava.material = mat;
    lava.isPickable = false;

    this.light = new PointLight("lava_light", new Vector3(center.x, this.lavaY + 0.5, center.z), scene);
    this.light.diffuse = new Color3(1, 0.12, 0.03);
    this.light.specular = Color3.Black();
    // Свет работает только в нижней части шахты и физически не достаёт до нулевого этажа.
    this.light.range = CONFIG.lava.lightRange;
    this.light.intensity = 1.25;

    for (let i = 0; i < CONFIG.lava.sparkCount; i++) {
      const spark = MeshBuilder.CreateBox(`lava_spark_${i}`, { size: 0.045 + Math.random() * 0.055 }, scene);
      const sm = new StandardMaterial(`lava_spark_mat_${i}`, scene);
      sm.diffuseColor = Color3.Black();
      sm.emissiveColor = new Color3(1, 0.18 + Math.random() * 0.35, 0.03);
      sm.specularColor = Color3.Black();
      spark.material = sm;
      spark.isPickable = false;
      spark.position.set(
        center.x + (Math.random() - 0.5) * (width - 0.8),
        this.lavaY + 0.1 + Math.random() * 0.4,
        center.z + (Math.random() - 0.5) * (depth - 0.8),
      );
      this.sparks.push({
        mesh: spark,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.4,
        life: Math.random() * 2,
      });
    }

    this.drawTexture(0);
  }

  update(dt: number) {
    this.time += dt;
    this.frame++;
    if (this.frame % 3 === 0) this.drawTexture(this.time);

    this.light.intensity = 1.0 + Math.sin(this.time * CONFIG.lava.glowSpeed) * 0.35;
    for (const s of this.sparks) {
      s.life += dt;
      const phase = s.phase + s.life * s.speed;
      const y = this.lavaY + 0.08 + (0.5 + 0.5 * Math.sin(phase * 2.2)) * 0.7;
      s.mesh.position.y = y;
      s.mesh.scaling.setAll(0.7 + 0.5 * (0.5 + 0.5 * Math.sin(phase * 3)));
    }
  }

  private drawTexture(t: number) {
    const c = this.ctx;
    c.fillStyle = "#3b0800";
    c.fillRect(0, 0, 128, 128);

    // Пиксельные лавовые поля и трещины: намеренно грубая сетка в духе 90-х.
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 128; x += 8) {
        const wave = Math.sin(x * 0.095 + t * 2.0) + Math.cos(y * 0.075 - t * 1.4) + Math.sin((x + y) * 0.05 + t);
        const hot = wave > 0.5;
        c.fillStyle = hot ? "#e33a0a" : "#611000";
        c.fillRect(x, y, 8, 8);
      }
    }
    c.strokeStyle = "#ff8a18";
    c.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const x = ((i * 37 + t * 18) % 136) - 4;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + 10, 35);
      c.lineTo(x - 6, 75);
      c.lineTo(x + 12, 128);
      c.stroke();
    }
    this.texture.update();
  }
}

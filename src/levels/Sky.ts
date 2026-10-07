import { Color3, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { canvasTexture, noise, rng } from "../utils/textures";

/** Звёздное небо и луна для крыши. Следуют за камерой (infiniteDistance) и не затуманиваются. */
export function createSky(scene: Scene) {
  const unlit = (name: string, emissive: Color3 | null, tex?: ReturnType<typeof canvasTexture>["tex"]) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
    if (emissive) m.emissiveColor = emissive;
    if (tex) m.emissiveTexture = tex;
    m.backFaceCulling = false; m.fogEnabled = false;
    return m;
  };

  // Небо: градиент и звёзды.
  const st = canvasTexture(scene, 1024, 512);
  const c = st.ctx, r = rng(777);
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#03040c"); g.addColorStop(0.5, "#1a2140"); g.addColorStop(1, "#05060e");
  c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 1100; i++) {
    const b = (110 + r() * 145) | 0;
    c.fillStyle = `rgb(${b},${b},${Math.min(255, b + 25)})`;
    c.fillRect((r() * 1024) | 0, (r() * 512) | 0, 1, 1);
  }
  c.fillStyle = "#ffffff";
  for (let i = 0; i < 70; i++) c.fillRect((r() * 1024) | 0, (r() * 420) | 0, 2, 2);
  st.tex.update();
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 800, segments: 24 }, scene);
  sky.material = unlit("sky_mat", null, st.tex);
  sky.infiniteDistance = true; sky.isPickable = false; sky.applyFog = false;

  // Луна: пятна «морей» и ореол. Расположена высоко, чтобы быть видна из-за высоких стен.
  const mt = canvasTexture(scene, 64, 64);
  noise(mt.ctx, rng(5), [226, 227, 212], 16, 64);
  mt.ctx.fillStyle = "rgba(150,152,140,0.55)";
  for (let i = 0; i < 9; i++) { mt.ctx.beginPath(); mt.ctx.arc(r() * 64, r() * 64, 4 + r() * 6, 0, Math.PI * 2); mt.ctx.fill(); }
  mt.tex.update();
  const moon = MeshBuilder.CreateSphere("moon", { diameter: 28, segments: 12 }, scene);
  moon.material = unlit("moon_mat", null, mt.tex);
  const halo = MeshBuilder.CreateSphere("moon_halo", { diameter: 44, segments: 12 }, scene);
  const hm = unlit("halo_mat", new Color3(0.35, 0.42, 0.6));
  hm.alpha = 0.16;
  halo.material = hm;
  for (const m of [moon, halo]) {
    m.position.set(-60, 230, -110);
    m.infiniteDistance = true; m.isPickable = false; m.applyFog = false;
  }
}

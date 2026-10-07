import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

interface BloodParticle {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
  maxLife: number;
  spin: number;
}

/** Пиксельная брызга крови из маленьких кубиков. */
export class BloodBurst {
  private readonly particles: BloodParticle[] = [];

  constructor(private readonly scene: Scene, origin: Vector3, hitFrom?: Vector3, viewDirection?: Vector3) {
    // Кровь летит в сторону атакующего: от точки попадания к монстру.
    const towardAttacker = hitFrom
      ? hitFrom.subtract(origin)
      : new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    const attackerDir = towardAttacker.lengthSquared() > 0.001
      ? towardAttacker.normalize()
      : new Vector3(0, 0, 1);
    const viewDir = viewDirection && viewDirection.lengthSquared() > 0.001
      ? viewDirection.normalize()
      : attackerDir;

    // При атаке со спины кровь всё равно должна лететь в поле зрения игрока.
    // Вектор взгляда имеет больший вес, направление к атакующему — меньший.
    const base = viewDir.scale(1.8).add(attackerDir.scale(0.45)).normalize();

    // Строим два ортогональных направления, чтобы частицы разлетались конусом
    // к атакующему, а не строились почти в одну линию.
    const up = Math.abs(base.y) > 0.85 ? new Vector3(1, 0, 0) : Vector3.Up();
    const side = Vector3.Cross(base, up).normalize();
    const coneUp = Vector3.Cross(side, base).normalize();

    for (let i = 0; i < 64; i++) {
      // Чуть уменьшаем размер пикселя, но оставляем его хорошо различимым.
      const size = 0.055 + Math.random() * 0.06;
      const mat = new StandardMaterial(`blood_${Date.now()}_${i}`, scene);
      mat.diffuseColor = new Color3(0.72 + Math.random() * 0.2, 0.005 + Math.random() * 0.015, 0.005);
      mat.emissiveColor = new Color3(0.12, 0.0, 0.0);
      mat.specularColor = Color3.Black();

      const mesh = MeshBuilder.CreateBox(`blood_pixel_${i}`, { width: size, height: size, depth: size }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.position.copyFrom(origin);

      // Разносим сами точки старта, чтобы брызги не выглядели одним потоком.
      mesh.position.addInPlace(
        side.scale((Math.random() - 0.5) * 0.26),
      );
      mesh.position.addInPlace(
        coneUp.scale((Math.random() - 0.5) * 0.2),
      );
      mesh.position.y += (Math.random() - 0.5) * 0.18;

      // Случайная точка внутри широкого конуса, направленного к атакующему.
      const angle = Math.random() * Math.PI * 2;
      const spreadAmount = Math.pow(Math.random(), 0.75) * 0.85;
      const direction = base
        .add(side.scale(Math.cos(angle) * spreadAmount))
        .add(coneUp.scale(Math.sin(angle) * spreadAmount))
        .normalize();
      const velocity = direction.scale(2.2 + Math.random() * 3.2);
      const life = 0.5 + Math.random() * 0.4;
      this.particles.push({ mesh, velocity, life, maxLife: life, spin: (Math.random() - 0.5) * 14 });
    }
  }

  update(dt: number) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.velocity.y -= 8.5 * dt;
      particle.mesh.position.addInPlace(particle.velocity.scale(dt));
      particle.mesh.rotation.x += particle.spin * dt;
      particle.mesh.rotation.z -= particle.spin * 0.7 * dt;
    }

    if (this.done) {
      this.dispose();
    }
  }

  get done() {
    return this.particles.length === 0 || this.particles.every((p) => p.life <= 0);
  }

  dispose() {
    for (const particle of this.particles) {
      particle.mesh.material?.dispose();
      particle.mesh.dispose();
    }
    this.particles.length = 0;
  }
}

import { Color3, FreeCamera, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { BloodBurst } from "../effects/BloodFx";

/** Игрок от первого лица: WASD + мышь, коллизии и кинематографичная смерть. */
export class Player {
  readonly body: Mesh;
  readonly camera: FreeCamera;
  locked = false;
  alive = true;
  deathReason = "ВИ ЗАГИНУЛИ"; // подпись на экране поражения
  health = CONFIG.player.health;
  readonly maxHealth = CONFIG.player.health;
  onLockChange: (locked: boolean) => void = () => {};
  onDamage: (health: number) => void = () => {};
  onInteract: () => void = () => {};
  onToggleWeapon: () => void = () => {};
  onFire: () => void = () => {};

  private yaw: number;
  private pitch = 0;
  private keys = new Set<string>();
  private inputEnabled = true;
  private deathProgress = 0;
  private deathCameraStart = new Vector3();
  private deathRotationStart = new Vector3();
  private corpseRoot: TransformNode;
  private readonly bloodBursts: BloodBurst[] = [];
  private freeLook = false;
  private deathInitialPitch = 0;
  private deathPrepared = false;
  private cameraShakeRemaining = 0;
  private cameraShakeAmplitude = 0;
  private cameraShakeFrequency = 0;
  private cameraShakeTime = 0;

  constructor(private readonly scene: Scene, private canvas: HTMLCanvasElement, feet: Vector3, yaw = 0) {
    const P = CONFIG.player;
    this.yaw = yaw;

    this.body = MeshBuilder.CreateBox("player", { size: 0.2 }, scene);
    this.body.isVisible = false;
    this.body.metadata = { player: true };
    this.body.ellipsoid = P.ellipsoid.clone();
    this.body.position.set(feet.x, feet.y + P.ellipsoid.y + 0.01, feet.z);

    this.camera = new FreeCamera("fpsCamera", new Vector3(0, P.eyeHeight - P.ellipsoid.y, 0), scene);
    this.camera.inputs.clear();
    this.camera.parent = this.body;
    this.camera.minZ = 0.05;
    this.camera.fov = CONFIG.render.fov;
    scene.activeCamera = this.camera;

    this.corpseRoot = this.createCorpse(scene);
    this.corpseRoot.setEnabled(false);

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (!e.repeat && this.locked && this.inputEnabled) {
        if (e.code === "KeyE") this.onInteract();
        if (e.code === "KeyQ") this.onToggleWeapon();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousedown", (e) => { if (this.locked && this.inputEnabled && e.button === 0) this.onFire(); });
    document.addEventListener("mousemove", (e) => {
      // В режиме freeLook камера может вращаться и после снятия pointer lock.
      if ((!this.locked && !this.freeLook) || (!this.inputEnabled && !this.freeLook)) return;
      this.yaw += e.movementX * P.mouseSensitivity;
      this.pitch = Math.max(-P.maxPitch, Math.min(P.maxPitch, this.pitch + e.movementY * P.mouseSensitivity));
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (!this.alive || !this.inputEnabled) return;
    try {
      (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch(() => {});
    } catch {
      /* браузер может отклонить повторный запрос сразу после Esc */
    }
  }

  /** Полностью блокирует управление, оставляя при необходимости pointer lock для осмотра камеры. */
  freezeInput(releasePointerLock = true) {
    this.inputEnabled = false;
    this.keys.clear();
    if (releasePointerLock && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Разрешает свободно вращать камеру после победы или смерти. */
  enableFreeLook() {
    this.freeLook = true;
  }

  /** Сильная локальная тряска камеры при аварийном падении лифта. */
  startCameraShake(amplitude: number, duration: number, frequency: number) {
    this.cameraShakeAmplitude = Math.max(this.cameraShakeAmplitude, amplitude);
    this.cameraShakeRemaining = Math.max(this.cameraShakeRemaining, duration);
    this.cameraShakeFrequency = Math.max(this.cameraShakeFrequency, frequency);
  }

  addPitch(d: number) {
    const m = CONFIG.player.maxPitch;
    this.pitch = Math.max(-m, Math.min(m, this.pitch + d));
  }

  getWorldPosition() {
    return this.body.position.clone();
  }

  damage(amount: number, hitFrom?: Vector3) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.spawnBlood(hitFrom);
    this.onDamage(this.health);
    if (this.health === 0) {
      this.alive = false;
      this.inputEnabled = false;
      this.keys.clear();
      if (!this.deathPrepared) {
        this.deathPrepared = true;
        this.prepareDeath();
      }
    }
  }

  /** Мгновенная смертельная причина без брызг крови (лава/падение кабины). */
  kill(reason?: string) {
    if (!this.alive) return;
    if (reason) this.deathReason = reason;
    this.health = 0;
    this.alive = false;
    this.inputEnabled = false;
    this.keys.clear();
    if (!this.deathPrepared) {
      this.deathPrepared = true;
      this.prepareDeath();
    }
  }

  getEyeRay(length: number): Ray {
    const eye = this.body.position.add(new Vector3(0, CONFIG.player.eyeHeight - CONFIG.player.ellipsoid.y, 0));
    const cp = Math.cos(this.pitch);
    return new Ray(eye, new Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp), length);
  }

  update(dt: number) {
    this.updateBlood(dt);

    if (!this.alive) {
      this.updateDeath(dt);
      return;
    }
    if (!this.inputEnabled) {
      if (this.freeLook) this.camera.rotation.set(this.pitch, this.yaw, 0);
      return;
    }

    const P = CONFIG.player;
    this.updateCameraShake(dt);
    const down = (c: string) => (this.locked && this.keys.has(c) ? 1 : 0);
    const f = down("KeyW") - down("KeyS");
    const r = down("KeyD") - down("KeyA");
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = sin * f + cos * r;
    let mz = cos * f - sin * r;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    this.body.moveWithCollisions(new Vector3(mx * P.moveSpeed * dt, -P.gravity * dt, mz * P.moveSpeed * dt));
    const roll = this.camera.rotation.z;
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }

  private updateCameraShake(dt: number) {
    if (this.camera.parent !== this.body || this.cameraShakeRemaining <= 0) {
      if (this.camera.parent === this.body) {
        this.camera.position.set(0, CONFIG.player.eyeHeight - CONFIG.player.ellipsoid.y, 0);
        this.camera.rotation.z = 0;
      }
      return;
    }

    this.cameraShakeRemaining = Math.max(0, this.cameraShakeRemaining - dt);
    this.cameraShakeTime += dt * this.cameraShakeFrequency;
    const fade = Math.min(1, this.cameraShakeRemaining / 0.25 + 0.2);
    const a = this.cameraShakeAmplitude * fade;
    const x = Math.sin(this.cameraShakeTime * 2.1) * a + Math.sin(this.cameraShakeTime * 5.3) * a * 0.35;
    const y = Math.cos(this.cameraShakeTime * 2.7) * a * 0.8;
    const z = Math.sin(this.cameraShakeTime * 3.4) * a * 0.45;
    const baseY = CONFIG.player.eyeHeight - CONFIG.player.ellipsoid.y;
    this.camera.position.set(x, baseY + y, z);
    this.camera.rotation.z = Math.sin(this.cameraShakeTime * 2.6) * a * 0.65;
  }

  private prepareDeath() {
    const P = CONFIG.player;

    // FreeCamera в текущей версии Babylon не предоставляет getAbsolutePosition().
    // Пока камера ещё привязана к телу игрока, её мировую позицию проще
    // вычислить напрямую из позиции тела и локального смещения камеры.
    const cameraWorld = this.body.position.add(
      new Vector3(0, P.eyeHeight - P.ellipsoid.y, 0),
    );
    this.cameraShakeRemaining = 0;
    this.cameraShakeAmplitude = 0;
    this.cameraShakeFrequency = 0;
    this.camera.position.set(0, 0, 0);
    this.camera.parent = null;
    this.camera.position.copyFrom(cameraWorld);
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.corpseRoot.position.set(
      this.body.position.x + forward.x * 0.22,
      this.body.position.y - P.ellipsoid.y + 0.03,
      this.body.position.z + forward.z * 0.22,
    );
    this.corpseRoot.rotation.y = this.yaw;
    this.corpseRoot.rotation.x = 0;
    this.corpseRoot.setEnabled(true);
    this.deathProgress = 0;
    this.deathCameraStart.copyFrom(this.camera.position);
    this.deathRotationStart.copyFrom(this.camera.rotation);
    this.deathInitialPitch = this.pitch;
    this.freeLook = true;
  }

  private updateDeath(dt: number) {
    this.deathProgress = Math.min(1, this.deathProgress + dt / CONFIG.player.deathCameraTime);
    const t = this.deathProgress;
    const ease = t * t * (3 - 2 * t);
    const P = CONFIG.player;

    // Quake 2-подобный эффект: камера отрывается от высоты глаз и смотрит вниз на упавшее тело.
    this.camera.position.x = this.deathCameraStart.x;
    this.camera.position.y = this.deathCameraStart.y + P.deathCameraRise * ease;
    this.camera.position.z = this.deathCameraStart.z + P.deathCameraForward * ease;

    if (this.deathProgress < 1) {
      const lookPitch = P.deathCameraPitch + (this.deathInitialPitch - this.pitch) * 0.35;
      this.camera.rotation.set(lookPitch, this.deathRotationStart.y, 0);
    } else {
      // После анимации камера полностью свободна для осмотра трупа до рестарта.
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }

    this.corpseRoot.rotation.x = -ease * Math.PI / 2;
  }

  private spawnBlood(hitFrom?: Vector3) {
    const origin = this.body.position.add(new Vector3(0, 1.05, 0));
    const viewDirection = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.bloodBursts.push(new BloodBurst(this.scene, origin, hitFrom, viewDirection));
  }

  private updateBlood(dt: number) {
    for (const burst of this.bloodBursts) burst.update(dt);
    for (let i = this.bloodBursts.length - 1; i >= 0; i--) {
      if (this.bloodBursts[i].done) this.bloodBursts.splice(i, 1);
    }
  }

  private createCorpse(scene: Scene) {
    const root = new TransformNode("player_corpse", scene);
    const part = (name: string, size: [number, number, number], pos: [number, number, number], color: Color3) => {
      const mat = new StandardMaterial(`${name}_mat`, scene);
      mat.diffuseColor = color;
      mat.specularColor = Color3.Black();
      const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
      mesh.parent = root;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.material = mat;
      mesh.isPickable = false;
    };

    part("player_legs", [0.4, 0.8, 0.3], [0, 0.4, 0], new Color3(0.12, 0.12, 0.16));
    part("player_torso", [0.52, 0.65, 0.32], [0, 1.08, 0], new Color3(0.25, 0.28, 0.31));
    part("player_head", [0.28, 0.3, 0.28], [0, 1.55, 0], new Color3(0.68, 0.48, 0.38));
    part("player_arm_l", [0.17, 0.72, 0.2], [-0.38, 1.08, 0], new Color3(0.22, 0.24, 0.27));
    part("player_arm_r", [0.17, 0.72, 0.2], [0.38, 1.08, 0], new Color3(0.22, 0.24, 0.27));
    return root;
  }
}

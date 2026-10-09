/** Экранный интерфейс: оверлей паузы, прицел, подсказка, кровь и сообщения. */
export class Hud {
  private overlay = document.getElementById("overlay") as HTMLElement;
  private crosshair = document.getElementById("crosshair") as HTMLElement;
  private hint = document.getElementById("hint") as HTMLElement;
  private toastEl = document.getElementById("toast") as HTMLElement;
  private bloodEl: HTMLElement | null = document.getElementById("bloodFx");
  private timer = 0;
  private bloodTimer = 0;
  private warnEl: HTMLElement | null = null;
  private warnLeft = 0;
  private warnTime = 0;
  private warnOrigin: { x: number; z: number } | null = null;

  setPaused(paused: boolean) {
    this.overlay.classList.toggle("hidden", !paused);
    this.crosshair.classList.toggle("hidden", paused);
  }

  /** Скрывает игровой HUD, но оставляет сообщения результата. */
  setEnding() {
    this.warnLeft = 0;
    this.warnEl?.classList.add("hidden");
    this.overlay.classList.add("hidden");
    this.crosshair.classList.add("hidden");
    this.hint.classList.add("hidden");
  }

  /** Бросок гранаты: у края экрана на несколько секунд появляется стрелка в сторону, откуда бросили. */
  warnGrenade(origin: { x: number; z: number }, seconds = 2.6) {
    this.warnOrigin = { x: origin.x, z: origin.z };
    this.warnLeft = seconds;
    this.warnTime = 0;
  }

  /** Вызывать каждый кадр: стрелка следует за поворотом камеры (camYaw — угол взгляда, рад). */
  updateWarning(dt: number, px: number, pz: number, camYaw: number) {
    if (this.warnLeft <= 0 || !this.warnOrigin) {
      this.warnEl?.classList.add("hidden");
      return;
    }
    this.warnLeft -= dt;
    this.warnTime += dt;
    const el = this.getWarnElement();
    const bearing = Math.atan2(this.warnOrigin.x - px, this.warnOrigin.z - pz);
    const rel = Math.atan2(Math.sin(bearing - camYaw), Math.cos(bearing - camYaw)); // 0 — прямо, + вправо
    el.style.left = `${50 + 46 * Math.sin(rel)}%`;
    el.style.top = `${50 - 42 * Math.cos(rel)}%`;
    el.style.transform = `translate(-50%, -50%) rotate(${rel}rad)`;
    el.style.opacity = String(Math.min(1, this.warnLeft / 0.6) * (0.65 + 0.35 * Math.sin(this.warnTime * 16)));
    el.classList.remove("hidden");
  }

  private getWarnElement(): HTMLElement {
    if (!this.warnEl) {
      const el = document.createElement("div");
      el.className = "hidden";
      el.style.cssText =
        "position:fixed;width:70px;height:46px;z-index:41;pointer-events:none;background:#ff3b1d;" +
        "clip-path:polygon(50% 0,100% 100%,50% 72%,0 100%);filter:drop-shadow(0 0 10px #ff2a00);";
      document.body.appendChild(el);
      this.warnEl = el;
    }
    return this.warnEl;
  }

  onStart(cb: () => void) {
    this.overlay.onclick = () => cb();
  }

  /** Немедленный экран окончания игры с ручным рестартом по клику. */
  showResult(title: string, subtitle: string, onRestart: () => void) {
    this.crosshair.classList.add("hidden");
    this.hint.classList.add("hidden");
    this.overlay.innerHTML = `
      <h1>${title}</h1>
      <p>"${subtitle}"</p>
      <button id="restartButton" type="button">Перезапустити гру</button>
    `;
    this.overlay.classList.remove("hidden");
    this.overlay.style.cursor = "default";
    this.overlay.onclick = null;
    const button = this.overlay.querySelector("#restartButton") as HTMLButtonElement | null;
    button?.addEventListener("click", (event) => {
      event.stopPropagation();
      onRestart();
    }, { once: true });
  }

  setHint(text: string | null) {
    if (text === null) { this.hint.classList.add("hidden"); return; }
    this.hint.textContent = text;
    this.hint.classList.remove("hidden");
  }

  toast(text: string, ms = 3000) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove("hidden");
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.toastEl.classList.add("hidden"), ms);
  }

  /** Экранные пиксельные брызги поверх canvas и toast.
   * Метод намеренно не зависит от того, существовал ли #bloodFx при создании HUD:
   * ошибка в декоративном эффекте не должна останавливать игровой цикл.
   */
  bloodSplash(count = 64) {
    try {
      const bloodEl = this.getBloodElement();
      if (!bloodEl) return;

      bloodEl.replaceChildren();
      bloodEl.classList.remove("hidden");

      const width = window.innerWidth;
      const height = window.innerHeight;
      const fragment = document.createDocumentFragment();

      for (let i = 0; i < count; i++) {
        const pixel = document.createElement("span");
        pixel.className = "blood-pixel";
        const size = 3 + Math.floor(Math.random() * 7);
        const edge = i < Math.floor(count * 0.55);
        const x = edge
          ? (Math.random() < 0.5 ? Math.random() * width * 0.28 : width * (0.72 + Math.random() * 0.28))
          : width * (0.28 + Math.random() * 0.44);
        const y = edge
          ? height * (0.12 + Math.random() * 0.76)
          : height * (0.30 + Math.random() * 0.45);
        pixel.style.width = `${size}px`;
        pixel.style.height = `${size}px`;
        pixel.style.left = `${x}px`;
        pixel.style.top = `${y}px`;
        pixel.style.opacity = `${0.55 + Math.random() * 0.45}`;
        pixel.style.transform = `rotate(${Math.floor(Math.random() * 4) * 90}deg)`;
        fragment.appendChild(pixel);
      }

      bloodEl.appendChild(fragment);
      window.clearTimeout(this.bloodTimer);
      this.bloodTimer = window.setTimeout(() => {
        // Элемент мог исчезнуть из DOM за время действия таймера.
        if (!bloodEl.isConnected) return;
        bloodEl.classList.add("hidden");
        bloodEl.replaceChildren();
      }, 900);
    } catch {
      // Кровь — только визуальный эффект. Ошибка DOM не должна останавливать игру.
    }
  }

  private getBloodElement(): HTMLElement | null {
    if (this.bloodEl?.isConnected) return this.bloodEl;

    const existing = document.getElementById("bloodFx");
    if (existing) {
      this.bloodEl = existing;
      return existing;
    }

    const created = document.createElement("div");
    created.id = "bloodFx";
    created.className = "hidden";
    created.style.position = "fixed";
    created.style.inset = "0";
    created.style.zIndex = "40";
    created.style.pointerEvents = "none";
    created.style.overflow = "hidden";
    document.body.appendChild(created);
    this.bloodEl = created;
    return created;
  }
}

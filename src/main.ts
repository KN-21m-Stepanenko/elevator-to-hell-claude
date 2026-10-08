import {
  Color3,
  Color4,
  Engine,
  Scene,
} from "@babylonjs/core";

import { CONFIG } from "./config";
import { Elevator } from "./elevator/Elevator";
import { buildWorld } from "./levels/World";
import {
  NpcEnv,
  spawnNpcs,
} from "./npc/Npc";
import { MonsterManager } from "./monsters/MonsterManager";
import { Player } from "./player/Player";
import { Weapon } from "./player/Weapon";
import { WEAPON_LABELS } from "./player/WeaponModels";
import { Hud } from "./ui/Hud";

const canvas =
  document.getElementById(
    "game",
  ) as HTMLCanvasElement;

const engine = new Engine(
  canvas,
  false,
  { stencil: false },
);

engine.setHardwareScalingLevel(
  CONFIG.render.pixelScale,
);

const scene = new Scene(engine);

scene.collisionsEnabled = true;
scene.clearColor =
  new Color4(0.02, 0.02, 0.03, 1);

scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity =
  CONFIG.render.fogDensity;
scene.fogColor =
  new Color3(0.03, 0.03, 0.04);

const world = buildWorld(scene);

const npcs = spawnNpcs(
  scene,
  world.cabin.root,
);

const player = new Player(
  scene,
  canvas,
  world.spawn,
  world.spawnYaw,
);

const weapon = new Weapon(
  scene,
  player,
);

const hud = new Hud();

const elevator = new Elevator(
  scene,
  world.cabin,
  world.landing,
  player,
  npcs,
  (t) => hud.toast(t),
);

const monsters = new MonsterManager(
  scene,
  player,
  npcs,
  world.cabin.root,
  (t, ms) => hud.toast(t, ms),
);

let ending = false;

const restartGame = () => {
  const url =
    new URL(window.location.href);

  url.searchParams.set(
    "restart",
    String(Date.now()),
  );

  window.location.assign(
    url.toString(),
  );
};

const showGameOver = () => {
  if (ending) return;

  ending = true;

  player.freezeInput(true);
  player.enableFreeLook();

  weapon.hide();
  monsters.freezeLiving();

  hud.showResult(
    "GAME OVER",
    player.deathReason,
    restartGame,
  );
};

const finishVictory = (
  message: string,
) => {
  if (ending) return;

  ending = true;

  player.freezeInput(true);
  player.enableFreeLook();

  weapon.hide();
  monsters.freezeLiving();

  hud.setEnding();

  const delay =
    CONFIG.result.delayBeforeMessage *
    1000;

  window.setTimeout(() => {
    if (!ending) return;

    hud.showResult(
      "YOU WIN",
      message,
      restartGame,
    );
  }, delay);
};

monsters.setDoorOpenProvider(() => elevator.exitOpen());

elevator.onArrived = (floor) =>
  monsters.spawnForFloor(floor);

monsters.onVictory = (floor) =>
  finishVictory(
    floor === 4
      ? "ДАХ ОЧИЩЕНО — ПЕРЕМОГА"
      : `ПОВЕРХ ${floor} ОЧИЩЕНО — ПЕРЕМОГА`,
  );

weapon.onPickup = (type) => {
  hud.toast(
    `ПІДІБРАНО: ${WEAPON_LABELS[type]}`,
    1800,
  );
};

player.onDamage = (hp) => {
  hud.bloodSplash(64);

  if (
    hp > 0 &&
    hp < player.maxHealth * 0.3
  ) {
    hud.toast(
      `ЗДОРОВ'Я: ${hp}%`,
      700,
    );
  }
};

const env: NpcEnv = {
  cabin: world.cabin.root,
  scene,
  player,
  weapon,
  elevator,
  npcs,
};

npcs.forEach(
  (npc) => (npc.env = env),
);

hud.setPaused(true);

hud.onStart(() =>
  player.requestLock(),
);

player.onLockChange = (locked) => {
  if (!ending && player.alive) {
    hud.setPaused(!locked);
  }
};

player.onToggleWeapon = () =>
  weapon.toggle();

player.onFire = () =>
  weapon.fire();

player.onFireHeld = () =>
  weapon.fireHeld();

player.onInteract = () => {
  // Сначала проверяем оружие.
  // Если рядом pickup — кнопка E забирает его
  // и не нажимает кнопку лифта.
  if (weapon.interact()) {
    return;
  }

  const key =
    elevator.pickKey();

  if (key !== null) {
    elevator.press(key);
  }
};

scene.onBeforeRenderObservable.add(
  () => {
    const dt = Math.min(
      engine.getDeltaTime() / 1000,
      0.05,
    );

    world.lava.update(dt);

    if (!ending) {
      const weaponHint =
        weapon.getPickupHint();

      if (weaponHint !== null) {
        hud.setHint(
          weaponHint,
        );
      } else {
        const key =
          elevator.pickKey();

        if (key === null) {
          hud.setHint(null);
        } else if (key === "stop") {
          hud.setHint(
            "E — аварійна зупинка",
          );
        } else {
          hud.setHint(
            "E — поверх",
          );
        }
      }

      elevator.update(dt);
      weapon.update(dt);
    }

    npcs.forEach(
      (npc) =>
        npc.update(dt, ending),
    );

    player.update(dt);

    elevator.constrainPlayer();

    if (
      !ending &&
      !player.alive
    ) {
      showGameOver();
    }

    monsters.update(dt);
  },
);

engine.runRenderLoop(() =>
  scene.render(),
);

window.addEventListener(
  "resize",
  () => engine.resize(),
);
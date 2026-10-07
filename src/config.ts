import { Vector3 } from "@babylonjs/core";

/** Единый конфиг игры: все числа и тайминги настраиваются здесь. */
export const CONFIG = {
  render: { pixelScale: 3, fov: 1.2, fogDensity: 0.015 },

  player: {
    moveSpeed: 6,
    mouseSensitivity: 0.0022,
    maxPitch: 1.5,
    eyeHeight: 1.6,
    ellipsoid: new Vector3(0.4, 0.9, 0.4),
    gravity: 9.8,
    health: 100,
    deathCameraRise: 1.2,
    deathCameraForward: -0.45,
    deathCameraPitch: 0.95,
    deathCameraTime: 0.55,
  },

  level: {
    tile: 2,
    wallHeight: 4,
    roofHeight: 4,
    wallThickness: 0.4,
    halfX: 10,
    halfZ: 8,
  },

  elevator: {
    cabinSize: 5,
    cabinHeight: 3,
    doorWidth: 2.4,
    floorHeight: 5,
    floors: [-1, 0, 1, 2, 3, 4],
    startFloor: 0,
    speed: 3,
    doorTime: 1.2,
    reach: 3.5,
    weightLimit: 300,
    playerWeight: 80,
    npcWeight: [60, 100],
    npcCount: [3, 5],
  },

  weapon: {
    // Радиус поиска оружия стал меньше.
    pickupRange: 1.35,

    shotgun: {
      pellets: 8,
      damage: 10,
      spread: 0.045,
      cooldown: 0.85,
      range: 40,
      recoil: 0.03,
    },

    machineGun: {
      damage: 16,
      spread: 0.014,
      cooldown: 0.085,
      range: 55,
      recoil: 0.008,
    },

    quadShotgun: {
      pellets: 4,
      damage: 28,
      spread: 0.055,
      cooldown: 0.95,
      range: 42,
      recoil: 0.038,
    },

    rocketLauncher: {
      directDamage: 125,

      // Увеличил урон по площади.
      splashDamage: 85,

      // Большой радиус взрыва.
      explosionRadius: 4.5,

      // Радиус proximity fuse.
      // Ракета взорвётся ещё до прямого контакта
      // с монстром, если пройдёт достаточно близко.
      proximityFuseRadius: 1.35,

      cooldown: 1.25,
      projectileSpeed: 18,
      projectileGravity: -1.8,
      maxFlightTime: 5,

      // Размер видимого следа ракеты.
      trailLength: 1.0,
      trailWidth: 0.045,

      recoil: 0.045,
    },

    railgun: {
      damage: 240,
      range: 80,
      cooldown: 1.7,
      recoil: 0.055,
      maxTargets: 6,

      // Q2-подобный спиральный след.
      trailDuration: 0.12,
      trailRadius: 0.11,
      trailSegments: 22,
      trailTurns: 3.5,
    },

    pickups: {
      1: {
        type: "MACHINE_GUN",
        position: [-7.0, 5.2],
      },

      2: {
        type: "QUAD_SHOTGUN",
        position: [-7.0, 5.2],
      },

      3: {
        type: "ROCKET_LAUNCHER",
        position: [4.8, 5.7],
      },

      4: {
        type: "RAILGUN",
        position: [-5.5, -5.3],
      },
    },
  },

  npc: {
    hp: 40,
    runSpeed: 3.2,
    sightRange: 18,
  },

  monsters: {
    walker: {
      count: [3, 5],
      hp: 225,
      speed: 1.9,
      damage: 12,
      attackRange: 1.5,
      attackCooldown: 0.9,
      attackDuration: 0.55,
      attackHitTime: 0.26,
      sightRange: 30,
      radius: 0.55,
      bodyHeight: 2.15,
      deathTime: 1.0,
      walkAnimRate: 3.4,
    },

    flying: {
      count: [3, 6],
      hp: 175,
      damage: 18,
      attackRange: 1.4,
      hitRadius: 2.1,
      attackCooldown: 1.2,
      orbitRadiusMin: 6,
      orbitRadiusMax: 9,
      orbitHeight: 5.5,
      orbitSpeed: 0.8,
      diveSpeed: 8,
      recoverSpeed: 5,
      diveInterval: 2.8,
      deathDropHeight: 0.18,
      wingFlapSpeed: 9,
    },
  },

  safety: {
    crushDistance: 0.3,
    bodyHalfWidth: 0.35,
    voidY: -0.6,
  },

  result: {
    delayBeforeMessage: 2,
    restartAfterMessage: 2,
  },

  lava: {
    floor: -1,
    cabinTargetY: -25.0,
    surfaceY: -23.6,
    deathDelay: 0.65,
    shaftWidth: 7.2,
    shaftDepth: 7.2,
    shaftTopY: -0.12,
    shaftBottomY: -27.0,
    glowSpeed: 3.2,
    sparkCount: 36,
    lightRange: 2.8,
  },

  emergency: {
    waitTime: 5.0,
    gravity: 10.5,
    impactDistance: 16.0,
    cableBreakDuration: 1.25,
    shakeAmplitude: 0.24,
    shakeFrequency: 31,
    cameraShakeAmplitude: 0.16,
    cameraShakeFrequency: 34,
    doorOpenBeforeFall: 0.35,
    doorOpenDuringFall: 0.55,
  },
};
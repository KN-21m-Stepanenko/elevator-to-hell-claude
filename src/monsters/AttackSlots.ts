import { CONFIG } from "../config";
import type { DamageTarget } from "./Monster";
import type { NavGrid, Point } from "./NavGrid";

/** Участник раздачи позиций: монстр, у которого есть цель и место (слот) вокруг неё. */
export interface SlotUser {
  alive: boolean;
  currentTarget: DamageTarget | null;
  slot: Point | null;
  getWorldPosition(): { x: number; y: number; z: number };
}

const RINGS = [{ r: 1.15, n: 8 }, { r: 2.4, n: 12 }, { r: 3.6, n: 16 }];
const MIN_GAP = 0.95;

/**
 * Раздаёт монстрам разные места вокруг одной цели, чтобы они не сбивались в кучу:
 * точки на кольцах вокруг цели, каждому — ближайшая свободная и не занятая другим.
 * Если цель в кабине, кольца строятся вокруг точки у двери: монстры выстраиваются в комнате веером.
 */
export class AttackSlots {
  private base = new Map<DamageTarget, number>();
  private roam = new WeakMap<SlotUser, { p: Point; t: number }>();

  assign(users: SlotUser[], nav: NavGrid, dt = 0.3) {
    const groups = new Map<DamageTarget, SlotUser[]>();
    for (const u of users) {
      u.slot = null;
      if (!u.alive || !u.currentTarget) continue;
      const list = groups.get(u.currentTarget) ?? [];
      list.push(u);
      groups.set(u.currentTarget, list);
    }

    for (const [target, list] of groups) {
      const tp = target.getWorldPosition();
      if (tp.z > CONFIG.level.halfZ - 0.3) { this.roamGroup(list, nav, dt); continue; } // цель в лифте: до неё не добраться
      const anchor = { x: tp.x, z: Math.min(tp.z, CONFIG.level.halfZ - 1.2) };
      const angleOf = (u: SlotUser) => { const p = u.getWorldPosition(); return Math.atan2(p.z - anchor.z, p.x - anchor.x); };
      const dist = (u: SlotUser) => { const p = u.getWorldPosition(); return Math.hypot(p.x - anchor.x, p.z - anchor.z); };

      list.sort((a, b) => dist(a) - dist(b));
      if (!this.base.has(target)) this.base.set(target, angleOf(list[0]));
      const base = this.base.get(target)!;

      const claimed: Point[] = [];
      for (const u of list) {
        if (dist(u) > 16) continue;
        const mine = angleOf(u);
        slotSearch:
        for (const ring of RINGS) {
          const cand: Array<{ p: Point; score: number }> = [];
          for (let k = 0; k < ring.n; k++) {
            const a = base + (k * Math.PI * 2) / ring.n;
            const p = { x: anchor.x + Math.cos(a) * ring.r, z: anchor.z + Math.sin(a) * ring.r };
            const dAng = Math.abs(Math.atan2(Math.sin(a - mine), Math.cos(a - mine)));
            cand.push({ p, score: dAng });
          }
          cand.sort((x, y) => x.score - y.score);
          for (const c of cand) {
            if (!nav.freeAt(c.p.x, c.p.z)) continue;
            if (claimed.some((o) => Math.hypot(o.x - c.p.x, o.z - c.p.z) < MIN_GAP)) continue;
            u.slot = c.p;
            claimed.push(c.p);
            break slotSearch;
          }
        }
      }
    }
  }

  /**
   * Цель в лифте: монстры не толпятся у двери и не мешают выйти, а бродят по комнате
   * не дальше lingerRadius от двери, не ближе 4.5 м и вне коридора перед дверью.
   */
  private roamGroup(list: SlotUser[], nav: NavGrid, dt: number) {
    const door = { x: 0, z: CONFIG.level.halfZ - 0.5 }, R = CONFIG.monsters.walker.lingerRadius;
    const taken: Point[] = [];
    for (const u of list) { const st = this.roam.get(u); if (st) taken.push(st.p); }

    for (const u of list) {
      let st = this.roam.get(u);
      if (st) st.t -= dt;
      if (!st || st.t <= 0) {
        const old = st?.p;
        if (old) taken.splice(taken.indexOf(old), 1);
        let pick: Point | null = null;
        for (let i = 0; i < 40 && !pick; i++) {
          const r = 4.5 + Math.random() * (R - 4.5), ang = Math.random() * Math.PI * 2;
          const p = { x: door.x + Math.cos(ang) * r, z: door.z + Math.sin(ang) * r };
          if (p.z > door.z - 3) continue;                                  // только в комнате, не у самой стены
          if (Math.abs(p.x - door.x) < 2.6 && p.z > door.z - 9) continue;  // коридор к двери остаётся свободным
          if (!nav.freeAt(p.x, p.z)) continue;
          if (taken.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.6)) continue;
          pick = p;
        }
        st = { p: pick ?? old ?? { x: u.getWorldPosition().x, z: u.getWorldPosition().z }, t: 5 + Math.random() * 4 };
        this.roam.set(u, st);
        taken.push(st.p);
      }
      u.slot = st.p;
    }
  }
}

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

  assign(users: SlotUser[], nav: NavGrid) {
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
}

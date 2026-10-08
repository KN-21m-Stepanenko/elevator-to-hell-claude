import { Scene, Vector3 } from "@babylonjs/core";

/** Мировой габаритный бокс статического коллайдера. */
export interface Aabb { min: Vector3; max: Vector3 }
export interface Point { x: number; z: number }

/** Все статические коллайдеры сцены (монстры, NPC и игрок пропускаются). */
/** includeDoors: учитывать створки дверей (для баллистики гранат); для навигации они игнорируются. */
export function staticBoxes(scene: Scene, includeDoors = false): Aabb[] {
  const out: Aabb[] = [];
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled() || !mesh.checkCollisions || mesh.metadata?.monster || mesh.metadata?.npc || mesh.metadata?.player || (!includeDoors && mesh.metadata?.door)) continue;
    mesh.computeWorldMatrix(true);
    const b = mesh.getBoundingInfo().boundingBox;
    out.push({ min: b.minimumWorld.clone(), max: b.maximumWorld.clone() });
  }
  return out;
}

/** Свободна ли точка в воздухе (куб со стороной 2r) от статических коллайдеров. */
export function isAirFree(boxes: Aabb[], p: Vector3, r: number): boolean {
  for (const b of boxes) {
    if (p.x + r < b.min.x || p.x - r > b.max.x) continue;
    if (p.y + r < b.min.y || p.y - r > b.max.y) continue;
    if (p.z + r < b.min.z || p.z - r > b.max.z) continue;
    return false;
  }
  return true;
}

const CELL = 0.5, X0 = -9.75, Z0 = -7.75, COLS = 39, ROWS = 31; // сетка покрывает комнату этажа
const SQRT2 = Math.SQRT2;

/** Минимальная бинарная куча для A*. */
class MinHeap {
  private f: number[] = [];
  private v: number[] = [];
  get size() { return this.v.length; }
  push(f: number, v: number) {
    let i = this.v.length;
    this.f.push(f); this.v.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      [this.f[p], this.f[i]] = [this.f[i], this.f[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.v[0], lf = this.f.pop()!, lv = this.v.pop()!;
    if (this.v.length) {
      this.f[0] = lf; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.v.length && this.f[l] < this.f[m]) m = l;
        if (r < this.v.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        [this.f[m], this.f[i]] = [this.f[i], this.f[m]];
        [this.v[i], this.v[m]] = [this.v[m], this.v[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Навигационная сетка этажа: клетки, куда помещается монстр с заданным радиусом, поиск пути A*
 * с «натягиванием нити» и подбор мест появления только в достижимых свободных клетках.
 */
export class NavGrid {
  private blocked = new Uint8Array(COLS * ROWS);

  constructor(boxes: Aabb[], floorY: number, radius: number, height: number) {
    const near = boxes.filter((b) => b.max.y > floorY + 0.05 && b.min.y < floorY + height);
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const c = this.center(i, j);
        for (const b of near) {
          const dx = c.x - Math.max(b.min.x, Math.min(c.x, b.max.x));
          const dz = c.z - Math.max(b.min.z, Math.min(c.z, b.max.z));
          if (dx * dx + dz * dz < radius * radius) { this.blocked[j * COLS + i] = 1; break; }
        }
      }
    }
  }

  private center(i: number, j: number): Point { return { x: X0 + (i + 0.5) * CELL, z: Z0 + (j + 0.5) * CELL }; }
  private inGrid(i: number, j: number) { return i >= 0 && j >= 0 && i < COLS && j < ROWS; }
  private cellOf(x: number, z: number) {
    return { i: Math.floor((x - X0) / CELL), j: Math.floor((z - Z0) / CELL) };
  }
  private isFreeCell(i: number, j: number) { return this.inGrid(i, j) && !this.blocked[j * COLS + i]; }

  /** Свободна ли точка (клетка с запасом под радиус монстра). */
  freeAt(x: number, z: number) {
    const c = this.cellOf(x, z);
    return this.isFreeCell(c.i, c.j);
  }

  /** Можно ли пройти по прямой: все точки отрезка лежат в свободных клетках. */
  lineFree(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.2);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.freeAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** Ближайшая свободная клетка (поиск кольцами). */
  private nearestFree(i0: number, j0: number): { i: number; j: number } | null {
    i0 = Math.max(0, Math.min(COLS - 1, i0));
    j0 = Math.max(0, Math.min(ROWS - 1, j0));
    for (let r = 0; r < Math.max(COLS, ROWS); r++) {
      let best: { i: number; j: number } | null = null, bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++)
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || !this.isFreeCell(i, j)) continue;
          const d = (i - i0) ** 2 + (j - j0) ** 2;
          if (d < bd) { bd = d; best = { i, j }; }
        }
      if (best) return best;
    }
    return null;
  }

  private neighbors(i: number, j: number, fn: (ni: number, nj: number, cost: number) => void) {
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.isFreeCell(ni, nj)) continue;
        // По диагонали — только если обе соседние клетки свободны (не срезаем углы).
        if (di && dj && (!this.isFreeCell(i + di, j) || !this.isFreeCell(i, j + dj))) continue;
        fn(ni, nj, di && dj ? SQRT2 : 1);
      }
  }

  /** Путь A* от (sx,sz) до (gx,gz): список точек, уже сглаженный. null — пути нет. */
  findPath(sx: number, sz: number, gx: number, gz: number): Point[] | null {
    const sc = this.cellOf(sx, sz), gc = this.cellOf(gx, gz);
    const s = this.nearestFree(sc.i, sc.j), g = this.nearestFree(gc.i, gc.j);
    if (!s || !g) return null;
    const N = COLS * ROWS, start = s.j * COLS + s.i, goal = g.j * COLS + g.i;
    const gs = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - g.i), dz = Math.abs(j - g.j);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    const open = new MinHeap();
    gs[start] = 0;
    open.push(h(s.i, s.j), start);
    while (open.size) {
      const cur = open.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      if (cur === goal) break;
      const ci = cur % COLS, cj = (cur / COLS) | 0;
      this.neighbors(ci, cj, (ni, nj, cost) => {
        const n = nj * COLS + ni, ng = gs[cur] + cost;
        if (ng < gs[n]) { gs[n] = ng; prev[n] = cur; open.push(ng + h(ni, nj), n); }
      });
    }
    if (prev[goal] === -1 && goal !== start) return null;

    const cells: Point[] = [];
    for (let c = goal; c !== -1; c = prev[c]) cells.push(this.center(c % COLS, (c / COLS) | 0));
    cells.reverse();
    // Натягивание нити: убираем лишние промежуточные точки, пока прямой путь свободен.
    const pts: Point[] = [{ x: sx, z: sz }, ...cells];
    const out: Point[] = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineFree(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }

  /**
   * Места появления: свободные клетки, достижимые от входа, не ближе minFromEntry к входу
   * и не ближе minSep друг к другу. Если мест не хватает, условия постепенно ослабляются.
   */
  pickSpawns(count: number, entry: Point, minFromEntry: number, minSep: number, maxZ = 7.2): Point[] {
    const sc = this.cellOf(entry.x, entry.z - 1.5);
    const s = this.nearestFree(sc.i, sc.j);
    if (!s) return [];
    const seen = new Uint8Array(COLS * ROWS), queue = [s.j * COLS + s.i], cells: number[] = [];
    seen[queue[0]] = 1;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      cells.push(cur);
      this.neighbors(cur % COLS, (cur / COLS) | 0, (ni, nj) => {
        const n = nj * COLS + ni;
        if (!seen[n]) { seen[n] = 1; queue.push(n); }
      });
    }
    cells.sort(() => Math.random() - 0.5);
    const out: Point[] = [];
    const pass = (dEntry: number, sep: number) => {
      for (const c of cells) {
        if (out.length >= count) return;
        const p = this.center(c % COLS, (c / COLS) | 0);
        if (p.z > maxZ) continue;
        if (Math.hypot(p.x - entry.x, p.z - entry.z) < dEntry) continue;
        if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < sep)) continue;
        out.push(p);
      }
    };
    pass(minFromEntry, minSep);
    pass(minFromEntry * 0.5, minSep * 0.6);
    pass(0, 1.2);
    return out;
  }
}

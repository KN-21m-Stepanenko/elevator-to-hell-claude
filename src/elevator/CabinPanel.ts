import { Color3, DynamicTexture, MeshBuilder, Scene, StandardMaterial, TransformNode } from "@babylonjs/core";
import { CONFIG } from "../config";
import { canvasTexture } from "../utils/textures";

export type ButtonKey = number | "stop";
type Ctx = CanvasRenderingContext2D;

/** Самосветящийся материал: цвет берётся только из текстуры. */
function litMaterial(scene: Scene, tex: DynamicTexture) {
  const m = new StandardMaterial("ui_mat", scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveTexture = tex;
  return m;
}

const PANEL_Z = -1.0;  // центр панели по оси кабины (z), ближе к двери
const EYE_ROWS = [1.75, 1.45]; // два ряда кнопок на уровне глаз
const COL_STEP = 0.3;

/** Табло веса на задней стене и панель кнопок (2 ряда) на правой стене кабины. */
export class CabinPanel {
  private bTex: DynamicTexture;
  private bCtx: Ctx;
  private bKey = "";
  private btn = new Map<ButtonKey, { tex: DynamicTexture; ctx: Ctx; label: string; w: number }>();

  constructor(scene: Scene, root: TransformNode) {
    const { cabinSize: s, cabinHeight: h, floors } = CONFIG.elevator;
    const half = s / 2;

    const board = canvasTexture(scene, 256, 96);
    this.bTex = board.tex; this.bCtx = board.ctx;
    const bm = MeshBuilder.CreatePlane("weight_board", { width: 2, height: 0.75 }, scene);
    bm.parent = root;
    bm.position.set(0, h - 0.65, half - 0.02);
    bm.material = litMaterial(scene, board.tex);

    // Тёмная подложка панели.
    const plate = MeshBuilder.CreatePlane("panel_plate", { width: 1.4, height: 0.72 }, scene);
    const pm = new StandardMaterial("plate_mat", scene);
    pm.diffuseColor = new Color3(0.06, 0.06, 0.07); pm.specularColor = Color3.Black();
    plate.material = pm; plate.parent = root; plate.isPickable = false;
    plate.position.set(half - 0.012, (EYE_ROWS[0] + EYE_ROWS[1]) / 2, PANEL_Z);
    plate.rotation.y = Math.PI / 2;

    // Колонки идут слева направо для игрока, смотрящего на правую стену (то есть вдоль -z).
    const add = (key: ButtonKey, label: string, col: number, row: number, span = 1) => {
      const w = span === 1 ? 0.24 : 0.24 + COL_STEP * (span - 1);
      const tw = span === 1 ? 64 : Math.round((w / 0.24) * 64);
      const t = canvasTexture(scene, tw, 64);
      const m = MeshBuilder.CreatePlane(`btn_${key}`, { width: w, height: 0.24 }, scene);
      m.parent = root;
      m.position.set(half - 0.03, EYE_ROWS[row], PANEL_Z - (col + (span - 1) / 2 - 1.5) * COL_STEP);
      m.rotation.y = Math.PI / 2; // нормаль смотрит внутрь кабины (-x)
      m.material = litMaterial(scene, t.tex);
      m.metadata = { button: key };
      this.btn.set(key, { ...t, label, w: tw });
      this.drawButton(key, false);
    };
    const top = floors.filter((f) => f > 0);
    const bottom = floors.filter((f) => f <= 0);
    top.forEach((f, i) => add(f, String(f), i, 0));
    bottom.forEach((f, i) => add(f, String(f), i, 1));
    add("stop", "СТОП", bottom.length, 1, 4 - bottom.length);
  }

  private drawButton(key: ButtonKey, lit: boolean) {
    const b = this.btn.get(key)!, c = b.ctx, stop = key === "stop";
    c.fillStyle = stop ? (lit ? "#ff5a48" : "#b01810") : lit ? "#ffd060" : "#2a2a2e";
    c.fillRect(0, 0, b.w, 64);
    c.strokeStyle = "#0c0c0c"; c.lineWidth = 5; c.strokeRect(2, 2, b.w - 4, 60);
    c.fillStyle = stop ? "#ffffff" : lit ? "#201000" : "#d8d0b0";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `bold ${stop ? 26 : 32}px "Courier New", monospace`;
    c.fillText(b.label, b.w / 2, 34);
    b.tex.update();
  }

  /** Подсветить выбранный этаж (null — снять подсветку). */
  setSelected(sel: number | null) {
    for (const k of this.btn.keys()) if (k !== "stop") this.drawButton(k, k === sel);
  }

  /**
   * Табло: слева текущий этаж и стрелка движения, справа вес.
   * Вес зелёный при ≤ лимита, красный при перегрузе; alarm — мигающая надпись после нажатия этажа.
   */
  setBoard(weight: number, limit: number, alarm: boolean, flashOn: boolean, floorText: string, dir: number, emergency = false, glitchTick = 0) {
    const key = `${weight}|${alarm}|${alarm && flashOn}|${floorText}|${dir}|${emergency}|${glitchTick}`;
    if (key === this.bKey) return;
    this.bKey = key;
    const c = this.bCtx, col = weight > limit ? "#ff3b2a" : "#3dff5e", fl = "#ffb830";
    c.fillStyle = emergency ? (flashOn ? "#240303" : "#050805") : "#050805";
    c.fillRect(0, 0, 256, 96);

    if (emergency) {
      // Во время аварии табло превращается в быстро меняющийся мусорный код.
      const glyphs = "#@$%&?!X7F/\\<>*+=";
      const pseudo = (seed: number, len: number) => {
        let x = (seed * 1103515245 + 12345) >>> 0;
        let out = "";
        for (let i = 0; i < len; i++) {
          x = (x * 1664525 + 1013904223) >>> 0;
          out += glyphs[x % glyphs.length];
        }
        return out;
      };
      c.strokeStyle = flashOn ? "#ff2b1f" : "#7a130d";
      c.lineWidth = 4;
      c.strokeRect(2, 2, 252, 92);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#ff3b2a";
      c.font = 'bold 25px "Courier New", monospace';
      c.fillText(pseudo(glitchTick + 11, 8), 58, 29);
      c.fillText(pseudo(glitchTick + 97, 8), 58, 68);
      c.font = 'bold 20px "Courier New", monospace';
      c.fillStyle = "#ff8a72";
      c.fillText(pseudo(glitchTick + 251, 12), 175, 28);
      c.fillText(pseudo(glitchTick + 521, 10), 175, 61);
      c.fillStyle = flashOn ? "#ffffff" : "#d33a30";
      c.fillText("//", 128, 45);
      this.bTex.update();
      return;
    }

    c.strokeStyle = col; c.lineWidth = 3; c.strokeRect(2, 2, 252, 92);
    c.fillStyle = col; c.fillRect(92, 8, 2, 80); // разделитель

    // Этаж и стрелка
    c.fillStyle = fl;
    if (dir !== 0) {
      c.beginPath();
      if (dir > 0) { c.moveTo(50, 8); c.lineTo(38, 24); c.lineTo(62, 24); } else { c.moveTo(50, 24); c.lineTo(38, 8); c.lineTo(62, 8); }
      c.closePath(); c.fill();
    }
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.font = 'bold 46px "Courier New", monospace';
    c.fillText(floorText, 50, 68);
    c.font = 'bold 14px "Courier New", monospace';
    c.fillText("ПОВЕРХ", 50, 86);

    // Вес
    c.fillStyle = col;
    c.font = 'bold 40px "Courier New", monospace';
    c.fillText(`${weight} КГ`, 175, 54);
    c.font = 'bold 18px "Courier New", monospace';
    c.fillText(alarm ? (flashOn ? "Перевантаження!" : "") : `ЛІМІТ ${limit} КГ`, 175, 82);
    this.bTex.update();
  }
}

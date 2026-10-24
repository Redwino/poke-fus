import Phaser from "phaser";
import movesFile from "../../data/moves.generated.json";
import { MAX_SPELLS, PLAYER_MOVE_POOL, session } from "../session";

// Menú "Equipo y hechizos", accesible desde el mapa del mundo.
// Acá se eligen hasta 4 hechizos para los próximos combates.
const MOVES: Record<string, { name: string; type: string; damageClass: string }> = (movesFile as any).moves;

export class TeamScene extends Phaser.Scene {
  private chosen: string[] = [];
  private buttons = new Map<string, Phaser.GameObjects.Text>();
  private counter!: Phaser.GameObjects.Text;

  constructor() {
    super("TeamScene");
  }

  create() {
    this.buttons.clear();
    this.chosen = session.playerMoves.length ? [...session.playerMoves] : PLAYER_MOVE_POOL.slice(0, MAX_SPELLS);

    const w = this.scale.width;
    const pm = session.playerMon;
    const title = pm ? `${pm.name}  Nv. ${pm.level}` : "Equipo y hechizos";
    this.add.text(16, 16, "Equipo y hechizos", { fontSize: "22px", color: "#ffffff" });
    this.add.text(16, 48, title, { fontSize: "16px", color: "#ffe08a" });
    this.add.text(16, 74, `Elige hasta ${MAX_SPELLS} hechizos para los próximos combates.`, {
      fontSize: "15px",
      color: "#cfd8e3",
    });

    let y = 110;
    for (const id of PLAYER_MOVE_POOL) {
      const m = MOVES[id];
      const label = m ? `${m.name}  (${m.type}, ${m.damageClass === "status" ? "estado" : m.damageClass})` : id;
      const btn = this.add
        .text(16, y, label, {
          fontSize: "17px",
          color: "#ffffff",
          backgroundColor: "#2d3748",
          padding: { x: 12, y: 10 },
          fixedWidth: Math.min(w - 32, 460),
        })
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.toggle(id));
      this.buttons.set(id, btn);
      y += 60;
    }

    this.counter = this.add.text(16, y + 8, "", { fontSize: "16px", color: "#ffe08a" });

    this.add
      .text(16, y + 46, "Volver al mapa", {
        fontSize: "20px",
        color: "#ffffff",
        backgroundColor: "#2f855a",
        padding: { x: 16, y: 10 },
      })
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.back());

    this.refresh();
  }

  private toggle(id: string) {
    if (this.chosen.includes(id)) {
      this.chosen = this.chosen.filter((x) => x !== id);
    } else if (this.chosen.length < MAX_SPELLS) {
      this.chosen.push(id);
    }
    this.refresh();
  }

  private refresh() {
    for (const [id, btn] of this.buttons) {
      btn.setBackgroundColor(this.chosen.includes(id) ? "#2f855a" : "#2d3748");
    }
    this.counter.setText(`Elegidos: ${this.chosen.length}/${MAX_SPELLS}`);
  }

  /** Guarda la selección (al menos 1) y vuelve al mapa. */
  private back() {
    if (this.chosen.length === 0) {
      this.counter.setText("Elige al menos 1 hechizo.");
      return;
    }
    session.playerMoves = [...this.chosen];
    this.scene.start("MapScene");
  }
}

import Phaser from "phaser";
import movesFile from "../../data/moves.generated.json";
import { MAX_SPELLS, PLAYER_MOVE_POOL, session } from "../session";

// Menú previo al combate: elegir hasta 4 hechizos (como en los juegos de Pokémon).
const MOVES: Record<string, { name: string; type: string; damageClass: string }> = (movesFile as any).moves;

export class PrepScene extends Phaser.Scene {
  private chosen: string[] = [];
  private buttons = new Map<string, Phaser.GameObjects.Text>();
  private counter!: Phaser.GameObjects.Text;

  constructor() {
    super("PrepScene");
  }

  create() {
    this.buttons.clear();
    this.chosen = session.playerMoves.length ? [...session.playerMoves] : PLAYER_MOVE_POOL.slice(0, MAX_SPELLS);

    const w = this.scale.width;
    this.add.text(16, 16, "Preparación de combate", { fontSize: "22px", color: "#ffffff" });
    this.add.text(16, 48, `Elige hasta ${MAX_SPELLS} hechizos para este combate.`, {
      fontSize: "15px",
      color: "#cfd8e3",
    });

    let y = 96;
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
      .text(16, y + 46, "Continuar", {
        fontSize: "20px",
        color: "#ffffff",
        backgroundColor: "#2f855a",
        padding: { x: 16, y: 10 },
      })
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.confirm());

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
      const on = this.chosen.includes(id);
      btn.setBackgroundColor(on ? "#2f855a" : "#2d3748");
    }
    this.counter.setText(`Elegidos: ${this.chosen.length}/${MAX_SPELLS}`);
  }

  private confirm() {
    if (this.chosen.length === 0) {
      this.counter.setText("Elige al menos 1 hechizo.");
      return;
    }
    session.playerMoves = [...this.chosen];
    this.scene.start("CombatScene");
  }
}

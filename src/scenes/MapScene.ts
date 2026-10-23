import Phaser from "phaser";
import { hexKey, hexNeighbors, hexRange, type Hex } from "../hex";
import { session } from "../session";
import { diamondCorners, hexToWorld, screenToHex, worldToIso, type IsoConfig } from "../render/iso";
import { directionOf, makeToken, makeWalker, preloadSprites, preloadWalk, setWalk } from "../render/sprites";

const PLAYER_SPRITE = "p1"; // Bulbasaur

// ---------- Mapa de exploración (libre, sin PA ni PM) ----------
const MAP_RADIUS = 7;
const HEX_SIZE = 34;
const WALK_MS = 170; // tiempo por casilla al caminar

// Casillas no utilizables (muros, huecos) y trampas de prueba
const OBSTACLES: Hex[] = [
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 2 }, { q: -2, r: 1 }, { q: 3, r: -3 },
];
const TRAPS: Hex[] = [
  { q: -1, r: 1 }, { q: 2, r: -2 }, { q: -3, r: -1 },
];

// Grupos de pios visibles: al caminar hasta ellos empieza el combate
const GROUP_HEX: Hex = { q: 2, r: 0 };
// Pokémon del grupo de prueba (nombre y nivel). Se mostrarán al pasar el mouse.
const GROUP_MONS = [
  { name: "Charmander", level: 12 },
  { name: "Squirtle", level: 11 },
];

export class MapScene extends Phaser.Scene {
  private cfg!: IsoConfig;
  private tiles: Hex[] = [];
  private tileSet = new Set<string>();
  private obstacleSet = new Set<string>();
  private trapSet = new Set<string>();
  private groupKey = hexKey(GROUP_HEX);

  private gfx!: Phaser.GameObjects.Graphics;
  private player!: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc;
  private facing = 0; // dirección PMD hacia donde mira el personaje
  private info!: Phaser.GameObjects.Text;
  private sword!: Phaser.GameObjects.Text;
  private groupTip!: Phaser.GameObjects.Text;

  private playerHex: Hex = { q: 0, r: 0 };
  private popupOpen = false;
  private hover: Hex | null = null;
  private target: Hex | null = null; // destino elegido
  private route: Hex[] = []; // casillas intermedias elegidas con Shift + clic
  private path: Hex[] | null = null; // camino completo a mostrar
  private moving = false;

  constructor() {
    super("MapScene");
  }

  preload() {
    preloadSprites(this, ["p1", "p4", "p7"]);
    preloadWalk(this, PLAYER_SPRITE);
  }

  create() {
    this.cfg = {
      size: HEX_SIZE,
      originX: this.scale.width / 2,
      originY: this.scale.height / 2.6,
    };

    this.tiles = hexRange({ q: 0, r: 0 }, MAP_RADIUS);
    this.tiles.forEach((t) => this.tileSet.add(hexKey(t)));
    OBSTACLES.forEach((h) => this.obstacleSet.add(hexKey(h)));
    TRAPS.forEach((h) => this.trapSet.add(hexKey(h)));

    this.gfx = this.add.graphics();
    this.player = makeWalker(this, PLAYER_SPRITE, 0, 0, 0xe8a33d).setDepth(10);
    this.info = this.add
      .text(12, 12, "", { fontSize: "15px", color: "#ffffff", lineSpacing: 4 })
      .setDepth(20);

    // Texto con el número de pios sobre el grupo
    const gc = this.center(GROUP_HEX);
    // Muestra el primer Pokémon del grupo; la etiqueta queda debajo
    makeToken(this, "p4", gc.x, gc.y - 8, 0xf5c46b).setDepth(8).setName("groupVisual");
    this.add
      .text(gc.x, gc.y + 22, `${GROUP_MONS.length} Pokémon`, {
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "#00000088",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(8)
      .setName("groupVisual");

    // Pantalla que aparece al llegar con un aviso (victoria o curación)
    if (session.groupDefeated) {
      this.children.list.filter((c) => c.name === "groupVisual").forEach((c) => c.setVisible(false));
    }
    if (session.pendingPopup) {
      this.showPopup(session.pendingPopup.title, session.pendingPopup.lines);
      session.pendingPopup = null;
    }

    // Espada que aparece al pasar el mouse sobre el grupo
    this.sword = this.add.text(0, 0, "⚔", { fontSize: "26px" }).setDepth(30).setVisible(false);

    // Ventana con los pios y sus niveles
    this.groupTip = this.add
      .text(0, 0, "", {
        fontSize: "13px",
        color: "#ffffff",
        backgroundColor: "#1a1d24ee",
        padding: { x: 8, y: 6 },
        lineSpacing: 3,
      })
      .setDepth(31)
      .setVisible(false);

    if (session.mapPlayerHex) this.playerHex = { ...session.mapPlayerHex };
    this.placePlayer(this.playerHex);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.moving) return;
      this.hover = screenToHex({ x: p.worldX, y: p.worldY }, this.cfg);
      this.updateGroupHover(p.worldX, p.worldY);
      this.updatePath();
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.moving || this.popupOpen) return;
      const h = screenToHex({ x: p.worldX, y: p.worldY }, this.cfg);
      this.onClick(h, p.event.shiftKey);
    });

    this.input.keyboard?.on("keydown-ESC", () => this.cancelPath());
    this.input.keyboard?.on("keydown-C", () => this.startCombat());

    this.draw();
  }

  private isGroup(h: Hex): boolean {
    return !session.groupDefeated && hexKey(h) === this.groupKey;
  }

  /** Espada y ventana de pios al pasar el mouse sobre el grupo. */
  private updateGroupHover(x: number, y: number) {
    const over = !!this.hover && this.isGroup(this.hover);
    this.sword.setVisible(over).setPosition(x + 10, y - 30);
    this.groupTip.setVisible(over);
    if (over) {
      const lines = GROUP_MONS.map((m) => `${m.name}  Nv. ${m.level}`);
      this.groupTip.setText(lines.join("\n")).setPosition(x + 20, y + 10);
    }
  }

  /** Empieza el combate con el grupo. Por ahora el combate usa su enemigo de prueba. */
  private startCombat() {
    if (session.groupDefeated) return;
    session.mapPlayerHex = { ...this.playerHex };
    this.scene.start("PrepScene");
  }

  /** Ventana emergente de recompensas o aviso. Bloquea los clics del mapa hasta cerrarla. */
  private showPopup(title: string, lines: string[]) {
    this.popupOpen = true;
    const w = this.scale.width;
    const h = this.scale.height;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.55).setDepth(60).setInteractive();
    parts.push(shade);
    parts.push(this.add.rectangle(w / 2, h / 2, Math.min(w - 40, 420), 260, 0x1a1d24, 0.97).setDepth(61));
    parts.push(
      this.add
        .text(w / 2, h / 2 - 100, title, { fontSize: "24px", color: "#ffe08a" })
        .setOrigin(0.5)
        .setDepth(62),
    );
    parts.push(
      this.add
        .text(w / 2, h / 2 - 20, lines.join("\n"), {
          fontSize: "15px",
          color: "#ffffff",
          align: "center",
          lineSpacing: 6,
          wordWrap: { width: 380 },
        })
        .setOrigin(0.5)
        .setDepth(62),
    );
    const close = this.add
      .text(w / 2, h / 2 + 90, "Cerrar", {
        fontSize: "18px",
        color: "#ffffff",
        backgroundColor: "#2f855a",
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(62)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        parts.forEach((p) => p.destroy());
        close.destroy();
        this.popupOpen = false;
        this.draw();
      });
  }

  /** Clic: elige destino, agrega una parada con Shift, o confirma si se vuelve a tocar el mismo destino. */
  private onClick(h: Hex, shift: boolean) {
    if (!this.isWalkable(h)) return;

    // Clic en el grupo: camina hasta él y luego empieza el combate
    if (this.isGroup(h) && !shift) {
      this.route = [];
      this.target = h;
      this.path = this.computePath();
      if (this.path) this.walk(this.path);
      return;
    }

    if (shift && this.target) {
      // Shift + clic: pasar por esa casilla antes de llegar al destino
      this.route.push(this.target);
      this.target = h;
      this.updatePath();
      return;
    }

    if (this.target && hexKey(this.target) === hexKey(h) && this.path) {
      this.walk(this.path);
      return;
    }

    this.route = [];
    this.target = h;
    this.updatePath();
  }

  private cancelPath() {
    this.target = null;
    this.route = [];
    this.path = null;
    this.draw();
  }

  private isWalkable(h: Hex): boolean {
    const k = hexKey(h);
    return this.tileSet.has(k) && !this.obstacleSet.has(k);
  }

  /** Camino más corto entre dos casillas, evitando obstáculos. Las trampas se pueden pisar. */
  private bfs(from: Hex, to: Hex): Hex[] | null {
    const prev = new Map<string, Hex | null>([[hexKey(from), null]]);
    const queue: Hex[] = [from];
    while (queue.length) {
      const h = queue.shift()!;
      if (hexKey(h) === hexKey(to)) {
        const out: Hex[] = [];
        let cur: Hex | null | undefined = h;
        while (cur) {
          out.unshift(cur);
          cur = prev.get(hexKey(cur));
        }
        return out;
      }
      for (const n of hexNeighbors(h)) {
        const k = hexKey(n);
        if (prev.has(k) || !this.isWalkable(n)) continue;
        prev.set(k, h);
        queue.push(n);
      }
    }
    return null;
  }

  /** Camino completo: desde el personaje, por las paradas elegidas, hasta el destino. */
  private computePath(): Hex[] | null {
    if (!this.target) return null;
    const points = [this.playerHex, ...this.route, this.target];
    let full: Hex[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const seg = this.bfs(points[i], points[i + 1]);
      if (!seg) return null;
      full = full.length ? full.concat(seg.slice(1)) : seg;
    }
    return full;
  }

  private updatePath() {
    this.path = this.computePath();
    this.draw();
  }

  /** Camina casilla por casilla, con animación. */
  private walk(path: Hex[]) {
    if (path.length < 2) {
      this.cancelPath();
      return;
    }
    this.moving = true;
    this.info.setText("");
    let i = 1;
    const step = () => {
      if (i >= path.length) {
        this.moving = false;
        this.playerHex = path[path.length - 1];
        this.route = [];
        this.target = null;
        this.path = null;
        setWalk(this.player, PLAYER_SPRITE, this.facing, false);
        this.draw();
        if (this.isGroup(this.playerHex)) this.startCombat();
        return;
      }
      const next = path[i++];
      const p = this.center(next);
      const from = this.center(this.playerHex);
      this.facing = directionOf(p.x - from.x, p.y - from.y);
      setWalk(this.player, PLAYER_SPRITE, this.facing, true);
      this.tweens.add({
        targets: this.player,
        x: p.x,
        y: p.y,
        duration: WALK_MS,
        onComplete: () => {
          this.playerHex = next;
          if (this.trapSet.has(hexKey(next))) {
            this.info.setText("¡Pisaste una trampa!");
          }
          step();
        },
      });
    };
    step();
  }

  // ----- Dibujo -----

  private draw() {
    this.gfx.clear();
    const onPath = new Set((this.path ?? []).map((h) => hexKey(h)));

    for (const t of this.tiles) {
      const k = hexKey(t);
      let fill = 0xf1ebdc;
      if (this.obstacleSet.has(k)) fill = 0x3d4450;
      else if (this.isGroup(t)) fill = 0xf5c46b;
      else if (this.trapSet.has(k)) fill = 0xf2b8b8;
      if (onPath.has(k) && !this.obstacleSet.has(k)) fill = this.trapSet.has(k) ? 0xe07a7a : 0xa8d8ff;
      if (this.hover && hexKey(this.hover) === k && this.isWalkable(t)) fill = 0x9fd3ff;
      if (this.target && hexKey(this.target) === k) fill = 0x4caf7a;

      const corners = this.corners(t);
      this.gfx.fillStyle(fill, 1);
      this.gfx.fillPoints(corners, true);
      this.gfx.lineStyle(1, 0x7a7265, 1);
      this.gfx.strokePoints(corners, true);
    }

    const trapHint = this.path?.some((h) => this.trapSet.has(hexKey(h)))
      ? " · Hay trampas en el camino (en rojo)."
      : "";
    this.info.setText(
      "Clic: elegir destino. Clic de nuevo en el destino: caminar.\n" +
        "Shift + clic: pasar por otra casilla. Esc: cancelar." +
        trapHint,
    );
  }

  private corners(h: Hex) {
    return diamondCorners(h, this.cfg);
  }

  private center(h: Hex) {
    return worldToIso(hexToWorld(h, this.cfg.size), this.cfg);
  }

  private placePlayer(h: Hex) {
    const p = this.center(h);
    this.player.setPosition(p.x, p.y);
  }
}

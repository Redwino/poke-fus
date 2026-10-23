import Phaser from "phaser";
import speciesFile from "../../data/species.generated.json";
import movesFile from "../../data/moves.generated.json";
import typesFile from "../../data/types.generated.json";
import naturesFile from "../../data/natures.json";
import rulesFile from "../../data/moves.rules.json";
import {
  computeHp,
  computeStat,
  damageRange,
  hits,
  type Ivs,
  type MoveData,
  type Nature,
} from "../damage";
import { hexDistance, hexKey, hexLine, hexNeighbors, hexRange, type Hex } from "../hex";
import { diamondCorners, hexToWorld, screenToHex, worldToIso, type IsoConfig } from "../render/iso";
import { affectedTiles, type Rule } from "../shapes";
import { turnOrderPvM, type Combatant } from "../turnOrder";
import { directionOf, makeWalker, preloadSprites, preloadWalk, setWalk } from "../render/sprites";
import { MAX_SPELLS, PLAYER_MOVE_POOL, POKE_CENTER, session } from "../session";

/** Color de los efectos según el tipo del hechizo. */
const TYPE_COLORS: Record<string, number> = {
  normal: 0xa8a878, fire: 0xf08030, water: 0x6890f0, electric: 0xf8d030, grass: 0x78c850,
  ice: 0x98d8d8, fighting: 0xc03028, poison: 0xa040a0, ground: 0xe0c068, flying: 0xa890f0,
  psychic: 0xf85888, bug: 0xa8b820, rock: 0xb8a038, ghost: 0x705898, dragon: 0x7038f8,
  dark: 0x705848, steel: 0xb8b8d0, fairy: 0xee99ac,
};

// ---------- Ajustes de combate ----------
const BATTLE_RADIUS = 6;
const HEX_SIZE = 28;
const AP_MAX = 6;
const MP_MAX = 3;
const TURN_SECONDS = 30;
const LEVEL = 5;
const PLAYER_ID = "p1"; // Bulbasaur
const ENEMY_ID = "p4"; // Charmander
const SPELLS_PER_MON = MAX_SPELLS;
const PREP_SECONDS = 15; // tiempo para unirse, elegir inicio y reto
const STEP_MS = 180;
const UI_BOTTOM = 200;

const COMBAT_OBSTACLES: Hex[] = [
  { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 2 }, { q: 2, r: 1 }, { q: -3, r: 1 },
];

// Movimientos de prueba
const TEST_ENEMY_MOVES = ["ember", "flamethrower", "water-gun", "spikes"];

const PLAYER_TEAM = "A";

/** Retos de combate: dan más botín si se cumplen (como en Dofus). */
interface Challenge {
  id: string;
  name: string;
  bonus: number;
}
const CHALLENGES: Challenge[] = [
  { id: "pm1", name: "Gastar máximo 1 PM por turno", bonus: 1.5 },
  { id: "ap-all", name: "Gastar todos los PA antes de terminar el turno", bonus: 1.3 },
  { id: "fast", name: "Ganar en 5 turnos o menos", bonus: 1.2 },
];

/**
 * Rutina de IA de los rivales (inspirada en Dofus):
 * - aggressive: se acerca y ataca; si puede, se queda en la posición de ataque.
 * - kite: ataca y luego usa los PM que le quedan para alejarse.
 */
type AiKind = "aggressive" | "kite";
const ENEMY_AI: AiKind = "kite";

// Colores (verde claro = alcance máximo, verde oscuro = desplazamiento)
const COLOR_RANGE = 0xb8e8c0;
const COLOR_REACH = 0x3f9b5b;
const COLOR_PATH = 0x1f5f36;
const COLOR_EFFECT = 0xe8643c;

// ---------- Datos ----------
const SPECIES: any[] = (speciesFile as any).species;
const MOVES: Record<string, MoveData> = (movesFile as any).moves;
const CHART: Record<string, Record<string, number>> = (typesFile as any).chart;
const NATURES: Nature[] = (naturesFile as any).natures;
const RULES: Record<string, Rule> = rulesFile as any;
const DEFAULT_RULE: Rule = { shape: "point", minRange: 1, maxRange: 4, ap: 3 };
const KEY_NAMES = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];

const ruleOf = (m: MoveData): Rule => RULES[m.id] ?? DEFAULT_RULE;

interface Mon {
  name: string;
  level: number;
  types: string[];
  nature: Nature;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
  hp: number;
  maxHp: number;
  moves: MoveData[];
}

interface Unit {
  id: string;
  mon: Mon;
  pos: Hex;
  team: "A" | "B";
  isPlayer: boolean;
  ap: number;
  mp: number;
  alive: boolean;
  status: string | null;
  statusOwnerId: string | null; // quién aplicó el estado
  statusExpiresAt: number; // turno del dueño en que el estado termina
  turnNo: number; // cantidad de turnos propios que ya empezaron
  cooldowns: Record<string, number>; // turnos propios que faltan para volver a usar cada movimiento
  // Cúmulos de PM perdido. El contador lo lleva quien estaba en turno al aplicarlo (timerId)
  pmLoss: { amount: number; timerId: string; expiresAt: number }[];
  ai: AiKind;
}

interface Trap {
  hex: Hex;
  team: "A" | "B";
  name: string;
  damagePct: number;
  ownerId: string;
  pmLoss: number;
  pmTurns: number;
  visibleTo: "owner" | "all";
  expiresAt: number; // turno del dueño en que la púa desaparece
  revealed: boolean;
}

function randomIvs(): Ivs {
  const r = () => Math.floor(Math.random() * 32);
  return { hp: r(), attack: r(), defense: r(), spAttack: r(), spDefense: r(), speed: r() };
}

function makeMon(id: string, level: number, nature: Nature, moveIds: string[]): Mon {
  const s = SPECIES.find((x) => x.id === id);
  if (!s) throw new Error(`No existe la especie ${id} en species.generated.json`);
  const b = s.baseStats;
  const ivs = randomIvs();
  const moves = moveIds.map((mid) => MOVES[mid]).filter((m): m is MoveData => !!m);
  const hp = computeHp(b.hp, ivs.hp, level);
  return {
    name: s.name,
    level,
    types: s.types,
    nature,
    attack: computeStat(b.attack, ivs.attack, level, "attack", nature),
    defense: computeStat(b.defense, ivs.defense, level, "defense", nature),
    spAttack: computeStat(b.spAttack, ivs.spAttack, level, "spAttack", nature),
    spDefense: computeStat(b.spDefense, ivs.spDefense, level, "spDefense", nature),
    speed: computeStat(b.speed, ivs.speed, level, "speed", nature),
    hp,
    maxHp: hp,
    moves: moves.slice(0, SPELLS_PER_MON),
  };
}

// ---------- Escena ----------
export class CombatScene extends Phaser.Scene {
  private cfg!: IsoConfig;
  private tiles: Hex[] = [];
  private tileSet = new Set<string>();
  private obstacleSet = new Set<string>();
  private units: Unit[] = [];
  private traps: Trap[] = [];
  private round = 0;
  private order: Unit[] = [];
  private orderIdx = 0;
  private current: Unit | null = null;
  private selectedSpell: MoveData | null = null;
  private timeLeft = TURN_SECONDS;
  private over = false;
  private busy = false;
  private hover: Hex | null = null;
  private log: string[] = [];
  private unitSprites = new Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc>();

  // Fase de preparación (antes del primer turno)
  private phase: "placement" | "fight" = "placement";
  private prepLeft = PREP_SECONDS;
  private zoneKeys = new Set<string>(); // casillas de inicio permitidas
  private challenge: Challenge = CHALLENGES[0];
  private challengeOk = true;
  private stepsThisTurn = 0;
  private prepTexts: Phaser.GameObjects.Text[] = [];
  private challengeTexts: Phaser.GameObjects.Text[] = [];

  private gfx!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private headerText!: Phaser.GameObjects.Text;
  private previewText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private spellButtons: Phaser.GameObjects.Text[] = [];
  private endButton!: Phaser.GameObjects.Text;

  constructor() {
    super("CombatScene");
  }

  preload() {
    preloadSprites(this, [PLAYER_ID, ENEMY_ID]);
    preloadWalk(this, PLAYER_ID);
    preloadWalk(this, ENEMY_ID);
  }

  create() {
    this.over = false;
    this.busy = false;
    this.round = 0;
    this.traps = [];
    this.log = [];
    this.selectedSpell = null;

    this.cfg = { size: HEX_SIZE, originX: this.scale.width / 2, originY: this.scale.height * 0.36 };

    this.tiles = hexRange({ q: 0, r: 0 }, BATTLE_RADIUS);
    this.tiles.forEach((t) => this.tileSet.add(hexKey(t)));
    this.obstacleSet = new Set(COMBAT_OBSTACLES.map((h) => hexKey(h)));

    this.gfx = this.add.graphics();
    this.headerText = this.add.text(12, 10, "", { fontSize: "16px", color: "#ffffff" });
    this.previewText = this.add.text(12, 36, "", { fontSize: "15px", color: "#ffe08a" });
    this.logText = this.add
      .text(this.scale.width - 12, 10, "", { fontSize: "13px", color: "#e8e8e8", align: "right", lineSpacing: 3 })
      .setOrigin(1, 0);

    this.endButton = this.add
      .text(12, this.scale.height - 190, "Terminar el turno (Espacio)", {
        fontSize: "15px",
        color: "#ffffff",
        backgroundColor: "#4a5568",
        padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.playerEndTurn());

    this.add.text(12, this.scale.height - 28, "1-6: hechizos   M: mapa   R: reiniciar   Esc: cancelar", {
      fontSize: "13px",
      color: "#9fd3ff",
    });

    this.setupUnits();

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.hover = screenToHex({ x: p.worldX, y: p.worldY }, this.cfg);
      if (!this.busy) this.refresh();
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.y > this.scale.height - UI_BOTTOM) return;
      if (this.isOverUI(p.x, p.y)) return; // los botones no cuentan como clic en el mapa
      this.handleClick(screenToHex({ x: p.worldX, y: p.worldY }, this.cfg));
    });
    this.input.keyboard?.on("keydown-SPACE", () => this.playerEndTurn());
    this.input.keyboard?.on("keydown-M", () => this.scene.start("MapScene"));
    this.input.keyboard?.on("keydown-R", () => this.scene.restart());
    this.input.keyboard?.on("keydown-ESC", () => {
      this.selectedSpell = null;
      this.refresh();
    });
    KEY_NAMES.forEach((k, i) => {
      this.input.keyboard?.on(`keydown-${k}`, () => this.pickSpell(i));
    });

    const enemy = this.units.find((u) => !u.isPlayer)!;
    this.addLog(`Aparece ${enemy.mon.name} salvaje (nivel ${LEVEL}, ${enemy.mon.nature.name}).`);
    this.buildPrepUi();
    this.input.keyboard?.on("keydown-ENTER", () => this.startFight());
    this.startPlacement();
  }

  update(_time: number, delta: number) {
    if (this.phase === "placement") {
      this.prepLeft -= delta / 1000;
      this.updateHeader();
      if (this.prepLeft <= 0) this.startFight();
      return;
    }
    if (this.over || this.busy || !this.current || !this.current.isPlayer) return;
    this.timeLeft -= delta / 1000;
    if (this.timeLeft <= 0) {
      this.addLog("Se acabó el tiempo.");
      this.endTurn();
      return;
    }
    this.updateHeader();
  }

  // ----- Unidades y turnos -----

  private setupUnits() {
    const playerNature = NATURES.find((n) => n.id === "adamant")!;
    const enemyNature = NATURES[Math.floor(Math.random() * NATURES.length)];
    this.units = [
      { id: "player", mon: this.playerMonFor(playerNature), pos: { q: -3, r: 0 }, team: "A", isPlayer: true, ap: 0, mp: 0, alive: true, status: null, statusOwnerId: null, statusExpiresAt: 0, turnNo: 0, cooldowns: {}, pmLoss: [], ai: "aggressive" },
      { id: "enemy", mon: makeMon(ENEMY_ID, LEVEL, enemyNature, TEST_ENEMY_MOVES), pos: { q: 3, r: 0 }, team: "B", isPlayer: false, ap: 0, mp: 0, alive: true, status: null, statusOwnerId: null, statusExpiresAt: 0, turnNo: 0, cooldowns: {}, pmLoss: [], ai: ENEMY_AI },
    ];
  }

  /** Pokémon del jugador: se crea una vez y se conserva entre combates (PS, IVs). Los hechizos se actualizan. */
  private playerMonFor(nature: Nature): Mon {
    const moves = session.playerMoves.length ? session.playerMoves : PLAYER_MOVE_POOL.slice(0, MAX_SPELLS);
    if (session.playerMon) {
      const pm = session.playerMon as Mon;
      pm.moves = moves.map((id) => MOVES[id]).filter((m): m is MoveData => !!m).slice(0, MAX_SPELLS);
      return pm;
    }
    const pm = makeMon(PLAYER_ID, LEVEL, nature, moves);
    session.playerMon = pm;
    return pm;
  }

  /** Id de sprite de la unidad (Bulbasaur o Charmander en la prueba). */
  private spriteIdOf(u: Unit): string {
    return u.isPlayer ? PLAYER_ID : ENEMY_ID;
  }

  /** Velocidad para el orden de turnos (las púas ya no la reducen: quitan PM). */
  private effectiveSpeed(u: Unit): number {
    return u.mon.speed;
  }

  private startRound() {
    this.round++;
    const combatants: Combatant[] = this.units
      .filter((u) => u.alive)
      .map((u) => ({ id: u.id, team: u.team, speed: this.effectiveSpeed(u) }));
    this.order = turnOrderPvM(combatants, PLAYER_TEAM).map((c) => this.units.find((u) => u.id === c.id)!);
    this.orderIdx = 0;
    this.beginTurn();
  }

  private beginTurn() {
    if (this.over) return;
    if (this.orderIdx >= this.order.length) {
      this.startRound();
      return;
    }
    const unit = this.order[this.orderIdx];
    if (!unit.alive) {
      this.orderIdx++;
      this.beginTurn();
      return;
    }

    this.current = unit;
    unit.turnNo++;
    this.expireOwned(unit);
    unit.ap = AP_MAX;
    // Al empezar el turno: se aplican los cúmulos vigentes y cada uno pierde un turno
    const lost = this.pmLossOf(unit);
    unit.mp = Math.max(0, MP_MAX - lost);
    if (lost > 0) this.addLog(`${unit.mon.name} tiene -${lost} PM por púas o efectos.`);
    this.selectedSpell = null;
    this.stepsThisTurn = 0;
    this.timeLeft = TURN_SECONDS;
    for (const k of Object.keys(unit.cooldowns)) {
      if (unit.cooldowns[k] > 0) unit.cooldowns[k]--;
    }
    this.addLog(unit.isPlayer ? "— Tu turno —" : `— Turno de ${unit.mon.name} salvaje —`);

    if (unit.status === "quemado") {
      const dmg = Math.floor(unit.mon.maxHp / 16);
      unit.mon.hp = Math.max(0, unit.mon.hp - dmg);
      this.addLog(`${unit.mon.name} sufre la quemadura: -${dmg} PS.`);
      if (unit.mon.hp <= 0) {
        unit.alive = false;
        this.addLog(`${unit.mon.name} fue derrotado.`);
        this.checkEnd();
        if (this.over) return;
        this.orderIdx++;
        this.beginTurn();
        return;
      }
    }

    this.refresh();
    if (!unit.isPlayer) {
      this.time.delayedCall(700, () => this.enemyTurn());
    }
  }

  private endTurn() {
    if (this.over || !this.current || this.busy) return;
    if (this.current.isPlayer && this.challenge.id === "ap-all" && this.current.ap > 0) this.challengeOk = false;
    this.orderIdx++;
    this.current = null;
    this.beginTurn();
  }

  private playerEndTurn() {
    if (this.current && this.current.isPlayer && !this.busy) this.endTurn();
  }

  // ----- Reglas -----

  private unitAt(h: Hex): Unit | undefined {
    return this.units.find((u) => u.alive && hexKey(u.pos) === hexKey(h));
  }

  private isFree(h: Hex): boolean {
    const k = hexKey(h);
    return this.tileSet.has(k) && !this.obstacleSet.has(k) && !this.unitAt(h);
  }

  private findPath(from: Hex, to: Hex): Hex[] | null {
    const prev = new Map<string, Hex | null>([[hexKey(from), null]]);
    const queue: Hex[] = [from];
    while (queue.length) {
      const h = queue.shift()!;
      if (hexKey(h) === hexKey(to)) {
        const path: Hex[] = [];
        let cur: Hex | null | undefined = h;
        while (cur) {
          path.unshift(cur);
          cur = prev.get(hexKey(cur));
        }
        return path;
      }
      for (const n of hexNeighbors(h)) {
        const k = hexKey(n);
        if (prev.has(k) || !this.isFree(n)) continue;
        prev.set(k, h);
        queue.push(n);
      }
    }
    return null;
  }

  private reachableTiles(u: Unit): Set<string> {
    const dist = new Map<string, number>([[hexKey(u.pos), 0]]);
    const queue: Hex[] = [u.pos];
    while (queue.length) {
      const h = queue.shift()!;
      const d = dist.get(hexKey(h))!;
      if (d >= u.mp) continue;
      for (const n of hexNeighbors(h)) {
        const k = hexKey(n);
        if (dist.has(k) || !this.isFree(n)) continue;
        dist.set(k, d + 1);
        queue.push(n);
      }
    }
    return new Set(dist.keys());
  }

  private hasLineOfSight(from: Hex, to: Hex): boolean {
    return !hexLine(from, to)
      .slice(0, -1)
      .some((h) => this.unitAt(h) || this.obstacleSet.has(hexKey(h)));
  }

  private canCast(u: Unit, move: MoveData, target: Hex): { ok: boolean; reason?: string } {
    const rule = ruleOf(move);
    const cd = u.cooldowns[move.id] ?? 0;
    if (cd > 0) return { ok: false, reason: `En enfriamiento (${cd} turnos)` };
    if (u.ap < rule.ap) return { ok: false, reason: "PA insuficientes" };
    const d = hexDistance(u.pos, target);
    if (d < rule.minRange || d > rule.maxRange) return { ok: false, reason: "Fuera de alcance" };
    if (rule.shape !== "self" && d > 0 && !this.hasLineOfSight(u.pos, target)) {
      return { ok: false, reason: "Sin línea de visión" };
    }
    return { ok: true };
  }

  private targetsOf(actor: Unit, move: MoveData, target: Hex) {
    const rule = ruleOf(move);
    const tiles = affectedTiles(actor.pos, target, rule, HEX_SIZE, this.tileSet);
    const hitUnits = tiles
      .map((a) => ({ unit: this.unitAt(a.hex), falloff: a.falloff }))
      .filter((x): x is { unit: Unit; falloff: number } => !!x.unit && x.unit !== actor)
      .filter((x) => x.unit.team !== actor.team || rule.hitsAllies);
    return { tiles, hitUnits };
  }

  /** Lo que ve el jugador de una trampa. */
  private trapVisible(t: Trap): boolean {
    return t.team === PLAYER_TEAM || t.visibleTo === "all" || t.revealed;
  }

  /** Se ejecuta cuando una unidad pisa una casilla. Solo afecta a rivales de quien puso la trampa. */
  private triggerTrap(unit: Unit, h: Hex) {
    const trap = this.traps.find((t) => hexKey(t.hex) === hexKey(h) && t.team !== unit.team);
    if (!trap) return;
    const dmg = Math.floor((unit.mon.maxHp * trap.damagePct) / 100);
    unit.mon.hp = Math.max(0, unit.mon.hp - dmg);
    // Cada púa resta PM ya, en este mismo turno (sin bajar de 0). El contador es del que está en turno
    const timer = this.current ?? unit;
    unit.mp = Math.max(0, unit.mp - trap.pmLoss);
    unit.pmLoss.push({ amount: trap.pmLoss, timerId: timer.id, expiresAt: timer.turnNo + trap.pmTurns });
    trap.revealed = true;
    this.addLog(`${unit.mon.name} pisa ${trap.name}: -${dmg} PS y -${trap.pmLoss} PM por ${trap.pmTurns} turnos.`);
    if (unit.mon.hp <= 0) {
      unit.alive = false;
      this.addLog(`${unit.mon.name} fue derrotado.`);
      this.checkEnd();
    }
  }

  private castSpell(actor: Unit, move: MoveData, target: Hex) {
    const rule = ruleOf(move);
    actor.ap -= rule.ap;
    if (rule.cooldown) actor.cooldowns[move.id] = rule.cooldown;

    // Trampas: colocan púas en el piso y no hacen daño al lanzar
    if (rule.placesTrap) {
      const tiles = affectedTiles(actor.pos, target, rule, HEX_SIZE, this.tileSet);
      let placed = 0;
      for (const a of tiles) {
        if (this.obstacleSet.has(hexKey(a.hex))) continue;
        this.traps = this.traps.filter((t) => hexKey(t.hex) !== hexKey(a.hex));
        this.traps.push({
          hex: a.hex,
          team: actor.team,
          name: move.name,
          damagePct: rule.placesTrap.damagePct,
          ownerId: actor.id,
          pmLoss: rule.placesTrap.pmLoss,
          pmTurns: rule.placesTrap.pmTurns,
          visibleTo: rule.placesTrap.visibleTo,
          expiresAt: actor.turnNo + rule.placesTrap.durationTurns,
          revealed: false,
        });
        placed++;
      }
      this.addLog(`${actor.mon.name} usa ${move.name} y coloca ${placed} trampa(s) en el piso.`);
      this.refresh();
      return;
    }

    if (rule.selfDamagePct) {
      const cost = Math.floor((actor.mon.maxHp * rule.selfDamagePct) / 100);
      actor.mon.hp = Math.max(0, actor.mon.hp - cost);
      this.addLog(`${actor.mon.name} se sacrifica: -${cost} PS.`);
      if (actor.mon.hp <= 0) {
        actor.alive = false;
        this.addLog(`${actor.mon.name} se debilitó.`);
      }
    }

    if (rule.healPct && actor.alive) {
      const heal = Math.floor((actor.mon.maxHp * rule.healPct) / 100);
      actor.mon.hp = Math.min(actor.mon.maxHp, actor.mon.hp + heal);
      this.addLog(`${actor.mon.name} usa ${move.name} y recupera ${heal} PS.`);
    }

    const { hitUnits } = this.targetsOf(actor, move, target);
    if (hitUnits.length === 0 && !rule.healPct && !rule.selfDamagePct) {
      this.addLog(`${actor.mon.name} usa ${move.name}. No alcanza a nadie.`);
    }

    for (const { unit, falloff } of hitUnits) {
      if (!unit.alive) continue;
      if (!hits(move)) {
        this.addLog(`${move.name} falla contra ${unit.mon.name}.`);
        continue;
      }
      const r = damageRange(actor.mon, unit.mon, move, CHART);
      if (r.max === 0) continue;
      const base = r.min === r.max ? r.min : r.min + Math.floor(Math.random() * (r.max - r.min + 1));
      const dmg = Math.floor(base * falloff);
      unit.mon.hp = Math.max(0, unit.mon.hp - dmg);
      this.addLog(`${move.name} hace ${dmg} de daño a ${unit.mon.name}.`);

      if (rule.status && unit.status === null && Math.random() < rule.status.chance) {
        unit.status = rule.status.name;
        unit.statusOwnerId = actor.id;
        unit.statusExpiresAt = actor.turnNo + (rule.status.duration ?? 4);
        this.addLog(`${unit.mon.name} queda ${rule.status.name}.`);
      }
      if (unit.mon.hp <= 0) {
        unit.alive = false;
        this.addLog(`${unit.mon.name} fue derrotado.`);
      }
    }

    this.checkEnd();
    this.refresh();
  }

  /** PM que pierde una unidad por todos sus efectos acumulados. */
  private pmLossOf(u: Unit): number {
    return u.pmLoss.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Al empezar el turno de `owner`, quita los efectos que lanzó y que ya cumplieron su duración.
   * Así un estado de 4 turnos lanzado en el turno 1 termina al empezar el turno 5 de quien lo lanzó.
   */
  private expireOwned(owner: Unit) {
    for (const u of this.units) {
      u.pmLoss = u.pmLoss.filter((e) => !(e.timerId === owner.id && owner.turnNo >= e.expiresAt));
      if (u.statusOwnerId === owner.id && owner.turnNo >= u.statusExpiresAt) {
        this.addLog(`${u.mon.name} deja de estar ${u.status}.`);
        u.status = null;
        u.statusOwnerId = null;
      }
    }
    const before = this.traps.length;
    this.traps = this.traps.filter((t) => !(t.ownerId === owner.id && owner.turnNo >= t.expiresAt));
    if (this.traps.length !== before) this.addLog(`Las púas de ${owner.mon.name} desaparecen.`);
  }

  private checkEnd() {
    if (this.over) return;
    const playerAlive = this.units.find((u) => u.isPlayer)!.alive;
    const enemyAlive = this.units.find((u) => !u.isPlayer)!.alive;
    if (!enemyAlive) {
      this.over = true;
      this.current = null;
      if (this.challenge.id === "fast" && this.round > 5) this.challengeOk = false;
      this.addLog("¡Ganaste!");
      this.time.delayedCall(1200, () => this.finishVictory());
    } else if (!playerAlive) {
      this.over = true;
      this.current = null;
      this.addLog("Perdiste.");
      this.time.delayedCall(600, () => this.showDefeat());
    }
  }

  /** Victoria: vuelve al mapa con la ventana de recompensas. */
  private finishVictory() {
    const enemy = this.units.find((u) => !u.isPlayer)!;
    const mult = this.challengeOk ? this.challenge.bonus : 1;
    const xp = Math.round(enemy.mon.level * 25 * mult);
    session.groupDefeated = true;
    session.pendingPopup = {
      title: "¡Victoria!",
      lines: [
        `XP ganada: ${xp}`,
        "Botín: por definir (lista de recompensas pendiente).",
        this.challengeOk ? `Reto cumplido: botín x${this.challenge.bonus}.` : "Reto fallido: botín normal.",
      ],
    };
    this.scene.start("MapScene");
  }

  /** Derrota: pantalla en escala de grises y aviso. Luego se lleva al centro Pokémon. */
  private showDefeat() {
    this.cameras.main.postFX?.addColorMatrix().grayscale(1);
    const w = this.scale.width;
    const h = this.scale.height;
    this.add.rectangle(w / 2, h / 2, Math.min(w - 40, 420), 230, 0x1a1d24, 0.95).setDepth(50);
    this.add
      .text(w / 2, h / 2 - 70, "Todo tu equipo fue debilitado", {
        fontSize: "22px",
        color: "#ffffff",
        align: "center",
        wordWrap: { width: 380 },
      })
      .setOrigin(0.5)
      .setDepth(51);
    this.add
      .text(w / 2, h / 2 - 10, "Serás llevado al centro Pokémon más cercano.", {
        fontSize: "15px",
        color: "#cfd8e3",
        align: "center",
        wordWrap: { width: 380 },
      })
      .setOrigin(0.5)
      .setDepth(51);
    this.add
      .text(w / 2, h / 2 + 62, "Ir al centro Pokémon", {
        fontSize: "18px",
        color: "#ffffff",
        backgroundColor: "#2f855a",
        padding: { x: 14, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        // Beta: curación completa al instante en el centro Pokémon
        if (session.playerMon) session.playerMon.hp = session.playerMon.maxHp;
        session.mapPlayerHex = { ...POKE_CENTER };
        session.pendingPopup = {
          title: "Recuperado",
          lines: ["Tus Pokémon fueron curados en el centro Pokémon."],
        };
        this.scene.start("MapScene");
      });
  }

  private aimFor(move: MoveData, h: Hex | null): Hex | null {
    const rule = ruleOf(move);
    if (rule.shape === "self" || rule.centerOn === "self") {
      return this.current ? this.current.pos : null;
    }
    return h;
  }

  /** Anima el recorrido de una unidad casilla por casilla, con trampas incluidas. */
  private animatePath(unit: Unit, path: Hex[], done: () => void) {
    if (path.length < 2) {
      done();
      return;
    }
    this.busy = true;
    let i = 1;
    const step = () => {
      if (i >= path.length) {
        this.busy = false;
        done();
        return;
      }
      const next = path[i++];
      // Sin PM no puede seguir caminando (las púas pueden haber gastado lo que quedaba)
      if (unit.mp < 1) {
        this.addLog(`${unit.mon.name} se queda sin PM y se detiene.`);
        this.busy = false;
        done();
        return;
      }
      const p = this.center(next);
      const sprite = this.unitSprites.get(unit.id);
      const from = this.center(unit.pos);
      const dir = directionOf(p.x - from.x, p.y - from.y);
      if (sprite) setWalk(sprite, this.spriteIdOf(unit), dir, true); // animación de caminar
      const finish = () => {
        if (sprite) setWalk(sprite, this.spriteIdOf(unit), dir, false);
        unit.pos = next;
        unit.mp -= 1; // cada paso gasta PM en vivo
        if (unit.isPlayer) {
          this.stepsThisTurn++;
          if (this.challenge.id === "pm1" && this.stepsThisTurn > 1) this.challengeOk = false;
        }
        this.triggerTrap(unit, next);
        if (!unit.alive || this.over) {
          this.busy = false;
          done();
          return;
        }
        step();
      };
      if (sprite) {
        this.tweens.add({ targets: sprite, x: p.x, y: p.y - 8, duration: STEP_MS, onComplete: finish });
      } else {
        finish();
      }
    };
    this.refresh();
    step();
  }

  // ----- Preparación previa al combate -----

  /** Crea los textos del panel de reto (arriba a la izquierda). Se muestran solo durante la preparación. */
  private buildPrepUi() {
    this.prepTexts = [];
    this.challengeTexts = [];
    const left = 12;
    this.prepTexts.push(
      this.add.text(left, 64, "Reto del combate (elige uno):", { fontSize: "15px", color: "#ffffff" }),
    );
    CHALLENGES.forEach((c, i) => {
      const t = this.add
        .text(left, 90 + i * 30, "", {
          fontSize: "14px",
          color: "#ffffff",
          backgroundColor: "#2d3748",
          padding: { x: 6, y: 4 },
        })
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          this.challenge = c;
          this.refreshPrep();
        });
      this.challengeTexts.push(t);
      this.prepTexts.push(t);
    });
    const readyY = 90 + CHALLENGES.length * 30 + 8;
    this.prepTexts.push(
      this.add
        .text(left, readyY, "Listo (Enter)", {
          fontSize: "15px",
          color: "#ffffff",
          backgroundColor: "#2f855a",
          padding: { x: 10, y: 6 },
        })
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.startFight()),
    );
    this.prepTexts.push(
      this.add.text(
        left,
        readyY + 40,
        "Toca una casilla azul para elegir inicio.\nUnirse al grupo e intercambiar posición: sin aliados en esta prueba.",
        { fontSize: "12px", color: "#cfd8e3", wordWrap: { width: 320 } },
      ),
    );
  }

  private refreshPrep() {
    const show = this.phase === "placement";
    this.prepTexts.forEach((t) => t.setVisible(show));
    this.challengeTexts.forEach((t, i) => {
      const c = CHALLENGES[i];
      const on = c.id === this.challenge.id;
      t.setText(`${on ? "● " : "○ "}${c.name} (botín x${c.bonus})`);
      t.setBackgroundColor(on ? "#c05621" : "#2d3748");
    });
  }

  private startPlacement() {
    this.phase = "placement";
    this.prepLeft = PREP_SECONDS;
    this.challengeOk = true;
    this.stepsThisTurn = 0;
    const pl = this.units.find((u) => u.isPlayer)!;
    this.zoneKeys = new Set(
      this.tiles
        .filter((h) => h.q <= -2 && (this.isFree(h) || hexKey(h) === hexKey(pl.pos)))
        .map((h) => hexKey(h)),
    );
    this.addLog(`Preparación: ${PREP_SECONDS} s para elegir inicio y reto.`);
    this.refreshPrep();
    this.refresh();
  }

  private startFight() {
    if (this.phase !== "placement") return;
    this.phase = "fight";
    this.zoneKeys.clear();
    this.refreshPrep();
    this.addLog(`Reto elegido: ${this.challenge.name}.`);
    this.startRound();
  }

  /** Clic dentro de un botón (no cuenta como clic en el mapa). */
  private isOverUI(x: number, y: number): boolean {
    return [this.endButton, ...this.spellButtons, ...this.prepTexts].some(
      (o) => o.visible && o.getBounds().contains(x, y),
    );
  }

  // ----- Entrada del jugador -----

  private pickSpell(index: number) {
    if (!this.current || !this.current.isPlayer || this.over || this.busy) return;
    const move = this.units.find((u) => u.isPlayer)!.mon.moves[index];
    if (!move) return;
    this.selectedSpell = this.selectedSpell?.id === move.id ? null : move;
    this.refresh();
  }

  private handleClick(h: Hex) {
    if (this.phase === "placement") {
      // Elegir la casilla de inicio dentro de la zona azul
      if (this.zoneKeys.has(hexKey(h))) {
        const pl = this.units.find((u) => u.isPlayer)!;
        pl.pos = h;
        this.addLog("Inicio elegido.");
        this.refresh();
      }
      return;
    }
    if (this.over || !this.current || !this.current.isPlayer || this.busy) return;
    const u = this.current;

    if (this.selectedSpell) {
      const aim = this.aimFor(this.selectedSpell, h);
      if (!aim) return;
      const check = this.canCast(u, this.selectedSpell, aim);
      if (check.ok) {
        const spell = this.selectedSpell;
        this.selectedSpell = null;
        this.performCast(u, spell, aim, () => this.refresh());
      } else {
        this.addLog(check.reason ?? "No se puede lanzar ahí.");
      }
      this.refresh();
      return;
    }

    if (!this.tileSet.has(hexKey(h)) || hexKey(h) === hexKey(u.pos)) return;
    const path = this.findPath(u.pos, h);
    if (!path) return;
    const steps = path.length - 1;
    if (steps > u.mp) {
      this.addLog("PM insuficientes para llegar ahí.");
      this.refresh();
      return;
    }
    this.animatePath(u, path, () => this.refresh());
  }

  // ----- Turno del salvaje (IA simple) -----

  /** Casillas a las que puede llegar una unidad con sus PM, con el camino para llegar. */
  private reachMap(u: Unit, mp: number): Map<string, { hex: Hex; steps: number; path: Hex[] }> {
    const out = new Map<string, { hex: Hex; steps: number; path: Hex[] }>();
    out.set(hexKey(u.pos), { hex: u.pos, steps: 0, path: [u.pos] });
    const queue: Hex[] = [u.pos];
    while (queue.length) {
      const h = queue.shift()!;
      const cur = out.get(hexKey(h))!;
      if (cur.steps >= mp) continue;
      for (const n of hexNeighbors(h)) {
        const k = hexKey(n);
        if (out.has(k) || !this.isFree(n)) continue;
        out.set(k, { hex: n, steps: cur.steps + 1, path: [...cur.path, n] });
        queue.push(n);
      }
    }
    return out;
  }

  /** Vista previa de un camino: PM que quedan, púas pisadas y daño total. No cambia nada del combate. */
  private previewPath(u: Unit, path: Hex[]): { steps: number; mpLeft: number; spikes: number; dmg: number; pmLoss: number } {
    let mp = u.mp;
    let steps = 0;
    let spikes = 0;
    let dmg = 0;
    let pmLoss = 0;
    for (let i = 1; i < path.length; i++) {
      if (mp < 1) break;
      mp -= 1;
      steps++;
      const trap = this.traps.find((t) => hexKey(t.hex) === hexKey(path[i]) && t.team !== u.team);
      if (trap) {
        spikes++;
        dmg += Math.floor((u.mon.maxHp * trap.damagePct) / 100);
        const loss = Math.min(mp, trap.pmLoss);
        mp -= loss;
        pmLoss += trap.pmLoss;
      }
    }
    return { steps, mpLeft: mp, spikes, dmg, pmLoss };
  }

  /** Ejecuta una función como si la unidad estuviera en otra casilla, y luego la devuelve a su lugar. */
  private withPos<T>(u: Unit, p: Hex, fn: () => T): T {
    const save = u.pos;
    u.pos = p;
    try {
      return fn();
    } finally {
      u.pos = save;
    }
  }

  /** Puntaje de un hechizo lanzado desde una casilla hacia un objetivo. Más alto = mejor. */
  private scoreOption(me: Unit, move: MoveData, aim: Hex): number {
    const rule = ruleOf(move);
    if (rule.selfDamagePct) return -1; // la IA no se sacrifica
    if (rule.placesTrap) return 2; // poner púas es una opción de respaldo
    if (rule.healPct) return me.mon.hp < me.mon.maxHp / 2 ? 40 : -1;

    const { hitUnits } = this.targetsOf(me, move, aim);
    let score = 0;
    for (const { unit, falloff } of hitUnits) {
      if (unit.team === me.team) {
        score -= 30; // no dañar aliados
        continue;
      }
      const r = damageRange(me.mon, unit.mon, move, CHART);
      score += ((r.min + r.max) / 2) * falloff;
      if (r.min * falloff >= unit.mon.hp) score += 60; // puede derribar al rival
      if (unit.isPlayer) score += 10; // prioridad a los jugadores
    }
    return score;
  }

  /** Elige la mejor combinación de casilla, hechizo y objetivo dentro del alcance de la reachMap. */
  private chooseAction(
    me: Unit,
    reach: Map<string, { hex: Hex; steps: number; path: Hex[] }>,
  ): { hex: Hex; steps: number; path: Hex[]; move: MoveData; aim: Hex; score: number } | null {
    let best: { hex: Hex; steps: number; path: Hex[]; move: MoveData; aim: Hex; score: number } | null = null;
    const players = this.units.filter((u) => u.isPlayer && u.alive);

    for (const entry of reach.values()) {
      for (const move of me.mon.moves) {
        const rule = ruleOf(move);
        const selfCentered = rule.shape === "self" || rule.centerOn === "self" || !!rule.healPct;
        const aims: Hex[] = selfCentered ? [entry.hex] : players.map((p) => p.pos);

        for (const aim of aims) {
          const ok = this.withPos(me, entry.hex, () => this.canCast(me, move, aim).ok);
          if (!ok) continue;
          // Pequeña penalización por caminar: a igual daño, prefiere quedarse cerca
          const score =
            this.withPos(me, entry.hex, () => this.scoreOption(me, move, aim)) - entry.steps * 2;
          if (score <= 0) continue;
          if (!best || score > best.score) best = { ...entry, move, aim, score };
        }
      }
    }
    return best;
  }

  /** Casilla más cercana a cualquier jugador vivo, usando la distancia en hexágonos. */
  private distToNearestFoe(me: Unit, h: Hex): number {
    const foes = this.units.filter((u) => u.isPlayer && u.alive);
    return Math.min(...foes.map((f) => hexDistance(h, f.pos)));
  }

  /** Si no hay ataque posible, se acerca al jugador más cercano. */
  private approachPath(me: Unit, reach: Map<string, { hex: Hex; steps: number; path: Hex[] }>): Hex[] {
    let best = { path: [me.pos], d: this.distToNearestFoe(me, me.pos) };
    for (const e of reach.values()) {
      const d = this.distToNearestFoe(me, e.hex);
      if (d < best.d) best = { path: e.path, d };
    }
    return best.path;
  }

  /** Para la rutina "kite": se aleja lo máximo posible con los PM que quedan. */
  private retreatPath(me: Unit): Hex[] {
    const reach = this.reachMap(me, me.mp);
    let best = { path: [me.pos], score: this.distToNearestFoe(me, me.pos) * 10 };
    for (const e of reach.values()) {
      const score = this.distToNearestFoe(me, e.hex) * 10 - e.steps;
      if (score > best.score) best = { path: e.path, score };
    }
    return best.path;
  }

  /** Lanza el mejor hechizo disponible desde la casilla actual y lo anuncia en el registro. */
  private enemyCastBest(me: Unit, done: () => void) {
    const here = new Map([[hexKey(me.pos), { hex: me.pos, steps: 0, path: [me.pos] }]]);
    const choice = this.chooseAction(me, here);
    if (!choice) {
      this.addLog(`${me.mon.name} no encuentra un ataque válido.`);
      done();
      return;
    }
    const target = this.unitAt(choice.aim);
    this.addLog(
      `${me.mon.name} usa ${choice.move.name}` + (target && target !== me ? ` contra ${target.mon.name}.` : "."),
    );
    this.performCast(me, choice.move, choice.aim, done);
  }

  /** Color del efecto según el tipo del hechizo. */
  private effectColor(move: MoveData): number {
    return TYPE_COLORS[move.type] ?? 0xffffff;
  }

  /** Proyectil que vuela desde el lanzador hasta el objetivo. Devuelve su duración. */
  private projectile(from: { x: number; y: number }, to: { x: number; y: number }, color: number): number {
    const ball = this.add.circle(from.x, from.y - 8, 6, color).setDepth(9);
    this.tweens.add({ targets: ball, x: to.x, y: to.y - 8, duration: 220, onComplete: () => ball.destroy() });
    return 220;
  }

  /** Resalta las casillas afectadas con el color del tipo y las hace desaparecer. */
  private flashTiles(hexes: Hex[], color: number) {
    const g = this.add.graphics().setDepth(8);
    g.fillStyle(color, 0.75);
    for (const h of hexes) g.fillPoints(this.corners(h), true);
    this.tweens.add({ targets: g, alpha: 0, duration: 350, onComplete: () => g.destroy() });
  }

  /**
   * Lanzamiento con animación: el Pokémon se adelanta hacia el objetivo, sale un proyectil
   * (si es a distancia), aparece el efecto sobre las casillas afectadas y luego se aplica el daño.
   */
  private performCast(actor: Unit, move: MoveData, aim: Hex, done: () => void) {
    const rule = ruleOf(move);
    const color = this.effectColor(move);
    const sprite = this.unitSprites.get(actor.id);
    const from = this.center(actor.pos);
    const to = this.center(aim);
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;

    const apply = () => {
      this.busy = false;
      this.castSpell(actor, move, aim);
      done();
    };
    const showEffect = () => {
      const launch = rule.shape === "point" && hexDistance(actor.pos, aim) > 1 ? this.projectile(from, to, color) : 0;
      this.time.delayedCall(launch, () => {
        const tiles = affectedTiles(actor.pos, aim, rule, HEX_SIZE, this.tileSet);
        this.flashTiles(
          tiles.map((a) => a.hex),
          color,
        );
        this.time.delayedCall(350, apply);
      });
    };

    this.busy = true;
    if (sprite && hexKey(aim) !== hexKey(actor.pos)) {
      // El Pokémon se adelanta hacia el objetivo y vuelve
      this.tweens.add({
        targets: sprite,
        x: sprite.x + ux * 14,
        y: sprite.y + uy * 14,
        duration: 120,
        yoyo: true,
        onComplete: showEffect,
      });
    } else {
      showEffect();
    }
  }

  /**
   * Turno de la IA:
   * 1) Busca la mejor combinación casilla + hechizo + objetivo con sus PM.
   * 2) Si no hay ataque posible, se acerca al jugador más cercano.
   * 3) Ataca desde la casilla elegida.
   * 4) Si su rutina es "kite", usa los PM que le sobran para alejarse.
   */
  private enemyTurn() {
    if (this.over || !this.current || this.current.isPlayer) return;
    const me = this.current;
    if (!this.units.some((u) => u.isPlayer && u.alive)) return;

    const reach = this.reachMap(me, me.mp);
    const choice = this.chooseAction(me, reach);
    const plan = choice ? choice.path : this.approachPath(me, reach);

    this.animatePath(me, plan, () => {
      if (!me.alive) {
        this.refresh();
        return;
      }
      this.enemyCastBest(me, () => {
        this.refresh();
        if (me.ai === "kite" && me.alive && me.mp > 0 && !this.over) {
          const retreat = this.retreatPath(me);
          this.animatePath(me, retreat, () => {
            this.refresh();
            this.time.delayedCall(800, () => this.endTurn());
          });
        } else {
          this.time.delayedCall(800, () => this.endTurn());
        }
      });
    });
  }

  // ----- Dibujo -----

  private refresh() {
    this.gfx.clear();
    this.labels.forEach((t) => t.destroy());
    this.labels = [];

    const u = this.current;
    const playerTurn = !!u && u.isPlayer && !this.over && !this.busy;

    // Alcance máximo (verde claro) o desplazamiento (verde oscuro) según lo elegido
    const rangeSet = new Set<string>();
    const reach = playerTurn && !this.selectedSpell ? this.reachableTiles(u!) : new Set<string>();
    const effectSet = new Set<string>();
    if (playerTurn && this.selectedSpell) {
      const rule = ruleOf(this.selectedSpell);
      for (const t of this.tiles) {
        const d = hexDistance(u!.pos, t);
        if (d >= rule.minRange && d <= rule.maxRange) rangeSet.add(hexKey(t));
      }
      const aim = this.aimFor(this.selectedSpell, this.hover);
      if (aim && rangeSet.has(hexKey(aim))) {
        for (const a of affectedTiles(u!.pos, aim, rule, HEX_SIZE, this.tileSet)) {
          effectSet.add(hexKey(a.hex));
        }
      }
    }

    for (const t of this.tiles) {
      const k = hexKey(t);
      const isHover = !!this.hover && hexKey(this.hover) === k;
      let fill = 0xf1ebdc;
      if (this.obstacleSet.has(k)) fill = 0x3d4450;
      else if (this.phase === "placement" && this.zoneKeys.has(k)) fill = 0xbfe3ff;
      else if (effectSet.has(k)) fill = COLOR_EFFECT;
      else if (rangeSet.has(k)) fill = COLOR_RANGE;
      else if (reach.has(k)) fill = COLOR_REACH;
      if (isHover && !effectSet.has(k) && !this.obstacleSet.has(k)) {
        fill = rangeSet.has(k) || reach.has(k) ? fill : 0x9fd3ff;
      }
      this.gfx.fillStyle(fill, 1);
      this.gfx.fillPoints(this.corners(t), true);
      this.gfx.lineStyle(1, 0x7a7265, 1);
      this.gfx.strokePoints(this.corners(t), true);
    }

    // Camino de desplazamiento sobre la casilla bajo el mouse
    if (playerTurn && !this.selectedSpell && this.hover && reach.has(hexKey(this.hover))) {
      const path = this.findPath(u!.pos, this.hover);
      if (path && path.length > 1) {
        this.gfx.lineStyle(3, COLOR_PATH, 1);
        for (let i = 1; i < path.length; i++) {
          const a = this.center(path[i - 1]);
          const b = this.center(path[i]);
          this.gfx.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
    }

    // Trampas visibles para el jugador
    for (const t of this.traps) {
      if (this.trapVisible(t)) this.drawSpikes(t.hex, t.team);
    }

    this.unitSprites.forEach((s) => s.destroy());
    this.unitSprites.clear();
    for (const unit of this.units) {
      if (!unit.alive) continue;
      const p = this.center(unit.pos);
      const sid = this.spriteIdOf(unit);
      const sprite = makeWalker(this, sid, p.x, p.y - 8, unit.isPlayer ? 0x4caf7a : 0xd9534f, 1.2).setDepth(5);
      const foe = this.units.find((o) => o.team !== unit.team && o.alive);
      if (foe) {
        const fc = this.center(foe.pos); // mira hacia el rival
        setWalk(sprite, sid, directionOf(fc.x - p.x, fc.y - p.y), false);
      }
      this.unitSprites.set(unit.id, sprite);
      const pm = this.pmLossOf(unit);
      const st = [unit.status, pm > 0 ? `-${pm} PM` : null].filter(Boolean).map((s) => ` [${s}]`).join("");
      this.labels.push(
        this.add
          .text(p.x, p.y - 36, `${unit.mon.name}  ${unit.mon.hp}/${unit.mon.maxHp} PS${st}`, {
            fontSize: "12px",
            color: "#ffffff",
            backgroundColor: "#00000088",
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(6),
      );
    }

    this.updatePreview();
    this.updateHeader();
    this.updateSpellBar();
    this.logText.setText(this.log.slice(-8).join("\n"));
  }

  /** Dibuja las púas: azul para el jugador, rojo para el salvaje. */
  private drawSpikes(h: Hex, team: "A" | "B") {
    const p = this.center(h);
    this.gfx.fillStyle(team === PLAYER_TEAM ? 0x2d6fb3 : 0xa33a3a, 1);
    for (const [dx, dy] of [[-7, 3], [0, -2], [7, 3]]) {
      this.gfx.fillTriangle(p.x + dx - 4, p.y + dy + 5, p.x + dx, p.y + dy - 5, p.x + dx + 4, p.y + dy + 5);
    }
  }

  private updatePreview() {
    this.previewText.setText("");
    const u = this.current;
    // Sin hechizo elegido: al pasar el mouse por una casilla alcanzable, muestra lo que pasa en el camino
    if (u && u.isPlayer && !this.selectedSpell && !this.busy && !this.over && this.hover) {
      const entry = this.reachMap(u, u.mp).get(hexKey(this.hover));
      if (entry && entry.steps > 0) {
        const pv = this.previewPath(u, entry.path);
        let text = `Camino: ${pv.steps} casilla(s) · PM al llegar: ${pv.mpLeft}`;
        if (pv.spikes > 0) {
          text += ` · ${pv.spikes} púa(s): -${pv.dmg} PS y -${pv.pmLoss} PM por 2 turnos`;
        }
        this.previewText.setText(text);
      }
      return;
    }
    if (!u || !u.isPlayer || !this.selectedSpell || this.busy) return;
    const rule = ruleOf(this.selectedSpell);
    const aim = this.aimFor(this.selectedSpell, this.hover);
    if (!aim) return;
    const check = this.canCast(u, this.selectedSpell, aim);
    if (!check.ok) {
      this.previewText.setText(`${this.selectedSpell.name}: ${check.reason}`);
      return;
    }

    if (rule.placesTrap) {
      const n = affectedTiles(u.pos, aim, rule, HEX_SIZE, this.tileSet).filter(
        (a) => !this.obstacleSet.has(hexKey(a.hex)),
      ).length;
      const who = rule.placesTrap.visibleTo === "owner" ? "solo tu equipo la ve" : "visible para todos";
      this.previewText.setText(
        `${this.selectedSpell.name}: coloca ${n} púa(s) · pisar: -${rule.placesTrap.damagePct}% PS y -${rule.placesTrap.pmLoss} PM por ${rule.placesTrap.pmTurns} turnos · ${who}`,
      );
      return;
    }

    const { hitUnits } = this.targetsOf(u, this.selectedSpell, aim);
    const enemies = hitUnits.filter((x) => x.unit.team !== u.team).length;
    const allies = hitUnits.filter((x) => x.unit.team === u.team).length;
    const center = hitUnits.find((x) => hexKey(x.unit.pos) === hexKey(aim)) ?? hitUnits[0];
    const acc = this.selectedSpell.accuracy === null ? "100%" : `${this.selectedSpell.accuracy}%`;
    let text = `${this.selectedSpell.name}`;
    if (center) {
      const r = damageRange(u.mon, center.unit.mon, this.selectedSpell, CHART);
      if (r.max > 0) text += `: ${r.min} – ${r.max} de daño en el centro (precisión ${acc})`;
    }
    text += `  ·  alcanza a ${enemies} enemigo(s)`;
    if (allies) text += ` y ${allies} aliado(s)`;
    if (rule.healPct) text += `  ·  cura ${rule.healPct}%`;
    if (rule.selfDamagePct) {
      const cost = Math.floor((u.mon.maxHp * rule.selfDamagePct) / 100);
      text += `  ·  te cuesta ${cost} PS (${rule.selfDamagePct}%)`;
    }
    this.previewText.setText(text);
  }

  private updateHeader() {
    if (this.phase === "placement") {
      this.headerText.setText(`Preparación: ${Math.ceil(this.prepLeft)} s`);
      return;
    }
    const u = this.current;
    if (!u || this.over) {
      this.headerText.setText("Combate terminado");
      return;
    }
    const who = u.isPlayer ? "Tu turno" : `Turno de ${u.mon.name} salvaje`;
    const time = u.isPlayer ? `   Tiempo: ${Math.ceil(this.timeLeft)}s` : "";
    this.headerText.setText(`${who}   PA ${u.ap}/${AP_MAX}   PM ${u.mp}/${MP_MAX}${time}`);
  }

  private updateSpellBar() {
    this.spellButtons.forEach((b) => b.destroy());
    this.spellButtons = [];
    const player = this.units.find((u) => u.isPlayer)!;
    const usable = !!this.current && this.current.isPlayer && !this.over && !this.busy;
    const width = Math.min(200, (this.scale.width - 24) / SPELLS_PER_MON);

    player.mon.moves.forEach((move, i) => {
      const rule = ruleOf(move);
      const selected = this.selectedSpell?.id === move.id;
      const cls = move.damageClass === "physical" ? "Físico" : move.damageClass === "special" ? "Especial" : "Estado";
      const range = rule.minRange === rule.maxRange ? `${rule.maxRange}` : `${rule.minRange}-${rule.maxRange}`;
      const btn = this.add
        .text(
          12 + i * (width + 6),
          this.scale.height - 150,
          `${i + 1}. ${move.name} (${move.type})\n${cls} · PA ${rule.ap} · Alc ${range}`,
          {
            fontSize: "13px",
            color: "#ffffff",
            backgroundColor: selected ? "#c05621" : "#2d3748",
            padding: { x: 8, y: 6 },
            lineSpacing: 4,
            wordWrap: { width },
          },
        )
        .setAlpha(usable ? 1 : 0.4)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.pickSpell(i));
      this.spellButtons.push(btn);
    });

    this.endButton.setAlpha(usable ? 1 : 0.4);
  }

  private corners(h: Hex) {
    return diamondCorners(h, this.cfg);
  }

  private center(h: Hex) {
    return worldToIso(hexToWorld(h, this.cfg.size), this.cfg);
  }

  private addLog(text: string) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }
}

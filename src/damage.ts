// Estadísticas, naturalezas y daño según las reglas de Pokémon.
// Ataque y Defensa para movimientos físicos. Ataque Especial y Defensa Especial para especiales.

export type StatName = "hp" | "attack" | "defense" | "spAttack" | "spDefense" | "speed";

export interface Ivs {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export interface Nature {
  id: string;
  name: string;
  plus: Exclude<StatName, "hp"> | null;
  minus: Exclude<StatName, "hp"> | null;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  power: number;
  accuracy: number | null;
  damageClass: "physical" | "special" | "status";
}

/** Estadística final: fórmula oficial de Pokémon, con el modificador de naturaleza. */
export function computeStat(
  base: number,
  iv: number,
  level: number,
  stat: Exclude<StatName, "hp">,
  nature: Nature,
): number {
  const raw = Math.floor(((2 * base + iv) * level) / 100) + 5;
  const mod = nature.plus === stat ? 1.1 : nature.minus === stat ? 0.9 : 1;
  return Math.floor(raw * mod);
}

export function computeHp(base: number, iv: number, level: number): number {
  return Math.floor(((2 * base + iv) * level) / 100) + level + 10;
}

/** Multiplicador por tipo del movimiento contra los tipos del objetivo. */
export function effectiveness(
  moveType: string,
  defenderTypes: string[],
  chart: Record<string, Record<string, number>>,
): number {
  return defenderTypes.reduce((acc, t) => acc * (chart[moveType]?.[t] ?? 1), 1);
}

export interface Attacker {
  level: number;
  types: string[];
  attack: number;
  spAttack: number;
}

export interface Defender {
  types: string[];
  defense: number;
  spDefense: number;
}

/** Rango de daño (mínimo y máximo) de un movimiento. Sin daño si es de estado. */
export function damageRange(
  attacker: Attacker,
  defender: Defender,
  move: MoveData,
  chart: Record<string, Record<string, number>>,
): { min: number; max: number } {
  if (move.damageClass === "status" || move.power === 0) return { min: 0, max: 0 };

  const physical = move.damageClass === "physical";
  const A = physical ? attacker.attack : attacker.spAttack;
  const D = physical ? defender.defense : defender.spDefense;

  const base = Math.floor(
    (Math.floor((2 * attacker.level) / 5 + 2) * move.power * A) / Math.max(1, D) / 50,
  ) + 2;

  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const eff = effectiveness(move.type, defender.types, chart);

  const calc = (roll: number) => Math.floor(base * stab * eff * roll);
  return { min: calc(0.85), max: calc(1) };
}

/** Tirada de precisión. Si el movimiento nunca falla (accuracy null), siempre acierta. */
export function hits(move: MoveData, rng: () => number = Math.random): boolean {
  if (move.accuracy === null) return true;
  return rng() * 100 < move.accuracy;
}

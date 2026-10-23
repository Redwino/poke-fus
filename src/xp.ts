import type { Pokemon, Species } from "./types";

export const MAX_LEVEL = 100;

/** Curva "medium fast" (n³). Las demás curvas se agregan acá cuando las definas. */
export function totalXpForLevel(level: number, group: Species["xpGroup"] = "medium_fast"): number {
  const n = Math.max(1, Math.min(level, MAX_LEVEL));
  switch (group) {
    case "fast":
      return Math.floor(0.8 * n ** 3);
    case "slow":
      return Math.floor(1.25 * n ** 3);
    case "medium_slow":
      return Math.floor(1.2 * n ** 3 - 15 * n ** 2 + 100 * n - 140);
    case "medium_fast":
    default:
      return n ** 3;
  }
}

export function levelFromXp(xp: number, group: Species["xpGroup"] = "medium_fast"): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= totalXpForLevel(level + 1, group)) level++;
  return level;
}

/** XP de caramelo raro: depende del candyValue de la especie que se consume. */
export const CANDY_BASE_XP = 1000;

export function candyXp(donor: Species): number {
  return Math.round(CANDY_BASE_XP * donor.candyValue);
}

/**
 * Traspaso de XP: el nuevo Pokémon recibe un % del XP total del de mayor nivel.
 * transferPct viene de la config (ej. 0.1 = 10%).
 */
export function transferXp(source: Pokemon, sourceSpecies: Species, transferPct: number): number {
  return Math.floor(source.xp * transferPct);
}

export function applyXp(p: Pokemon, species: Species, gained: number): Pokemon {
  const xp = p.xp + gained;
  return { ...p, xp, level: levelFromXp(xp, species.xpGroup) };
}

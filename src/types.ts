export type StatKey = "hp" | "attack" | "defense" | "spAttack" | "spDefense" | "speed";
export type NatureStat = Exclude<StatKey, "hp">;

export interface Nature {
  id: string;
  name: string;
  plus: NatureStat | null;
  minus: NatureStat | null;
}

export interface Species {
  id: string;
  name: string;
  types: string[];
  captureRate: number;
  candyValue: number;
  xpGroup: "fast" | "medium_fast" | "medium_slow" | "slow";
  baseStats: Record<StatKey, number> | null;
}

export interface Pokemon {
  uid: string;
  speciesId: string;
  level: number;
  xp: number;
  nature: string;
  shiny: boolean;
  ivs: Record<StatKey, number>; // 0 a 31
}

export interface Trainer {
  badges: number;
  copiesOwned: Record<string, number>; // speciesId -> cantidad capturada
  captureBonus: number; // bonus extra del entrenador (0 por defecto)
}

export interface CaptureConfig {
  medalBonus: number;
  copiesForFullCapture: number;
  minigame: { accuracyMin: number; accuracyMax: number };
  balls: Record<string, { multiplier: number }>;
  startingLevel: number;
  shinyChance: number;
}

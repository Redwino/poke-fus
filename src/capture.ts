import type { CaptureConfig, Species, Trainer } from "./types";

/**
 * Probabilidad de captura estilo "drop de Dofus":
 * - parte de captureRate de la especie
 * - cada medalla suma medalBonus
 * - cada copia suma proporcionalmente hasta llegar al 100% en copiesForFullCapture copias
 * Si el resultado llega a 1, la captura es automática.
 */
export function baseCaptureChance(
  species: Species,
  trainer: Trainer,
  config: CaptureConfig,
): number {
  const copies = trainer.copiesOwned[species.id] ?? 0;
  const copyProgress = Math.min(copies, config.copiesForFullCapture) / config.copiesForFullCapture;

  const copyBonus = copyProgress * (1 - species.captureRate);
  const medalBonus = trainer.badges * config.medalBonus;

  return clamp01(species.captureRate + copyBonus + medalBonus + trainer.captureBonus);
}

/**
 * Aplica el resultado del mini juego (accuracy entre 0 y 1) y la ball.
 * Con accuracy 0 se usa accuracyMin; con accuracy 1, accuracyMax.
 * Si la probabilidad base ya es 1, no hay mini juego: captura asegurada.
 */
export function finalCaptureChance(
  base: number,
  accuracy: number,
  ballId: string,
  config: CaptureConfig,
): number {
  if (base >= 1) return 1;

  const { accuracyMin, accuracyMax } = config.minigame;
  const acc = clamp01(accuracy);
  const minigameMod = accuracyMin + (accuracyMax - accuracyMin) * acc;
  const ballMod = config.balls[ballId]?.multiplier ?? 1;

  return clamp01(base * minigameMod * ballMod);
}

export function attemptCapture(
  finalChance: number,
  rng: () => number = Math.random,
): boolean {
  return rng() < finalChance;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

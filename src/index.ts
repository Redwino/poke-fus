import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attemptCapture, baseCaptureChance, finalCaptureChance } from "./capture";
import { candyXp, applyXp, transferXp, totalXpForLevel } from "./xp";
import { validateBattleSelection } from "./team";
import type { CaptureConfig, Nature, Species, Trainer } from "./types";

const dataDir = join(__dirname, "..", "data");
const load = <T>(file: string): T => JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T;

export const captureConfig = load<CaptureConfig>("capture.json");
export const natures = load<{ natures: Nature[] }>("natures.json").natures;
export const species = load<{ species: Species[] }>("species.json").species;

// Pequeña demostración de uso
if (require.main === module) {
  const trainer: Trainer = { badges: 2, copiesOwned: { legendario_1: 0, salvaje_comun_1: 5 }, captureBonus: 0 };
  const salvaje = species.find((s) => s.id === "salvaje_comun_1")!;
  const base = baseCaptureChance(salvaje, trainer, captureConfig);
  const chance = finalCaptureChance(base, 0.8, "poke", captureConfig);
  console.log(`Captura ${salvaje.name}: base ${base.toFixed(3)}, final ${chance.toFixed(3)}, resultado ${attemptCapture(chance)}`);

  console.log("XP nivel 50:", totalXpForLevel(50));
  console.log("Caramelo de Legendario 1:", candyXp(species.find((s) => s.id === "legendario_1")!), "XP");
  console.log("Selección válida en coliseo:", validateBattleSelection(["a"], true) ?? "ok");
  void applyXp;
  void transferXp;
}

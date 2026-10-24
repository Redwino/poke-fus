import Phaser from "phaser";
import { MapScene } from "./scenes/MapScene";
import { CombatScene } from "./scenes/CombatScene";
import { TeamScene } from "./scenes/TeamScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#2b2f36",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: "100%",
    height: "100%",
  },
  scene: [MapScene, TeamScene, CombatScene],
});

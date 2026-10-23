import Phaser from "phaser";

// Sprites HOME de PokeAPI (mismo patrón que scripts/fetch-species.mjs).
// Se cargan por internet al abrir el juego. Si una imagen no carga, se dibuja un círculo de color.
const HOME_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home";
const TOKEN_SIZE = 52;

// Hojas de caminar de PMD Collab (CC BY-NC 4.0: uso no comercial, con crédito).
// Cada hoja es de 240x320: cuadros de 40x40, 6 por fila, 8 filas (una por dirección).
const PMD_URL = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite";
const PMD_FRAME = 40;
const PMD_FRAMES_PER_DIR = 6;
const WALK_SCALE = 1.5;

/** Clave interna de la imagen de un Pokémon. id = "p25" (número nacional con prefijo p). */
export function spriteKey(id: string): string {
  return `sp-${id}`;
}

/** Carga los sprites HOME de una lista de Pokémon. Llamar desde preload() de cada escena. */
export function preloadSprites(scene: Phaser.Scene, ids: string[]) {
  scene.load.setCORS("anonymous");
  for (const id of ids) {
    const nationalId = id.replace(/^p/, "");
    if (!scene.textures.exists(spriteKey(id))) {
      scene.load.image(spriteKey(id), `${HOME_URL}/${nationalId}.png`);
    }
  }
  // Si una carga falla, la textura no existe y makeToken dibuja el círculo
}

/** Crea la ficha de un Pokémon (imagen HOME si existe, círculo si no). */
export function makeToken(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  fallbackColor: number,
  flip = false,
): Phaser.GameObjects.Image | Phaser.GameObjects.Arc {
  const key = spriteKey(id);
  if (scene.textures.exists(key)) {
    const img = scene.add.image(x, y, key).setDisplaySize(TOKEN_SIZE, TOKEN_SIZE);
    if (flip) img.setFlipX(true);
    return img;
  }
  return scene.add.circle(x, y, 14, fallbackColor);
}

// ----- Caminar (sprites PMD) -----

export function walkKey(id: string): string {
  return `walk-${id}`;
}

/** Carga la hoja de caminar de un Pokémon. Llamar desde preload(). */
export function preloadWalk(scene: Phaser.Scene, id: string) {
  scene.load.setCORS("anonymous");
  const nationalId = id.replace(/^p/, "").padStart(4, "0");
  if (!scene.textures.exists(walkKey(id))) {
    scene.load.spritesheet(walkKey(id), `${PMD_URL}/${nationalId}/Walk-Anim.png`, {
      frameWidth: PMD_FRAME,
      frameHeight: PMD_FRAME,
    });
  }
}

/** Dirección PMD según el movimiento en pantalla: 0 abajo, 2 derecha, 4 arriba, 6 izquierda (y diagonales). */
export function directionOf(dx: number, dy: number): number {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const k = Math.round(angle / 45);
  return (((2 - k) % 8) + 8) % 8;
}

function ensureWalkAnims(scene: Phaser.Scene, id: string) {
  for (let d = 0; d < 8; d++) {
    const key = `${walkKey(id)}-${d}`;
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(walkKey(id), {
        start: d * PMD_FRAMES_PER_DIR,
        end: d * PMD_FRAMES_PER_DIR + PMD_FRAMES_PER_DIR - 1,
      }),
      frameRate: 8,
      repeat: -1,
    });
  }
}

/** Crea el personaje caminante: sprite PMD si cargó, círculo si no. */
export function makeWalker(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  fallbackColor: number,
  scale = WALK_SCALE,
): Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc {
  if (scene.textures.exists(walkKey(id))) {
    ensureWalkAnims(scene, id);
    return scene.add.sprite(x, y, walkKey(id), 0).setScale(scale);
  }
  return scene.add.circle(x, y, 12, fallbackColor);
}

/** Anima el caminar hacia una dirección, o se queda quieto mirando hacia ella. */
export function setWalk(
  obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc,
  id: string,
  dir: number,
  moving: boolean,
) {
  if (!(obj instanceof Phaser.GameObjects.Sprite)) return;
  if (moving) {
    obj.anims.play(`${walkKey(id)}-${dir}`, true);
  } else {
    obj.anims.stop();
    obj.setFrame(dir * PMD_FRAMES_PER_DIR);
  }
}

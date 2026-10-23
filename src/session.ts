// Datos que pasan de una escena a otra (mapa, menú previo, combate, popups).

/** Máximo de hechizos que se pueden equipar para un combate. */
export const MAX_SPELLS = 4;

/** Hechizos disponibles para Bulbasaur en la prueba. */
export const PLAYER_MOVE_POOL = ["vine-whip", "solar-beam", "earthquake", "self-destruct", "spikes", "synthesis"];

/** Centro Pokémon de la prueba (casilla donde aparece el jugador tras perder). */
export const POKE_CENTER = { q: 0, r: 0 };

export const session = {
  /** Hechizos elegidos en el menú previo. Si está vacío, se usan los primeros 4. */
  playerMoves: [] as string[],
  /** Pokémon del jugador. Persiste entre combates (PS, IVs). Tipo: el Mon de CombatScene. */
  playerMon: null as any,
  /** Casilla del jugador en el mapa mundo (se recuerda al volver del combate). */
  mapPlayerHex: null as null | { q: number; r: number },
  /** true cuando el grupo de pios ya fue derrotado en el mapa. */
  groupDefeated: false,
  /** Ventana que se muestra al llegar al mapa (recompensas o aviso de derrota). */
  pendingPopup: null as null | { title: string; lines: string[] },
};

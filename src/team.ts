export const TEAM_MAX = 6;
export const BATTLE_MIN = 1;
export const BATTLE_MAX = 3;
export const COLISEUM_MAX_PER_PLAYER = 1;

export function validateTeam(team: unknown[]): string | null {
  if (team.length > TEAM_MAX) return `El equipo no puede tener más de ${TEAM_MAX} Pokémon.`;
  return null;
}

export function validateBattleSelection(selected: string[], isColiseum: boolean): string | null {
  if (isColiseum) {
    if (selected.length !== COLISEUM_MAX_PER_PLAYER) {
      return `En el coliseo cada jugador usa exactamente ${COLISEUM_MAX_PER_PLAYER} Pokémon.`;
    }
    return null;
  }
  if (selected.length < BATTLE_MIN || selected.length > BATTLE_MAX) {
    return `Tenés que elegir entre ${BATTLE_MIN} y ${BATTLE_MAX} Pokémon.`;
  }
  return null;
}

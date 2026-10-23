// PA (puntos de acción) y PM (puntos de movimiento) por turno, y hechizos con coste y recarga.

export interface Spell {
  id: string;
  name: string;
  apCost: number;
  range: number;
  /** Veces por turno. undefined = sin límite. 1 = una vez por turno. */
  perTurnLimit?: number;
  /** Turnos de recarga tras usarse. 0 o undefined = sin recarga. */
  cooldown?: number;
}

export interface TurnState {
  ap: number;
  mp: number;
  castsThisTurn: Record<string, number>;
  cooldowns: Record<string, number>; // spellId -> turnos restantes
}

export function startTurn(
  baseAp: number,
  baseMp: number,
  cooldowns: Record<string, number>,
): TurnState {
  const next: Record<string, number> = {};
  for (const [id, left] of Object.entries(cooldowns)) {
    if (left > 1) next[id] = left - 1;
  }
  return { ap: baseAp, mp: baseMp, castsThisTurn: {}, cooldowns: next };
}

export function canCast(state: TurnState, spell: Spell): { ok: boolean; reason?: string } {
  if (state.ap < spell.apCost) return { ok: false, reason: "PA insuficientes" };
  if ((state.cooldowns[spell.id] ?? 0) > 0) return { ok: false, reason: "Hechizo en recarga" };
  const used = state.castsThisTurn[spell.id] ?? 0;
  if (spell.perTurnLimit !== undefined && used >= spell.perTurnLimit) {
    return { ok: false, reason: "Límite por turno alcanzado" };
  }
  return { ok: true };
}

export function applyCast(state: TurnState, spell: Spell): TurnState {
  const check = canCast(state, spell);
  if (!check.ok) throw new Error(check.reason);
  const cooldowns = { ...state.cooldowns };
  if (spell.cooldown && spell.cooldown > 0) cooldowns[spell.id] = spell.cooldown;
  return {
    ...state,
    ap: state.ap - spell.apCost,
    castsThisTurn: {
      ...state.castsThisTurn,
      [spell.id]: (state.castsThisTurn[spell.id] ?? 0) + 1,
    },
    cooldowns,
  };
}

export function applyMove(state: TurnState, steps: number): TurnState {
  if (steps > state.mp) throw new Error("PM insuficientes");
  return { ...state, mp: state.mp - steps };
}

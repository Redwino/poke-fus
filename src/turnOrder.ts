// Orden de turnos estilo Dofus:
// - Cada equipo ordena sus combatientes por velocidad (mayor a menor).
// - Los equipos se intercalan. El primero de la ronda es el equipo del combatiente más rápido.
// - Cuando un equipo se queda sin combatientes en la alternancia, los restantes del otro completan la ronda.
// - Se recalcula en cada ronda, así un combatiente más rápido puede adelantarse.

export interface Combatant {
  id: string;
  team: "A" | "B";
  speed: number;
}

export function turnOrder(combatants: Combatant[]): Combatant[] {
  const teams: Record<"A" | "B", Combatant[]> = {
    A: combatants.filter((c) => c.team === "A").sort((x, y) => y.speed - x.speed),
    B: combatants.filter((c) => c.team === "B").sort((x, y) => y.speed - x.speed),
  };

  if (teams.A.length === 0 && teams.B.length === 0) return [];

  const fastest = [...combatants].sort((x, y) => y.speed - x.speed)[0];
  const first: "A" | "B" = fastest.team;
  const second: "A" | "B" = first === "A" ? "B" : "A";

  const order: Combatant[] = [];
  const max = Math.max(teams[first].length, teams[second].length);
  for (let i = 0; i < max; i++) {
    if (teams[first][i]) order.push(teams[first][i]);
    if (teams[second][i]) order.push(teams[second][i]);
  }
  return order;
}

/**
 * PvM: el equipo del jugador siempre arranca.
 * Se usa el mismo intercalado, pero con el equipo `playerTeam` primero.
 */
export function turnOrderPvM(combatants: Combatant[], playerTeam: "A" | "B"): Combatant[] {
  const other: "A" | "B" = playerTeam === "A" ? "B" : "A";
  const byTeam = (t: "A" | "B") =>
    combatants.filter((c) => c.team === t).sort((x, y) => y.speed - x.speed);
  const p = byTeam(playerTeam);
  const o = byTeam(other);
  const order: Combatant[] = [];
  const max = Math.max(p.length, o.length);
  for (let i = 0; i < max; i++) {
    if (p[i]) order.push(p[i]);
    if (o[i]) order.push(o[i]);
  }
  return order;
}

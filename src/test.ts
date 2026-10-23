import assert from "node:assert/strict";
import { hexDistance, hexRange, hexLine } from "./hex";
import { turnOrder, turnOrderPvM, type Combatant } from "./turnOrder";
import { startTurn, applyCast, canCast, applyMove, type Spell } from "./actions";

// --- hex ---
assert.equal(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 }), 1);
assert.equal(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 3);
assert.equal(hexRange({ q: 0, r: 0 }, 1).length, 5);
assert.equal(hexRange({ q: 0, r: 0 }, 2).length, 13);
assert.equal(hexLine({ q: 0, r: 0 }, { q: 3, r: 0 }).length, 3);

// --- turnos: ejemplo del diseño A2 - B1 - A1 - B2 - B3 - B4 - B5 ---
const mk = (id: string, team: "A" | "B", speed: number): Combatant => ({ id, team, speed });
const combatants: Combatant[] = [
  mk("A1", "A", 50),
  mk("A2", "A", 90), // más rápido de A y de todo el combate
  mk("B1", "B", 60),
  mk("B2", "B", 40),
  mk("B3", "B", 30),
  mk("B4", "B", 20),
  mk("B5", "B", 10),
];
assert.deepEqual(
  turnOrder(combatants).map((c) => c.id),
  ["A2", "B1", "A1", "B2", "B3", "B4", "B5"],
);
// PvM: el equipo del jugador (A) arranca siempre
assert.deepEqual(
  turnOrderPvM(combatants.map((c) => ({ ...c, speed: c.team === "B" ? 999 : c.speed })), "A")
    .map((c) => c.id)[0],
  "A2",
);

// --- PA/PM y hechizos ---
const bola: Spell = { id: "bola", name: "Bola", apCost: 3, range: 4, perTurnLimit: 1, cooldown: 2 };
let t = startTurn(6, 3, {});
assert.equal(canCast(t, bola).ok, true);
t = applyCast(t, bola);
assert.equal(t.ap, 3);
assert.equal(canCast(t, bola).ok, false); // una vez por turno
t = startTurn(6, 3, t.cooldowns);
assert.equal(canCast(t, bola).ok, false); // recarga de 2 turnos, todavía 1 restante
t = startTurn(6, 3, t.cooldowns);
assert.equal(canCast(t, bola).ok, true);
t = applyMove(t, 2);
assert.equal(t.mp, 1);
assert.throws(() => applyMove(t, 5));

console.log("Todas las pruebas pasaron.");

// Formas de ataque: qué casillas toca un movimiento, y con qué fuerza.
// - point: solo la casilla elegida
// - self: solo el lanzador
// - area: círculo alrededor del punto elegido (o del lanzador si centerOn = self)
//   el daño baja 3% por casilla alejada del centro
// - cone: se abre desde el lanzador hacia la casilla elegida (60 grados)
// - line: recta desde el lanzador hacia la casilla elegida, con ancho

import { hexDistance, hexKey, hexRange, type Hex } from "./hex";
import { hexToWorld } from "./render/iso";

export interface Rule {
  shape: "point" | "cone" | "line" | "area" | "self";
  centerOn?: "target" | "self";
  length?: number;
  width?: number;
  radius?: number;
  minRange: number;
  maxRange: number;
  ap: number;
  hitsAllies?: boolean;
  healPct?: number;
  selfDamagePct?: number;
  status?: { name: string; chance: number; duration?: number }; // duration en turnos de quien lo lanza
  cooldown?: number; // turnos propios de quien lo lanza hasta poder volver a usarlo
  placesTrap?: {
    damagePct: number; // % de PS máximos que quita al pisarla
    pmLoss: number; // PM que quita cada púa pisada (acumulable)
    pmTurns: number; // turnos de quien la lanzó que dura ese efecto
    durationTurns: number; // turnos de quien la lanzó que dura la púa en el piso (incluye el de lanzamiento)
    visibleTo: "owner" | "all"; // "owner": solo ve el equipo que la puso
  };
}

export interface Affected {
  hex: Hex;
  falloff: number; // 1 = daño completo
}

export function affectedTiles(
  origin: Hex,
  target: Hex,
  rule: Rule,
  size: number,
  tileSet: Set<string>,
): Affected[] {
  const s = Math.hypot(size, size / 2); // distancia en pantalla entre centros de casillas vecinas (rombos)

  if (rule.shape === "self") return [{ hex: origin, falloff: 1 }];
  if (rule.shape === "point") return [{ hex: target, falloff: 1 }];

  if (rule.shape === "area") {
    const center = rule.centerOn === "self" ? origin : target;
    const out: Affected[] = [];
    for (const h of hexRange(center, rule.radius ?? 1)) {
      if (!tileSet.has(hexKey(h))) continue;
      const falloff = Math.max(0.5, 1 - 0.03 * hexDistance(center, h));
      out.push({ hex: h, falloff });
    }
    return out;
  }

  // cono y línea: dirección desde el lanzador hacia la casilla elegida
  const length = rule.length ?? 3;
  const o = hexToWorld(origin, size);
  const t = hexToWorld(target, size);
  let dx = t.x - o.x;
  let dy = t.y - o.y;
  const norm = Math.hypot(dx, dy) || 1;
  dx /= norm;
  dy /= norm;
  const maxAlong = length * s + 0.5 * s;

  const out: Affected[] = [];
  for (const h of hexRange(origin, length)) {
    if (hexDistance(origin, h) === 0) continue;
    if (!tileSet.has(hexKey(h))) continue;
    const w = hexToWorld(h, size);
    const vx = w.x - o.x;
    const vy = w.y - o.y;
    const along = vx * dx + vy * dy;
    const perp = Math.abs(-vx * dy + vy * dx);
    if (along <= 0.5 * s || along > maxAlong) continue;

    if (rule.shape === "cone") {
      const spread = along * Math.tan(Math.PI / 6) + 0.5 * s;
      if (perp > spread) continue;
    } else {
      const half = ((rule.width ?? 1) * s) / 2 * 0.9;
      if (perp > half) continue;
    }
    out.push({ hex: h, falloff: 1 });
  }
  return out;
}

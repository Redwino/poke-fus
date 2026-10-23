// Cuadrícula de casillas en forma de rombo (isométrica).
// Cada casilla tiene coordenadas (q, r) = (columna, fila) de la cuadrícula.
// Se mantienen los nombres "hex" del código por compatibilidad: ahora la casilla es un rombo.
// Cada casilla tiene 4 vecinas (las que comparten lado) y la distancia es la suma de pasos.

export interface Hex {
  q: number;
  r: number;
}

export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
];

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

export const hexAdd = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

export function hexNeighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => hexAdd(h, d));
}

/** Distancia en casillas (pasos ortogonales en la cuadrícula). */
export function hexDistance(a: Hex, b: Hex): number {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

/** Todas las casillas a distancia <= range (incluye el origen). Forma de rombo. */
export function hexRange(center: Hex, range: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -range; dq <= range; dq++) {
    const rest = range - Math.abs(dq);
    for (let dr = -rest; dr <= rest; dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** Línea de casillas desde a (sin incluirla) hasta b (incluida). Se usa para la línea de visión. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const path: Hex[] = [];
  let cq = a.q;
  let cr = a.r;
  while (cq !== b.q || cr !== b.r) {
    const stepQ = Math.abs(b.q - cq) >= Math.abs(b.r - cr);
    if (stepQ && cq !== b.q) cq += Math.sign(b.q - cq);
    else cr += Math.sign(b.r - cr);
    path.push({ q: cq, r: cr });
  }
  return path;
}

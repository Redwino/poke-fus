// Proyección isométrica de casillas en forma de rombo (relación 2:1, como Dofus).
// Cada casilla es un rombo de ancho 2*size y alto size.

import { type Hex } from "../hex";

export interface Point {
  x: number;
  y: number;
}

export interface IsoConfig {
  /** Media anchura del rombo en pantalla (la altura es la mitad). */
  size: number;
  /** Origen de pantalla de la casilla (0, 0) del mapa. */
  originX: number;
  originY: number;
}

/** Centro de una casilla en pantalla, sin el desplazamiento del origen. */
export function hexToWorld(h: Hex, size: number): Point {
  return {
    x: (h.q - h.r) * size,
    y: ((h.q + h.r) * size) / 2,
  };
}

/** Pasa un punto del mundo a pantalla, aplicando el origen. */
export function worldToIso(p: Point, cfg: IsoConfig): Point {
  return {
    x: cfg.originX + p.x,
    y: cfg.originY + p.y,
  };
}

/** Los 4 vértices del rombo de una casilla, en pantalla (arriba, derecha, abajo, izquierda). */
export function diamondCorners(h: Hex, cfg: IsoConfig): Point[] {
  const c = worldToIso(hexToWorld(h, cfg.size), cfg);
  const hw = cfg.size;
  const hh = cfg.size / 2;
  return [
    { x: c.x, y: c.y - hh },
    { x: c.x + hw, y: c.y },
    { x: c.x, y: c.y + hh },
    { x: c.x - hw, y: c.y },
  ];
}

/** Casilla que contiene un punto de pantalla (para el clic del jugador). */
export function screenToHex(screen: Point, cfg: IsoConfig): Hex {
  const x = screen.x - cfg.originX;
  const y = screen.y - cfg.originY;
  const a = x / cfg.size; // q - r
  const b = y / (cfg.size / 2); // q + r
  return {
    q: Math.round((a + b) / 2),
    r: Math.round((b - a) / 2),
  };
}

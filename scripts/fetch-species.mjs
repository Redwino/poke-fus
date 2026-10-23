// Descarga desde PokeAPI:
//   - especies: stats base, tipos, tasa de captura, movimientos por nivel
//   - movimientos: tipo, potencia, precisión, clase (físico/especial/estado)
//   - tabla de tipos (efectividades)
// Se corre en tu PC (necesita internet):
//   node scripts/fetch-species.mjs --max 9     -> prueba con las 9 iniciales
//   node scripts/fetch-species.mjs             -> todas las especies
// Genera en data/: species.generated.json, moves.generated.json, types.generated.json

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://pokeapi.co/api/v2";
const VERSION_GROUP = "scarlet-violet";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DELAY_MS = 150;

const args = process.argv.slice(2);
const maxArg = args.indexOf("--max");
const MAX = maxArg >= 0 ? Number(args[maxArg + 1]) : Infinity;

const STAT_MAP = {
  hp: "hp",
  attack: "attack",
  defense: "defense",
  "special-attack": "spAttack",
  "special-defense": "spDefense",
  speed: "speed",
};

// erratic y fluctuating no están en src/xp.ts todavía; caen en medium_fast por defecto.
const GROWTH_MAP = {
  fast: "fast",
  medium: "medium_fast",
  "medium-slow": "medium_slow",
  slow: "slow",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt === 3) throw new Error(`${res.status} en ${url}`);
    await sleep(500 * attempt);
  }
}

async function fetchSpecies(id) {
  const pokemon = await getJson(`${API}/pokemon/${id}`);
  const species = await getJson(pokemon.species.url);

  const esName = species.names.find((n) => n.language.name === "es")?.name ?? pokemon.name;

  const baseStats = {};
  for (const s of pokemon.stats) baseStats[STAT_MAP[s.stat.name]] = s.base_stat;

  const types = pokemon.types
    .sort((a, b) => a.slot - b.slot)
    .map((t) => t.type.name);

  const learnset = pokemon.moves
    .map((m) => {
      const detail = m.version_group_details.find(
        (d) => d.version_group.name === VERSION_GROUP && d.move_learn_method.name === "level-up",
      );
      return detail ? { level: detail.level_learned_at, move: m.move.name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.level - b.level || a.move.localeCompare(b.move));

  return {
    id: `p${pokemon.id}`,
    nationalId: pokemon.id,
    name: esName,
    englishName: pokemon.name,
    types,
    captureRate: species.capture_rate / 255,
    baseStats,
    learnset,
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${pokemon.id}.png`,
    xpGroup: GROWTH_MAP[species.growth_rate.name] ?? "medium_fast",
  };
}

async function fetchMove(name) {
  const m = await getJson(`${API}/move/${name}`);
  const esName = m.names.find((n) => n.language.name === "es")?.name ?? m.name;
  return {
    id: m.name,
    name: esName,
    type: m.type.name,
    power: m.power ?? 0, // 0 = movimiento de estado (sin daño)
    accuracy: m.accuracy, // null = nunca falla
    pp: m.pp,
    damageClass: m.damage_class.name, // physical | special | status
    priority: m.priority,
  };
}

async function fetchTypeChart() {
  const list = await getJson(`${API}/type?limit=100`);
  const standard = list.results.filter((t) => {
    const n = Number(t.url.split("/").filter(Boolean).pop());
    return n >= 1 && n <= 18;
  });
  const chart = {};
  for (const t of standard) {
    const data = await getJson(t.url);
    const row = {};
    for (const x of data.damage_relations.double_damage_to) row[x.name] = 2;
    for (const x of data.damage_relations.half_damage_to) row[x.name] = 0.5;
    for (const x of data.damage_relations.no_damage_to) row[x.name] = 0;
    chart[data.name] = row; // chart[atacante][defensor] = multiplicador (default 1)
    await sleep(DELAY_MS);
  }
  return chart;
}

async function main() {
  const list = await getJson(`${API}/pokemon?limit=100000`);
  const ids = list.results.map((p) => Number(p.url.split("/").filter(Boolean).pop()));
  const selected = ids.filter((id) => id < 10000).slice(0, MAX);

  const species = [];
  for (const id of selected) {
    try {
      species.push(await fetchSpecies(id));
      console.log(`especie ok ${id}`);
    } catch (err) {
      console.error(`error especie ${id}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  // Movimientos usados por las especies descargadas
  // Movimientos de prueba de data/moves.rules.json (pueden no estar en las iniciales)
  const EXTRA_MOVES = [
    "tackle", "vine-whip", "ember", "water-gun", "flamethrower",
    "hydro-pump", "solar-beam", "earthquake", "self-destruct", "synthesis", "spikes",
  ];
  const moveNames = [...new Set([
    ...species.flatMap((s) => s.learnset.map((l) => l.move)),
    ...EXTRA_MOVES,
  ])];
  const moves = {};
  for (const name of moveNames) {
    try {
      moves[name] = await fetchMove(name);
      console.log(`movimiento ok ${name}`);
    } catch (err) {
      console.error(`error movimiento ${name}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  const types = await fetchTypeChart();

  await writeFile(join(DATA, "species.generated.json"),
    JSON.stringify({ source: "PokeAPI", versionGroup: VERSION_GROUP, species }, null, 2));
  await writeFile(join(DATA, "moves.generated.json"),
    JSON.stringify({ source: "PokeAPI", moves }, null, 2));
  await writeFile(join(DATA, "types.generated.json"),
    JSON.stringify({ source: "PokeAPI", chart: types }, null, 2));

  console.log(`Listo: ${species.length} especies, ${Object.keys(moves).length} movimientos, tabla de tipos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

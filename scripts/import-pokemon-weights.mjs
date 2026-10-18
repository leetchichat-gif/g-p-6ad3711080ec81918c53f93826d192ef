const apiUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiUrl || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.");
}

const csvBase = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const [pokemonCsv, speciesCsv, catalog] = await Promise.all([
  fetchText(`${csvBase}/pokemon.csv`),
  fetchText(`${csvBase}/pokemon_species.csv`),
  fetchCatalog(),
]);
if (catalog.length === 0) throw new Error("No eligible Pokemon were found in pokemon_catalog.");

const pokemonRows = parseCsv(pokemonCsv).map(row => ({
  id: row.id,
  identifier: row.identifier,
  speciesId: row.species_id,
  weightHg: Number(row.weight),
  isDefault: row.is_default === "1",
}));
const speciesRows = parseCsv(speciesCsv);
const speciesById = new Map(speciesRows.map(row => [row.id, row.identifier]));
const bySpecies = new Map();
for (const row of pokemonRows) {
  const bucket = bySpecies.get(row.speciesId) ?? [];
  bucket.push(row);
  bySpecies.set(row.speciesId, bucket);
}

const payload = [];
const unresolved = [];
for (const entry of catalog) {
  const variants = bySpecies.get(String(entry.national_dex)) ?? [];
  const match = matchVariant(entry, variants, speciesById.get(String(entry.national_dex)));
  if (!match || !Number.isFinite(match.weightHg) || match.weightHg <= 0) {
    unresolved.push(`${entry.pokemon_id} · ${entry.display_name} · forme=${entry.form}`);
    continue;
  }
  // PokéAPI stores weight in hectograms; the game stores kilograms.
  payload.push({ pokemon_id: entry.pokemon_id, weight_kg: match.weightHg / 10 });
}

if (unresolved.length) {
  console.error(`Weights not matched for ${unresolved.length} eligible catalog rows:`);
  for (const row of unresolved) console.error(` - ${row}`);
  throw new Error("Nothing was imported. Resolve the listed form names, then run the workflow again.");
}

const response = await fetch(`${apiUrl.replace(/\/$/, "")}/rest/v1/rpc/admin_import_pokemon_weights`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ p_rows: payload }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Supabase import failed (${response.status}): ${body}`);
console.log(`Imported weights for ${payload.length} eligible catalog rows.`);

function matchVariant(entry, variants, speciesName) {
  if (!variants.length) return null;
  const form = normalize(entry.form ?? "standard");
  const defaultForms = new Set(["", "standard", "default", "base", "normal"]);
  if (defaultForms.has(form)) return variants.find(row => row.isDefault) ?? null;

  const pokemonId = normalize(entry.pokemon_id);
  const exactId = variants.find(row => normalize(row.identifier) === pokemonId);
  if (exactId) return exactId;

  const expectedSuffixes = formAliases(form);
  const named = variants.filter(row => {
    const identifier = normalize(row.identifier);
    return expectedSuffixes.some(suffix => identifier.endsWith(suffix));
  });
  if (named.length === 1) return named[0];

  // Some catalogues identify a form in pokemon_id while form is left generic.
  const species = normalize(speciesName ?? "");
  if (species && pokemonId.startsWith(species)) {
    const suffix = pokemonId.slice(species.length);
    const byIdSuffix = variants.find(row => normalize(row.identifier).endsWith(suffix));
    if (byIdSuffix) return byIdSuffix;
  }

  // If PokéAPI has exactly one non-default variant for this species, it is
  // unambiguous. Otherwise fail instead of silently assigning the wrong form.
  const nonDefault = variants.filter(row => !row.isDefault);
  if (nonDefault.length === 1) return nonDefault[0];
  return null;
}

function formAliases(form) {
  const aliases = new Set([form]);
  if (form.includes("alola")) aliases.add("alola");
  const pairs = [
    ["alolan", "alola"], ["alolanform", "alola"], ["hisui", "hisui"],
    ["galarian", "galar"], ["paldean", "paldea"], ["duskmanenecrozma", "dusk-mane"],
  ];
  for (const [from, to] of pairs) if (form.includes(from)) aliases.add(normalize(to));
  return [...aliases].filter(Boolean);
}

function normalize(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchCatalog() {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${apiUrl.replace(/\/$/, "")}/rest/v1/pokemon_catalog`);
    url.searchParams.set("select", "pokemon_id,national_dex,display_name,form");
    url.searchParams.set("eligible", "eq.true");
    url.searchParams.set("order", "national_dex.asc,pokemon_id.asc");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, { headers: { apikey: serviceKey } });
    if (!response.ok) throw new Error(`Could not read catalog (${response.status}): ${await response.text()}`);
    const batch = await response.json();
    all.push(...batch);
    if (batch.length < 1000) return all;
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  return response.text();
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map(line => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value); value = ""; }
    else value += char;
  }
  cells.push(value);
  return cells;
}


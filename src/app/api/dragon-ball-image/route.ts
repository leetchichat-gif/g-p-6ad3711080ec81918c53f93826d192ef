type DragonBallCharacter = { name?: string; image?: string | null };
type JikanCharacter = {
  name?: string;
  nicknames?: string[];
  images?: { jpg?: { image_url?: string | null }; webp?: { image_url?: string | null } };
};

const aliases: Record<string, string[]> = {
  masterroshi: ["Master Roshi", "Muten Roshi", "Kame-Sennin"],
  mutenroshi: ["Master Roshi", "Muten Roshi"],
  frieza: ["Frieza", "Freezer"],
  beerus: ["Beerus", "Bills"],
  belmod: ["Belmod", "Vermoud"],
  sidra: ["Sidra"],
  liquiir: ["Liquiir", "Liquir"],
  grandpriest: ["Grand Priest", "Daishinkan"],
  futurezeno: ["Future Zeno", "Zeno"],
  majinbuu: ["Majin Buu", "Majin Boo"],
  kidbuu: ["Kid Buu", "Pure Buu"],
  tien: ["Tien Shinhan", "Tenshinhan"],
  chiaotzu: ["Chiaotzu", "Chaozu"],
  kingpiccolo: ["King Piccolo", "Piccolo Daimao"],
  android20: ["Android 20", "Dr. Gero"],
  martinu: ["Martinu", "Martyne"],
  rumsshi: ["Rumsshi", "Rummsshi", "Rumoosh"],
  giin: ["Giin", "Geene"],
  mosco: ["Mosco", "Mule"],
  cukatail: ["Cukatail", "Cognac", "Cucatail"],
  korn: ["Korn", "Corn"],
  mojito: ["Mojito", "Mohito"],
  kusu: ["Kusu", "Cus", "Kusu Dragon Ball"],
  marcarita: ["Marcarita", "Marcarita Dragon Ball"],
  awamo: ["Awamo", "Awamo Dragon Ball"],
  campari: ["Campari", "Camparri"],
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function characterRows(payload: unknown): DragonBallCharacter[] {
  if (Array.isArray(payload)) return payload as DragonBallCharacter[];
  if (!payload || typeof payload !== "object") return [];
  const value = payload as { items?: unknown; characters?: unknown; data?: unknown; character?: unknown };
  const nested = value.characters ?? value.items ?? value.data ?? value.character;
  if (Array.isArray(nested)) return nested as DragonBallCharacter[];
  if (nested && typeof nested === "object") return [nested as DragonBallCharacter];
  return [payload as DragonBallCharacter];
}

function findDragonBallImages(rows: DragonBallCharacter[], name: string) {
  const search = normalized(name);
  const exact = rows.find((row) => normalized(row.name ?? "") === search);
  const related = exact ?? rows.find((row) => {
    const candidate = normalized(row.name ?? "");
    return candidate.length >= 4 && (candidate.includes(search) || search.includes(candidate));
  });
  return related?.image && /^https:\/\//i.test(related.image) ? [related.image] : [];
}

async function dragonBallImages(name: string) {
  try {
    // The full paged catalog is more dependable than the provider's name filter for aliases.
    const response = await fetch("https://dragonball-api.com/api/characters?limit=100", {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    return findDragonBallImages(characterRows(await response.json()), name);
  } catch {
    return [];
  }
}

async function jikanImages(name: string) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=10`, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: JikanCharacter[] };
    const rows = payload.data ?? [];
    const exact = rows.filter((row) => [row.name, ...(row.nicknames ?? [])]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalized(value) === normalized(name)));
    const candidates = [...exact, ...rows.filter((row) => !exact.includes(row))]
      .map((row) => row.images?.webp?.image_url ?? row.images?.jpg?.image_url)
      .filter((image): image is string => typeof image === "string" && /^https:\/\//i.test(image));
    return [...new Set(candidates)];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 100) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  const candidates: string[] = [];
  for (const search of aliases[normalized(name)] ?? [name]) {
    candidates.push(...await dragonBallImages(search));
    candidates.push(...await jikanImages(search));
    if (candidates.length >= 4) break;
  }
  const imageUrls = [...new Set(candidates)];
  return Response.json({ image_url: imageUrls[0] ?? null, image_urls: imageUrls }, {
    headers: { "Cache-Control": imageUrls.length ? "public, max-age=86400, stale-while-revalidate=604800" : "no-store" },
  });
}

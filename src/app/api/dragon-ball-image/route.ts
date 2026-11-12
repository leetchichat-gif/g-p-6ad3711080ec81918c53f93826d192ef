type DragonBallCharacter = {
  name?: string;
  image?: string | null;
};

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
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function asCharacters(payload: unknown): DragonBallCharacter[] {
  if (Array.isArray(payload)) return payload as DragonBallCharacter[];
  if (!payload || typeof payload !== "object") return [];
  const value = payload as { items?: unknown; characters?: unknown; data?: unknown; character?: unknown };
  const nested = value.characters ?? value.items ?? value.data ?? value.character;
  if (Array.isArray(nested)) return nested as DragonBallCharacter[];
  if (nested && typeof nested === "object") return [nested as DragonBallCharacter];
  return [payload as DragonBallCharacter];
}

async function dragonBallImage(name: string) {
  try {
    const response = await fetch(`https://dragonball-api.com/api/characters?name=${encodeURIComponent(name)}`, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const rows = asCharacters(await response.json());
    const match = rows.find((row) => normalized(row.name ?? "") === normalized(name)) ?? rows[0];
    const image = match?.image;
    return typeof image === "string" && /^https:\/\//i.test(image) ? image : null;
  } catch {
    return null;
  }
}

async function jikanImage(name: string) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=10`, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: JikanCharacter[] };
    const rows = payload.data ?? [];
    const match = rows.find((row) => [row.name, ...(row.nicknames ?? [])]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalized(value) === normalized(name))) ?? rows[0];
    const image = match?.images?.webp?.image_url ?? match?.images?.jpg?.image_url;
    return typeof image === "string" && /^https:\/\//i.test(image) ? image : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 100) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  for (const search of aliases[normalized(name)] ?? [name]) {
    const image = await dragonBallImage(search) ?? await jikanImage(search);
    if (image) {
      return Response.json({ image_url: image }, {
        headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
      });
    }
  }

  return Response.json({ image_url: null }, { headers: { "Cache-Control": "no-store" } });
}

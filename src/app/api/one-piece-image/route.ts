type CharacterName = string | { en?: string; romaji?: string; jp?: string } | null;
type OnePieceApiCharacter = { name?: CharacterName; image_url?: string | null };
type JikanCharacter = {
  name?: string;
  nicknames?: string[];
  images?: { jpg?: { image_url?: string | null } };
};

const aliases: Record<string, string[]> = {
  trafalgarlaw: ["Trafalgar D. Water Law", "Trafalgar Law", "Law"],
  blackbeard: ["Marshall D. Teach", "Blackbeard", "Teach"],
  bonclay: ["Bentham", "Bon Clay", "Bon Kurei", "Mr. 2 Bon Clay"],
  edwardnewgate: ["Edward Newgate", "Whitebeard"],
  goldroger: ["Gol D. Roger", "Gold Roger", "Gold D. Roger"],
  bigmom: ["Charlotte Linlin", "Big Mom"],
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function isHttpsImage(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 80) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  const names = aliases[normalized(name)] ?? [name];
  for (const search of names) {
    try {
      const response = await fetch(
        `https://onepieceapi.com/api/characters?q=${encodeURIComponent(search)}&limit=10`,
        { next: { revalidate: 86400 } },
      );
      if (!response.ok) continue;
      const rows = await response.json() as OnePieceApiCharacter[];
      if (!Array.isArray(rows)) continue;

      const match = rows.find((row) => {
        const apiName = typeof row.name === "string" ? row.name : row.name?.en ?? row.name?.romaji ?? "";
        return normalized(apiName) === normalized(search) && isHttpsImage(row.image_url);
      });
      if (match?.image_url) return imageResponse(match.image_url);
    } catch { /* Try the next known name. */ }
  }

  // A second character catalog covers common aliases that the first one may not index.
  for (const search of names) {
    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(search)}&limit=10`,
        { next: { revalidate: 86400 } },
      );
      if (!response.ok) continue;
      const payload = await response.json() as { data?: JikanCharacter[] };
      const match = payload.data?.find((character) => {
        const candidates = [character.name, ...(character.nicknames ?? [])].filter((value): value is string => Boolean(value));
        return candidates.some((candidate) => normalized(candidate) === normalized(search))
          && isHttpsImage(character.images?.jpg?.image_url);
      });
      const imageUrl = match?.images?.jpg?.image_url;
      if (isHttpsImage(imageUrl)) return imageResponse(imageUrl);
    } catch { /* Keep trying aliases; the UI has a portrait placeholder. */ }
  }

  return Response.json({ image_url: null }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

function imageResponse(imageUrl: string) {
  return Response.json({ image_url: imageUrl }, {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}

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
      if (match?.image_url) {
        const result = await imageResponse(match.image_url);
        if (result) return result;
      }
    } catch { /* Try the next known name. */ }
  }

  // A second character catalog covers common aliases that the first one may not index.
  for (const search of names) {
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(
          `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(search)}&limit=10`,
          { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) },
        );
        if (response.status !== 429 || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      if (!response?.ok) continue;
      const payload = await response.json() as { data?: JikanCharacter[] };
      const match = payload.data?.find((character) => {
        const candidates = [character.name, ...(character.nicknames ?? [])].filter((value): value is string => Boolean(value));
        return candidates.some((candidate) => normalized(candidate) === normalized(search))
          && isHttpsImage(character.images?.jpg?.image_url);
      });
      const imageUrl = match?.images?.jpg?.image_url;
      if (isHttpsImage(imageUrl)) {
        const result = await imageResponse(imageUrl);
        if (result) return result;
      }
    } catch { /* Keep trying aliases; the UI has a portrait placeholder. */ }
  }

  return Response.json({ image_url: null }, { headers: { "Cache-Control": "no-store" } });
}

async function imageResponse(imageUrl: string) {
  const correctedUrl = currentProjectStorageUrl(imageUrl);
  if (correctedUrl !== imageUrl) {
    try {
      const check = await fetch(correctedUrl, {
        method: "HEAD",
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(5000),
      });
      if (!check.ok) return null;
    } catch {
      return null;
    }
  }
  return Response.json({ image_url: correctedUrl }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function currentProjectStorageUrl(imageUrl: string) {
  const currentProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!currentProjectUrl) return imageUrl;
  try {
    const image = new URL(imageUrl);
    const project = new URL(currentProjectUrl);
    if (image.hostname.endsWith(".supabase.co")
      && image.pathname.startsWith("/storage/v1/object/public/")) {
      image.protocol = project.protocol;
      image.host = project.host;
      return image.toString();
    }
  } catch { /* Keep the source URL if either address is malformed. */ }
  return imageUrl;
}

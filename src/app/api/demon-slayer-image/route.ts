type JikanCharacter = {
  name?: string;
  nicknames?: string[];
  images?: { jpg?: { image_url?: string | null } };
};

const aliases: Record<string, string[]> = {
  tanjirokamado: ["Tanjiro Kamado", "Tanjirou Kamado", "Kamado Tanjiro"],
  yoriichitsugikuni: ["Yoriichi Tsugikuni", "Tsugikuni Yoriichi"],
  sakonjiurokodaki: ["Sakonji Urokodaki", "Urokodaki Sakonji"],
  jigorokuwajima: ["Jigoro Kuwajima", "Kuwajima Jigoro"],
  muichirotokito: ["Muichiro Tokito", "Muichirou Tokitou", "Tokito Muichiro"],
  kyojurorengoku: ["Kyojuro Rengoku", "Kyoujurou Rengoku", "Rengoku Kyojuro"],
  giyutomioka: ["Giyu Tomioka", "Giyuu Tomioka", "Tomioka Giyu"],
  kyogai: ["Kyogai", "Kyogai Tsuzumi Demon"],
  handdemon: ["Hand Demon", "Temari Demon"],
  swampdemon: ["Swamp Demon", "沼の鬼"],
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/ou/g, "o").replace(/[^a-z0-9]/g, "");
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 100) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  const searches = aliases[normalized(name)] ?? [name];
  for (const search of searches) {
    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(search)}&limit=10`,
        { next: { revalidate: 86400 }, headers: { Accept: "application/json", "User-Agent": "PokeDraft character portraits" } },
      );
      if (!response.ok) continue;
      const payload = await response.json() as { data?: JikanCharacter[] };
      const rows = payload.data ?? [];
      const exact = rows.find((character) => {
        const names = [character.name, ...(character.nicknames ?? [])]
          .filter((value): value is string => Boolean(value));
        return names.some((candidate) => normalized(candidate) === normalized(search))
          && typeof character.images?.jpg?.image_url === "string"
          && character.images.jpg.image_url.startsWith("https://");
      });
      // Jikan sometimes returns the same character with another romanization.
      // Since the query is already the curated full character name, its first image is the safe fallback.
      const match = exact ?? rows.find((character) => typeof character.images?.jpg?.image_url === "string");
      const imageUrl = match?.images?.jpg?.image_url;
      if (typeof imageUrl === "string" && imageUrl.startsWith("https://")) {
        return Response.json({ image_url: imageUrl }, {
          headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
        });
      }
    } catch {
      // Try the next spelling; the UI shows a readable name even without a portrait.
    }
  }

  return Response.json({ image_url: null }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

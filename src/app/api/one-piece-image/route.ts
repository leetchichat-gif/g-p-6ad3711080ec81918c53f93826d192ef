type CharacterName = string | { en?: string; romaji?: string; jp?: string } | null;
type ApiCharacter = { name?: CharacterName; image_url?: string | null };

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 80) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  try {
    const url = `https://onepieceapi.com/api/characters?q=${encodeURIComponent(name)}&limit=10`;
    const response = await fetch(url, { next: { revalidate: 86400 } });
    if (!response.ok) return Response.json({ image_url: null }, { status: 200 });
    const rows = await response.json() as ApiCharacter[];
    if (!Array.isArray(rows)) return Response.json({ image_url: null }, { status: 200 });

    const exact = rows.find((row) => {
      const apiName = typeof row.name === "string" ? row.name : row.name?.en ?? row.name?.romaji ?? "";
      return normalized(apiName) === normalized(name) && row.image_url;
    });
    const fallback = exact ?? rows.find((row) => row.image_url);
    const imageUrl = fallback?.image_url;
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      return Response.json({ image_url: null }, { status: 200 });
    }
    return Response.json({ image_url: imageUrl ?? null }, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
  } catch {
    return Response.json({ image_url: null }, { status: 200 });
  }
}


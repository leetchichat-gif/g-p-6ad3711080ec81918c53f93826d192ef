type FandomPage = { title?: string; thumbnail?: { source?: string } };
type JikanCharacter = {
  name?: string;
  nicknames?: string[];
  images?: { jpg?: { image_url?: string | null }; webp?: { image_url?: string | null } };
};
type AniListCharacter = { name?: { full?: string | null }; image?: { large?: string | null } };

const aliases: Record<string, string[]> = {
  yujiitadori: ["Yuji Itadori", "Yuuji Itadori"],
  ryomensukuna: ["Ryomen Sukuna", "Sukuna"],
  megumifushiguro: ["Megumi Fushiguro"],
  nobarakugisaki: ["Nobara Kugisaki"],
  satorugojo: ["Satoru Gojo", "Gojo Satoru"],
  sugurugeto: ["Suguru Geto", "Geto Suguru"],
  yutaokkotsu: ["Yuta Okkotsu"],
  togeinumaki: ["Toge Inumaki"],
  kentonanami: ["Kento Nanami", "Nanami Kento"],
  kokichimuta: ["Kokichi Muta", "Mechamaru"],
  mastertengen: ["Master Tengen", "Tengen"],
  hanakurusu: ["Hana Kurusu", "Angel"],
  mahoraga: ["Mahoraga", "Eight-Handled Sword Divergent Sila Divine General Mahoraga"],
  ryuishigori: ["Ryu Ishigori", "Ryu Ishigoori"],
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

async function aniListImages(name: string) {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($search: String!) { Character(search: $search) { name { full } image { large } } }",
        variables: { search: name },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { Character?: AniListCharacter | null } };
    const image = payload.data?.Character?.image?.large;
    return typeof image === "string" && /^https:\/\//i.test(image) ? [image] : [];
  } catch {
    return [];
  }
}

async function fandomImages(name: string) {
  try {
    const query = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", generator: "search",
      gsrsearch: name, gsrnamespace: "0", gsrlimit: "8", prop: "pageimages",
      piprop: "thumbnail", pithumbsize: "600", redirects: "1",
    });
    const response = await fetch(`https://jujutsu-kaisen.fandom.com/api.php?${query.toString()}`, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json", "User-Agent": "PokeDraft/1.0 (character portraits)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { query?: { pages?: FandomPage[] | Record<string, FandomPage> } };
    const raw = payload.query?.pages;
    const pages: FandomPage[] = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    const exact = pages.filter((page) => normalized(page.title ?? "") === normalized(name));
    const ordered = [...exact, ...pages.filter((page) => !exact.includes(page))];
    return [...new Set(ordered.map((page) => page.thumbnail?.source)
      .filter((image): image is string => typeof image === "string" && /^https:\/\//i.test(image)))];
  } catch {
    return [];
  }
}

async function jikanImages(name: string) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=10`, {
      next: { revalidate: 86400 }, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000),
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
  if (!name || name.length > 100) return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });

  const candidates: string[] = [];
  const shortName = name.replace(/\s+jujutsu kaisen$/i, "").trim();
  for (const search of aliases[normalized(name)] ?? aliases[normalized(shortName)] ?? [shortName]) {
    candidates.push(...await aniListImages(search));
    candidates.push(...await fandomImages(search));
    candidates.push(...await jikanImages(search));
    if (candidates.length >= 6) break;
  }
  const imageUrls = [...new Set(candidates)];
  return Response.json({ image_url: imageUrls[0] ?? null, image_urls: imageUrls }, {
    headers: { "Cache-Control": imageUrls.length ? "public, max-age=86400, stale-while-revalidate=604800" : "no-store" },
  });
}

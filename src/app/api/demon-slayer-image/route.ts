type JikanCharacter = {
  name?: string;
  nicknames?: string[];
  images?: {
    jpg?: { image_url?: string | null };
    webp?: { image_url?: string | null; small_image_url?: string | null };
  };
};

const aliases: Record<string, string[]> = {
  tanjirokamado: ["Tanjiro Kamado", "Tanjirou Kamado", "Kamado Tanjiro"],
  tanjirodemonking: ["Tanjiro Kamado", "Demon King Tanjiro", "Demon Tanjiro"],
  yoriichitsugikuni: ["Yoriichi Tsugikuni", "Tsugikuni Yoriichi"],
  sakonjiurokodaki: ["Sakonji Urokodaki", "Urokodaki Sakonji"],
  jigorokuwajima: ["Jigoro Kuwajima", "Kuwajima Jigoro"],
  muichirotokito: ["Muichiro Tokito", "Muichirou Tokitou", "Tokito Muichiro"],
  kyojurorengoku: ["Kyojuro Rengoku", "Kyoujurou Rengoku", "Rengoku Kyojuro"],
  giyutomioka: ["Giyu Tomioka", "Giyuu Tomioka", "Tomioka Giyu"],
  gyomeihimejima: ["Gyomei Himejima", "Himejima Gyomei"],
  shinobukocho: ["Shinobu Kocho", "Shinobu Kochou"],
  obanaiiguro: ["Obanai Iguro", "Iguro Obanai"],
  mitsurikanroji: ["Mitsuri Kanroji", "Kanroji Mitsuri"],
  muzan: ["Muzan Kibutsuji", "Kibutsuji Muzan"],
  hantengu: ["Hantengu", "Hantengu Demon Slayer"],
  gyokko: ["Gyokko", "Gyokko Demon Slayer"],
  nakime: ["Nakime", "Nakime Demon Slayer"],
  kaigaku: ["Kaigaku", "Kaigaku Demon Slayer"],
  yahaba: ["Yahaba", "Yahaba Demon Slayer"],
  handdemon: ["Hand Demon", "Temari Demon"],
  swampdemon: ["Swamp Demon", "Swamp Demon Kimetsu no Yaiba"],
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/ou/g, "o").replace(/[^a-z0-9]/g, "");
}

function imageOf(character: JikanCharacter) {
  return character.images?.webp?.image_url
    ?? character.images?.jpg?.image_url
    ?? character.images?.webp?.small_image_url;
}

let jikanQueue: Promise<void> = Promise.resolve();

function queuedFetch(url: string) {
  const response = jikanQueue.then(async () => {
    // Keep the burst from the team/history cards below Jikan's public API rate limit.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "PokeDraft/1.0 (character image lookup)" },
      signal: AbortSignal.timeout(8000),
    });
  });
  jikanQueue = response.then(() => undefined, () => undefined);
  return response;
}

async function searchJikan(search: string) {
  const url = `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(search)}&limit=10`;
  // Jikan rate-limits bursts. Retry transient throttling instead of caching an empty result.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await queuedFetch(url);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 900 * (attempt + 1)));
          continue;
        }
        return [];
      }
      if (!response.ok) return [];
      const payload = await response.json() as { data?: JikanCharacter[] };
      return payload.data ?? [];
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  return [];
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 100) {
    return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  }

  const searches = aliases[normalized(name)] ?? [name];
  for (const search of searches) {
    const rows = await searchJikan(search);
    const usable = rows.filter((character) => {
      const image = imageOf(character);
      return typeof image === "string" && /^https:\/\//i.test(image);
    });
    const exact = usable.find((character) => [character.name, ...(character.nicknames ?? [])]
      .filter((value): value is string => Boolean(value))
      .some((candidate) => normalized(candidate) === normalized(search)));
    const imageUrl = imageOf(exact ?? usable[0] ?? {});
    if (typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)) {
      return Response.json({ image_url: imageUrl }, {
        headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
      });
    }
  }

  // Do not cache failures: a transient Jikan rate limit must not hide portraits for an hour.
  return Response.json({ image_url: null }, { headers: { "Cache-Control": "no-store" } });
}

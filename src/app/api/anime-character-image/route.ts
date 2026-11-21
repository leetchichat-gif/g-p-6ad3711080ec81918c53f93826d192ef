type ImageResult = { image_url: string | null; image_urls: string[] };
type JikanCharacter = { name?: string; nicknames?: string[]; images?: { webp?: { image_url?: string | null }; jpg?: { image_url?: string | null } } };

const aliases: Record<string, string[]> = {
  rimurutempest: ["Rimuru Tempest", "Rimuru"], anosvoldigoad: ["Anos Voldigoad"],
  wanglingthedailyoftheimmortalking: ["Wang Ling", "Wang Ling The Daily Life of the Immortal King"],
  gilgameshfate: ["Gilgamesh Fate", "Gilgamesh"], artoriapendragonfate: ["Artoria Pendragon", "Saber Fate Stay Night", "Saber"],
  simongurrenlagann: ["Simon the Digger", "Simon Gurren Lagann"], antispiralgurrenlagann: ["Anti-Spiral", "Antispiral Gurren Lagann"],
  saitamaonepunchman: ["Saitama One Punch Man", "Saitama"], cosmicfeargarouonepunchman: ["Garou Cosmic Fear Mode", "Garou One Punch Man", "Garou"],
  zenodragonballsuper: ["Zeno", "Zen-Oh"], yhwachbleach: ["Yhwach", "Juha Bach"], soulkingbleach: ["Soul King", "Reio"],
  sosukeaizenbleach: ["Sosuke Aizen", "Sousuke Aizen"], ricksanchezrickandmorty: ["Rick Sanchez"],
  "alcorrez ero lostinmemories": ["Alcor", "Alcor Re Zero"], "subarunatsukirez ero": ["Subaru Natsuki", "Natsuki Subaru"],
  "son gokudragonball": ["Son Goku", "Goku"], friezadragonball: ["Frieza", "Freeza"], beerusdragonballsuper: ["Beerus", "Bills"],
  "madarau chihanaruto": ["Madara Uchiha", "Madara"], kaguyaotsutsukinaruto: ["Kaguya Otsutsuki", "Kaguya"],
  narutouzumakinaruto: ["Naruto Uzumaki", "Naruto"], sasukeuchihanaruto: ["Sasuke Uchiha", "Sasuke"],
  ichigokurosakibleach: ["Ichigo Kurosaki", "Ichigo"], ichibehyosubebleach: ["Ichibe Hyosube", "Ichibei Hyosube"],
  "satorugoj ojujutsukaisen": ["Satoru Gojo", "Gojo Satoru"], ryomensukunajujutsukaisen: ["Ryomen Sukuna", "Sukuna"],
  yutaokkotsujujutsukaisen: ["Yuta Okkotsu"], shigeokageyamamobpsycho100: ["Shigeo Kageyama", "Mob"],
  alucardhellsing: ["Alucard Hellsing", "Alucard"], giornogiovannijojo: ["Giorno Giovanna"], diobrandojojo: ["Dio Brando", "DIO"],
  "jotarukuj ojo": ["Jotaro Kujo"], ainzooalgownoverlord: ["Ainz Ooal Gown", "Momonga"],
  "reinhardvanast rearez ero": ["Reinhard van Astrea"], "satellarez ero": ["Satella", "Witch of Envy"],
  sungjinwoosololeveling: ["Sung Jinwoo", "Sung Jin-Woo"], milimnavatensura: ["Milim Nava", "Milim"],
  veldoratempesttensura: ["Veldora Tempest", "Veldora"], "accelerator acertainmagicalindex": ["Accelerator Toaru", "Accelerator"],
  kamijoutoumaacertainmagicalindex: ["Kamijou Touma", "Touma Kamijou"], natsudragneelfairytail: ["Natsu Dragneel"],
  acnologiafairytail: ["Acnologia"], zerefdragneelfairytail: ["Zeref Dragneel", "Zeref"],
  gonfreecsshunterxhunter: ["Gon Freecss", "Gon"], "tatsumakione punchman": ["Tatsumaki One Punch Man", "Tatsumaki"],
  borosonepunchman: ["Boros One Punch Man", "Boros"], muzankibutsujidemonslayer: ["Muzan Kibutsuji"],
  yoriichitsugikunidemonslayer: ["Yoriichi Tsugikuni"], tanjirokamadodemonslayer: ["Tanjiro Kamado"],
  izukumidoriyamyheroacademia: ["Izuku Midoriya", "Deku"], tomurashigarakimyheroacademia: ["Tomura Shigaraki"],
  "pegasusseiy asaintseiya": ["Pegasus Seiya", "Seiya"], "usagitsukin osailormoon": ["Usagi Tsukino", "Sailor Moon"],
  homuraakemimadokamagica: ["Homura Akemi"], madokakanamemadokamagica: ["Madoka Kaname"],
  erenyeagerattackontitan: ["Eren Yeager", "Eren Jaeger"], allforonemyheroacademia: ["All For One"],
};

function normalized(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""); }

async function aniListImage(query: string): Promise<string | null> {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: "query ($search: String!) { Character(search: $search) { name { full alternative } image { large } } }", variables: { search: query } }),
      next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { Character?: { name?: { full?: string | null; alternative?: string[] | null }; image?: { large?: string | null } } | null } };
    const character = payload.data?.Character;
    const image = character?.image?.large;
    const names = [character?.name?.full, ...(character?.name?.alternative ?? [])].filter((value): value is string => Boolean(value));
    if (!image || (!names.some((value) => normalized(value) === normalized(query)) && !query.includes(" "))) return null;
    return /^https:\/\//i.test(image) ? image : null;
  } catch { return null; }
}

async function jikanImages(query: string): Promise<string[]> {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=10`, {
      next: { revalidate: 86400 }, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: JikanCharacter[] };
    const rows = payload.data ?? [];
    const exact = rows.filter((row) => [row.name, ...(row.nicknames ?? [])].some((value) => value && normalized(value) === normalized(query)));
    return [...new Set([...exact, ...rows.filter((row) => !exact.includes(row))].map((row) => row.images?.webp?.image_url ?? row.images?.jpg?.image_url)
      .filter((value): value is string => typeof value === "string" && /^https:\/\//i.test(value)))];
  } catch { return []; }
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 120) return Response.json({ error: "Nom de personnage invalide" }, { status: 400 });
  const alias = Object.entries(aliases).find(([key]) => normalized(key) === normalized(name));
  const queries = alias?.[1] ?? [name];
  const images: string[] = [];
  for (const query of queries) {
    const aniList = await aniListImage(query);
    if (aniList) images.push(aniList);
    if (!images.length) images.push(...await jikanImages(query));
    if (images.length) break;
  }
  const image_urls = [...new Set(images)];
  const result: ImageResult = { image_url: image_urls[0] ?? null, image_urls };
  return Response.json(result, { headers: { "Cache-Control": image_urls.length ? "public, max-age=86400, stale-while-revalidate=604800" : "public, max-age=3600" } });
}

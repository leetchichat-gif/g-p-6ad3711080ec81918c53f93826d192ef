export type Player = { user_id: string; nickname: string; ready: boolean; online: boolean; seat: number; budget: number };
export type Pokemon = { id: string; name: string; display_name: string; showdown_name: string; form: string; types: string[]; sprite: string; national_dex: number };
export type PublicBid = { id: string; user_id: string; nickname: string; amount: number; created_at: string };
export type RoomState = {
  room: { id: string; code: string; status: "waiting" | "active" | "finished" | "abandoned"; mode: "turn_based" | "blind" | "clue_roulette"; round_no: number; round_total: number; opens_at: string | null; deadline_at: string | null; admin_round: boolean; current_turn_user_id: string | null; current_price: number; current_pokemon: Pokemon | null; starter_user_id: string | null; clue: { number: 1 | 2 | 3 | 4 | 5 | 6; label: string; value?: string | number | string[] | null; unit?: string; weight_kg?: number | null; types?: string[] } | null; result: { winner_id: string | null; price: number } | null };
  players: Player[]; bids: PublicBid[]; user_id: string; collection: Array<{pokemon:Pokemon; owner_id:string; owner_name:string; price:number}>;
};

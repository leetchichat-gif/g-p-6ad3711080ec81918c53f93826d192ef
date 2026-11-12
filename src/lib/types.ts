export type Player = { user_id: string; nickname: string; ready: boolean; online: boolean; seat: number; budget: number };
export type Pokemon = { id: string; name: string; display_name: string; showdown_name: string; form: string; types: string[]; sprite: string; national_dex: number };
export type PublicBid = { id: string; user_id: string; nickname: string; amount: number; created_at: string };
export type OnePieceCharacter = { id: string; name: string; search_name?: string };
export type OnePieceDraftState = {
  phase: "draw" | "offering" | "autopick" | "finished";
  turn_no: number;
  drawer_user_id: string;
  decision_user_id: string;
  is_drawer: boolean;
  is_decision_player: boolean;
  autopick_user_id: string | null;
  autopick_at: string | null;
  current_character: OnePieceCharacter | null;
  teams: Array<{ user_id: string; nickname: string; characters: OnePieceCharacter[] }>;
  history: Array<{ turn_no: number; id: string; name: string; search_name?: string; drawer_user_id: string; decision_user_id: string; accepted: boolean; owner_id: string | null }>;
};
export type RoomState = {
  room: { id: string; code: string; status: "waiting" | "active" | "finished" | "abandoned"; mode: "turn_based" | "blind" | "clue_roulette" | "one_piece_draft" | "demon_slayer_draft" | "dragon_ball_draft"; round_no: number; round_total: number; opens_at: string | null; deadline_at: string | null; admin_round: boolean; current_turn_user_id: string | null; current_price: number; current_pokemon: Pokemon | null; starter_user_id: string | null; clue: { number: 1 | 2 | 3 | 4 | 5 | 6; label: string; value?: string | number | string[] | null; unit?: string; weight_kg?: number | null; types?: string[] } | null; result: { winner_id: string | null; price: number } | null };
  players: Player[]; bids: PublicBid[]; user_id: string; collection: Array<{pokemon:Pokemon; owner_id:string; owner_name:string; price:number}>;
  one_piece?: OnePieceDraftState | null;
  demon_slayer?: OnePieceDraftState | null;
  dragon_ball?: OnePieceDraftState | null;
};

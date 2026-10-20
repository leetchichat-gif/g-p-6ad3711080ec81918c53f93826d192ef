"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clipboard, DoorOpen, Eye, RefreshCw, Search, ShieldCheck, Shuffle } from "lucide-react";
import { ensureIdentity, getSupabase, rpc } from "@/lib/supabase";

const ROOM_KEY = "pokedraft-spectator-room-id";
const NICK_KEY = "pokedraft-nickname";
const money = new Intl.NumberFormat("fr-FR");

type SpectatorPokemon = {
  id: string;
  national_dex: number;
  display_name: string;
  form: string;
  types: string[];
  sprite: string;
  weight_kg: number | null;
};

type SpectatorState = {
  user_id: string;
  role: "spectator" | "admin";
  room: {
    id: string;
    code: string;
    status: "waiting" | "active" | "finished" | "abandoned";
    mode: "turn_based" | "blind" | "clue_roulette";
    round_no: number;
    round_total: number;
    deadline_at: string | null;
    current_price: number | null;
    admin_round: boolean;
    next_admin_round: boolean;
    next_admin_pokemon: SpectatorPokemon | null;
    current_pokemon: SpectatorPokemon | null;
  };
  players: Array<{ user_id: string; nickname: string; seat: number; ready: boolean; budget: number }>;
  spectator_count: number;
};

type PokemonChoice = {
  pokemon_id: string;
  national_dex: number;
  display_name: string;
  form: string;
  types: string[];
  sprite_url: string;
};

export default function SpectatorPage() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomId, setRoomId] = useState("");
  const [state, setState] = useState<SpectatorState | null>(null);
  const [adminCode, setAdminCode] = useState("");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<PokemonChoice[]>([]);
  const [adminRoundSelecting, setAdminRoundSelecting] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (id: string) => {
    const result = await rpc<SpectatorState>("get_spectator_room_state", { p_room: id });
    setState(result);
  }, []);

  useEffect(() => {
    const savedName = localStorage.getItem(NICK_KEY);
    if (savedName) setNickname(savedName);

    const params = new URLSearchParams(location.search);
    const inviteCode = params.get("room");
    if (inviteCode) {
      setRoomCode(inviteCode.toUpperCase());
      localStorage.removeItem(ROOM_KEY);
    }

    ensureIdentity()
      .then(() => setIdentityReady(true))
      .catch((cause) => setError(errorText(cause)));

    const savedRoom = inviteCode ? null : localStorage.getItem(ROOM_KEY);
    if (savedRoom) {
      setRoomId(savedRoom);
      void refresh(savedRoom).catch(() => {
        localStorage.removeItem(ROOM_KEY);
        setRoomId("");
      });
    }
  }, [refresh]);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => {
      void refresh(roomId).catch((cause) => setError(errorText(cause)));
    }, 2500);
    return () => clearInterval(timer);
  }, [roomId, refresh]);

  const joinAsSpectator = async () => {
    const cleanName = nickname.trim();
    if (cleanName.length < 2) {
      setError("Choisis un pseudo de 2 caractères minimum.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      localStorage.setItem(NICK_KEY, cleanName);
      const id = await rpc<string>("join_room_as_spectator", {
        p_code: roomCode,
        p_nickname: cleanName,
      });
      localStorage.setItem(ROOM_KEY, id);
      setRoomId(id);
      await refresh(id);
      setNotice("Tu as rejoint le salon comme spectateur.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const becomeAdmin = async () => {
    if (!state) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expirée. Recharge la page et réessaie.");

      const response = await fetch("/api/spectator/promote", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId: state.room.id, code: adminCode }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Impossible d’activer l’administration.");

      setAdminCode("");
      await refresh(state.room.id);
      setNotice("Mode administrateur activé.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const searchPokemon = async () => {
    if (!state) return;
    setLoading(true);
    setError("");
    try {
      const found = await rpc<PokemonChoice[]>(adminRoundSelecting ? "search_admin_round_pokemon" : "search_spectator_pokemon", {
        p_room: state.room.id,
        p_query: query.trim(),
      });
      setChoices(found);
      if (found.length === 0) setNotice("Aucun Pokémon disponible ne correspond à la recherche.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const changePokemon = async (pokemonId: string | null) => {
    if (!state) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await rpc<SpectatorPokemon>("admin_change_current_pokemon", {
        p_room: state.room.id,
        p_pokemon_id: pokemonId,
      });
      setChoices([]);
      await refresh(state.room.id);
      setNotice("Pokémon du lot modifié.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const startAdminRound = async (pokemonId: string) => {
    if (!state) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await rpc("admin_queue_round", { p_room: state.room.id, p_pokemon_id: pokemonId });
      setChoices([]);
      setAdminRoundSelecting(false);
      await refresh(state.room.id);
      setNotice("Prochaine manche programmée en mode administrateur : aucun indice et aucun timer.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const leave = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      await rpc("leave_room_as_spectator", { p_room: roomId });
      localStorage.removeItem(ROOM_KEY);
      setRoomId("");
      setState(null);
      setChoices([]);
      setAdminRoundSelecting(false);
      setNotice("Tu as quitté le salon.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(label + " copié.");
    } catch {
      setError("Le presse-papiers n’est pas accessible sur cet appareil.");
    }
  };

  return (
    <main className="ambient">
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">✦</span>
            <span>POKÉ<span className="gradient-text">DRAFT</span></span>
          </a>
          <span className="pill"><Eye size={14} style={{ display: "inline", verticalAlign: "-3px", marginRight: 5 }} /> MODE SPECTATEUR</span>
        </header>

        {!state ? (
          <>
            <section className="hero">
              <div className="eyebrow">Observer la partie</div>
              <h1>Dans les coulisses<br /><span className="gradient-text">des enchères.</span></h1>
              <p className="subtitle">Le spectateur voit le Pokémon du lot et l’état de la partie. Il ne peut ni miser ni modifier le jeu sans le code administrateur.</p>
            </section>
            <section className="panel lobby">
              <label className="field-label" htmlFor="spectator-name">Ton pseudo</label>
              <input className="input" id="spectator-name" value={nickname} maxLength={20} placeholder="Ex. Ondine" onChange={(event) => setNickname(event.target.value)} />
              <label className="field-label" htmlFor="spectator-code">Code du salon</label>
              <input className="input" id="spectator-code" value={roomCode} maxLength={8} placeholder="Ex. 4F8A21C0" onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
              <button className="btn primary wide" onClick={() => void joinAsSpectator()} disabled={loading || !identityReady || roomCode.trim().length < 6}>
                Rejoindre comme spectateur <ArrowRight size={16} style={{ display: "inline", verticalAlign: "-3px" }} />
              </button>
              {error && <p className="notice error">{error}</p>}
              {notice && <p className="notice">{notice}</p>}
              <p className="hint" style={{ marginTop: 14 }}>Un salon accepte jusqu’à 20 spectateurs. Ils ne prennent pas de place parmi les deux joueurs.</p>
            </section>
          </>
        ) : (
          <>
            <div className="room-header">
              <div>
                <div className="eyebrow">{state.room.status === "waiting" ? "Salle d’attente" : state.room.status === "finished" ? "Partie terminée" : "Enchère en cours"}</div>
                <h1>Salon <span className="gradient-text">{state.room.code}</span></h1>
                <span className="pill">{state.role === "admin" ? "🛡️ Administrateur" : "👁️ Spectateur"} · {state.spectator_count} spectateur{state.spectator_count === 1 ? "" : "s"}</span>
              </div>
              <div className="copy-row">
                <button className="btn secondary" onClick={() => void copy(location.origin + "/spectator?room=" + state.room.code, "Lien spectateur")}><Clipboard size={15} style={{ display: "inline", verticalAlign: "-3px" }} /> Inviter un spectateur</button>
                <button className="btn secondary" onClick={() => void leave()} aria-label="Quitter le salon"><DoorOpen size={16} /></button>
              </div>
            </div>

            {error && <p className="notice error">{error}</p>}
            {notice && <p className="notice">{notice}</p>}

            <section className="game-grid">
              <article className="panel pokemon-card">
                <div className="lot">
                  <span>LOT {state.room.round_no}/{state.room.round_total}</span>
                  <span className="timer">{money.format(state.room.current_price ?? 0)} P$</span>
                </div>
                {state.room.current_pokemon ? (
                  <>
                    <div className="pokemon-art"><img src={state.room.current_pokemon.sprite} alt={state.room.current_pokemon.display_name} /></div>
                    <h2 className="pokemon-name">{state.room.current_pokemon.display_name}</h2>
                    {state.room.current_pokemon.form !== "standard" && <p className="hint">Forme : {state.room.current_pokemon.form}</p>}
                    <div className="type-row">
                      {state.room.current_pokemon.types.map((type) => <span className="type" key={type}>{type}</span>)}
                      <span className="type">N° {state.room.current_pokemon.national_dex}</span>
                      {state.room.current_pokemon.weight_kg !== null && <span className="type">{state.room.current_pokemon.weight_kg} kg</span>}
                    </div>
                  </>
                ) : (
                  <div className="pokemon-art" style={{ minHeight: 180, display: "grid", placeItems: "center" }}>
                    <div><div style={{ fontSize: 40 }}>❔</div><b>En attente du premier lot</b></div>
                  </div>
                )}
                <p className="hint" style={{ marginTop: 16 }}>Les informations du Pokémon sont visibles ici avant et pendant les enchères. Aucune action de mise n’est disponible dans cet écran.</p>
              </article>

              <aside className="panel side">
                <h2 className="section-title">Joueurs</h2>
                {state.players.map((player) => (
                  <div className="player-row" key={player.user_id}>
                    <div><b>{player.nickname}</b><div className="hint">{player.ready ? "Prêt" : "En attente"} · place {player.seat}</div></div>
                    <div style={{ textAlign: "right" }}><b>{money.format(player.budget)} P$</b></div>
                  </div>
                ))}
                <p className="notice">Mises publiques · {state.room.mode === "clue_roulette" ? "les joueurs ne voient que leurs indices" : state.room.mode === "blind" ? "le Pokémon est masqué à l’un des joueurs" : "le Pokémon est révélé aux joueurs"}.</p>
              </aside>
            </section>

            {state.role === "spectator" ? (
              <section className="panel lobby history">
                <h2 className="section-title">Devenir administrateur</h2>
                <p className="hint">Le code donne le droit de changer le Pokémon du lot actif tant qu’aucune mise n’a été faite, et de programmer une manche spéciale dans le mode roue.</p>
                <label className="field-label" htmlFor="admin-code">Code administrateur</label>
                <input className="input" id="admin-code" type="password" inputMode="numeric" autoComplete="one-time-code" value={adminCode} maxLength={32} onChange={(event) => setAdminCode(event.target.value)} />
                <button className="btn primary wide" onClick={() => void becomeAdmin()} disabled={loading || adminCode.length === 0}>Activer le mode administrateur</button>
              </section>
            ) : (
              <section className="panel lobby history">
                <h2 className="section-title">Contrôler le lot actif</h2>
                <p className="hint">Le Pokémon peut être remplacé aléatoirement ou par recherche tant que personne n’a encore misé. Les doublons dans cette partie sont refusés.</p>
                {state.room.mode === "clue_roulette" && state.room.status === "active" && state.room.round_no < state.room.round_total && !state.room.next_admin_round && (
                  <div className="notice">
                    <b>Programmer une manche administrateur</b>
                    <p className="hint">La manche en cours continue. La suivante utilisera le Pokémon de ton choix, sans indice ni timer.</p>
                    <button className="btn primary" disabled={loading} onClick={() => { setAdminRoundSelecting(true); setChoices([]); setNotice("Recherche le Pokémon de la prochaine manche."); }}>
                      Choisir le Pokémon de la prochaine manche
                    </button>
                  </div>
                )}
                {state.room.next_admin_round && <p className="notice"><b>La prochaine manche administrateur est programmée avec {state.room.next_admin_pokemon?.display_name ?? "le Pokémon choisi"} · sans indice · sans timer</b></p>}
                {state.room.admin_round && <p className="notice"><b>Manche administrateur en cours · sans indice · sans timer</b></p>}
                <div className="bid-actions">
                  <button className="btn secondary" disabled={loading || state.room.status !== "active"} onClick={() => void changePokemon(null)}><Shuffle size={15} style={{ display: "inline", verticalAlign: "-3px" }} /> Pokémon aléatoire</button>
                  <button className="btn secondary" disabled={loading} onClick={() => void refresh(state.room.id)}><RefreshCw size={15} style={{ display: "inline", verticalAlign: "-3px" }} /> Actualiser</button>
                </div>
                <label className="field-label" htmlFor="pokemon-search">{adminRoundSelecting ? "Choisir le Pokémon de la prochaine manche administrateur" : "Chercher par nom, numéro ou identifiant"}</label>
                <div className="bid-controls">
                  <input className="input" id="pokemon-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPokemon(); }} />
                  <button className="btn primary" disabled={loading || state.room.status !== "active"} onClick={() => void searchPokemon()}><Search size={16} /> Chercher</button>
                </div>
                {adminRoundSelecting && <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => { setAdminRoundSelecting(false); setChoices([]); }}>Annuler</button>}
                {choices.length > 0 && <div className="collection" style={{ marginTop: 14 }}>
                  {choices.map((pokemon) => (
                    <button className="owned" key={pokemon.pokemon_id} disabled={loading} onClick={() => void (adminRoundSelecting ? startAdminRound(pokemon.pokemon_id) : changePokemon(pokemon.pokemon_id))}>
                      <img src={pokemon.sprite_url} alt="" />
                      <p>{pokemon.display_name}</p>
                      <small>N° {pokemon.national_dex} · {pokemon.form}</small>
                    </button>
                  ))}
                </div>}
              </section>
            )}
          </>
        )}

        <footer className="footer"><ShieldCheck size={14} style={{ display: "inline", verticalAlign: "-3px", marginRight: 5 }} />Écran spectateur en lecture seule, sauf accès administrateur.</footer>
      </div>
    </main>
  );
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : "Une erreur est survenue. Réessaie dans un instant.";
}

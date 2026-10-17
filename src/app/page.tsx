"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Clipboard, Crown, DoorOpen, Link2, LockKeyhole, ShieldCheck, Sparkles, Swords, Users } from "lucide-react";
import { ensureIdentity, getSupabase, rpc } from "@/lib/supabase";
import type { RoomState } from "@/lib/types";

const ROOM_KEY = "pokedraft-room-id", NICK_KEY = "pokedraft-nickname";
const money = new Intl.NumberFormat("fr-FR");
type AuctionResult={round_no:number;pokemon:{display_name:string;sprite:string};winner_id:string|null;winner_name:string|null;price:number};

export default function Home() {
  const [nickname,setNickname]=useState(""),[joinCode,setJoinCode]=useState(""),[mode,setMode]=useState<"turn_based"|"blind">("turn_based");
  const [state,setState]=useState<RoomState|null>(null),[results,setResults]=useState<AuctionResult[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[toast,setToast]=useState("");
  const [bid,setBid]=useState(500),[now,setNow]=useState(Date.now()),[selected,setSelected]=useState<string[]>([]),[onlineIds,setOnlineIds]=useState<string[]>([]),[identityReady,setIdentityReady]=useState(false),[configMissing,setConfigMissing]=useState(false);

  const refresh=useCallback(async(roomId?:string)=>{
    const id=roomId??localStorage.getItem(ROOM_KEY)??undefined;if(!id)return;
    try{const value=await rpc<RoomState>("get_room_state",{p_room:id});
      if(value.room.mode==="blind"&&value.room.status==="active"){
        const {data}=await getSupabase().from("secret_bids").select("amount").eq("room_id",id).eq("round_no",value.room.round_no).eq("user_id",value.user_id).maybeSingle();
        value.my_secret_bid=data?{submitted:true,amount:data.amount}:null;
      }
      const history=await rpc<AuctionResult[]>("get_room_results",{p_room:id});setResults(history);setState(value);setBid(Math.max(500,value.room.current_price+100));localStorage.setItem(ROOM_KEY,id);}
    catch(e){if(roomId)setError(errorText(e));else localStorage.removeItem(ROOM_KEY);}
  },[]);
  useEffect(()=>{
    const saved=localStorage.getItem(NICK_KEY);if(saved)setNickname(saved);
    const code=new URLSearchParams(location.search).get("room");if(code){setJoinCode(code.toUpperCase());localStorage.removeItem(ROOM_KEY);}
    ensureIdentity().then(()=>setIdentityReady(true)).catch(e=>{setConfigMissing(true);setError(errorText(e));});
    const id=new URLSearchParams(location.search).get("room")?null:localStorage.getItem(ROOM_KEY);if(id)void refresh(id);
  },[refresh]);
  useEffect(()=>{if(!state)return;const id=state.room.id,s=getSupabase();
    const channel=s.channel(`room:${id}`,{config:{private:true,presence:{key:state.user_id}}}).on("presence",{event:"sync"},()=>setOnlineIds(Object.values(channel.presenceState()).flat().map((item:any)=>item.user_id)))
      .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:`id=eq.${id}`},()=>void refresh(id))
      .on("postgres_changes",{event:"*",schema:"public",table:"public_bids",filter:`room_id=eq.${id}`},()=>void refresh(id))
      .on("postgres_changes",{event:"*",schema:"public",table:"room_players",filter:`room_id=eq.${id}`},()=>void refresh(id)).subscribe(async status=>{if(status==="SUBSCRIBED")await channel.track({user_id:state.user_id});});
    const poll=window.setInterval(()=>void refresh(id),3500);return()=>{clearInterval(poll);setOnlineIds([]);void s.removeChannel(channel);};
  },[state?.room.id,refresh]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),400);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!state||state.room.status!=="active"||!state.room.deadline_at)return;
    const id=state.room.id,deadline=new Date(state.room.deadline_at).getTime();let sent=false;
    const timer=window.setInterval(()=>{if(!sent&&Date.now()>=deadline){sent=true;void rpc("tick_auction",{p_room:id}).then(()=>refresh(id)).catch(()=>void refresh(id));}},400);
    return()=>clearInterval(timer);
  },[state?.room.id,state?.room.status,state?.room.deadline_at,refresh]);

  const act=async(fn:()=>Promise<unknown>,message?:string)=>{setLoading(true);setError("");setToast("");try{await fn();if(message)setToast(message);if(state)await refresh(state.room.id);}catch(e){setError(errorText(e));}finally{setLoading(false);}};
  const saveNickname=()=>{const name=nickname.trim();if(name.length<2)throw new Error("Choisissez un pseudo de 2 caractères minimum.");localStorage.setItem(NICK_KEY,name);return name;};
  const createRoom=()=>act(async()=>{const data=await rpc<{id:string;code:string}>("create_room",{p_nickname:saveNickname(),p_mode:mode});localStorage.setItem(ROOM_KEY,data.id);await refresh(data.id);});
  const joinRoom=()=>act(async()=>{const id=await rpc<string>("join_room",{p_code:joinCode,p_nickname:saveNickname()});localStorage.setItem(ROOM_KEY,id);await refresh(id);});

  const me=state?.players.find(p=>p.user_id===state.user_id),opponent=state?.players.find(p=>p.user_id!==state.user_id);
  const myTurn=state?.room.current_turn_user_id===state.user_id;
  const seconds=state?.room.deadline_at?Math.max(0,Math.ceil((new Date(state.room.deadline_at).getTime()-now)/1000)):0;
  const minimum=state?Math.max(500,state.room.current_price+100):500;
  const ready=!!state&&state.players.length===2&&state.players.every(p=>p.ready);
  const invite=state?`${location.origin}/?room=${state.room.code}`:"";
  const myCollection=useMemo(()=>state?.collection.filter(x=>x.owner_id===state.user_id)??[],[state]);
  const exportText=useMemo(()=>myCollection.filter(x=>selected.includes(x.pokemon.id)).map(x=>`${x.pokemon.showdown_name}\n`).join("\n"),[myCollection,selected]);
  const copy=async(text:string,label:string)=>{try{await navigator.clipboard.writeText(text);setToast(`${label} copié.`);window.setTimeout(()=>setToast(""),2200);}catch{setError("Le presse-papiers n’est pas accessible sur cet appareil.");}};
  const toggleTeam=(id:string)=>setSelected(a=>a.includes(id)?a.filter(x=>x!==id):a.length<6?[...a,id]:a);
  const leave=async()=>{if(!state)return;setLoading(true);setError("");try{await rpc("leave_room",{p_room:state.room.id});localStorage.removeItem(ROOM_KEY);setState(null);setResults([]);setSelected([]);setToast("Salon quitté.");}catch(e){setError(errorText(e));}finally{setLoading(false);}};

  return <main className="ambient"><div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">✦</span><span>POKÉ<span className="gradient-text">DRAFT</span></span></div><span className="pill">BÊTA · 2 JOUEURS · 12 LOTS</span></header>
    {!state?<>
      <section className="hero"><div className="eyebrow">Le draft Pokémon entre amis</div><h1>Enchérissez.<br/><span className="gradient-text">Composez votre équipe.</span></h1><p className="subtitle">12 Pokémon mystères, 10 000 P$ et un adversaire. Remportez vos enchères, puis choisissez votre équipe pour le combat.</p></section>
      <section className="panel lobby"><label className="field-label" htmlFor="nickname">Votre pseudo</label><input className="input" id="nickname" value={nickname} maxLength={20} placeholder="Ex. Sacha" onChange={e=>setNickname(e.target.value)}/>
        <div className="columns" style={{marginTop:18}}>
          <div className="option"><h2><Sparkles size={17} style={{display:"inline",verticalAlign:"-3px",marginRight:7}}/>Créer un salon</h2><p className="hint">Choisissez les règles, puis partagez le code unique à votre adversaire.</p><label className="field-label" htmlFor="mode">Mode d’enchères</label><select className="input select" id="mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="turn_based">À tour de rôle</option><option value="blind">Mise secrète</option></select><button className="btn primary wide" onClick={createRoom} disabled={loading||!identityReady}>Créer la partie <ArrowRight size={16} style={{display:"inline",verticalAlign:"-3px"}}/></button></div>
          <div className="option"><h2><DoorOpen size={17} style={{display:"inline",verticalAlign:"-3px",marginRight:7}}/>Rejoindre un salon</h2><p className="hint">Entrez le code de votre ami ou ouvrez son lien d’invitation.</p><label className="field-label" htmlFor="room-code">Code du salon</label><input className="input" id="room-code" value={joinCode} maxLength={8} placeholder="Ex. 4F8A21C0" onChange={e=>setJoinCode(e.target.value.toUpperCase())}/><button className="btn secondary wide" onClick={joinRoom} disabled={loading||!identityReady||joinCode.trim().length<6}>Rejoindre <ArrowRight size={16} style={{display:"inline",verticalAlign:"-3px"}}/></button></div>
        </div>
        {configMissing&&<p className="notice">Supabase n’est pas configuré. Ajoutez les variables de <code>.env.example</code> après avoir créé votre projet Supabase.</p>}{error&&<p className="notice error">{error}</p>}{toast&&<p className="notice">{toast}</p>}
      </section>
      <section className="features"><article className="panel feature"><span className="feature-icon">⚖️</span><b>Règles équitables</b><span>Le serveur valide les mises, les budgets et les attributions.</span></article><article className="panel feature"><span className="feature-icon">🔒</span><b>Mode secret</b><span>Les mises restent privées jusqu’à la clôture simultanée.</span></article><article className="panel feature"><span className="feature-icon">📋</span><b>Équipe à exporter</b><span>Sélectionnez jusqu’à six Pokémon gagnés pour Showdown.</span></article></section>
      <p className="footer">Le catalogue initial contient les espèces introduites en 7G. L’export Showdown fournit les espèces choisies sans inventer d’attaques ou de stratégie; la légalité doit être vérifiée dans le format de combat choisi.</p>
    </>:<>
      <div className="room-header"><div><div className="eyebrow">{state.room.status==="waiting"?"Salle d’attente":state.room.status==="finished"?"Partie terminée":state.room.status==="abandoned"?"Partie interrompue":"Enchère en cours"}</div><h1>Salon <span className="gradient-text">{state.room.code}</span></h1></div><div className="copy-row"><button className="btn secondary" onClick={()=>void copy(invite,"Lien d’invitation")}><Link2 size={15} style={{display:"inline",verticalAlign:"-3px"}}/> Inviter</button><button className="btn secondary" onClick={leave} aria-label="Quitter le salon"><DoorOpen size={16}/></button></div></div>
      {error&&<p className="notice error">{error}</p>}{toast&&<p className="notice">{toast}</p>}
      {state.room.status==="waiting"?<section className="panel lobby"><div className="history-head"><h2 className="section-title">Joueurs prêts</h2><span className="pill">{state.room.mode==="blind"?"🔒 MISE SECRÈTE":"⚔️ À TOUR DE RÔLE"}</span></div>
        {state.players.map(p=><div className="player-row" key={p.user_id}><div className="player-main"><span className="avatar">{p.seat===1?"⭐":"🎒"}</span><div><b>{p.nickname}{p.user_id===state.user_id?" (vous)":""}</b><div className="hint">Joueur {p.seat}</div></div></div><span className="pill">{p.ready?"✓ Prêt":"En attente"}</span></div>)}
        {state.players.length<2&&<p className="notice">Partagez le lien ou le code du salon. La partie commencera après l’arrivée du deuxième joueur.</p>}
        <div className="columns" style={{marginTop:14}}><button className="btn secondary" onClick={()=>void copy(state.room.code,"Code du salon")}><Clipboard size={15} style={{display:"inline",verticalAlign:"-3px"}}/> Copier le code</button><button className="btn primary" disabled={loading||me?.ready} onClick={()=>void act(()=>rpc("set_ready",{p_room:state.room.id,p_ready:true}),"Vous êtes prêt.")}>{me?.ready?"En attente de l’adversaire…":"Je suis prêt"} <Check size={15} style={{display:"inline",verticalAlign:"-3px"}}/></button></div>
        <button className="btn primary wide" disabled={loading||!ready||state.players[0]?.user_id!==state.user_id} onClick={()=>void act(()=>rpc("start_game",{p_room:state.room.id}),"La partie commence !")}>Démarrer la partie <ArrowRight size={15} style={{display:"inline",verticalAlign:"-3px"}}/></button><p className="hint" style={{marginTop:10}}>Chaque joueur commence avec 10 000 P$. 12 Pokémon sont tirés sans doublon, un à la fois. Le joueur qui ouvre les enchères alterne à chaque lot.</p>
      </section>:<>
        {state.room.status==="active"&&<div className="game-grid"><section className="panel pokemon-card"><div className="lot"><span>LOT {state.room.round_no}/{state.room.round_total}</span><span className="timer">00:{String(seconds).padStart(2,"0")}</span></div>
          {state.room.current_pokemon&&<><div className="pokemon-art"><img src={state.room.current_pokemon.sprite} alt={state.room.current_pokemon.display_name}/></div><h2 className="pokemon-name">{state.room.current_pokemon.display_name}</h2><div className="type-row">{state.room.current_pokemon.types.map(t=><span className="type" key={t}>{t}</span>)}<span className="type">N° {state.room.current_pokemon.national_dex}</span></div></>}
          <div className="bid-box"><div className="history-head"><div><span className="hint">{state.room.mode==="blind"?"Votre budget restant":"Mise actuelle"}</span><div className="budget">{state.room.mode==="blind"?`${money.format(me?.budget??0)} P$`:`${money.format(state.room.current_price)} P$`}</div></div><span className="pill">{state.room.mode==="blind"?"🔒 Secrète":myTurn?"À vous de jouer":`Tour de ${opponent?.nickname??"l’adversaire"}`}</span></div>
            {state.room.mode==="turn_based"?<><p className="hint">{state.room.current_price?`Surenchère minimale : ${money.format(minimum)} P$`:"Mise minimale : 500 P$"} · Départ par {state.players.find(p=>p.user_id===state.room.current_turn_user_id)?.nickname??"…"}</p><div className="bid-controls"><input className="input" type="number" min={minimum} step={100} value={bid} onChange={e=>setBid(Number(e.target.value))}/><button className="btn primary" disabled={loading||!myTurn||(me?.budget??0)<500||bid<minimum||bid>(me?.budget??0)} onClick={()=>void act(()=>rpc("place_bid",{p_room:state.room.id,p_amount:bid,p_request:crypto.randomUUID()}))}>Miser</button></div><div className="bid-actions"><button className="btn secondary" disabled={loading||!myTurn} onClick={()=>void act(()=>rpc("pass_auction",{p_room:state.room.id}),"Vous passez votre tour.")}>Passer</button><span className="hint" style={{alignSelf:"center",textAlign:"right"}}>{(me?.budget??0)<500?"Budget trop bas : le lot se clôturera au délai.":"Chaque surenchère : +100 P$ minimum."}</span></div></>:<><p className="hint">Déposez votre mise avant la fin du compte à rebours. Elle reste invisible à l’adversaire jusqu’à la clôture. Saisissez 0 pour passer.</p>{state.my_secret_bid?.submitted?<div className="notice">Mise scellée envoyée ✓ · {state.my_secret_bid.amount===0?"forfait":`${money.format(state.my_secret_bid.amount)} P$`}. Révélation simultanée à la clôture.</div>:<div className="bid-controls"><input className="input" type="number" min={0} step={100} value={bid} onChange={e=>setBid(Number(e.target.value))}/><button className="btn primary" disabled={loading||bid<0||(bid>0&&bid<500)||bid>(me?.budget??0)} onClick={()=>void act(()=>rpc("submit_secret_bid",{p_room:state.room.id,p_amount:bid}),"Votre mise est scellée.")}>Sceller ma mise</button></div>}</>}
          </div></section>
          <aside className="panel side"><h2 className="section-title"><Users size={16} style={{display:"inline",verticalAlign:"-3px",marginRight:6}}/>Dresseurs</h2>{state.players.map(p=><div className="player-row" key={p.user_id}><div className="player-main"><span className="avatar">{p.user_id===state.room.starter_user_id?<Crown size={16}/>:<Swords size={15}/>}</span><div><b>{p.nickname}{p.user_id===state.user_id?" (vous)":""}</b><div className="hint">{p.user_id===state.room.starter_user_id?"Ouvre ce lot":"Adversaire"}</div></div></div><div style={{textAlign:"right"}}><div className="budget">{money.format(p.budget)} P$</div><small className="muted">{onlineIds.includes(p.user_id)?"● connecté":"○ hors ligne"}</small></div></div>)}
            <div style={{marginTop:18}}><h3 className="section-title">Historique des mises</h3><div className="bid-log">{state.bids.filter(b=>b.amount>0).slice(-10).reverse().map(b=><div className="bid-line" key={b.id}><span>{b.nickname}</span><b>{money.format(b.amount)} P$</b></div>)}{state.bids.length===0&&<p className="hint">Aucune mise publique pour le moment.</p>}{state.room.mode==="blind"&&<p className="hint">Les mises secrètes apparaissent ici seulement après clôture du lot.</p>}</div></div><div className="notice"><LockKeyhole size={14} style={{display:"inline",verticalAlign:"-3px",marginRight:5}}/>Le serveur arbitre les mises et le compte à rebours.</div>
          </aside></div>}
        {results.length>0&&<section className="panel history"><div className="history-head"><h2 className="section-title">Résultats des lots clôturés</h2><span className="hint">Dernier résultat d’abord</span></div><div className="collection">{[...results].reverse().map(r=><div className="owned" key={r.round_no}><img src={r.pokemon.sprite} alt=""/><p>Lot {r.round_no} · {r.pokemon.display_name}</p><small>{r.winner_name?`${r.winner_name} · ${money.format(r.price)} P$`:"Sans gagnant"}</small></div>)}</div></section>}
        {state.room.status==="finished"&&<section className="panel history"><h2 className="section-title">🏆 Partie terminée · budgets finaux</h2>{state.players.map(p=><p key={p.user_id}>{p.nickname} — <b>{money.format(p.budget)} P$</b> restants · {state.collection.filter(x=>x.owner_id===p.user_id).length} Pokémon</p>)}</section>}
        {state.room.status==="abandoned"&&<p className="notice error">Un joueur a quitté la partie. Le salon est interrompu.</p>}
        {state.room.status!=="abandoned"&&<section className="panel history"><div className="history-head"><div><h2 className="section-title">Collection remportée</h2><span className="hint">Choisissez jusqu’à six Pokémon pour votre équipe.</span></div><span className="pill">{selected.length}/6 sélectionnés</span></div>
          {myCollection.length?<><div className="collection">{myCollection.map(x=><div className="owned" key={x.pokemon.id}><img src={x.pokemon.sprite} alt=""/><p>{x.pokemon.display_name}</p><small>{money.format(x.price)} P$</small><label><input type="checkbox" checked={selected.includes(x.pokemon.id)} onChange={()=>toggleTeam(x.pokemon.id)} disabled={!selected.includes(x.pokemon.id)&&selected.length>=6}/> Équipe</label></div>)}</div>{selected.length>0&&<div className="bid-actions" style={{marginTop:16}}><span className="pill">Format visé : Gen 7 OU</span><button className="btn secondary" onClick={()=>void copy(exportText,"Texte Showdown")}>Copier l’équipe <Clipboard size={15} style={{display:"inline",verticalAlign:"-3px"}}/></button></div>}<p className="hint" style={{marginTop:12}}>L’export contient seulement les espèces choisies. Aucun set (attaques, talent, objet, EV) n’est inventé. La légalité Gen 7 OU n’est pas vérifiée automatiquement : contrôlez l’équipe dans Showdown avant le combat.</p></>:<p className="hint">Vos Pokémon remportés apparaîtront ici. L’export Showdown n’inventera pas de set.</p>}
          <h3 className="section-title" style={{marginTop:24}}>Tous les Pokémon remportés</h3><div className="collection">{state.collection.map(x=><div className="owned" key={x.pokemon.id}><img src={x.pokemon.sprite} alt=""/><p>{x.pokemon.display_name}</p><small>{x.owner_name} · {money.format(x.price)} P$</small></div>)}</div>
        </section>}
      </>}
    </>}
    <footer className="footer"><ShieldCheck size={14} style={{display:"inline",verticalAlign:"-3px",marginRight:5}}/>Budgets, tirages et résultats sont validés en base de données. Connexion : {identityReady?"établie":"en cours"}.</footer>
  </div></main>;
}
function errorText(e:unknown){return e instanceof Error?e.message:"Une erreur est survenue. Réessayez dans un instant.";}

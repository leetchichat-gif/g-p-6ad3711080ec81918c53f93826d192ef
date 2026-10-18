import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!accessToken) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const adminCode = process.env.POKEDRAFT_ADMIN_CODE;

  if (!url || !publishableKey || !secretKey || !adminCode) {
    return NextResponse.json(
      { error: "La configuration serveur du mode administrateur est incomplète." },
      { status: 503 }
    );
  }

  let body: { roomId?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const submittedCode = typeof body.code === "string" ? body.code : "";
  if (!/^[0-9a-f-]{36}$/i.test(roomId) || submittedCode.length > 64) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Session invalide. Reconnecte-toi au salon." }, { status: 401 });
  }

  const adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-client";
  const clientIp = forwardedFor.split(",").at(-1)?.trim() || "unknown-client";
  const fingerprint = createHmac("sha256", adminCode).update(clientIp).digest("hex");

  const { data: allowed, error: rateError } = await adminClient.rpc(
    "consume_room_admin_attempt",
    { p_room: roomId, p_user: authData.user.id, p_fingerprint: fingerprint }
  );
  if (rateError) {
    return NextResponse.json({ error: "Impossible de vérifier la demande." }, { status: 500 });
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "Trop d’essais ou tu n’es pas spectateur de ce salon. Réessaie dans 15 minutes." },
      { status: 429 }
    );
  }

  const expected = Buffer.from(adminCode, "utf8");
  const received = Buffer.from(submittedCode, "utf8");
  const matches = expected.length === received.length && timingSafeEqual(expected, received);
  if (!matches) {
    return NextResponse.json({ error: "Code administrateur incorrect." }, { status: 403 });
  }

  const { error: promoteError } = await adminClient.rpc("promote_spectator_to_admin", {
    p_room: roomId,
    p_user: authData.user.id,
  });
  if (promoteError) {
    const message = promoteError.message.includes("déjà présent")
      ? "Un administrateur est déjà présent dans ce salon."
      : "Impossible d’activer le mode administrateur.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

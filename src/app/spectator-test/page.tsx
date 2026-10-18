import SpectatorClient from "../spectator/SpectatorClient2";
// Route de test pour vérifier l’accès au spectateur.
export const dynamic = "force-dynamic";

export default function SpectatorTestPage() {
  return <SpectatorClient />;
}

import SpectatorClient from "../spectator/SpectatorClient";
// Route de test pour vérifier l’accès au spectateur.
export const dynamic = "force-dynamic";

export default function SpectatorTestPage() {
  return <SpectatorClient />;
}

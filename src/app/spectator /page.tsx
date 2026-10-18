import SpectatorClient from "./SpectatorClient";

// Render this route on demand instead of serving a prerendered static page.
export const dynamic = "force-dynamic";

export default function SpectatorPage() {
  return <SpectatorClient />;
}

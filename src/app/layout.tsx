import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PokeDraft — Enchères Pokémon entre amis", description: "Composez votre équipe Pokémon en remportant les enchères face à un ami." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fr"><body>{children}</body></html>; }

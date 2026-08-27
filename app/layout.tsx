import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PassaTela — compartilhamento simples e nítido",
  description: "Compartilhe sua tela com baixa latência e controle intuitivo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

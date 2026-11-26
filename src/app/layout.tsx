import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CYBER RAID | Telegram Mini App RPG",
  description:
    "Idle cyberpunk RPG, Gacha capsules, asynchronous PvP raids, and Telegram Stars monetization.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05070e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full bg-[#05070e] text-[#e5f0ff] font-sans selection:bg-cyan-500/30">
        {children}
      </body>
    </html>
  );
}

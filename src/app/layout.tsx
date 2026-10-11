import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "edocBR Plenário",
  description:
    "Plenário eletrônico edocBR para Câmaras Municipais: sessões, votação, transmissão, auditoria e transparência.",
  keywords: [
    "câmara municipal",
    "processo legislativo",
    "sessão plenária",
    "votação",
    "transparência",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <Sonner position="top-right" richColors closeButton />
      </body>
    </html>
  );
}

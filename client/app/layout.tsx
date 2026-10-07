import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ToasterProvider from './components/ToasterProvider';
import SWRProvider from './components/SWRProvider';
import { ClientI18nRoot } from './components/ClientI18nRoot';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Obsidian Tracker",
  description: "The OverPowered Torrent Tracker",
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-text`}
        suppressHydrationWarning
      >
        <ClientI18nRoot />
        <ToasterProvider />
        <SWRProvider>
          {children}
        </SWRProvider>
      </body>
    </html>
  );
}

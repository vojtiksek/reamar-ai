import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GlobalNav } from "@/components/GlobalNav";
import { ActiveClientProvider } from "@/contexts/ActiveClientContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reamar",
  description: "Interní nástroj pro správu nemovitostí",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body
        className={`${geistSans.variable} ${geistMono.variable} app-root`}
      >
        <ActiveClientProvider>
          <div className="app-shell">
            <GlobalNav />
            {children}
          </div>
        </ActiveClientProvider>
      </body>
    </html>
  );
}

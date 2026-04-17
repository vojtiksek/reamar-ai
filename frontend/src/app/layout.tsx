import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ActiveClientProvider } from "@/contexts/ActiveClientContext";
import { LayoutSwitcher } from "@/components/v2/LayoutSwitcher";

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
          <LayoutSwitcher>{children}</LayoutSwitcher>
        </ActiveClientProvider>
      </body>
    </html>
  );
}

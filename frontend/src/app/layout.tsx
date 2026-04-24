import type { Metadata, Viewport } from "next";
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
  applicationName: "Reamar",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Reamar",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#1E3A5F",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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

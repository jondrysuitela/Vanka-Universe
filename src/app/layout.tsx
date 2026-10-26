
import type { Metadata } from "next";
import {
  Inter,
  Playfair_Display,
  Cinzel,
  Dancing_Script,
} from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
});

const dancingScript = Dancing_Script({
  variable: "--font-dancing",
  subsets: ["latin"],
});

const siteUrl = "https://vanka-universe.online";
const ogImage = `${siteUrl}/og-vanka-universe.jpg`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Vanka Universe",
  description: "A Universe of Memories. A Lifetime of Love.",
  keywords: ["Vanka", "memories", "birthday", "universe", "archive"],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Vanka Universe",
    title: "Vanka Universe",
    description: "A Universe of Memories. A Lifetime of Love.",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "Vanka Universe — A Universe of Memories. A Lifetime of Love.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanka Universe",
    description: "A Universe of Memories. A Lifetime of Love.",
    images: [ogImage],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${cinzel.variable} ${dancingScript.variable} h-full antialiased`}
    >
      <body className="cosmos-body min-h-full font-sans">{children}</body>
    </html>
  );
}

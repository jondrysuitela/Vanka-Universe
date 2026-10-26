import type { Metadata } from "next";
import { Inter, Playfair_Display, Cinzel, Dancing_Script } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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

export const metadata: Metadata = {
  title: "Vanka Universe",
  description: "A Universe of Memories. A Lifetime of Love.",
  keywords: ["Vanka", "memories", "birthday", "universe", "archive"],
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
      <body className="cosmos-body min-h-full font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}

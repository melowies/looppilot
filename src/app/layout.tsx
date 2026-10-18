import type { Metadata } from "next";
import { Averia_Sans_Libre, Gochi_Hand, Karla } from "next/font/google";
import "./globals.css";
const bodyFont = Karla({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
const headingFont = Averia_Sans_Libre({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});
const handwrittenFont = Gochi_Hand({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-handwritten",
  display: "swap",
});
export const metadata: Metadata = {
  title: "LoopPilot · Study journal",
  description:
    "A focused workspace for coding practice, behavioral stories, and evidence-based interview preparation.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} ${handwrittenFont.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floorplan Analyzer",
  description: "AI-powered floorplan analysis for area calculation and antenna placement",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Medicare — Your Health, Our Priority",
  description:
    "Medicare healthcare POC — headless frontend powered by Optimizely CMS and Optimizely Graph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}


import "./globals.css";
import React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "D-one",
  description: "Manage shop performance, bonuses, daily closing, and staff shifts.",
  appleWebApp: { title: "D-one" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} font-body antialiased`}>
          {children}
      </body>
    </html>
  );
}

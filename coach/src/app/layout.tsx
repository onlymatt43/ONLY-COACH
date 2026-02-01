import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "System OM43",
  description: "Private AI Interface"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

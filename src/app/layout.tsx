import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SameFace AI",
  description: "Controllable AI portrait retouching for the same person on a better day.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#f7f3ee]">{children}</body>
    </html>
  );
}

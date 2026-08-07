import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeaWorld Company OS",
  description: "Phase 0 control plane"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}

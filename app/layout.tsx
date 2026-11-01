import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "research.nalenz.org", description: "A living map of @sigalor's research posts around one question." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}

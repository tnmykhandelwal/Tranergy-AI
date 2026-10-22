import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { AppShell } from "@/components/TopNav";
import { Toaster } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Tranergy AI — Verified energy settlement",
  description:
    "Certificate verification, anomaly triage and escrowed renewable-energy settlement for microgrids.",
};

const themeScript = `
  try {
    var t = localStorage.getItem('tranergy.theme');
    var theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <SessionProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}

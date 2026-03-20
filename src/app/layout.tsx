import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { PrismBreadcrumb } from "@/components/PrismBreadcrumb";

export const metadata: Metadata = {
  title: "ORGANVM — Stakeholder Intelligence Portal",
  description:
    "Real-time intelligence on the ORGANVM eight-organ creative-institutional system. 111 repos, 8 organs, one vision.",
};

import manifest from "@/data/manifest.json";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const syncDate = manifest.generated ? new Date(manifest.generated).toLocaleString() : "Unknown";

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased flex flex-col relative">
        {/* Background decorative elements */}
        <div className="fixed inset-0 pointer-events-none z-[-1]">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/10 blur-[100px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-900/10 blur-[100px]" />
        </div>

        <nav className="glass-panel sticky top-0 z-50 px-6 py-4 m-4 rounded-2xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
              ORGANVM
            </Link>
            <div className="flex gap-6 text-sm font-medium text-[var(--color-text-muted)]">
              <Link href="/repos" className="hover:text-blue-400 transition-colors">
                Repos
              </Link>
              <Link href="/organs" className="hover:text-blue-400 transition-colors">
                Organs
              </Link>
              <Link href="/dashboard" className="hover:text-blue-400 transition-colors">
                Dashboard
              </Link>
              <Link href="/constitution" className="hover:text-blue-400 transition-colors">
                Constitution
              </Link>
              <Link href="/testament" className="hover:text-blue-400 transition-colors">
                Testament
              </Link>
              <Link href="/ask" className="hover:text-blue-400 transition-colors">
                Ask
              </Link>
              <Link href="/planning" className="hover:text-blue-400 transition-colors">
                Planning
              </Link>
              <Link href="/admin/intel" className="hover:text-blue-400 transition-colors">
                Admin
              </Link>
              <Link href="/about" className="hover:text-blue-400 transition-colors">
                About
              </Link>
            </div>
          </div>
        </nav>

        <PrismBreadcrumb />

        <main className="mx-auto max-w-7xl px-6 py-8 flex-1 w-full">{children}</main>

        <footer className="mt-auto border-t border-[var(--color-border)] py-6 bg-black/30 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-6 flex justify-between items-center text-xs text-[var(--color-text-muted)]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>System Online</span>
              </div>
              <a href="https://4444j99.github.io/portfolio/?prism=hermeneus.footer" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
                Portfolio
              </a>
            </div>
            <div>
              Last Indexed: <span className="font-mono text-white/80">{syncDate}</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

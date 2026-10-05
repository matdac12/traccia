import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { AppearanceProvider } from "@/components/traccia/appearance-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ACCENT_COOKIE, FONT_COOKIE, parseAccentCookie, parseFontCookie } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Traccia", template: "%s · Traccia" } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Accent and font come from cookies (TRC-57), so the server render has no flash of the default.
  const cookieStore = await cookies();
  const accent = parseAccentCookie(cookieStore.get(ACCENT_COOKIE)?.value);
  const font = parseFontCookie(cookieStore.get(FONT_COOKIE)?.value);
  return (
    <html lang="en" suppressHydrationWarning data-font={font} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppearanceProvider initialAccent={accent} initialFont={font}>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          </AppearanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

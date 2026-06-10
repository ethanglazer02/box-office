import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Box Office",
  description: "Connect two actors through shared credits while keeping your path short and cheap.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any" },
      { url: "/icon.png?v=2", type: "image/png" }
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/apple-icon.png?v=2"
  }
};

const themeInitScript = `
  (() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

    try {
      const stored = window.localStorage.getItem("box-office-theme");
      document.documentElement.dataset.theme =
        stored === "light" || stored === "dark" ? stored : systemTheme;
    } catch {
      document.documentElement.dataset.theme = systemTheme;
    }
  })();
`;

export default function RootLayout({
  children,
  modal
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        {modal}
      </body>
    </html>
  );
}

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
    const defaultTheme = "dark";

    try {
      const stored = window.localStorage.getItem("box-office-theme");
      document.documentElement.dataset.theme =
        stored === "light" || stored === "dark" ? stored : defaultTheme;
    } catch {
      document.documentElement.dataset.theme = defaultTheme;
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
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

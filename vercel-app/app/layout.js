export const metadata = {
  title: "WMS 38 — Tigalapan Indonesia",
  description: "WMS Tigalapan Indonesia. Operasional gudang distribusi, barcode, alokasi dan pengiriman.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#172c40" };

// Shell HTML disamakan persis dengan web/index.html paket desktop (lihat source/web/index.html) --
// <div id="root"> dipasangi app.jsx yang SAMA (dibundel scripts/build-assets.mjs ke public/app.js),
// jadi seluruh UI/logic React tidak diduplikasi/ditulis ulang untuk Next.js.
export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        {children}
        <script type="module" src="/app.js" />
      </body>
    </html>
  );
}

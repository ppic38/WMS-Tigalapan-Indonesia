// Menyiapkan public/ untuk Next.js dari sumber yang sama dipakai paket desktop (../web, ../src) --
// SATU sumber kebenaran (web/, src/app.jsx), tidak ada salinan manual yang bisa kadaluarsa. Dijalankan
// sebagai langkah "build" (lihat package.json) sebelum `next build`/`next dev`.
import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const sourceRoot = path.join(root, "..");
const publicDir = path.join(root, "public");

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else await fs.copyFile(src, dest);
  }
}

await fs.rm(publicDir, { recursive: true, force: true });
await fs.mkdir(publicDir, { recursive: true });

// web/index.html TIDAK ikut disalin -- halaman root dilayani app/page.js (lihat catatan di file itu).
for (const entry of await fs.readdir(path.join(sourceRoot, "web"), { withFileTypes: true })) {
  if (entry.name === "index.html") continue;
  const src = path.join(sourceRoot, "web", entry.name);
  const dest = path.join(publicDir, entry.name);
  if (entry.isDirectory()) await copyDir(src, dest);
  else await fs.copyFile(src, dest);
}

await esbuild.build({
  entryPoints: [path.join(sourceRoot, "src", "app.jsx")],
  bundle: true,
  minify: true,
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(publicDir, "app.js"),
  // Entry point ada di ../src (di LUAR folder ini) -- resolusi node_modules esbuild yang berjalan
  // ke atas dari situ tidak akan pernah sampai ke node_modules DI SINI (bukan folder leluhurnya).
  // react/react-dom/lucide-react sengaja dideklarasikan di package.json folder ini (bukan di
  // source/package.json) supaya Vercel (yang cuma `npm install` di folder ini, lihat Root
  // Directory) tetap bisa install dependency yang dipakai app.jsx.
  nodePaths: [path.join(root, "node_modules")],
});

console.log("public/ siap: aset dari web/ disalin, src/app.jsx dibundel jadi public/app.js");

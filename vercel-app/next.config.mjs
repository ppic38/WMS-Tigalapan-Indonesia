import { fileURLToPath } from "node:url";
import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root di-set ke satu level ATAS folder ini (bukan folder ini sendiri) -- app/api/integrations
  // mengimpor ../../../../../server/integration-gateway.js yang letaknya di luar vercel-app/, jadi
  // batas workspace Turbopack harus mencakup folder itu juga, bukan cuma vercel-app/.
  turbopack: { root: path.join(path.dirname(fileURLToPath(import.meta.url)), "..") },
};
export default nextConfig;

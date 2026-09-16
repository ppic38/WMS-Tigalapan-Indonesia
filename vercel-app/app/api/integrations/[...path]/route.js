// Membungkus ../../../../../server/integration-gateway.js APA ADANYA (tidak ditulis ulang) --
// handler itu sudah berbentuk (request, env) => Response standar Fetch API, jadi tinggal dipanggil
// dari Route Handler Next.js. Path asli (/api/integrations/status|resi|moka-stock|outbox) tetap
// ditangani oleh parsing internal gateway itu sendiri, bukan oleh segmen [...path] di sini.
// Gerbang autentikasi (harus sudah login) & cek same-origin untuk method selain GET/HEAD sudah
// dilakukan di middleware.js SEBELUM request sampai ke sini.
import { createIntegrationGateway } from "../../../../../server/integration-gateway.js";

const gateway = createIntegrationGateway();

async function handle(request) {
  return gateway(request, process.env);
}

export const GET = handle;
export const POST = handle;

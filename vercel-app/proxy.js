import { NextResponse } from "next/server";

// Reimplementasi ../server/pin-gate.js untuk Next.js Edge Middleware (Vercel) -- logic keamanan
// (HMAC session, hash PIN, rate limit percobaan, cek same-origin) DIPERTAHANKAN SAMA PERSIS, cuma
// dipindah dari bentuk {fetch(request,env)} gaya Worker ke middleware.js Next.js supaya bisa
// menggerbangi file statis di public/ (dibangun dari web/ + src/app.jsx, lihat scripts/build-assets.mjs)
// SEBELUM sampai ke CDN Vercel -- perilaku "belum login = tidak bisa lihat apa pun" tetap sama
// seperti paket desktop asli.
const COOKIE = "__Host-wms_session";
const TTL = 8 * 60 * 60;
const WINDOW = 10 * 60 * 1000;
const encoder = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/.{2}/g) || [], (b) => parseInt(b, 16));
const secureHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

// Browser bisa mengirim Origin buram pada form POST dari halaman login sebelumnya (no-referrer).
// Fetch Metadata dikontrol browser; hanya nilai same-origin persis yang boleh menutupi Origin yang
// kosong/buram -- sama persis alasan & logika di server/pin-gate.js versi Worker.
function isSameOriginPost(request) {
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  if (origin && origin !== "null") return origin === new URL(request.url).origin;
  return site === "same-origin";
}

function respond(body, status = 200, headers = {}) {
  return new NextResponse(body, { status, headers: { ...secureHeaders, ...headers } });
}
function redirectTo(request, to) {
  return NextResponse.redirect(new URL(to, request.url), 303);
}

async function sessionKey(env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.WMS_SESSION_SECRET + ":" + env.WMS_TEST_PIN_HASH), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function validSession(request, env, now) {
  const token = request.cookies.get(COOKIE)?.value || "";
  const match = /^(\d{10,13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + TTL * 1000) return false;
  return crypto.subtle.verify("HMAC", await sessionKey(env), unhex(match[3]), encoder.encode(`${match[1]}.${match[2]}`));
}

function loginPage(message = "") {
  return `<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#172c40"><title>Masuk · WMS 38</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#f2f5f8;color:#172c40;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:100%;max-width:440px;background:white;border:1px solid #dce5ed;border-radius:16px;padding:36px;box-shadow:0 12px 40px #172c4009}.brand{font-size:28px;font-weight:800;letter-spacing:-1px}.brand b{color:#d99b36}.tag{font-size:11px;letter-spacing:1.6px;color:#71869b}h1{font-size:25px;line-height:1.3;margin:30px 0 10px}p{color:#61758a;font-size:14px}label{display:block;font-size:14px;font-weight:600;margin:24px 0 8px}input{width:100%;border:1px solid #bcccdc;border-radius:8px;padding:14px;font-size:24px;letter-spacing:7px;color:#172c40}input:focus{outline:3px solid #f0ba5560;border-color:#294f70}button{width:100%;border:0;border-radius:8px;background:#294f70;color:white;font:600 15px system-ui;padding:15px;margin-top:20px;cursor:pointer}button:hover{background:#172c40}.error{padding:12px;background:#fff2e2;border-radius:8px;color:#8c4210}.foot{font-size:12px;margin:24px 0 0}a{color:#294f70}</style></head><body><main><div class="brand">WMS <b>38</b></div><div class="tag">TIGALAPAN INDONESIA</div><h1>Masuk untuk testing</h1><p>Masukkan PIN testing untuk membuka operasional gudang.</p>${message ? `<p class="error" role="alert">${message}</p>` : ""}<form method="post" action="/login"><label for="pin">PIN testing</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" autocomplete="current-password" placeholder="8 digit" required autofocus aria-describedby="pin-help"><p id="pin-help">Gunakan PIN yang dibagikan administrator.</p><button type="submit">Masuk ke WMS</button></form><p class="foot">Sesi berlaku 8 jam. Data uji tersimpan di browser ini.</p></main><script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});</script></body></html>`;
}

// Best-effort per-IP, per-instance Edge -- bukan kuota global durable, sama seperti komentar asli
// di server/pin-gate.js (Worker/Node isolate juga tidak menjamin satu proses tunggal).
const attempts = new Map();

export async function proxy(request) {
  const env = process.env;
  const url = new URL(request.url);
  const path = url.pathname;
  const now = Date.now();

  if (!/^[a-f0-9]{64}$/.test(env.WMS_TEST_PIN_HASH || "") || !env.WMS_SESSION_SECRET || env.WMS_SESSION_SECRET.length < 32) {
    return respond("Login testing belum dikonfigurasi. Hubungi administrator.", 503);
  }

  if (path === "/login" && request.method === "GET") {
    return respond(loginPage(), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; worker-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
  }

  if ((path === "/login" || path === "/logout") && request.method === "POST") {
    if (!isSameOriginPost(request)) return respond("Permintaan tidak diizinkan. Buka kembali halaman login WMS lalu coba lagi.", 403);

    if (path === "/logout") {
      const res = redirectTo(request, "/login");
      res.cookies.set(COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "strict" });
      return res;
    }

    for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const entry = attempts.get(ip) || { count: 0, until: now + WINDOW };
    if (entry.count >= 5 || (!attempts.has(ip) && attempts.size >= 10000)) {
      return respond(loginPage("Terlalu banyak percobaan. Coba kembali dalam 10 menit."), 429, {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": String(Math.max(1, Math.ceil((entry.until - now) / 1000))),
      });
    }
    entry.count++;
    attempts.set(ip, entry);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1024) return respond("Permintaan terlalu besar.", 413);
    const bodyText = await request.text();
    if (bodyText.length > 1024) return respond("Permintaan terlalu besar.", 413);
    const pin = new URLSearchParams(bodyText).get("pin") || "";

    const digest = hex(await crypto.subtle.digest("SHA-256", encoder.encode(pin)));
    let different = 0;
    for (let i = 0; i < 64; i++) different |= digest.charCodeAt(i) ^ env.WMS_TEST_PIN_HASH.charCodeAt(i);
    if (!/^\d{8}$/.test(pin) || different) {
      return respond(loginPage("PIN tidak sesuai. Silakan coba lagi."), 401, { "Content-Type": "text/html; charset=utf-8" });
    }
    attempts.delete(ip);

    const payload = `${now + TTL * 1000}.${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
    const signature = hex(await crypto.subtle.sign("HMAC", await sessionKey(env), encoder.encode(payload)));
    const res = redirectTo(request, "/");
    res.cookies.set(COOKIE, `${payload}.${signature}`, { path: "/", maxAge: TTL, httpOnly: true, secure: true, sameSite: "strict" });
    return res;
  }

  const authenticated = await validSession(request, env, now);

  if (path === "/auth/session") {
    return respond(JSON.stringify({ authenticated }), authenticated ? 200 : 401, { "Content-Type": "application/json" });
  }
  if (!authenticated) {
    if (path === "/" || path === "/index.html") return redirectTo(request, "/login");
    return respond("Silakan masuk dengan PIN testing.", 401);
  }
  if (path.startsWith("/api/integrations/") && !["GET", "HEAD"].includes(request.method) && !isSameOriginPost(request)) {
    return respond("Permintaan tidak diizinkan.", 403);
  }
  return NextResponse.next();
}

// /sw.js SENGAJA tidak digerbangi (sama seperti versi Worker) -- registrasi service worker harus
// bisa jalan walau belum login. _next/* murni infrastruktur Next.js, bukan bagian aplikasi WMS.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};

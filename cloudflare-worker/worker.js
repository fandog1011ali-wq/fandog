import { connect } from 'cloudflare:sockets';

/**
 * TITAN IPTV HTTPS Stream Proxy
 * Version: 1.0.0
 * - Exact host/port allow-list generated from the current TITAN M3U files + logo hosts.
 * - Domain origins use Workers Fetch API.
 * - Public IP origins use Workers TCP sockets (HTTP/1.0 or HTTP/1.1 response parsing).
 * - HLS playlists are rewritten recursively (URI attributes and URI lines).
 * - DASH BaseURL elements are rewritten to a directory-aware proxy route.
 * - Media bodies are streamed; Range/206 is preserved.
 *
 * IMPORTANT: Do not turn this into an unrestricted public proxy. Extend the allow-list only
 * for stream/logo hosts you control or are authorized to access.
 */

const VERSION = '1.0.1';
const APP_ORIGIN = 'https://fandog1011ali-wq.github.io';

// Exact hostnames and ports present in the four M3U files supplied with TITAN 4.0.1.
// Default HTTP/HTTPS ports are included for all approved domain hosts.
const HOST_PORTS = new Map([
  ['233d3515.kazmazpaz.ru', [80, 443]],
  ['59ec5453559f0.streamlock.net', [80, 443, 1935]],
  ['5f22d76e220e1.streamlock.net', [80, 443]],
  ['adultiptv.net', [80, 443]],
  ['api.alpaca.t62a.com', [80, 443]],
  ['biaupload.net', [80, 443]],
  ['cdn-main.lolokoko.tv', [80, 443]],
  ['cdn.adultiptv.net', [80, 443]],
  ['cms.tvhd4k.com', [80, 443, 19500]],
  ['epg.provider.plex.tv', [80, 443]],
  ['event.vedge.infomaniak.com', [80, 443]],
  ['gameserver2.streamiptv.online', [80, 443, 18001]],
  ['gohyperspeed.com', [80, 443]],
  ['hometv.iptvserverbuy.com', [80, 443, 8000]],
  ['ip1.orgip.net', [80, 443]],
  ['iptv.proff.co', [80, 443, 15003]],
  ['line.watchtivo-8k.com', [80, 443]],
  ['live-1.otcnet.ru', [80, 443]],
  ['live.adultiptv.net', [80, 443]],
  ['live.mycamtv.com', [80, 443]],
  ['live.redtraffic.net', [80, 443]],
  ['live.redtraffic.xyz', [80, 443]],
  ['newlook.ddns.net', [80, 443, 9880]],
  ['nl4.iptv.monster', [80, 443]],
  ['orien.live', [80, 443]],
  ['ott.server-iptv.live', [80, 443]],
  ['raw.githubusercontent.com', [80, 443]],
  ['rr3.tvdosug.net', [80, 443]],
  ['sdn-global-live-streaming-packager-cache.3qsdn.com', [80, 443]],
  ['sex4.brasileirinhas.com.br', [80, 443]],
  ['stream.visit-x.tv', [80, 443]],
  ['super1cam.ddns.net', [80, 443, 8000]],
  ['tv.lightiptv.cc', [80, 443]],
  ['video1.rhsj520.com', [80, 443]],
  ['vip4.ddyunbo.com', [80, 443]],
  ['wse2.transmissaodigital.com', [80, 443, 1935]],

  // Logo-only domains seen in tvg-logo attributes.
  ['files.adultiptv.net', [80, 443]],
  ['i.imgur.com', [80, 443]],
  ['i123.fastpic.org', [80, 443]],
  ['cdn.strpst.com', [80, 443]],
  ['s31.postimg.org', [80, 443]],
  ['s20.postimg.org', [80, 443]],
  ['www.ifcmedia.sk', [80, 443]],
  ['www.goiptv.top', [80, 443]],
  ['iptvx.one', [80, 443]],
  ['s.rbk.ru', [80, 443]],
  ['1.bp.blogspot.com', [80, 443]],
  ['yt3.googleusercontent.com', [80, 443]],
  ['www.eropuls.de', [80, 443]],
  ['s27.postimg.org', [80, 443]],
  ['s9.postimg.org', [80, 443]],
  ['s32.postimg.org', [80, 443]],
  ['s10.postimg.org', [80, 443]],
  ['s17.postimg.org', [80, 443]],
]);

// Public IP addresses used by current M3U stream entries. Workers Fetch cannot fetch IP literals;
// this finite list enables only these exact public IP + port pairs through TCP sockets.
const IP_PORTS = new Map([
  ['109.71.162.112', [1935]],
  ['109.71.163.112', [1935]],
  ['138.201.33.133', [80]],
  ['141.95.55.143', [80]],
  ['144.76.58.245', [2307]],
  ['149.62.183.194', [9293]],
  ['159.203.63.133', [8081]],
  ['185.142.236.82', [2500]],
  ['185.152.65.130', [8080]],
  ['190.11.225.124', [5000]],
  ['192.99.148.73', [8080]],
  ['193.33.240.8', [8080]],
  ['194.163.179.246', [80]],
  ['200.115.120.1', [8000]],
  ['200.194.238.229', [8383]],
  ['213.188.51.185', [9981]],
  ['31.148.48.15', [80]],
  ['45.167.1.138', [8000]],
  ['45.87.172.19', [85]],
  ['5.255.90.94', [1339]],
  ['5.57.74.130', [8000]],
  ['51.159.102.100', [80]],
  ['66.90.110.10', [80, 8080]],
  ['84.245.50.99', [9002]],
  ['88.212.7.11', [80]],
]);

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'set-cookie'
]);

function corsHeaders(origin) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': APP_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, Accept, Cache-Control, Content-Type',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified',
    'Access-Control-Max-Age': '86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin && origin !== APP_ORIGIN) return null;
  return headers;
}

function json(data, status = 200, headers = new Headers()) {
  const out = new Headers(headers);
  out.set('Content-Type', 'application/json; charset=utf-8');
  out.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data, null, 2), { status, headers: out });
}

function isIPLiteral(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':');
}

function validateTarget(raw) {
  let target;
  try { target = new URL(raw); }
  catch { throw new Error('آدرس منبع معتبر نیست.'); }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('فقط منابع HTTP و HTTPS پشتیبانی می‌شوند؛ RTSP/RTMP/UDP/SRT قابل عبور از این Worker نیستند.');
  }
  if (target.username || target.password) throw new Error('آدرس دارای نام کاربری یا رمز داخل URL پذیرفته نمی‌شود.');
  if (target.hash) target.hash = '';

  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const defaultPort = target.protocol === 'https:' ? 443 : 80;
  const port = Number(target.port || defaultPort);
  const allowedPorts = isIPLiteral(host) ? IP_PORTS.get(host) : HOST_PORTS.get(host);

  if (!allowedPorts) {
    if (isIPLiteral(host)) throw new Error('این IP در فهرست مجاز منابع TITAN نیست. فقط IPهای عمومی ثبت‌شده در پلی‌لیست پذیرفته می‌شوند.');
    throw new Error('دامنه این منبع در فهرست مجاز Worker ثبت نشده است؛ دامنه را فقط پس از اطمینان از مجاز بودن به HOST_PORTS اضافه کنید.');
  }
  if (!allowedPorts.includes(port)) throw new Error(`پورت ${port} برای این میزبان در فهرست مجاز نیست.`);
  return target;
}

function bytesIndexOf(buffer, needle) {
  outer: for (let i = 0; i <= buffer.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (buffer[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function concatBytes(a, b) {
  if (!a || !a.length) return b || new Uint8Array(0);
  if (!b || !b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length); return out;
}

function streamSocketBody(reader, initial, socket, chunked) {
  if (!chunked) {
    let first = initial || new Uint8Array(0);
    return new ReadableStream({
      async pull(controller) {
        try {
          if (first.length) { controller.enqueue(first); first = new Uint8Array(0); return; }
          const part = await reader.read();
          if (part.done) { controller.close(); try { await socket.close(); } catch {} return; }
          if (part.value?.length) controller.enqueue(part.value);
        } catch (error) { controller.error(error); try { await socket.close(); } catch {} }
      },
      async cancel() { try { await socket.close(); } catch {} },
    });
  }

  let buffer = initial || new Uint8Array(0);
  let state = 'size';
  let remaining = 0;
  let finished = false;
  const crlf = new Uint8Array([13, 10]);
  async function more() {
    const part = await reader.read();
    if (part.done) return false;
    if (part.value?.length) buffer = concatBytes(buffer, part.value);
    return true;
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!finished) {
          if (state === 'size') {
            const end = bytesIndexOf(buffer, crlf);
            if (end < 0) { if (!(await more())) throw new Error('پاسخ chunked ناقص بود.'); continue; }
            const line = new TextDecoder().decode(buffer.slice(0, end)).trim();
            buffer = buffer.slice(end + 2);
            const sizeText = line.split(';', 1)[0].trim();
            remaining = parseInt(sizeText, 16);
            if (!Number.isFinite(remaining) || remaining < 0) throw new Error('اندازه chunk نامعتبر است.');
            state = remaining === 0 ? 'trailers' : 'data';
            continue;
          }
          if (state === 'data') {
            if (!buffer.length) { if (!(await more())) throw new Error('بدنه chunked ناتمام ماند.'); continue; }
            const count = Math.min(buffer.length, remaining);
            const chunk = buffer.slice(0, count);
            buffer = buffer.slice(count);
            remaining -= count;
            if (remaining === 0) state = 'data-crlf';
            controller.enqueue(chunk);
            return;
          }
          if (state === 'data-crlf') {
            while (buffer.length < 2) { if (!(await more())) throw new Error('پایان chunk نامعتبر است.'); }
            if (buffer[0] !== 13 || buffer[1] !== 10) throw new Error('جداکننده chunk نامعتبر است.');
            buffer = buffer.slice(2); state = 'size'; continue;
          }
          if (state === 'trailers') {
            const end = bytesIndexOf(buffer, crlf);
            if (end < 0) { if (!(await more())) { finished = true; break; } continue; }
            const line = new TextDecoder().decode(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
            if (!line.trim()) { finished = true; break; }
            continue;
          }
        }
        controller.close(); try { await socket.close(); } catch {}
      } catch (error) { controller.error(error); try { await socket.close(); } catch {} }
    },
    async cancel() { try { await socket.close(); } catch {} },
  });
}

async function fetchViaSocket(target, incoming, redirectCount = 0) {
  if (redirectCount > 4) throw new Error('تعداد تغییرمسیرهای منبع بیش از حد مجاز است.');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const socket = connect({ hostname: host, port }, { secureTransport: target.protocol === 'https:' ? 'on' : 'off', allowHalfOpen: false });
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const path = `${target.pathname || '/'}${target.search || ''}`;
  const hostHeader = target.host;
  const lines = [
    `${incoming.method} ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'User-Agent: Mozilla/5.0 (compatible; TITAN-Stream-Proxy/1.0.1)',
    'Accept: */*',
    'Accept-Encoding: identity',
    'Connection: close',
    'Icy-MetaData: 0',
  ];
  const range = incoming.headers.get('Range');
  const ifRange = incoming.headers.get('If-Range');
  if (range) lines.push(`Range: ${range}`);
  if (ifRange) lines.push(`If-Range: ${ifRange}`);
  await writer.write(new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\n`));
  await writer.close();

  let buffer = new Uint8Array(0);
  const separator = new Uint8Array([13, 10, 13, 10]);
  let headerEnd = -1;
  while (headerEnd < 0) {
    const part = await reader.read();
    if (part.done) throw new Error('منبع IP قبل از ارسال سربرگ HTTP اتصال را بست.');
    buffer = concatBytes(buffer, part.value || new Uint8Array(0));
    if (buffer.length > 65536) throw new Error('سربرگ پاسخ منبع بیش از حد بزرگ است.');
    headerEnd = bytesIndexOf(buffer, separator);
  }

  const headerText = new TextDecoder('iso-8859-1').decode(buffer.slice(0, headerEnd));
  const bodyInitial = buffer.slice(headerEnd + 4);
  const headerLines = headerText.split('\r\n');
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/i.exec(headerLines.shift() || '');
  if (!statusMatch) throw new Error('پاسخ منبع IP، وضعیت HTTP معتبر ندارد.');
  const status = Number(statusMatch[1]);
  const statusText = statusMatch[2] || '';
  const upstreamHeaders = new Headers();
  for (const line of headerLines) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      try { upstreamHeaders.append(name, value); } catch {}
    }
  }

  if (REDIRECT_CODES.has(status) && upstreamHeaders.get('Location')) {
    const location = new URL(upstreamHeaders.get('Location'), target).href;
    try { await socket.close(); } catch {}
    const next = validateTarget(location);
    return fetchUpstream(next, incoming, redirectCount + 1);
  }

  const transferEncoding = upstreamHeaders.get('Transfer-Encoding') || '';
  const chunked = /chunked/i.test(transferEncoding);
  if (chunked) upstreamHeaders.delete('Content-Length');
  upstreamHeaders.delete('Transfer-Encoding');
  upstreamHeaders.delete('Connection');
  upstreamHeaders.delete('Keep-Alive');
  if (incoming.method === 'HEAD') {
    try { await socket.close(); } catch {}
    return { response: new Response(null, { status, statusText, headers: upstreamHeaders }), finalUrl: target };
  }
  return {
    response: new Response(streamSocketBody(reader, bodyInitial, socket, chunked), { status, statusText, headers: upstreamHeaders }),
    finalUrl: target,
  };
}

async function fetchViaFetch(target, incoming, redirectCount = 0) {
  if (redirectCount > 4) throw new Error('تعداد تغییرمسیرهای منبع بیش از حد مجاز است.');
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (compatible; TITAN-Stream-Proxy/1.0.1)',
    'Accept': incoming.headers.get('Accept') || '*/*',
    'Accept-Encoding': 'identity',
  });
  const range = incoming.headers.get('Range');
  const ifRange = incoming.headers.get('If-Range');
  if (range) headers.set('Range', range);
  if (ifRange) headers.set('If-Range', ifRange);
  const response = await fetch(target.href, { method: incoming.method, headers, redirect: 'manual', cache: 'no-store' });
  if (REDIRECT_CODES.has(response.status) && response.headers.get('Location')) {
    const location = new URL(response.headers.get('Location'), target).href;
    try { await response.body?.cancel(); } catch {}
    return fetchUpstream(validateTarget(location), incoming, redirectCount + 1);
  }
  return { response, finalUrl: target };
}

async function fetchUpstream(target, incoming, redirectCount = 0) {
  // Free-plan compatible routing:
  // - Workers Fetch does not accept IP-literal URLs, so public IP origins use TCP sockets.
  // - Non-standard ports use TCP sockets too; no allow_custom_ports flag or paid add-on is needed.
  // - Standard domain HTTP/HTTPS origins use the Fetch API.
  const defaultPort = target.protocol === 'https:' ? 443 : 80;
  const requestedPort = Number(target.port || defaultPort);
  if (isIPLiteral(target.hostname) || requestedPort !== defaultPort) {
    return fetchViaSocket(target, incoming, redirectCount);
  }
  return fetchViaFetch(target, incoming, redirectCount);
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlDecode(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function workerExactUrl(workerUrl, target) {
  const out = new URL('/proxy', workerUrl.origin);
  out.searchParams.set('url', target.href);
  return out.href;
}

function workerDirectoryUrl(workerUrl, target) {
  const u = new URL(target.href);
  const path = u.pathname || '/';
  const cut = path.endsWith('/') ? path.length : path.lastIndexOf('/') + 1;
  const directory = new URL(u.origin + path.slice(0, cut));
  // Preserve origin query tokens for relative DASH segments.
  directory.search = u.search;
  const suffix = path.slice(cut);
  const encoded = base64UrlEncode(directory.href);
  return `${workerUrl.origin}/dir/${encoded}/${suffix}${u.search || ''}`;
}

function resolveManifestUri(value, base) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:data:|skd:|urn:)/i.test(raw)) return null;
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');
    const target = new URL(raw, base);
    // Some signed HLS origins put the authorization token on the master/child playlist URL
    // and expect relative segment/key URLs to inherit it when they do not define their own.
    if (!isAbsolute && !target.search && base.search) target.search = base.search;
    return target;
  } catch { return null; }
}

function rewriteHls(text, base, workerUrl) {
  return String(text).replace(/\r?\n/g, '\n').split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.charAt(0) === '#') {
      return line.replace(/\b(URI|SERVER-URI)\s*=\s*(["'])(.*?)\2/gi, (whole, attribute, quote, value) => {
        const target = resolveManifestUri(value, base);
        return target ? `${attribute}=${quote}${workerExactUrl(workerUrl, target)}${quote}` : whole;
      });
    }
    const target = resolveManifestUri(trimmed, base);
    return target ? line.replace(trimmed, workerExactUrl(workerUrl, target)) : line;
  }).join('\n');
}

function rewriteDash(text, base, workerUrl) {
  let xml = String(text);
  let foundBase = false;
  xml = xml.replace(/(<BaseURL\b[^>]*>)([\s\S]*?)(<\/BaseURL>)/gi, (whole, open, value, close) => {
    const target = resolveManifestUri(value.replace(/&amp;/g, '&').trim(), base);
    if (!target) return whole;
    foundBase = true;
    return `${open}${workerDirectoryUrl(workerUrl, target)}${close}`;
  });
  // A root BaseURL is required when SegmentTemplate/SegmentURL paths are relative and no BaseURL exists.
  if (!foundBase) {
    const rootDir = new URL(base.href);
    rootDir.pathname = rootDir.pathname.slice(0, rootDir.pathname.lastIndexOf('/') + 1);
    // Preserve signed-query parameters used by relative DASH segment URLs.
    const proxiedBase = workerDirectoryUrl(workerUrl, rootDir);
    xml = xml.replace(/(<MPD\b[^>]*>)/i, `$1<BaseURL>${proxiedBase}</BaseURL>`);
  }
  // Rewrite only absolute URL attributes; relative media templates resolve against the rewritten BaseURL.
  xml = xml.replace(/\b(media|initialization|sourceURL|href)\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi, (whole, name, quote, value) => {
    const target = resolveManifestUri(value, base);
    return target ? `${name}=${quote}${workerDirectoryUrl(workerUrl, target)}${quote}` : whole;
  });
  return xml;
}

async function readTextLimited(response, maxBytes = 2 * 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('فهرست رسانه غیرعادی بزرگ است و برای بازنویسی ایمن پذیرفته نشد.'); }
      chunks.push(part.value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(merged);
}

function addCors(response, headers) {
  const out = new Headers(response.headers);
  for (const [name, value] of headers.entries()) out.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
}

async function handleProxy(request, workerUrl, cors) {
  const incomingUrl = new URL(request.url);
  let rawTarget = incomingUrl.searchParams.get('url');
  if (!rawTarget) return json({ ok: false, error: 'پارامتر url ارسال نشده است.' }, 400, cors);
  let target;
  try { target = validateTarget(rawTarget); }
  catch (error) { return json({ ok: false, error: error.message }, 403, cors); }

  let upstream;
  try { upstream = await fetchUpstream(target, request); }
  catch (error) { return json({ ok: false, error: `ارتباط با منبع ناموفق بود: ${String(error?.message || error).slice(0, 260)}` }, 502, cors); }

  const response = upstream.response;
  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
  const path = upstream.finalUrl.pathname.toLowerCase();
  const maybeHls = /mpegurl|vnd\.apple\.mpegurl/.test(contentType) || /\.m3u8?$/.test(path);
  const maybeDash = /dash\+xml/.test(contentType) || /\.mpd$/.test(path);

  if (request.method === 'HEAD' || (!maybeHls && !maybeDash) || !response.ok) return addCors(response, cors);

  let text;
  try { text = await readTextLimited(response); }
  catch (error) { return json({ ok: false, error: error.message }, 502, cors); }
  const looksHls = maybeHls || /^\s*#EXTM3U(?:\s|$)/i.test(text);
  const looksDash = !looksHls && (maybeDash || /<MPD\b/i.test(text));
  if (looksHls) text = rewriteHls(text, upstream.finalUrl, workerUrl);
  else if (looksDash) text = rewriteDash(text, upstream.finalUrl, workerUrl);

  const headers = new Headers(cors);
  headers.set('Content-Type', looksHls ? 'application/vnd.apple.mpegurl; charset=utf-8' : (looksDash ? 'application/dash+xml; charset=utf-8' : (response.headers.get('Content-Type') || 'text/plain; charset=utf-8')));
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  return new Response(text, { status: response.status, headers });
}

async function handleDirectoryProxy(request, workerUrl, cors) {
  const url = new URL(request.url);
  const rest = url.pathname.slice('/dir/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return json({ ok: false, error: 'مسیر پراکسی پوشه نامعتبر است.' }, 400, cors);
  let base;
  try { base = new URL(base64UrlDecode(rest.slice(0, slash))); }
  catch { return json({ ok: false, error: 'کد مسیر پایه نامعتبر است.' }, 400, cors); }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const suffix = rest.slice(slash + 1);
  let target;
  try {
    target = new URL(suffix, base);
    if (url.search) target.search = url.search;
    else if (base.search && !target.search) target.search = base.search;
    target = validateTarget(target.href);
  } catch (error) { return json({ ok: false, error: error.message }, 403, cors); }
  let upstream;
  try { upstream = await fetchUpstream(target, request); }
  catch (error) { return json({ ok: false, error: `دریافت قطعه رسانه ناموفق بود: ${String(error?.message || error).slice(0, 260)}` }, 502, cors); }
  return addCors(upstream.response, cors);
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (!cors) return new Response('Origin is not allowed.', { status: 403 });

    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'فقط GET و HEAD پشتیبانی می‌شوند.' }, 405, cors);

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return json({
        ok: true,
        service: 'TITAN Cloudflare Stream Proxy',
        version: VERSION,
        allowedDomainHosts: HOST_PORTS.size,
        allowedPublicIpHosts: IP_PORTS.size,
        appOrigin: APP_ORIGIN,
        hlsRewrite: true,
        dashBaseUrlRewrite: true,
        rangeRequests: true,
        freePlanCompatible: true,
        customPorts: 'TCP sockets (no allow_custom_ports flag required)',
      }, 200, cors);
    }
    if (url.pathname === '/proxy' || url.pathname === '/') return handleProxy(request, url, cors);
    if (url.pathname.startsWith('/dir/')) return handleDirectoryProxy(request, url, cors);
    return json({ ok: false, error: 'مسیر Worker شناخته نشد. از /health یا /proxy?url=... استفاده کنید.' }, 404, cors);
  }
};

// Exposed only for local tests; it does not add an HTTP route.
export const __test = { validateTarget, rewriteHls, rewriteDash, workerDirectoryUrl, workerExactUrl };

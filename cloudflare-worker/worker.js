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

const VERSION = '1.2.0';
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



/* -------------------------------------------------------------------------
 * Telewebion manifest rewrite module supplied by the project owner.
 * Kept separate from the general TITAN HTTP/HTTPS proxy routes.
 * Routes: /<channel>/<rendition> and /segment?url=<telewebion-ts-url>
 * ------------------------------------------------------------------------- */
/**
 * Telewebion manifest rewriter, for players that cannot handle the original.
 *
 * WHY THIS EXISTS
 * Telewebion publishes IRIB's channels, and it is the only source for them reachable from
 * outside Iran. Its media playlists are valid HLS, and one number in them is more than a
 * television can hold:
 *
 *   EXT-X-MEDIA-SEQUENCE is sixteen digits, for example 1786395804195022, because the
 *   packager derives it from a microsecond timestamp. Samsung's AVPlay keeps that field in
 *   a SIGNED 32 bit integer, so anything above 2,147,483,647 overflows and its window
 *   arithmetic collapses. Telewebion's value is about 831,000 times the limit.
 *
 * Measured on a Samsung QE55S90D running Tizen 9.0, one property changed at a time, by
 * serving AVPlay manifests built from this same stream:
 *
 *   sequence 2,147,483,000 (just under 2^31)  ->  plays, window reported correctly
 *   sequence 2,147,484,000 (just over 2^31)   ->  reports the stream as 2000ms, one frame
 *   sequence 4,294,966,000 (just under 2^32)  ->  same failure, so it is signed, not unsigned
 *
 * THE WINDOW IS NOT THE PROBLEM, AND THAT MATTERS
 * The same test says the size of the playlist is fine: 3600 segments and 813KB parsed
 * correctly and played, as did 600 and 120. So trimming is not what fixes anything, and a
 * shorter window on its own would not have helped. Trimming stays because it is what keeps
 * this Worker's CPU and egress small, which is a cost decision rather than a fix. Anyone
 * tempted to raise SEQUENCE_MODULUS to fit "32 bits" should read the table above first:
 * four billion is not a safe number here, two billion is.
 *
 * COST CONTROL, THE POINT OF THE DESIGN
 * AVPlay receives absolute Telewebion segment URLs, so its video never touches this Worker.
 * Browser JavaScript requests need segment proxying because Telewebion allows only its own
 * website origin. That browser path carries the video and consumes far more Worker requests.
 * Cloudflare bills a Worker per incoming request. fetch() subrequests and the Cache API are
 * free and do not count.
 *
 * How often a player comes back was assumed here and is now measured. AVPlay reloads at
 * about HALF the declared TARGETDURATION, not once per target, and it starts playback about
 * three targets behind the live edge. Counted over 64 seconds of real playback:
 *
 *   target 12s -> reload every 6.4s -> 562 requests/viewer-hour -> 178 viewer-hours/day
 *   target 20s -> reload every 9.1s -> 394 requests/viewer-hour -> 253 viewer-hours/day
 *   target 30s -> reload every 12.8s -> 281 requests/viewer-hour -> 355 viewer-hours/day
 *
 * The right hand column is the free plan's 100,000 requests a day. The old comment here
 * claimed 300 requests per viewer-hour at a 12 second target, which was half the truth and
 * therefore twice the capacity.
 *
 * Two things that would have decoupled the request rate from the latency do not work, and
 * both were tried on the set rather than reasoned about:
 *
 *   EXT-X-START:TIME-OFFSET   ignored. Playback began 33.6s behind the edge with and
 *                             without it, which is three times the target either way.
 *   Cache-Control: max-age    ignored for playlist reloads. Ten requests in 64 seconds
 *                             with max-age=10, and ten with no-cache.
 *
 * So the only lever is TARGETDURATION, and it buys fewer requests with more delay behind
 * live. 20 seconds is the default below: a third fewer requests than before, and a viewer
 * about a minute behind the broadcast, which nobody notices on a channel and everybody
 * notices during a football match.
 *
 * PLAYERS THAT CAN READ THE ORIGINAL ARE SENT AWAY
 * VLC, ffmpeg, mpv and Kodi read Telewebion's original manifest perfectly well, so they are
 * redirected to it and stop costing anything at all. Native browser media requests are also
 * redirected. Browser JavaScript requests receive a rewritten manifest whose segment URLs use
 * the restricted proxy route. AVPlay identifies itself as "samsung-agent/1.1", so it receives
 * the rewritten manifest with direct Telewebion segment URLs.
 *
 * DEPLOY
 *   npx wrangler deploy
 *
 * USE
 *   https://<your-worker>.workers.dev/tv1/1080p
 *   https://<your-worker>.workers.dev/irinn/720p
 */

const ORIGIN = "https://ncdn.telewebion.ir";
const TARGET_DURATION = 20;   // what we advertise, halved is how often a player returns
const WINDOW_SECONDS = 150;   // three targets of start latency, plus 90s of margin
const EDGE_CACHE_SECONDS = 8; // collapses concurrent viewers into one origin fetch
/**
 * Nine digits, and the ceiling is 2^31 rather than 2^32: see the table at the top. Nine
 * digits also means the number a player sees never grows past this, whatever Telewebion's
 * does, and it advances by one per segment exactly as the original does.
 */
const SEQUENCE_MODULUS = 1_000_000_000;

const SLUG = /^[a-z0-9_-]{1,40}$/i;
const RENDITION = /^(\d{3,4}p)$/;
const TELEWEBION_HOST = /(^|\.)telewebion\.(ir|net)$/i;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
};

export function isNativeMediaRequest(request) {
  return request.headers.get("range") === "bytes=0-"
    && !/samsung-agent/i.test(request.headers.get("user-agent") ?? "");
}

/**
 * Desktop players that read the original without help, and are therefore not this Worker's
 * problem. Browsers use the range based branch above when native media playback is selected.
 */
const READS_THE_ORIGINAL = /vlc|libvlc|lavf|ffmpeg|mpv|kodi|gstreamer|mplayer/i;

async function proxySegment(request, url) {
  let target;
  try {
    target = new URL(url.searchParams.get("url"));
  } catch {
    return new Response("invalid segment\n", { status: 400 });
  }
  if (target.protocol !== "https:" || !TELEWEBION_HOST.test(target.hostname)
      || !target.pathname.endsWith(".ts")) {
    return new Response("invalid segment\n", { status: 400 });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed\n", { status: 405 });
  }
  const range = request.headers.get("range");
  let upstream;
  try {
    upstream = await fetch(target, {
      headers: range ? { Range: range } : {},
      redirect: "error",
    });
  } catch {
    return new Response("segment unreachable\n", { status: 502 });
  }
  const headers = new Headers(CORS_HEADERS);
  for (const name of ["content-type", "content-length", "accept-ranges", "content-range", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}



async function handleTelewebionRequest(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed\n", { status: 405, headers: CORS_HEADERS });
    if (url.pathname === "/segment") return proxySegment(request, url);
    const [, slug, rendition] = url.pathname.split("/");

    if (!slug || !SLUG.test(slug)) {
      return new Response("usage: /<channel>/<rendition>, e.g. /tv1/1080p\n", { status: 400 });
    }
    const quality = RENDITION.test(rendition || "") ? rendition : "1080p";
    const source = `${ORIGIN}/${slug}/live/${quality}/index.m3u8`;

    if (isNativeMediaRequest(request)) {
      return Response.redirect(source, 302);
    }

    /*
     * A player that can read the original is sent to it, and stops costing anything.
     *
     * Temporary rather than permanent, so nothing caches the decision: the day Telewebion
     * changes its addresses, this Worker is the only thing that has to know. If a player
     * follows the redirect but keeps asking here on every reload, the cost is this branch
     * rather than a fetch and a parse, so the worst case is still cheaper than before.
     */
    const userAgent = request.headers.get("user-agent") ?? "";
    if (READS_THE_ORIGINAL.test(userAgent)) {
      return Response.redirect(source, 302);
    }

    const proxyOrigin = /mozilla/i.test(userAgent) ? url.origin : null;
    const cache = caches.default;
    const cacheKey = new Request(
      `${url.origin}/${slug}/${quality}${proxyOrigin ? "?cors=1" : ""}`,
      { method: "GET" },
    );
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let upstream;
    try {
      upstream = await fetch(source, {
        headers: { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20", Accept: "*/*" },
        // Four seconds rather than two. A player now returns every nine seconds or so, and
        // two segments of staleness against a 150 second window is nothing, so this halves
        // the origin fetches for a channel with several viewers.
        cf: { cacheTtl: 4, cacheEverything: true },
      });
    } catch {
      return new Response("upstream unreachable\n", { status: 502 });
    }
    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}\n`, { status: 502 });
    }

    // fetch() follows redirects, and upstream.url is where the manifest actually came
    // from. Relative segment paths must resolve against that, not against `source`:
    // ncdn only serves manifests and refuses segments, which is the other reason strict
    // players fail on the original URL.
    const body = await upstream.text();
    const playlist = rewrite(body, upstream.url, proxyOrigin);
    if (!playlist) return new Response("unexpected upstream format\n", { status: 502 });

    const response = new Response(playlist, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}


function rewrite(body, finalUrl, proxyOrigin = null) {
  /*
   * Upstream lists two hours of segments and we publish two and a half minutes of them, so
   * the hot path must stay cheap: count in a single pass, keep only the tail in a ring
   * buffer, and resolve URLs for that tail alone. Building a URL object per line would cost
   * roughly 8ms across 1800 entries, which is where the free plan's 10ms CPU ceiling is.
   *
   * That headroom is worth watching rather than trusting, because the upstream window has
   * already doubled once: it was 1800 segments and 318KB when this was written and it is
   * 3600 and 651KB today, so the single pass walks twice the lines it used to.
   */
  const base = new URL(finalUrl);
  const baseDir = base.href.slice(0, base.href.lastIndexOf("/") + 1);
  const lines = body.split("\n");

  const keepMax = Math.max(3, Math.ceil(WINDOW_SECONDS / 2)) + 4;
  const infs = new Array(keepMax);
  const uris = new Array(keepMax);
  let count = 0, slot = 0, sequence = null, pendingInf = null, longest = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 35) {              // '#'
      if (line.startsWith("#EXTINF")) {
        pendingInf = line;
        const seconds = parseFloat(line.slice(8));
        if (seconds > longest) longest = seconds;
      } else if (sequence === null && line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        sequence = Number(line.slice(22));
      }
    } else if (pendingInf !== null) {
      infs[slot] = pendingInf;                    // ring buffer, only the tail survives
      uris[slot] = line;
      slot = (slot + 1) % keepMax;
      count++;
      pendingInf = null;
    }
  }
  if (!count || sequence === null) return null;

  const segment = longest || 2;
  const keep = Math.min(count, Math.max(3, Math.ceil(WINDOW_SECONDS / segment)));
  const target = Math.max(TARGET_DURATION, Math.ceil(longest));

  const out = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${target}`,
    `#EXT-X-MEDIA-SEQUENCE:${(sequence + count - keep) % SEQUENCE_MODULUS}`,
  ];
  for (let i = keep; i > 0; i--) {
    const at = (slot - i + keepMax * 2) % keepMax;
    const uri = uris[at];
    const absolute = uri.charCodeAt(0) === 104 && uri.startsWith("http") ? uri
      : uri.charCodeAt(0) === 47 ? base.origin + uri
        : baseDir + uri;
    out.push(infs[at], proxyOrigin
      ? `${proxyOrigin}/segment?url=${encodeURIComponent(absolute)}`
      : absolute);
  }
  return out.join("\n") + "\n";
}


/* -------------------------------------------------------------------------
 * General TITAN proxy request handler. This covers only exact source hosts
 * already present in the current project playlists; it is not an open proxy.
 * ------------------------------------------------------------------------- */
async function handleTitanProxyRequest(request) {
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
        telewebionManifestRewrite: true,
        telewebionSegmentProxy: true,
      }, 200, cors);
    }
    if (url.pathname === '/proxy' || url.pathname === '/') return handleProxy(request, url, cors);
    if (url.pathname.startsWith('/dir/')) return handleDirectoryProxy(request, url, cors);
    return json({ ok: false, error: 'مسیر Worker شناخته نشد. از /health یا /proxy?url=... استفاده کنید.' }, 404, cors);
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Telewebion routes use the exact provider-specific manifest rewriter from worker.zip.
    if (url.pathname === '/segment' || /^\/[a-z0-9_-]{1,40}\/\d{3,4}p\/?$/i.test(url.pathname)) {
      return handleTelewebionRequest(request, env, ctx);
    }
    // All other routes use the allow-listed general TITAN proxy.
    return handleTitanProxyRequest(request);
  }
};

// Local-test hooks; these exports do not add public HTTP routes.
export const __test = {
  validateTarget,
  rewriteHls,
  rewriteDash,
  workerDirectoryUrl,
  workerExactUrl,
  telewebionRewrite: rewrite
};

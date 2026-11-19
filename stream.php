<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

// Streaming proxy: disable PHP/web-server buffering as much as PHP can control.
@ini_set('output_buffering', '0');
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) { @ob_end_clean(); }
@set_time_limit(0);
ignore_user_abort(false);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Accel-Buffering: no');

function fail_stream(int $status, string $message, array $extra = []): never {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Accel-Buffering: no');
    }
    echo json_encode(['ok'=>false,'error'=>$message] + $extra, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}
function b64url_decode_stream(string $v): string|false {
    $v = strtr($v, '-_', '+/');
    return base64_decode($v . str_repeat('=', (4 - strlen($v) % 4) % 4), true);
}
function is_public_ip_stream(string $ip): bool {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}
/**
 * Resolve and cache only public addresses for a short period. HLS requests one PHP
 * request per segment; caching avoids a DNS lookup for every segment. The selected
 * public IP is also pinned into cURL below, preventing a second DNS lookup/rebinding.
 */
function public_ips_for_stream_host(string $host): array {
    $host = strtolower(rtrim(trim($host, '[]'), '.'));
    if (filter_var($host, FILTER_VALIDATE_IP)) return is_public_ip_stream($host) ? [$host] : [];
    if ($host === '' || preg_match('/(^|\.)(localhost|local|internal)$/i', $host)) return [];

    $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'titan-dns-'.hash('sha256', __DIR__.'|'.$host).'.json';
    $cached = @json_decode((string)@file_get_contents($cacheFile), true);
    if (is_array($cached) && (int)($cached['expires'] ?? 0) > time() && is_array($cached['ips'] ?? null)) {
        $valid = array_values(array_filter($cached['ips'], static fn($ip) => is_string($ip) && is_public_ip_stream($ip)));
        if ($valid && count($valid) === count($cached['ips'])) return $valid;
    }

    $records = @dns_get_record($host, DNS_A | DNS_AAAA);
    $ips = []; $ttl = 30;
    if (is_array($records)) foreach ($records as $record) {
        if (!empty($record['ip'])) $ips[] = $record['ip'];
        if (!empty($record['ipv6'])) $ips[] = $record['ipv6'];
        if (isset($record['ttl']) && (int)$record['ttl'] > 0) $ttl = min($ttl, (int)$record['ttl']);
    }
    if (!$ips) { $v4 = @gethostbynamel($host); if (is_array($v4)) $ips = $v4; }
    $ips = array_values(array_unique($ips));
    if (!$ips) return [];
    foreach ($ips as $ip) if (!is_public_ip_stream($ip)) return [];
    // Prefer IPv4 where available; many shared hosts have incomplete IPv6 egress.
    usort($ips, static fn($a, $b) => (filter_var($a, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? 0 : 1) <=> (filter_var($b, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? 0 : 1));

    $entry = ['expires' => time() + max(5, min(30, $ttl)), 'ips' => $ips];
    @file_put_contents($cacheFile, json_encode($entry, JSON_UNESCAPED_SLASHES), LOCK_EX);
    @chmod($cacheFile, 0600);
    return $ips;
}
function host_is_public_stream(string $host): bool {
    return public_ips_for_stream_host($host) !== [];
}
function curl_resolve_pin_for_stream(string $url): ?string {
    $p = parse_url($url);
    if (!$p || empty($p['host'])) return null;
    $host = strtolower(trim((string)$p['host'], '[]'));
    if (filter_var($host, FILTER_VALIDATE_IP)) return null;
    $ips = public_ips_for_stream_host($host);
    if (!$ips) fail_stream(403, 'میزبان منبع عمومی یا قابل دسترسی نیست.');
    $port = (int)($p['port'] ?? (strtolower((string)($p['scheme'] ?? 'https')) === 'https' ? 443 : 80));
    $ip = $ips[0];
    if (str_contains($ip, ':')) $ip = '['.$ip.']';
    return $host.':'.$port.':'.$ip;
}
function validate_stream_url(string $url): array {
    if (strlen($url) > 4096 || !filter_var($url, FILTER_VALIDATE_URL)) fail_stream(400, 'آدرس منبع معتبر نیست.');
    $p = parse_url($url);
    if (!$p || !in_array(strtolower((string)($p['scheme'] ?? '')), ['http','https'], true) || empty($p['host']) || isset($p['user']) || isset($p['pass'])) fail_stream(400, 'فقط منابع HTTP و HTTPS پشتیبانی می‌شوند.');
    if (!host_is_public_stream((string)$p['host'])) fail_stream(403, 'میزبان منبع عمومی یا قابل دسترسی نیست.');
    return $p;
}
function resolve_stream_url(string $base, string $ref): string {
    $ref = trim($ref);
    if ($ref === '' || preg_match('~^(data|skd|urn):~i', $ref)) return $ref;
    if (preg_match('~^https?://~i', $ref)) return preg_replace('/#.*$/', '', $ref);
    $b = parse_url($base);
    if (!$b || empty($b['scheme']) || empty($b['host'])) return $ref;
    $origin = $b['scheme'].'://'.$b['host'].(isset($b['port']) ? ':'.$b['port'] : '');
    if (str_starts_with($ref, '//')) return $b['scheme'].':'.preg_replace('/#.*$/', '', $ref);
    if ($ref[0] === '#') return $base;
    if ($ref[0] === '?') return $origin.($b['path'] ?? '/').$ref;
    $r = parse_url($ref);
    $refPath = $r['path'] ?? '';
    if ($refPath !== '' && $refPath[0] === '/') $path = $refPath;
    else {
        $basePath = $b['path'] ?? '/';
        $dir = substr($basePath, 0, strrpos($basePath, '/') !== false ? strrpos($basePath, '/') + 1 : 0);
        $path = $dir.$refPath;
    }
    $absolute = str_starts_with($path, '/');
    $trailing = str_ends_with($path, '/');
    $stack = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') { array_pop($stack); continue; }
        $stack[] = $part;
    }
    $normalized = ($absolute ? '/' : '').implode('/', $stack).($trailing ? '/' : '');
    if ($normalized === '') $normalized = '/';
    // Some IPTV/CDN origins put a signed token on the manifest URL and expect
    // the same token on relative child playlists, segments, and keys. Preserve
    // that query only when the child URI does not provide its own query string.
    $query = isset($r['query']) ? '?'.$r['query'] : (isset($b['query']) ? '?'.$b['query'] : '');
    return $origin.$normalized.$query;
}
function proxy_child_url(string $url, int $expires): string {
    if (!preg_match('~^https?://~i', $url)) return $url;
    $b64 = rtrim(strtr(base64_encode($url), '+/', '-_'), '=');
    $sig = titanStreamSignature($url, $expires);
    return './stream.php?u='.rawurlencode($b64).'&e='.$expires.'&s='.$sig;
}
function rewrite_hls_manifest(string $body, string $baseUrl, int $expires): string {
    $lines = preg_split('/\r\n|\n|\r/', $body) ?: [];
    $out = [];
    foreach ($lines as $line) {
        $trim = trim($line);
        if ($trim === '') { $out[] = $line; continue; }
        if (str_starts_with($trim, '#')) {
            $line = preg_replace_callback('/URI="([^"]+)"/i', function($m) use ($baseUrl, $expires) {
                return 'URI="'.proxy_child_url(resolve_stream_url($baseUrl, $m[1]), $expires).'"';
            }, $line) ?? $line;
            $out[] = $line;
        } else {
            $out[] = proxy_child_url(resolve_stream_url($baseUrl, $trim), $expires);
        }
    }
    return implode("\n", $out);
}

/** Build a same-origin route base for relative DASH SegmentTemplate/SegmentList URLs. */
function dash_proxy_prefix(string $url, int $expires): string {
    $p = parse_url($url);
    if (!$p || empty($p['scheme']) || empty($p['host'])) return './';
    $origin = $p['scheme'].'://'.$p['host'].(isset($p['port']) ? ':'.$p['port'] : '');
    $path = (string)($p['path'] ?? '/');
    if (!str_ends_with($path, '/')) {
        $slash = strrpos($path, '/');
        $path = $slash === false ? '/' : substr($path, 0, $slash + 1);
    }
    $base = $origin.$path.(isset($p['query']) ? '?'.$p['query'] : '');
    $b64 = rtrim(strtr(base64_encode($base), '+/', '-_'), '=');
    $sig = titanStreamSignature($base, $expires);
    $appPath = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/stream.php'))), '/');
    if ($appPath === '.' || $appPath === '/') $appPath = '';
    return $appPath.'/dash/'.$b64.'/'.$expires.'/'.$sig.'/';
}
/** Rewrite common DASH BaseURL and absolute segment-template URLs to our signed same-origin gateway. */
function rewrite_dash_manifest(string $body, string $baseUrl, int $expires): string {
    $rewrittenBase = false;
    $body = preg_replace_callback('~<BaseURL(\b[^>]*)>(.*?)</BaseURL>~is', function($m) use ($baseUrl, $expires, &$rewrittenBase) {
        $raw = html_entity_decode(trim(strip_tags($m[2])), ENT_QUOTES | ENT_XML1, 'UTF-8');
        if ($raw === '' || preg_match('~^(data|urn|skd):~i', $raw)) return $m[0];
        $absolute = resolve_stream_url($baseUrl, $raw);
        if (!preg_match('~^https?://~i', $absolute)) return $m[0];
        $rewrittenBase = true;
        return '<BaseURL'.$m[1].'>'.htmlspecialchars(dash_proxy_prefix($absolute, $expires), ENT_QUOTES | ENT_XML1, 'UTF-8').'</BaseURL>';
    }, $body) ?? $body;

    // SegmentTemplate values containing $Number$, $Time$, or $RepresentationID$ must
    // keep those placeholders in the URL path so dash.js/Shaka can substitute them.
    $body = preg_replace_callback('~\b(media|initialization|sourceURL|index)\s*=\s*(["\'])(.*?)\2~is', function($m) use ($baseUrl, $expires) {
        $raw = html_entity_decode($m[3], ENT_QUOTES | ENT_XML1, 'UTF-8');
        if (!preg_match('~^https?://~i', $raw)) return $m[0];
        $p = parse_url($raw);
        if (!$p || empty($p['host'])) return $m[0];
        $origin = $p['scheme'].'://'.$p['host'].(isset($p['port']) ? ':'.$p['port'] : '');
        $path = (string)($p['path'] ?? '/');
        $slash = strrpos($path, '/');
        $dir = $origin.($slash === false ? '/' : substr($path, 0, $slash + 1));
        $name = $slash === false ? $path : substr($path, $slash + 1);
        $url = dash_proxy_prefix($dir, $expires).$name.(isset($p['query']) ? '?'.$p['query'] : '');
        return $m[1].'='.$m[2].htmlspecialchars($url, ENT_QUOTES | ENT_XML1, 'UTF-8').$m[2];
    }, $body) ?? $body;

    if (!$rewrittenBase && stripos($body, '<BaseURL') === false) {
        $base = htmlspecialchars(dash_proxy_prefix($baseUrl, $expires), ENT_QUOTES | ENT_XML1, 'UTF-8');
        $body = preg_replace('~(<MPD\b[^>]*>)~i', '$1<BaseURL>'.$base.'</BaseURL>', $body, 1) ?? $body;
    }
    return $body;
}

if (!function_exists('curl_init')) fail_stream(503, 'افزونه PHP cURL روی هاست فعال نیست. پخش مستقیمِ دارای CORS ممکن است کار کند، اما پراکسی HLS و MPEG-TS به cURL نیاز دارد.');
$encoded = (string)($_GET['u'] ?? '');
$expires = filter_var($_GET['e'] ?? null, FILTER_VALIDATE_INT);
$sig = (string)($_GET['s'] ?? '');
$url = b64url_decode_stream($encoded);
if (!is_string($url) || !$expires || $expires < time() || $expires > time()+90000 || !hash_equals(titanStreamSignature($url, (int)$expires), $sig)) fail_stream(403, 'نشانی پخش منقضی یا نامعتبر است؛ دوباره شبکه را انتخاب کنید.');
validate_stream_url($url);
$formatHint = strtolower((string)($_GET['fmt'] ?? ''));
if (!in_array($formatHint, ['hls','dash','mpegts','flv','native'], true)) $formatHint = '';

$range = (string)($_SERVER['HTTP_RANGE'] ?? '');
$forwardHeaders = ['Accept: */*', 'Accept-Encoding: identity'];
if ($range !== '' && preg_match('/^bytes=\d*-\d*(,\d*-\d*)*$/', $range)) $forwardHeaders[] = 'Range: '.$range;
if (!empty($_SERVER['HTTP_IF_RANGE'])) $forwardHeaders[] = 'If-Range: '.substr((string)$_SERVER['HTTP_IF_RANGE'], 0, 256);
$maxRedirects = 5;
$currentUrl = $url;

for ($hop=0; $hop<=$maxRedirects; $hop++) {
    $responseHeaders = [];
    $status = 0;
    $manifestBody = '';
    $errorBody = '';
    $isManifest = (bool)preg_match('/\.(m3u8?|m3u)(?:$|[?#])|[?&](?:m3u8|type=m3u8)(?:[=&]|$)|\/hls(?:\/|$)|\/playlist\.?(?:$|[?#])/i', $currentUrl);
    $isDash = (bool)preg_match('/\.mpd(?:$|[?#])/i', $currentUrl);
    $headersSent = false;
    $redirectLocation = '';
    $curlError = '';
    $manifestTooLarge = false;
    $upstreamRejected = false;
    $responseMime = '';

    $ch = curl_init($currentUrl);
    $curlOptions = [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_NOSIGNAL => true,
        CURLOPT_TCP_KEEPALIVE => 1,
        CURLOPT_LOW_SPEED_LIMIT => 128,
        CURLOPT_LOW_SPEED_TIME => 25,
        CURLOPT_BUFFERSIZE => 65536,
        CURLOPT_USERAGENT => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? 'Mozilla/5.0 (compatible; TITANPlayer/3.6.0)'), 0, 512),
        CURLOPT_HTTPHEADER => $forwardHeaders,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HEADERFUNCTION => function($ch, $line) use (&$responseHeaders, &$status, &$isManifest, &$isDash, $currentUrl, &$redirectLocation) {
            $len = strlen($line);
            if (preg_match('~^HTTP/\S+\s+(\d{3})~i', $line, $m)) { $status=(int)$m[1];$responseHeaders=[];$redirectLocation=''; }
            elseif (strpos($line, ':') !== false) {
                [$k,$v] = explode(':',$line,2);$key=strtolower(trim($k));$responseHeaders[$key]=trim($v);
                if ($key==='location') $redirectLocation=trim($v);
            } elseif (trim($line)==='') {
                $ct=strtolower($responseHeaders['content-type']??'');
                if (str_contains($ct,'mpegurl') || str_contains($ct,'vnd.apple.mpegurl') || preg_match('/\.(m3u8?|m3u)(?:$|[?#])|[?&](?:m3u8|type=m3u8)(?:[=&]|$)|\/hls(?:\/|$)|\/playlist\.?(?:$|[?#])/i',$currentUrl)) $isManifest=true;
                if (str_contains($ct,'dash+xml') || preg_match('/\.mpd(?:$|[?#])/i',$currentUrl)) $isDash=true;
            }
            return $len;
        },
        CURLOPT_WRITEFUNCTION => function($ch, $chunk) use (&$responseHeaders,&$status,&$isManifest,&$isDash,&$manifestBody,&$errorBody,&$headersSent,&$manifestTooLarge,&$upstreamRejected,&$responseMime,$formatHint) {
            $len=strlen($chunk);
            if ($status>=300 && $status<400) return $len;
            if ($status<200 || $status>=300) {
                $upstreamRejected=true;
                if (strlen($errorBody)<65536) $errorBody.=substr($chunk,0,65536-strlen($errorBody));
                return $len;
            }
            $mime=strtolower(trim(explode(';',(string)($responseHeaders['content-type']??''))[0]));
            $responseMime=$mime;
            if ($mime==='text/html' || $mime==='application/json' || $mime==='text/json') {
                $upstreamRejected=true;
                if (strlen($errorBody)<65536) $errorBody.=substr($chunk,0,65536-strlen($errorBody));
                return $len;
            }
            if ($isManifest || $isDash) {
                if (strlen($manifestBody)+$len>4*1024*1024) {$manifestTooLarge=true;return 0;}
                $manifestBody.=$chunk;return $len;
            }
            if (!$headersSent) {
                http_response_code($status?:200);
                $ct=$responseHeaders['content-type']??'application/octet-stream';
                $mimeLower=strtolower($ct);
                if ($formatHint==='mpegts' && (str_contains($mimeLower,'octet-stream') || $mimeLower==='')) $ct='video/mp2t';
                elseif ($formatHint==='flv' && (str_contains($mimeLower,'octet-stream') || $mimeLower==='')) $ct='video/x-flv';
                header('Content-Type: '.$ct);
                foreach (['content-length'=>'Content-Length','content-range'=>'Content-Range','accept-ranges'=>'Accept-Ranges','last-modified'=>'Last-Modified','etag'=>'ETag'] as $src=>$dst) if (!empty($responseHeaders[$src])) header($dst.': '.$responseHeaders[$src]);
                header('Cache-Control: no-store');header('X-Accel-Buffering: no');$headersSent=true;
            }
            echo $chunk;
            flush();
            return $len;
        },
    ];
    if (defined('CURLOPT_RESOLVE')) {
        $resolvePin = curl_resolve_pin_for_stream($currentUrl);
        if ($resolvePin !== null) $curlOptions[CURLOPT_RESOLVE] = [$resolvePin];
    }
    curl_setopt_array($ch, $curlOptions);
    $ok=curl_exec($ch);
    $curlNo=curl_errno($ch);
    $curlError=curl_error($ch);
    $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE)?:$status;
    curl_close($ch);

    if ($status>=300 && $status<400 && $redirectLocation!=='') {
        if ($hop >= $maxRedirects) fail_stream(502,'منبع پخش بیش از حد تغییر مسیر داد.');
        $currentUrl=resolve_stream_url($currentUrl,$redirectLocation);
        validate_stream_url($currentUrl);
        continue;
    }
    if ($status>=300 && $status<400) fail_stream(502,'سرور منبع Redirect ناقص برگرداند یا آدرس مقصد تغییر مسیر مشخص نبود.');
    if ($manifestTooLarge) fail_stream(502,'فهرست رسانه بزرگ‌تر از حد مجاز است.');
    if ($status<200 || $status>=300 || $upstreamRejected) {
        $detail = match($status) {
            401 => 'منبع پخش احراز هویت می‌خواهد (HTTP 401).',
            403 => 'منبع پخش دسترسی را رد کرد (HTTP 403). بررسی مجوز، محدودیت منطقه‌ای، Referer و توکن لازم است.',
            404 => 'آدرس استریم یا قطعه آن پیدا نشد (HTTP 404).',
            408, 504 => 'اتصال به سرور پخش زمان‌بر شد.',
            429 => 'سرور پخش تعداد درخواست‌ها را محدود کرد (HTTP 429).',
            default => 'سرور منبع پاسخ رسانه‌ای معتبر نداد',
        };
        if (str_contains(strtolower($responseMime),'text/html') || str_contains(strtolower($responseMime),'json')) $detail .= ' به‌جای رسانه، صفحه HTML/JSON برگشت؛ معمولاً صفحه ورود، محدودیت یا لینک منقضی است.';
        if ($errorBody!=='' && !str_contains(strtolower($responseMime),'text/html')) $detail .= ' پاسخ: '.substr(trim(strip_tags($errorBody)),0,180);
        fail_stream($status>=400&&$status<=599?$status:502,$detail,['upstreamStatus'=>$status,'contentType'=>$responseMime]);
    }
    if ($ok===false && $curlNo!==0) {
        if ($headersSent) { error_log('TITAN stream proxy: '.$curlError); exit; }
        fail_stream(502,'ارتباط هاست با سرور استریم قطع شد: '.$curlError,['upstreamStatus'=>$status]);
    }
    if ($isManifest) {
        if (!str_contains(ltrim($manifestBody),'#EXTM3U')) fail_stream(502,'پاسخ منبع، فهرست HLS معتبر نیست؛ احتمالاً صفحه خطا، مجوز یا فرمت دیگری است.',['upstreamStatus'=>$status,'contentType'=>$responseMime]);
        $rewritten=rewrite_hls_manifest($manifestBody,$currentUrl,(int)$expires);
        http_response_code(200);header('Content-Type: application/vnd.apple.mpegurl; charset=utf-8');header('Cache-Control: no-store');header('X-TITAN-Proxy: hls');
        echo $rewritten;exit;
    }
    if ($isDash) {
        if ($manifestBody === '' || !preg_match('~<MPD\b~i', $manifestBody)) fail_stream(502,'پاسخ منبع، MPD معتبر DASH نیست.',['upstreamStatus'=>$status,'contentType'=>$responseMime]);
        $rewritten = rewrite_dash_manifest($manifestBody, $currentUrl, (int)$expires);
        http_response_code(200);
        header('Content-Type: application/dash+xml; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-TITAN-Proxy: dash');
        echo $rewritten;
        exit;
    }
    if (!$headersSent) {
        http_response_code($status?:502);
        $ct=$responseHeaders['content-type']??'application/octet-stream';
        if ($formatHint==='mpegts' && str_contains(strtolower($ct),'octet-stream')) $ct='video/mp2t';
        elseif ($formatHint==='flv' && str_contains(strtolower($ct),'octet-stream')) $ct='video/x-flv';
        header('Content-Type: '.$ct);
        if (!empty($responseHeaders['content-length'])) header('Content-Length: '.$responseHeaders['content-length']);
    }
    exit;
}
fail_stream(502,'امکان اتصال به منبع پخش فراهم نشد.');

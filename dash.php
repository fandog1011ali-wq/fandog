<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function dash_fail(int $status, string $message): never {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}
function dash_b64decode(string $value): string|false {
    $value = strtr($value, '-_', '+/');
    return base64_decode($value . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
}
function dash_resolve(string $base, string $ref): string {
    $ref = trim($ref);
    if ($ref === '' || str_contains($ref, "\0") || preg_match('~^(?:https?:)?//|^[a-z][a-z0-9+.-]*:~i', $ref)) dash_fail(400, 'مسیر قطعه DASH نامعتبر است.');
    $b = parse_url($base);
    if (!$b || empty($b['scheme']) || empty($b['host'])) dash_fail(400, 'نشانی پایه DASH نامعتبر است.');
    $origin = $b['scheme'].'://'.$b['host'].(isset($b['port']) ? ':'.$b['port'] : '');
    $r = parse_url($ref);
    $refPath = (string)($r['path'] ?? '');
    if (str_starts_with($refPath, '/')) $path = $refPath;
    else {
        $basePath = (string)($b['path'] ?? '/');
        if (!str_ends_with($basePath, '/')) $basePath = substr($basePath, 0, strrpos($basePath, '/') + 1);
        $path = $basePath.$refPath;
    }
    $stack = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') { array_pop($stack); continue; }
        $stack[] = $part;
    }
    $normalized = '/'.implode('/', $stack);
    $query = isset($r['query']) ? '?'.$r['query'] : (isset($b['query']) ? '?'.$b['query'] : '');
    return $origin.$normalized.$query;
}

$encoded = (string)($_GET['b'] ?? '');
$expires = filter_var($_GET['e'] ?? null, FILTER_VALIDATE_INT);
$sig = (string)($_GET['s'] ?? '');
$base = dash_b64decode($encoded);
$path = (string)($_GET['p'] ?? '');
if (!is_string($base) || !$expires || $expires < time() || $expires > time() + 90000 || !hash_equals(titanStreamSignature($base, (int)$expires), $sig)) dash_fail(403, 'بلیت مسیر DASH منقضی یا نامعتبر است.');
$baseParts = parse_url($base);
if (!$baseParts || !in_array(strtolower((string)($baseParts['scheme'] ?? '')), ['http','https'], true) || empty($baseParts['host']) || isset($baseParts['user']) || isset($baseParts['pass'])) dash_fail(400, 'نشانی پایه DASH معتبر نیست.');
if ($path === '' || strlen($path) > 4096 || str_contains($path, "\0") || preg_match('~^(?:https?:)?//|^[a-z][a-z0-9+.-]*:~i', $path)) dash_fail(400, 'مسیر قطعه DASH نامعتبر است.');

$target = dash_resolve($base, $path);
// Preserve query parameters attached to SegmentURL/SegmentTemplate references.
$extra = $_GET;
foreach (['b','e','s','p'] as $reserved) unset($extra[$reserved]);
if ($extra) {
    $separator = str_contains($target, '?') ? '&' : '?';
    $target .= $separator.http_build_query($extra, '', '&', PHP_QUERY_RFC3986);
}
$targetParts = parse_url($target);
if (!$targetParts || strtolower((string)$targetParts['host']) !== strtolower((string)$baseParts['host']) || strtolower((string)$targetParts['scheme']) !== strtolower((string)$baseParts['scheme'])) dash_fail(403, 'مقصد قطعه DASH با میزبان مجاز manifest یکسان نیست.');

$child = rtrim(strtr(base64_encode($target), '+/', '-_'), '=');
$childSig = titanStreamSignature($target, (int)$expires);
$appPath = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/dash.php'))), '/');
if ($appPath === '.' || $appPath === '/') $appPath = '';
$location = $appPath.'/stream.php?u='.rawurlencode($child).'&e='.$expires.'&s='.$childSig;
header('Location: '.$location, true, 302);
exit;

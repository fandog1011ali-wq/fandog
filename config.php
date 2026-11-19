<?php
declare(strict_types=1);

// تنها تنظیمات لازم برای اتصال ربات و آدرس برنامه.
const BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN_HERE';
const APP_URL = 'https://example.com/titan/';

/**
 * توکن احراز وب‌هوک به‌صورت خودکار از BOT_TOKEN ساخته می‌شود.
 * کلید احراز وب‌هوک بدون تنظیم دستی ساخته می‌شود.
 */

/** Private writable storage outside the public web root whenever possible. */
function titanPrivateDir(): string
{
    $docRoot = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $base = $docRoot !== false ? dirname($docRoot) : dirname(__DIR__, 2);
    $suffix = substr(hash('sha256', __DIR__), 0, 12);
    $dir = rtrim($base, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '.titan-private-' . $suffix;
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
        $dir = __DIR__ . DIRECTORY_SEPARATOR . 'private';
        if (!is_dir($dir)) @mkdir($dir, 0750, true);
    }
    return $dir;
}

function titanWebhookSecret(): string
{
    return hash_hmac('sha256', 'TITAN_TELEGRAM_WEBHOOK_V1', BOT_TOKEN);
}


/** امضای داخلی پراکسی؛ از تنظیمات موجود ساخته می‌شود و کلید جداگانه‌ای لازم ندارد. */
function titanStreamSignature(string $url, int $expires): string
{
    $key = hash('sha256', BOT_TOKEN . "\n" . APP_URL . "\nTITAN_STREAM_PROXY_V1", true);
    return hash_hmac('sha256', $url . "\n" . $expires, $key);
}

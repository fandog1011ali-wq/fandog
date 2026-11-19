راهنمای Worker یکپارچه TITAN 4.1.2
====================================

این نسخه دو کد Worker را در یک Worker واحد ادغام می‌کند:
1) پراکسی عمومی محدودشده TITAN برای میزبان‌ها و IP/پورت‌های فعلی چهار پلی‌لیست.
2) مسیر اختصاصی Telewebion برای بازنویسی HLS و قطعات TS.

فایل اصلی برای انتشار:
  cloudflare-worker/worker.js

تنظیم Wrangler:
  cloudflare-worker/wrangler.jsonc

نکته بسیار مهم:
GitHub Pages فقط HTML/CSS/JavaScript میزبانی می‌کند و Worker را اجرا نمی‌کند.
برای عبور HTTPS از منابع HTTP، همین فایل worker.js باید یک‌بار روی حساب Cloudflare منتشر شود.
پس از انتشار، آدرس workers.dev را در فایل ریشه worker-config.js قرار دهید:
  window.TITAN_WORKER_URL = 'https://نام-ورکر.نام-حساب.workers.dev';

بعد از آن، پلیر:
- منابع موجود در allowlist را از مسیر /proxy عبور می‌دهد.
- HLS و DASH را با بازنویسی آدرس قطعات/زیرپلی‌لیست‌ها دریافت می‌کند.
- اگر منبع Telewebion با مسیر /<channel>/live/<quality>/index.m3u8 به پلیر داده شود، آن را به مسیر اختصاصی /<channel>/<quality> می‌فرستد.
- قطعات Telewebion از مسیر /segment دریافت می‌شوند.

این بسته حساب Cloudflare را خودکار Deploy نمی‌کند؛ برای آن دسترسی ورود/اجازه صاحب حساب لازم است.
هیچ توکن یا حسابی از فایل .wrangler آپلودشده در این بسته کپی نشده است.

محدودیت‌ها:
- منابع خارج از allowlist در پراکسی عمومی رد می‌شوند.
- RTSP/RTMP/UDP/SRT و تبدیل کدک با Worker پوشش داده نمی‌شوند.
- پخش نهایی به دسترسی منبع، CORS/توکن/Referer و سازگاری کدک بستگی دارد.
- پلن رایگان Cloudflare محدودیت درخواست و CPU دارد؛ هر قطعه HLS می‌تواند درخواست جداگانه باشد.

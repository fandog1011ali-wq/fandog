فهرست‌های فعال TITAN
====================

این بسته به‌دلایل حفظ اطلاعات شخصی، فایل‌های M3U واقعی حساب/هاست شما را شامل نمی‌شود.
در زمان نصب، فایل‌های فعلی خود را نگه دارید:
- live.m3u
- list1.m3u
- list2.m3u
- list3.m3u

هر URL پخش که قرار است از stream.php عبور کند باید دقیقاً (پس از decode شدن &amp; و حذف BOM) در یکی از این چهار فایل باشد؛ API برای URL دلخواه بلیت پراکسی صادر نمی‌کند.

فایل‌ها باید M3U معتبر باشند و هر ورودی رسانه بعد از خط #EXTINF قرار بگیرد. این پوشه از دسترسی مستقیم HTTP محافظت شده و API برنامه فایل‌ها را می‌خواند.

نمونهٔ ساختار:
#EXTM3U
#EXTINF:-1 tvg-id="channel-id" tvg-name="Channel Name" tvg-logo="https://example.invalid/logo.png" group-title="News",Channel Name
https://authorized.example.invalid/live/index.m3u8

از قرار دادن رمز، توکن محرمانه یا اطلاعات ورود شخصی در فایل‌های قابل اشتراک خودداری کنید.

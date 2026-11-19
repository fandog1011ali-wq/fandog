/* TITAN Legacy Player. ES5 syntax and XMLHttpRequest for Android 4.x WebKit. */
(function () {
  var CATEGORIES = [
    { id: 'live', title: 'پخش زنده' },
    { id: 'list1', title: 'لیست پخش 1' },
    { id: 'list2', title: 'لیست پخش 2' },
    { id: 'list3', title: 'لیست پخش 3' }
  ];
  var lists = { live: [], list1: [], list2: [], list3: [] };
  var allChannels = [];
  var logoMap = {};
  var activeCategory = 'live';
  var favoritesOnly = false;
  var favorites = [];
  var currentChannel = null;
  var currentIndex = -1;
  var proxyTried = false;
  var playbackGeneration = 0;
  var refreshInProgress = false;

  function byId(id) { return document.getElementById(id); }
  function setMessage(message, isError) {
    var node = byId('playMessage');
    node.className = isError ? 'message error' : 'message';
    node.innerHTML = '';
    node.appendChild(document.createTextNode(message));
  }
  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u0640\u200c]/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  function safeStorageGet(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) { return fallback; }
  }
  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { }
  }
  function loadFavorites() {
    try {
      var value = JSON.parse(safeStorageGet('titan_favorites', '[]'));
      if (Object.prototype.toString.call(value) === '[object Array]') favorites = value;
    } catch (e) { favorites = []; }
  }
  function hasFavorite(key) { return favorites.indexOf(key) !== -1; }
  function toggleFavorite(channel) {
    var index = favorites.indexOf(channel.key);
    if (index === -1) { favorites.push(channel.key); }
    else { favorites.splice(index, 1); }
    safeStorageSet('titan_favorites', JSON.stringify(favorites));
    renderChannels();
  }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function request(url, callback) {
    var xhr = new XMLHttpRequest();
    var completed = false;
    function finish(error, body, status) {
      if (completed) return;
      completed = true;
      callback(error, body, status);
    }
    xhr.open('GET', url, true);
    try { xhr.setRequestHeader('Cache-Control', 'no-cache'); } catch (e) { }
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) finish(null, xhr.responseText, xhr.status);
        else finish(new Error('HTTP ' + (xhr.status || 'نامشخص')), xhr.responseText, xhr.status);
      }
    };
    xhr.onerror = function () { finish(new Error('ارتباط با سرور برقرار نشد.'), '', 0); };
    try { xhr.send(null); } catch (e) { finish(e, '', 0); }
  }
  function parseAttributes(text) {
    var result = {};
    var regex = /([\w-]+)="([^"]*)"/g;
    var match;
    while ((match = regex.exec(text)) !== null) result[match[1].toLowerCase()] = match[2];
    return result;
  }
  function splitExtinf(line) {
    var quoted = false;
    var i;
    for (i = 0; i < line.length; i++) {
      if (line.charAt(i) === '"') quoted = !quoted;
      else if (line.charAt(i) === ',' && !quoted) return [line.substring(0, i), line.substring(i + 1)];
    }
    return [line, ''];
  }
  function parsePlaylist(raw, category) {
    var lines = String(raw || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    var result = [];
    var meta = null;
    var counts = {};
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, '');
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        var parts = splitExtinf(line);
        var attrs = parseAttributes(parts[0]);
        var title = (parts[1] || '').split('|')[0];
        var name = attrs['tvg-name'] || title || 'شبکه بدون نام';
        var base = normalize(attrs['tvg-id'] || name);
        counts[base] = (counts[base] || 0) + 1;
        meta = {
          name: name.replace(/^\s+|\s+$/g, ''),
          title: title,
          logo: attrs['tvg-logo'] || attrs['tvg-image'] || attrs['poster'] || attrs['cover'] || '',
          id: attrs['tvg-id'] || '',
          group: attrs['group-title'] || '',
          attrs: attrs,
          category: category,
          key: category + '|' + base + '|' + counts[base]
        };
      } else if (line.charAt(0) !== '#' && meta) {
        var streamUrl = line.replace(/&amp;/gi, '&').replace(/^['"]|['"]$/g, '');
        if (/^(https?:|rtsp:|rtmp:|rtmps:|udp:|srt:|rtp:)\/\//i.test(streamUrl)) {
          meta.url = streamUrl;
          result.push(meta);
        }
        meta = null;
      }
    }
    return result;
  }
  function loadOne(category, callback) {
    request('api.php?list=' + encodeURIComponent(category) + '&v=' + new Date().getTime(), function (error, body) {
      if (error) { lists[category] = []; callback(error); return; }
      lists[category] = parsePlaylist(body, category);
      callback(null);
    });
  }
  function loadAll() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    byId('channelCount').innerHTML = 'در حال دریافت فهرست‌ها...';
    var position = 0;
    var errors = 0;
    function next() {
      if (position >= CATEGORIES.length) {
        request('api.php?logos=1&v=' + new Date().getTime(), function (logoError, body) {
          if (!logoError) {
            try {
              var rawMap = JSON.parse(body) || {};
              var mapKey;
              logoMap = {};
              for (mapKey in rawMap) {
                if (Object.prototype.hasOwnProperty.call(rawMap, mapKey) && typeof rawMap[mapKey] === 'string') {
                  logoMap[normalize(mapKey)] = rawMap[mapKey];
                }
              }
            } catch (e) { logoMap = {}; }
          }
          rebuildAll();
          refreshInProgress = false;
          if (errors) setMessage('بعضی فهرست‌ها دریافت نشدند. وجود پوشه playlists و فایل‌های M3U را بررسی کنید.', true);
          else setMessage('فهرست‌ها به‌روزرسانی شدند. یک شبکه را انتخاب کنید.', false);
        });
        return;
      }
      var category = CATEGORIES[position].id;
      position++;
      loadOne(category, function (error) { if (error) errors++; next(); });
    }
    next();
  }
  function rebuildAll() {
    allChannels = [];
    var i;
    for (i = 0; i < CATEGORIES.length; i++) {
      var part = lists[CATEGORIES[i].id] || [];
      var j;
      for (j = 0; j < part.length; j++) allChannels.push(part[j]);
    }
    renderChannels();
  }
  function normalizeLegacyLogo(value) {
    var s = String(value || '');
    if (/^assets\/logos\//i.test(s) && /\.(svg|webp|avif|tiff?|heic|heif|apng)$/i.test(s)) {
      return 'image.php?file=' + encodeURIComponent(s.replace(/^assets\/logos\//i, ''));
    }
    return s;
  }
  function getLogo(channel) {
    var logo = channel.logo || '';
    var candidates = [channel.id, channel.name, channel.attrs ? channel.attrs['tvg-name'] : ''];
    var i;
    if (logo && (/^https?:\/\//i.test(logo) || /^assets\/logos\/[a-z0-9_./-]+\.(png|jpe?g|gif|bmp|ico|svg|webp|avif|tiff?|heic|heif|apng)$/i.test(logo))) return normalizeLegacyLogo(logo);
    for (i = 0; i < candidates.length; i++) {
      var key = normalize(candidates[i]);
      if (key && logoMap[key] && typeof logoMap[key] === 'string') {
        var mapped = logoMap[key];
        if (/^https?:\/\//i.test(mapped) || /^assets\/logos\/[a-z0-9_./-]+\.(png|jpe?g|gif|bmp|ico|svg|webp|avif|tiff?|heic|heif|apng)$/i.test(mapped)) return normalizeLegacyLogo(mapped);
      }
    }
    return '';
  }
  function displayedChannels() {
    var source = [];
    var query = normalize(byId('search').value);
    var i;
    if (favoritesOnly) {
      for (i = 0; i < allChannels.length; i++) if (hasFavorite(allChannels[i].key)) source.push(allChannels[i]);
    } else if (activeCategory === 'all') source = allChannels.slice(0);
    else source = (lists[activeCategory] || []).slice(0);
    if (query) {
      var filtered = [];
      for (i = 0; i < source.length; i++) if (normalize(source[i].name).indexOf(query) !== -1) filtered.push(source[i]);
      source = filtered;
    }
    return source;
  }
  function renderChannels() {
    var container = byId('channelList');
    var channels = displayedChannels();
    var i;
    container.innerHTML = '';
    byId('channelCount').innerHTML = channels.length + ' شبکه';
    if (!channels.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.appendChild(document.createTextNode(allChannels.length ? 'شبکه‌ای با این جستجو پیدا نشد.' : 'شبکه‌ای دریافت نشد. فایل‌های live.m3u و list1.m3u تا list3.m3u را داخل پوشه playlists قرار دهید.'));
      container.appendChild(empty);
      return;
    }
    for (i = 0; i < channels.length; i++) {
      (function (channel, number) {
        var button = document.createElement('button');
        var title = document.createElement('span');
        var star = document.createElement('span');
        var logo = getLogo(channel);
        button.type = 'button';
        button.className = 'channel-row' + (currentChannel && currentChannel.key === channel.key ? ' selected' : '');
        if (logo) {
          var img = document.createElement('img');
          img.alt = '';
          img.src = logo;
          img.onerror = function () {
            if (!img.getAttribute('data-proxy-tried') && /^https?:\/\//i.test(logo)) {
              img.setAttribute('data-proxy-tried', '1');
              request('api.php?logoTicket=' + encodeURIComponent(toBase64Url(logo)) + '&v=' + new Date().getTime(), function (proxyError, body) {
                var data = null;
                if (!proxyError) { try { data = JSON.parse(body); } catch (e) { data = null; } }
                if (data && data.ok && data.url) img.src = data.url;
                else if (img.parentNode) img.parentNode.removeChild(img);
              });
            } else if (img.parentNode) img.parentNode.removeChild(img);
          };
          button.appendChild(img);
        }
        title.className = 'name';
        title.appendChild(document.createTextNode(channel.name));
        button.appendChild(title);
        star.className = 'star';
        star.appendChild(document.createTextNode(hasFavorite(channel.key) ? '★' : '☆'));
        button.appendChild(star);
        button.onclick = function () {
          currentIndex = number;
          playChannel(channel);
          renderChannels();
        };
        star.onclick = function (event) {
          if (event && event.stopPropagation) event.stopPropagation();
          toggleFavorite(channel);
          return false;
        };
        container.appendChild(button);
      }(channels[i], i));
    }
  }
  function setCategory(category) {
    activeCategory = category;
    favoritesOnly = false;
    var buttons = byId('categories').getElementsByTagName('button');
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].className = buttons[i].getAttribute('data-category') === category ? 'active' : '';
    }
    byId('favoritesButton').className = '';
    renderChannels();
  }
  function getType(url) {
    var clean = String(url || '').toLowerCase().split('?')[0].split('#')[0];
    if (/^(rtsp|rtmp|rtmps|udp|srt|rtp):\/\//.test(clean)) return 'transcode-required';
    if (/\.m3u8$/.test(clean)) return 'hls';
    if (/\.mpd$/.test(clean)) return 'dash';
    if (/\.(ts|m2ts)$/.test(clean)) return 'mpegts';
    if (/\.flv$/.test(clean)) return 'flv';
    return 'native';
  }
  function toBase64Url(value) {
    var encoded = window.btoa(unescape(encodeURIComponent(value)));
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function requestProxy(channel, reason, generation) {
    if (generation !== playbackGeneration) return;
    if (proxyTried) {
      setMessage('پخش در این مرورگر ناموفق بود. ممکن است فرمت یا کدک شبکه پشتیبانی نشود.', true);
      return;
    }
    proxyTried = true;
    setMessage(reason || 'در حال آماده‌سازی مسیر سازگار پخش...', false);
    var type = getType(channel.url);
    var endpoint = 'api.php?streamTicket=' + encodeURIComponent(toBase64Url(channel.url)) + '&format=' + encodeURIComponent(type) + '&v=' + new Date().getTime();
    request(endpoint, function (error, body) {
      if (generation !== playbackGeneration) return;
      if (error) {
        setMessage('مسیر جایگزین آماده نشد. افزونه PHP cURL هاست و لینک شبکه را بررسی کنید.', true);
        return;
      }
      var data;
      try { data = JSON.parse(body); } catch (e) { data = null; }
      if (!data || !data.ok || !data.url) {
        setMessage((data && data.error) ? data.error : 'سرور مسیر جایگزین پخش را ارائه نکرد.', true);
        return;
      }
      attachVideo(data.url, true, generation);
    });
  }
  function requestTranscode(channel, generation, reason) {
    if (generation !== playbackGeneration || !channel) return;
    setMessage(reason || 'این منبع به تبدیل کدک نیاز دارد؛ در حال آماده‌سازی خروجی H.264/AAC با FFmpeg...', false);
    var endpoint = 'api.php?transcodeTicket=' + encodeURIComponent(toBase64Url(channel.url)) + '&v=' + new Date().getTime();
    request(endpoint, function (error, body) {
      if (generation !== playbackGeneration) return;
      if (error) { setMessage('صدور بلیت تبدیل ناموفق بود؛ نصب FFmpeg و اجازه proc_open روی سرور را بررسی کنید.', true); return; }
      var data;
      try { data = JSON.parse(body); } catch (e) { data = null; }
      if (!data || !data.ok || !data.url) { setMessage((data && data.error) ? data.error : 'سرویس تبدیل FFmpeg در دسترس نیست.', true); return; }
      attachVideo(data.url + '&q=480', true, generation, true);
    });
  }
  function attachVideo(url, viaProxy, generation, isTranscoded) {
    var video = byId('video');
    video.onerror = function () {
      if (generation !== playbackGeneration) return;
      if (!viaProxy && currentChannel) requestProxy(currentChannel, 'پخش مستقیم انجام نشد؛ مسیر جایگزین در حال آماده‌سازی است...', generation);
      else if (!isTranscoded && currentChannel) requestTranscode(currentChannel, generation, 'پراکسی نیز قابل رمزگشایی نبود؛ تبدیل کدک با FFmpeg امتحان می‌شود...');
      else setMessage('مرورگر نتوانست خروجی سازگار را رمزگشایی کند. این دستگاه ممکن است حتی MP4 قطعه‌ای H.264/AAC را پشتیبانی نکند.', true);
    };
    video.onplaying = function () { if (generation === playbackGeneration) setMessage('در حال پخش: ' + (currentChannel ? currentChannel.name : ''), false); };
    video.onloadedmetadata = function () { if (generation === playbackGeneration) setMessage('اطلاعات رسانه دریافت شد؛ در حال پخش...', false); };
    try { video.pause(); } catch (e) { }
    video.src = url;
    try { video.load(); } catch (e) { }
    try {
      var playResult = video.play();
      if (playResult && playResult.catch) playResult.catch(function () { setMessage('برای شروع پخش، دکمه پخش داخل ویدئو را لمس کنید.', false); });
    } catch (e) { setMessage('برای شروع پخش، دکمه پخش داخل ویدئو را لمس کنید.', false); }
    if (viaProxy) setMessage('مسیر امن پخش آماده شد؛ در حال اتصال...', false);
    else setMessage('در حال اتصال مستقیم به شبکه...', false);
  }
  function playChannel(channel) {
    var video = byId('video');
    var generation = playbackGeneration + 1;
    playbackGeneration = generation;
    currentChannel = channel;
    proxyTried = false;
    byId('nowPlaying').innerHTML = escapeHtml(channel.name);
    setMessage('در حال اتصال به ' + channel.name + '...', false);
    try { video.pause(); } catch (e) { }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { }
    var type = getType(channel.url);
    if (type === 'transcode-required' || type === 'dash' || type === 'flv') {
      requestTranscode(channel, generation, 'این پروتکل/قالب در مرورگر قدیمی مستقیم پشتیبانی نمی‌شود؛ تبدیل سمت سرور به H.264/AAC آغاز می‌شود...');
      return;
    }
    if (type === 'mpegts') {
      setMessage('پشتیبانی مستقیم MPEG-TS به مدل دستگاه وابسته است؛ در صورت خطا، نسخه MP4/HLS لازم است.', false);
    }
    if (window.location.protocol === 'https:' && /^http:\/\//i.test(channel.url)) {
      requestProxy(channel, 'به‌دلیل HTTP بودن لینک در صفحه HTTPS، مسیر امن پخش در حال آماده‌سازی است...', generation);
    } else {
      attachVideo(channel.url, false, generation);
    }
  }
  function stepChannel(direction) {
    var channels = displayedChannels();
    if (!channels.length) return;
    if (currentChannel) {
      var i;
      for (i = 0; i < channels.length; i++) if (channels[i].key === currentChannel.key) { currentIndex = i; break; }
    }
    if (currentIndex < 0) currentIndex = 0;
    else currentIndex = (currentIndex + direction + channels.length) % channels.length;
    playChannel(channels[currentIndex]);
    renderChannels();
  }
  function bindEvents() {
    var buttons = byId('categories').getElementsByTagName('button');
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function () { setCategory(this.getAttribute('data-category')); };
    }
    byId('refreshButton').onclick = function () { loadAll(); };
    byId('previousButton').onclick = function () { stepChannel(-1); };
    byId('nextButton').onclick = function () { stepChannel(1); };
    byId('allButton').onclick = function () { setCategory('all'); };
    byId('favoritesButton').onclick = function () {
      favoritesOnly = !favoritesOnly;
      activeCategory = 'all';
      this.className = favoritesOnly ? 'active' : '';
      renderChannels();
    };
    byId('search').onkeyup = function () { renderChannels(); };
  }

  function init() {
    loadFavorites();
    bindEvents();
    loadAll();
  }
  if (document.readyState === 'loading') {
    if (document.addEventListener) document.addEventListener('DOMContentLoaded', init, false);
    else window.onload = init;
  } else init();
}());

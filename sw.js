const CACHE_NAME='titan-shell-v401';
const PLAYER_CACHE='titan-player-libs-v401';
const SHELL=['./','./index.html','./modern.html','./legacy.html','./legacy.js','./compat-check.js','./manifest.webmanifest','./assets/titan.svg','./assets/icons/titan-192.png','./assets/icons/titan-512.png','./assets/icons/titan-maskable-512.png','./assets/wallpapers/stadium.svg','./assets/wallpapers/cinema.svg','./assets/wallpapers/film.svg','./assets/wallpapers/animation.svg','./assets/wallpapers/aurora.svg'];
const PLAYER_HOSTS=new Set(['cdn.jsdelivr.net','unpkg.com']);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![CACHE_NAME,PLAYER_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);
  if(req.destination==='script'&&PLAYER_HOSTS.has(url.hostname)){
    event.respondWith((async()=>{
      const cache=await caches.open(PLAYER_CACHE);const cached=await cache.match(req);
      const network=fetch(req).then(response=>{
        if(response&&(response.ok||response.type==='opaque'))cache.put(req,response.clone()).catch(()=>{});
        return response;
      }).catch(error=>{if(cached)return cached;throw error});
      if(cached){event.waitUntil(network.then(()=>{}).catch(()=>{}));return cached;}
      return network;
    })());
    return;
  }
  if(url.origin!==self.location.origin||url.pathname.endsWith('/api.php')||url.pathname.endsWith('/transcode.php')||url.pathname.endsWith('/media-info.php')||url.pathname.endsWith('/stream.php')||url.pathname.endsWith('/image.php')||url.pathname.includes('/playlists/')||url.pathname.includes('/dash/')||url.pathname.endsWith('/dash.php')||/\.(m3u8|mpd|ts|m2ts|flv)(\?|$)/i.test(url.href))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{
      if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));}
      return res;
    }).catch(()=>caches.match(req).then(cached=>cached||caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
    if(res.ok&&url.origin===self.location.origin){const copy=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));}
    return res;
  })));
});

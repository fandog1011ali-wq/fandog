<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
$allowed = ['live', 'list1', 'list2', 'list3'];

function titanFindBinaryApi(string $name): ?string {
  $env = getenv('TITAN_' . strtoupper($name));
  $candidates = [];
  if (is_string($env) && $env !== '') $candidates[] = $env;
  foreach (['/usr/bin/','/usr/local/bin/','/bin/','/opt/bin/','/opt/cpanel/ea-ffmpeg/bin/'] as $dir) $candidates[] = $dir . $name;
  foreach ($candidates as $candidate) if (is_file($candidate) && is_executable($candidate)) return $candidate;
  $path = (string)getenv('PATH');
  foreach (explode(PATH_SEPARATOR, $path) as $dir) { $candidate = rtrim($dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name; if ($dir !== '' && is_file($candidate) && is_executable($candidate)) return $candidate; }
  return null;
}
function titanApiHostIsPublic(string $host): bool {
  $host = trim($host, '[]');
  if (filter_var($host, FILTER_VALIDATE_IP)) return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE) !== false;
  if ($host === '' || preg_match('/(^|\.)(localhost|local|internal)$/i', $host)) return false;
  $records = @dns_get_record($host, DNS_A|DNS_AAAA); $ips = [];
  if (is_array($records)) foreach ($records as $r) { if (!empty($r['ip'])) $ips[] = $r['ip']; if (!empty($r['ipv6'])) $ips[] = $r['ipv6']; }
  if (!$ips) { $fallback = @gethostbynamel($host); if (is_array($fallback)) $ips = $fallback; }
  if (!$ips) return false;
  foreach (array_unique($ips) as $ip) if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE) === false) return false;
  return true;
}

function titanPlaylistContainsExactUrl(string $url, array $allowed): bool {
  foreach ($allowed as $name) {
    $playlist = __DIR__ . '/playlists/' . $name . '.m3u';
    if (!is_readable($playlist)) continue;
    foreach (file($playlist, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
      $candidate = trim((string)$line);
      $candidate = preg_replace('/^\xEF\xBB\xBF/', '', $candidate) ?? $candidate;
      $candidate = html_entity_decode($candidate, ENT_QUOTES | ENT_HTML5, 'UTF-8');
      if ($candidate !== '' && !str_starts_with($candidate, '#') && hash_equals($candidate, $url)) return true;
    }
  }
  return false;
}

// صدور بلیت تصویر فقط برای لوگوهایی که در پلی‌لیست مدیر یا logos.json ثبت شده‌اند.
if (isset($_GET['logoTicket'])) {
  header('Content-Type: application/json; charset=utf-8');
  $encoded=(string)$_GET['logoTicket'];$logoUrl=base64_decode(strtr($encoded,'-_','+/').str_repeat('=',(4-strlen($encoded)%4)%4),true);
  if(!is_string($logoUrl)||strlen($logoUrl)>4096||!filter_var($logoUrl,FILTER_VALIDATE_URL)){http_response_code(400);echo json_encode(['ok'=>false,'error'=>'آدرس لوگو نامعتبر است.']);exit;}
  $parts=parse_url($logoUrl);if(!$parts||!in_array(strtolower((string)($parts['scheme']??'')),['http','https'],true)||empty($parts['host'])||isset($parts['user'])||isset($parts['pass'])){http_response_code(400);echo json_encode(['ok'=>false,'error'=>'لوگو باید از نشانی HTTP یا HTTPS باشد.']);exit;}
  $allowedLogo=false;$map=json_decode((string)@file_get_contents(__DIR__.'/logos.json'),true);
  if(is_array($map)&&in_array($logoUrl,$map,true))$allowedLogo=true;
  if(!$allowedLogo){foreach($allowed as $name){$playlist=__DIR__.'/playlists/'.$name.'.m3u';if(!is_readable($playlist))continue;$raw=(string)file_get_contents($playlist);if(preg_match_all('/tvg-(?:logo|image)="([^"]+)"|(?:poster|cover|thumbnail)="([^"]+)"/i',$raw,$matches,PREG_SET_ORDER)){foreach($matches as $m){$candidate=$m[1]!==''?$m[1]:($m[2]??'');if($candidate===$logoUrl){$allowedLogo=true;break 2;}}}}}
  if(!$allowedLogo){http_response_code(403);echo json_encode(['ok'=>false,'error'=>'این تصویر در منابع مجاز سایت ثبت نشده است.']);exit;}
  $expires=time()+600;$sig=titanStreamSignature($logoUrl,$expires);$b64=rtrim(strtr(base64_encode($logoUrl),'+/','-_'),'=');
  echo json_encode(['ok'=>true,'url'=>'image.php?u='.rawurlencode($b64).'&e='.$expires.'&s='.$sig],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;
}

// صدور نشانی پراکسی فقط برای URLهایی که دقیقاً در فایل‌های پلی‌لیست مدیر ثبت شده‌اند.
if (isset($_GET['streamTicket'])) {
  header('Content-Type: application/json; charset=utf-8');
  $encoded = (string)$_GET['streamTicket'];
  $url = base64_decode(strtr($encoded, '-_', '+/') . str_repeat('=', (4 - strlen($encoded) % 4) % 4), true);
  if (!is_string($url) || strlen($url) > 4096 || !filter_var($url, FILTER_VALIDATE_URL)) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'آدرس پخش نامعتبر است.']); exit; }
  $parts = parse_url($url);
  if (!$parts || !in_array(strtolower((string)($parts['scheme'] ?? '')), ['http','https'], true) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'فقط آدرس مستقیم HTTP/HTTPS پذیرفته می‌شود.']); exit; }
  if (!titanPlaylistContainsExactUrl($url, $allowed)) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'این لینک در پلی‌لیست‌های مجاز ثبت نشده است.']); exit; }
  $expires = time() + 86400;
  $sig = titanStreamSignature($url, $expires);
  $b64 = rtrim(strtr(base64_encode($url), '+/', '-_'), '=');
  $format = strtolower((string)($_GET['format'] ?? ''));
  if (!in_array($format, ['hls','dash','mpegts','flv','native'], true)) $format = '';
  $proxyUrl = 'stream.php?u='.rawurlencode($b64).'&e='.$expires.'&s='.$sig.($format !== '' ? '&fmt='.$format : '');
  echo json_encode(['ok'=>true,'url'=>$proxyUrl,'expires'=>$expires], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  exit;
}

// Issue a short-lived ticket for server-side FFmpeg only for exact administrator playlist entries.
if (isset($_GET['transcodeTicket']) || isset($_GET['mediaInfoTicket'])) {
  header('Content-Type: application/json; charset=utf-8');
  $isInfo = isset($_GET['mediaInfoTicket']);
  $encoded = (string)($_GET[$isInfo ? 'mediaInfoTicket' : 'transcodeTicket']);
  $url = base64_decode(strtr($encoded, '-_', '+/') . str_repeat('=', (4 - strlen($encoded) % 4) % 4), true);
  if (!is_string($url) || strlen($url) > 4096 || !filter_var($url, FILTER_VALIDATE_URL)) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'آدرس رسانه معتبر نیست.']); exit; }
  if (!titanPlaylistContainsExactUrl($url, $allowed)) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'این منبع دقیقاً در پلی‌لیست‌های مجاز TITAN ثبت نشده است.']); exit; }
  $parts = parse_url($url); $scheme = strtolower((string)($parts['scheme'] ?? ''));
  $schemes = $isInfo ? ['http','https'] : ['http','https','rtsp','rtmp','rtmps','udp','srt','rtp'];
  $udpListenSyntax = $scheme === 'udp' && array_key_exists('user', (array)$parts) && (string)$parts['user'] === '';
  if (!$parts || !in_array($scheme, $schemes, true) || empty($parts['host']) || (isset($parts['user']) && !$udpListenSyntax) || isset($parts['pass'])) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'پروتکل این منبع برای سرویس سرور مجاز نیست.']); exit; }
  $udpMulticast = false;
  if ($scheme === 'udp' && filter_var((string)$parts['host'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
    $octets = array_map('intval', explode('.', (string)$parts['host']));
    $udpMulticast = count($octets) === 4 && $octets[0] >= 224 && $octets[0] <= 239;
  }
  if (!$udpMulticast && !titanApiHostIsPublic((string)$parts['host'])) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'میزبان منبع عمومی نیست یا DNS آن قابل تأیید نیست.']); exit; }
  $binary = titanFindBinaryApi($isInfo ? 'ffprobe' : 'ffmpeg');
  $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
  $canRun = function_exists('proc_open') && !in_array('proc_open', $disabled, true);
  if (!$binary || !$canRun) { http_response_code(503); echo json_encode(['ok'=>false,'error'=>($isInfo?'FFprobe':'FFmpeg').' روی هاست پیدا نشد یا PHP اجازه اجرای proc_open را ندارد. برای این قابلیت، FFmpeg/FFprobe و اجرای پردازش باید روی VPS یا هاست فعال باشد.']); exit; }
  $expires = time() + 600; $sig = titanStreamSignature($url, $expires); $b64 = rtrim(strtr(base64_encode($url), '+/', '-_'), '=');
  $target = $isInfo ? 'media-info.php' : 'transcode.php';
  echo json_encode(['ok'=>true,'url'=>$target.'?u='.rawurlencode($b64).'&e='.$expires.'&s='.$sig,'expires'=>$expires], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit;
}

// Probe extensionless or misleading IPTV links using a small HTTP range request.
// Only exact URLs already present in an active local playlist are eligible.
if (isset($_GET['probeTicket'])) {
  header('Content-Type: application/json; charset=utf-8');
  $encoded=(string)$_GET['probeTicket'];
  $url=base64_decode(strtr($encoded,'-_','+/').str_repeat('=',(4-strlen($encoded)%4)%4),true);
  if(!is_string($url)||strlen($url)>4096||!filter_var($url,FILTER_VALIDATE_URL)){http_response_code(400);echo json_encode(['ok'=>false,'error'=>'آدرس منبع برای تشخیص قالب معتبر نیست.']);exit;}
  $parts=parse_url($url);
  if(!$parts||!in_array(strtolower((string)($parts['scheme']??'')),['http','https'],true)||empty($parts['host'])||isset($parts['user'])||isset($parts['pass'])){http_response_code(400);echo json_encode(['ok'=>false,'error'=>'فقط لینک‌های مستقیم HTTP/HTTPS قابل بررسی‌اند.']);exit;}
  if(!titanPlaylistContainsExactUrl($url,$allowed)){http_response_code(403);echo json_encode(['ok'=>false,'error'=>'این لینک در فهرست‌های فعال ثبت نشده است.']);exit;}
  if(!function_exists('curl_init')){http_response_code(503);echo json_encode(['ok'=>false,'error'=>'برای تشخیص خودکار نوع استریم، افزونه PHP cURL روی هاست لازم است.']);exit;}
  $isPublicHost=static function(string $host):bool{
    $host=trim($host,'[]');
    if(filter_var($host,FILTER_VALIDATE_IP))return filter_var($host,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)!==false;
    if($host===''||preg_match('/(^|\.)(localhost|local|internal)$/i',$host))return false;
    $records=@dns_get_record($host,DNS_A|DNS_AAAA);$ips=[];
    if(is_array($records))foreach($records as $r){if(!empty($r['ip']))$ips[]=$r['ip'];if(!empty($r['ipv6']))$ips[]=$r['ipv6'];}
    if(!$ips){$v=@gethostbynamel($host);if(is_array($v))$ips=$v;}
    if(!$ips)return false;foreach(array_unique($ips) as $ip)if(filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)===false)return false;return true;
  };
  $resolve=static function(string $base,string $ref):string{
    if(preg_match('~^https?://~i',$ref))return $ref;$b=parse_url($base);if(!$b||empty($b['host']))return $ref;
    $origin=$b['scheme'].'://'.$b['host'].(isset($b['port'])?':'.$b['port']:'');
    if(str_starts_with($ref,'//'))return $b['scheme'].':'.$ref;
    if(str_starts_with($ref,'?'))return $origin.($b['path']??'/').$ref;
    $r=parse_url($ref);$rp=$r['path']??'';if(str_starts_with($rp,'/'))$path=$rp;else{$bp=$b['path']??'/';$dir=substr($bp,0,strrpos($bp,'/')!==false?strrpos($bp,'/')+1:0);$path=$dir.$rp;}
    $stack=[];foreach(explode('/',$path) as $part){if($part===''||$part==='.')continue;if($part==='..'){array_pop($stack);continue;}$stack[]=$part;}
    return $origin.'/'.implode('/',$stack).(isset($r['query'])?'?'.$r['query']:'');
  };
  $current=$url;$status=0;$mime='';$bytes='';$location='';$curlMessage='';
  for($hop=0;$hop<5;$hop++){
    $parts=parse_url($current);if(!$parts||empty($parts['host'])||!$isPublicHost((string)$parts['host'])){http_response_code(403);echo json_encode(['ok'=>false,'error'=>'مسیر تغییر مسیر منبع به میزبان غیرعمومی ختم شد.']);exit;}
    $headers=[];$bytes='';$status=0;$location='';
    $ch=curl_init($current);
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>2,CURLOPT_TIMEOUT=>3,CURLOPT_NOSIGNAL=>true,CURLOPT_RANGE=>'0-4095',CURLOPT_USERAGENT=>'Mozilla/5.0 (compatible; TITANProbe/3.6.0)',CURLOPT_HTTPHEADER=>['Accept: */*','Accept-Encoding: identity'],CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
      CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$headers,&$status,&$location){$len=strlen($line);if(preg_match('~^HTTP/\S+\s+(\d{3})~i',$line,$m)){$status=(int)$m[1];$headers=[];$location='';}elseif(strpos($line,':')!==false){[$k,$v]=explode(':',$line,2);$k=strtolower(trim($k));$headers[$k]=trim($v);if($k==='location')$location=trim($v);}return $len;},
      CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$bytes){$len=strlen($chunk);$room=8192-strlen($bytes);if($room<=0)return 0;if($len>$room){$bytes.=substr($chunk,0,$room);return 0;}$bytes.=$chunk;return $len;}
    ]);
    $ok=curl_exec($ch);$curlNo=curl_errno($ch);$curlMessage=curl_error($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE)?:$status;curl_close($ch);
    if($status>=300&&$status<400&&$location!==''){$current=$resolve($current,$location);continue;}
    $mime=strtolower(trim(explode(';',(string)($headers['content-type']??''))[0]));
    if(($status>=200&&$status<300)&&($bytes!==''||$ok!==false||$curlNo===23))break;
    http_response_code($status>=400&&$status<=599?$status:502);echo json_encode(['ok'=>false,'error'=>'منبع هنگام بررسی پاسخ موفق نداد (HTTP '.($status?:'نامشخص').'). '.($curlMessage?:'')],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;
  }
  if($status>=300&&$status<400){http_response_code(502);echo json_encode(['ok'=>false,'error'=>'منبع استریم بیش از حد تغییر مسیر داد یا پاسخ Redirect ناقص است.']);exit;}
  $sample=ltrim($bytes,"\xEF\xBB\xBF \t\r\n");$type='unknown';
  if(str_contains($mime,'mpegurl')||str_starts_with($sample,'#EXTM3U'))$type='hls';
  elseif(str_contains($mime,'dash+xml')||preg_match('/^(?:<\?xml[^>]*>\s*)?<MPD\b/i',$sample))$type='dash';
  elseif(str_contains($mime,'x-flv')||str_starts_with($bytes,'FLV'))$type='flv';
  elseif(str_contains($mime,'mp2t')||str_contains($mime,'mpeg')&&strlen($bytes)>376&&ord($bytes[0])===0x47&&ord($bytes[188])===0x47)$type='mpegts';
  elseif((strlen($bytes)>8&&substr($bytes,4,4)==='ftyp')||str_starts_with($bytes,"\x1A\x45\xDF\xA3")||str_starts_with($bytes,'OggS')||str_starts_with($bytes,'ID3')||str_contains($mime,'video/')||str_contains($mime,'audio/')||str_contains($mime,'webm')||str_contains($mime,'mp4'))$type='native';
  elseif(strlen($bytes)>376){for($offset=0;$offset<188;$offset++){if(isset($bytes[$offset],$bytes[$offset+188])&&ord($bytes[$offset])===0x47&&ord($bytes[$offset+188])===0x47){$type='mpegts';break;}}}
  echo json_encode(['ok'=>true,'type'=>$type,'contentType'=>$mime,'status'=>$status],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;
}
if (isset($_GET['health'])) {
  header('Content-Type: application/json; charset=utf-8');
  $disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));$ffmpeg=false;$ffprobe=false;
  foreach(['/usr/bin/ffmpeg','/usr/local/bin/ffmpeg','/bin/ffmpeg'] as $bin)if(is_executable($bin)){$ffmpeg=true;break;}
  foreach(['/usr/bin/ffprobe','/usr/local/bin/ffprobe','/bin/ffprobe'] as $bin)if(is_executable($bin)){$ffprobe=true;break;}
  if(!$ffmpeg&&function_exists('shell_exec')&&!in_array('shell_exec',$disabled,true)){$out=@shell_exec('command -v ffmpeg 2>/dev/null');$ffmpeg=is_string($out)&&trim($out)!=='';}
  if(!$ffprobe&&function_exists('shell_exec')&&!in_array('shell_exec',$disabled,true)){$out=@shell_exec('command -v ffprobe 2>/dev/null');$ffprobe=is_string($out)&&trim($out)!=='';}
  $ffmpegBin=titanFindBinaryApi('ffmpeg');$ffprobeBin=titanFindBinaryApi('ffprobe');$disabledFunctions=array_map('trim',explode(',',(string)ini_get('disable_functions')));$canProc=function_exists('proc_open')&&!in_array('proc_open',$disabledFunctions,true);
  echo json_encode(['ok'=>true,'php'=>PHP_VERSION,'curl'=>function_exists('curl_init'),'streamProxy'=>function_exists('curl_init'),'ffmpeg'=>['available'=>$ffmpeg||$ffmpegBin!==null,'path'=>$ffmpegBin],'ffprobe'=>['available'=>$ffprobe||$ffprobeBin!==null,'path'=>$ffprobeBin],'transcode'=>['available'=>$ffmpegBin!==null&&$canProc,'procOpen'=>$canProc],'imageProcessor'=>['imagick'=>extension_loaded('imagick'),'gd'=>extension_loaded('gd')],'lists'=>array_values(array_filter($allowed, static fn($n)=>is_readable(__DIR__.'/playlists/'.$n.'.m3u')))], JSON_UNESCAPED_UNICODE); exit;
}
if (isset($_GET['logos'])) {
  header('Content-Type: application/json; charset=utf-8'); $file=__DIR__.'/logos.json';
  if(!is_file($file)||!is_readable($file)){echo '{}';exit;}
  $data=json_decode((string)file_get_contents($file),true);if(!is_array($data)){http_response_code(500);echo '{}';exit;}
  $imageExt='svg|png|jpe?g|webp|gif|avif|bmp|ico|tiff?|heic|heif|apng';
  $clean=[];foreach($data as $name=>$url){if(is_string($name)&&is_string($url)&&trim($name)!==''&&trim($url)!==''&&(preg_match('~^https?://~i',trim($url))||preg_match('~^assets/logos/[a-z0-9_./-]+\.('.$imageExt.')$~i',trim($url))))$clean[trim($name)]=trim($url);}
  // Local logo files are also indexed by their filename, so a channel can match a logo automatically.
  $logoDir=__DIR__.'/assets/logos';
  if(is_dir($logoDir))foreach(glob($logoDir.'/*')?:[] as $path){if(!is_file($path))continue;$ext=strtolower(pathinfo($path,PATHINFO_EXTENSION));if(!in_array($ext,['svg','png','jpg','jpeg','webp','gif','avif','bmp','ico','tif','tiff','heic','heif','apng'],true))continue;$key=pathinfo($path,PATHINFO_FILENAME);if(!isset($clean[$key]))$clean[$key]='assets/logos/'.basename($path);}
  echo json_encode($clean,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;
}
$list=(string)($_GET['list']??'');if(!in_array($list,$allowed,true)){http_response_code(400);header('Content-Type:text/plain; charset=utf-8');echo 'Invalid playlist';exit;}
$file=__DIR__.'/playlists/'.$list.'.m3u';if(!is_file($file)||!is_readable($file)){http_response_code(404);header('Content-Type:text/plain; charset=utf-8');echo 'Playlist not found';exit;}
header('Content-Type: audio/x-mpegurl; charset=utf-8');header('Content-Disposition: inline; filename="'.$list.'.m3u"');readfile($file);

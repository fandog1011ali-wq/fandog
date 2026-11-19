<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';
@ini_set('output_buffering','0'); @ini_set('zlib.output_compression','0'); @set_time_limit(0); ignore_user_abort(false);
while (ob_get_level() > 0) { @ob_end_clean(); }
header('X-Content-Type-Options: nosniff'); header('Cache-Control: no-store'); header('X-Accel-Buffering: no'); header('Referrer-Policy: same-origin');
function titan_transcode_fail(int $status,string $message): never { if(!headers_sent()){http_response_code($status);header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');} echo json_encode(['ok'=>false,'error'=>$message],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }
function titan_transcode_decode(string $v): string|false { $v=strtr($v,'-_','+/'); return base64_decode($v.str_repeat('=',(4-strlen($v)%4)%4),true); }
function titan_transcode_binary(string $name): ?string { $env=getenv('TITAN_'.strtoupper($name));$items=[];if(is_string($env)&&$env!=='')$items[]=$env;foreach(['/usr/bin/','/usr/local/bin/','/bin/','/opt/bin/','/opt/cpanel/ea-ffmpeg/bin/'] as $d)$items[]=$d.$name;foreach(explode(PATH_SEPARATOR,(string)getenv('PATH')) as $d)if($d!=='')$items[]=rtrim($d,'/').'/'.$name;foreach($items as $f)if(is_file($f)&&is_executable($f))return $f;return null; }
function titan_transcode_public_host(string $host): bool { $host=trim($host,'[]');if(filter_var($host,FILTER_VALIDATE_IP))return filter_var($host,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)!==false;if($host===''||preg_match('/(^|\.)(localhost|local|internal)$/i',$host))return false;$r=@dns_get_record($host,DNS_A|DNS_AAAA);$ips=[];if(is_array($r))foreach($r as $x){if(!empty($x['ip']))$ips[]=$x['ip'];if(!empty($x['ipv6']))$ips[]=$x['ipv6'];}if(!$ips){$x=@gethostbynamel($host);if(is_array($x))$ips=$x;}if(!$ips)return false;foreach(array_unique($ips) as $ip)if(filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)===false)return false;return true; }
function titan_transcode_playlist_allowed(string $url): bool { foreach(['live','list1','list2','list3'] as $list){$path=__DIR__.'/playlists/'.$list.'.m3u';if(!is_readable($path))continue;foreach(file($path,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)?:[] as $line){$line=html_entity_decode(trim((string)$line),ENT_QUOTES|ENT_HTML5,'UTF-8');if($line!==''&&!str_starts_with($line,'#')&&hash_equals($line,$url))return true;}}return false; }
$encoded=(string)($_GET['u']??'');$expires=filter_var($_GET['e']??null,FILTER_VALIDATE_INT);$signature=(string)($_GET['s']??'');$url=titan_transcode_decode($encoded);
if(!is_string($url)||!$expires||$expires<time()||$expires>time()+900||!hash_equals(titanStreamSignature($url,(int)$expires),$signature))titan_transcode_fail(403,'بلیت تبدیل منقضی یا نامعتبر است.');
if(!titan_transcode_playlist_allowed($url))titan_transcode_fail(403,'این منبع دیگر در فهرست مجاز ثبت نشده است.');
$parts=parse_url($url);$scheme=strtolower((string)($parts['scheme']??''));$udpListenSyntax=$scheme==='udp'&&is_array($parts)&&array_key_exists('user',$parts)&&(string)$parts['user']==='';if(!$parts||!in_array($scheme,['http','https','rtsp','rtmp','rtmps','udp','srt','rtp'],true)||empty($parts['host'])||(isset($parts['user'])&&!$udpListenSyntax)||isset($parts['pass']))titan_transcode_fail(400,'پروتکل یا ساختار منبع پشتیبانی نمی‌شود.');
$udpMulticast=false;if($scheme==='udp'&&filter_var((string)$parts['host'],FILTER_VALIDATE_IP,FILTER_FLAG_IPV4)){$octets=array_map('intval',explode('.',(string)$parts['host']));$udpMulticast=count($octets)===4&&$octets[0]>=224&&$octets[0]<=239;}if(!$udpMulticast&&!titan_transcode_public_host((string)$parts['host']))titan_transcode_fail(403,'میزبان منبع عمومی نیست یا DNS آن قابل تأیید نیست.');
$disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));if(!function_exists('proc_open')||in_array('proc_open',$disabled,true))titan_transcode_fail(503,'PHP روی این هاست اجرای پردازش FFmpeg را مجاز نمی‌کند. سرویس تبدیل باید روی VPS یا هاست دارای proc_open اجرا شود.');
$ffmpeg=titan_transcode_binary('ffmpeg');if(!$ffmpeg)titan_transcode_fail(503,'FFmpeg نصب نیست یا در PATH نیست. مسیر آن را در متغیر محیطی TITAN_FFMPEG تنظیم کنید.');
$q=(string)($_GET['q']??'auto');$profiles=['480'=>['w'=>854,'v'=>'1100k','max'=>'1400k','buf'=>'2200k'],'720'=>['w'=>1280,'v'=>'2500k','max'=>'3200k','buf'=>'5000k'],'1080'=>['w'=>1920,'v'=>'4500k','max'=>'5500k','buf'=>'9000k'],'auto'=>['w'=>1280,'v'=>'2500k','max'=>'3200k','buf'=>'5000k']];$profile=$profiles[$q]??$profiles['auto'];
$protocols='http,https,tcp,tls,crypto,rtmp,rtmps,rtsp,udp,srt';
$inputOptions=[$ffmpeg,'-hide_banner','-loglevel','error','-nostats','-nostdin','-protocol_whitelist',$protocols,'-fflags','+genpts+discardcorrupt','-rw_timeout','15000000'];if(in_array($scheme,['http','https'],true))array_push($inputOptions,'-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','2');if($scheme==='rtsp')array_push($inputOptions,'-rtsp_transport','tcp');array_push($inputOptions,'-analyzeduration','1000000','-probesize','1000000','-i',$url);
$outputOptions=[
    '-map','0:v:0?','-map','0:a:0?','-sn','-dn',
    '-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-profile:v','baseline','-level','3.1','-pix_fmt','yuv420p',
    '-vf',"scale=w='min({$profile['w']},iw)':h=-2:force_original_aspect_ratio=decrease",'-r','30','-g','60','-keyint_min','60','-sc_threshold','0',
    '-b:v',$profile['v'],'-maxrate',$profile['max'],'-bufsize',$profile['buf'],'-threads','2',
    '-c:a','aac','-b:a','128k','-ac','2','-ar','48000','-af','aresample=async=1:first_pts=0',
    '-movflags','+frag_keyframe+empty_moov+default_base_moof','-frag_duration','1000000','-flush_packets','1','-f','mp4','pipe:1'
];
$cmd=array_merge($inputOptions,$outputOptions);
$logFile=tempnam(sys_get_temp_dir(),'titan-ffmpeg-');if(!is_string($logFile))$logFile='/dev/null';
$descriptors=[0=>['pipe','r'],1=>['pipe','w'],2=>['file',$logFile,'a']];$process=@proc_open($cmd,$descriptors,$pipes,__DIR__);
if(!is_resource($process)){if($logFile!=='/dev/null')@unlink($logFile);titan_transcode_fail(503,'اجرای FFmpeg توسط هاست مسدود شد یا پردازش ساخته نشد.');}
if(isset($pipes[0])&&is_resource($pipes[0]))fclose($pipes[0]);if(isset($pipes[1])&&is_resource($pipes[1]))stream_set_blocking($pipes[1],true);
header('Content-Type: video/mp4');header('Accept-Ranges: none');header('Content-Disposition: inline; filename="titan-compatible.mp4"');header('Cache-Control: no-store');header('X-TITAN-Transcode: h264-aac-fmp4');
$sent=0;
try{while(isset($pipes[1])&&!feof($pipes[1])){if(connection_aborted())break;$chunk=fread($pipes[1],65536);if($chunk===false||$chunk===''){if(feof($pipes[1]))break;usleep(10000);continue;}echo $chunk;$sent+=strlen($chunk);flush();}}finally{if(isset($pipes[1])&&is_resource($pipes[1]))fclose($pipes[1]);$status=proc_close($process);if($logFile!=='/dev/null'){if($status!==0){$log=@file_get_contents($logFile);if(is_string($log)&&$log!=='')error_log('TITAN FFmpeg failed: '.substr($log,0,1200));}@unlink($logFile);}}
if($sent===0&&!headers_sent())titan_transcode_fail(502,'FFmpeg هیچ داده قابل پخشی تولید نکرد. احتمالاً کدک libx264 موجود نیست، پروتکل در نسخه FFmpeg کامپایل نشده یا منبع دسترسی نمی‌دهد.');

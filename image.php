<?php
declare(strict_types=1);
require_once __DIR__.'/config.php';
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=86400');
function image_fail(int $code,string $message): never { http_response_code($code);header('Content-Type: text/plain; charset=utf-8');echo $message;exit; }
function image_public_host(string $host): bool {
  $host=trim($host,'[]');if(filter_var($host,FILTER_VALIDATE_IP))return filter_var($host,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)!==false;
  if($host===''||preg_match('/(^|\.)(localhost|local|internal)$/i',$host))return false;
  $records=@dns_get_record($host,DNS_A|DNS_AAAA);$ips=[];if(is_array($records))foreach($records as $r){if(!empty($r['ip']))$ips[]=$r['ip'];if(!empty($r['ipv6']))$ips[]=$r['ipv6'];}
  if(!$ips){$v=@gethostbynamel($host);if(is_array($v))$ips=$v;}if(!$ips)return false;
  foreach(array_unique($ips) as $ip)if(filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)===false)return false;return true;
}
function emit_image(string $bytes,string $mime): never {
  // Prefer WebP when an image decoder is installed; preserve transparency.
  if(extension_loaded('imagick')){
    try{$im=new Imagick();$im->readImageBlob($bytes);if($im->getNumberImages()>1)$im->setIteratorIndex(0);$im->setImageFormat('webp');$im->setImageCompressionQuality(88);header('Content-Type: image/webp');echo $im->getImageBlob();$im->clear();exit;}catch(Throwable $e){/* fall through to GD/raw */}
  }
  if(function_exists('imagecreatefromstring')&&function_exists('imagewebp')){
    $im=@imagecreatefromstring($bytes);if($im!==false){ob_start();imagewebp($im,null,88);$out=(string)ob_get_clean();imagedestroy($im);if($out!==''){header('Content-Type: image/webp');echo $out;exit;}}
  }
  // Last-resort conversion for formats that many mobile/legacy browsers cannot decode.
  // Use an argument array with proc_open (never a shell command) and cap input/output.
  $needsConversion=in_array(strtolower($mime),['image/heic','image/heif','image/tiff','image/avif','image/svg+xml','image/bmp','image/x-ms-bmp','image/vnd.microsoft.icon','image/x-icon','image/apng'],true);
  $disabled=array_map('trim',explode(',',(string)ini_get('disable_functions')));
  if($needsConversion&&function_exists('proc_open')&&!in_array('proc_open',$disabled,true)){
    $bin=getenv('TITAN_FFMPEG');if(!is_string($bin)||$bin===''||!is_executable($bin))$bin=is_executable('/usr/bin/ffmpeg')?'/usr/bin/ffmpeg':(is_executable('/usr/local/bin/ffmpeg')?'/usr/local/bin/ffmpeg':null);
    $extensions=['image/heic'=>'heic','image/heif'=>'heif','image/tiff'=>'tiff','image/avif'=>'avif','image/svg+xml'=>'svg','image/bmp'=>'bmp','image/x-ms-bmp'=>'bmp','image/vnd.microsoft.icon'=>'ico','image/x-icon'=>'ico','image/apng'=>'png'];
    if($bin&&isset($extensions[strtolower($mime)])){
      $base=@tempnam(sys_get_temp_dir(),'titan-logo-');$temp=is_string($base)?$base.'.'.$extensions[strtolower($mime)]:'';
      if($base&&$temp!==''&&@rename($base,$temp)&&@file_put_contents($temp,$bytes,LOCK_EX)===strlen($bytes)){
        $cmd=[$bin,'-hide_banner','-loglevel','error','-nostdin','-threads','1','-i',$temp,'-frames:v','1','-vf',"scale=w='min(512,iw)':h=-2:force_original_aspect_ratio=decrease",'-f','image2pipe','-vcodec','png','pipe:1'];
        $desc=[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']];$proc=@proc_open($cmd,$desc,$pipes,__DIR__);
        if(is_resource($proc)){fclose($pipes[0]);$converted=stream_get_contents($pipes[1],8*1024*1024);$err=stream_get_contents($pipes[2],4096);fclose($pipes[1]);fclose($pipes[2]);$status=proc_close($proc);if($status===0&&is_string($converted)&&str_starts_with($converted,"\x89PNG\r\n\x1a\n")){@unlink($temp);header('Content-Type: image/png');header('X-TITAN-Image-Converted: ffmpeg');echo $converted;exit;}}
        @unlink($temp);
      }elseif($base){@unlink($base);if($temp!=='')@unlink($temp);}
    }
  }
  header('Content-Type: '.$mime);echo $bytes;exit;
}
$allowedExt=['svg','png','jpg','jpeg','gif','webp','avif','bmp','ico','tif','tiff','heic','heif','apng'];
if(isset($_GET['file'])){
  $name=basename((string)$_GET['file']);$ext=strtolower(pathinfo($name,PATHINFO_EXTENSION));if(!in_array($ext,$allowedExt,true))image_fail(400,'فرمت تصویر مجاز نیست.');
  $base=realpath(__DIR__.'/assets/logos');$path=realpath(__DIR__.'/assets/logos/'.$name);if(!$base||!$path||!str_starts_with($path,$base.DIRECTORY_SEPARATOR)||!is_file($path))image_fail(404,'فایل لوگو پیدا نشد.');
  $bytes=@file_get_contents($path);if(!is_string($bytes)||strlen($bytes)>8*1024*1024)image_fail(413,'حجم تصویر بیش از حد مجاز است.');
  $mime=function_exists('mime_content_type')?(mime_content_type($path)?:'application/octet-stream'):'application/octet-stream';emit_image($bytes,$mime);
}
$encoded=(string)($_GET['u']??'');$expires=filter_var($_GET['e']??null,FILTER_VALIDATE_INT);$sig=(string)($_GET['s']??'');$url=base64_decode(strtr($encoded,'-_','+/').str_repeat('=',(4-strlen($encoded)%4)%4),true);
if(!is_string($url)||!$expires||$expires<time()||$expires>time()+900||!hash_equals(titanStreamSignature($url,(int)$expires),$sig))image_fail(403,'نشانی تصویر منقضی یا نامعتبر است.');
$p=parse_url($url);if(!$p||!in_array(strtolower((string)($p['scheme']??'')),['http','https'],true)||empty($p['host'])||isset($p['user'])||isset($p['pass'])||!image_public_host((string)$p['host']))image_fail(403,'میزبان تصویر مجاز نیست.');
if(!function_exists('curl_init'))image_fail(503,'افزونه PHP cURL فعال نیست.');
function image_resolve_redirect(string $base,string $ref): string {
  if(preg_match('~^https?://~i',$ref))return $ref;
  $b=parse_url($base);if(!$b||empty($b['host']))return $ref;
  $origin=$b['scheme'].'://'.$b['host'].(isset($b['port'])?':'.$b['port']:'');
  if(str_starts_with($ref,'//'))return $b['scheme'].':'.$ref;
  if(str_starts_with($ref,'?'))return $origin.($b['path']??'/').$ref;
  $r=parse_url($ref);$rp=$r['path']??'';
  if(str_starts_with($rp,'/'))$path=$rp;else{$bp=$b['path']??'/';$dir=substr($bp,0,strrpos($bp,'/')!==false?strrpos($bp,'/')+1:0);$path=$dir.$rp;}
  $stack=[];foreach(explode('/',$path) as $part){if($part===''||$part==='.')continue;if($part==='..'){array_pop($stack);continue;}$stack[]=$part;}
  return $origin.'/'.implode('/',$stack).(isset($r['query'])?'?'.$r['query']:'');
}
$current=$url;$body='';$mime='';$status=0;$tooLarge=false;
for($hop=0;$hop<5;$hop++){
  $parts=parse_url($current);if(!$parts||empty($parts['host'])||!image_public_host((string)$parts['host']))image_fail(403,'مسیر تغییر تصویر به میزبان غیرعمومی ختم شد.');
  $headers=[];$body='';$status=0;$location='';$tooLarge=false;
  $ch=curl_init($current);
  curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>6,CURLOPT_TIMEOUT=>14,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_USERAGENT=>'Mozilla/5.0 TITAN Logo Fetcher',CURLOPT_HTTPHEADER=>['Accept: image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8','Accept-Encoding: identity'],
    CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$headers,&$status,&$location){$len=strlen($line);if(preg_match('~^HTTP/\\S+\\s+(\\d{3})~i',$line,$m)){$status=(int)$m[1];$headers=[];$location='';}elseif(strpos($line,':')!==false){[$k,$v]=explode(':',$line,2);$k=strtolower(trim($k));$headers[$k]=trim($v);if($k==='location')$location=trim($v);}return $len;},
    CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$body,&$tooLarge){$len=strlen($chunk);if(strlen($body)+$len>8*1024*1024){$tooLarge=true;return 0;}$body.=$chunk;return $len;}
  ]);
  $ok=curl_exec($ch);$curlError=curl_error($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE)?:$status;curl_close($ch);
  if($status>=300&&$status<400&&$location!==''){$current=image_resolve_redirect($current,$location);continue;}
  $mime=strtolower(trim(explode(';',(string)($headers['content-type']??''))[0]));
  if($tooLarge)image_fail(413,'حجم تصویر بیش از ۸ مگابایت است.');
  if($ok===false||$status<200||$status>=300)image_fail(502,'دریافت لوگو از سرور ناموفق بود (HTTP '.($status?:'نامشخص').'). '.($curlError?:''));
  break;
}
if($status>=300&&$status<400)image_fail(502,'سرور لوگو بیش از حد تغییر مسیر داد.');
$magicMime='';
if(str_starts_with($body,"\x89PNG\r\n\x1a\n"))$magicMime='image/png';
elseif(str_starts_with($body,"\xff\xd8\xff"))$magicMime='image/jpeg';
elseif(str_starts_with($body,'GIF87a')||str_starts_with($body,'GIF89a'))$magicMime='image/gif';
elseif(str_starts_with(ltrim($body),'<svg')||str_contains(substr(ltrim($body),0,300),'<svg'))$magicMime='image/svg+xml';
elseif(strlen($body)>12&&substr($body,4,4)==='ftyp'&&preg_match('/avif|avis/',substr($body,8,16)))$magicMime='image/avif';
elseif(str_starts_with($body,'RIFF')&&substr($body,8,4)==='WEBP')$magicMime='image/webp';
if(!str_starts_with($mime,'image/'))$mime=$magicMime;
if($body===''||$mime==='')image_fail(502,'پاسخ سرور لوگو تصویر معتبر نیست؛ به‌جای لوگو احتمالاً صفحه HTML یا خطای دسترسی برگشته است.');
emit_image($body,$mime);

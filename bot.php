<?php
declare(strict_types=1);
require_once __DIR__.'/config.php';
header('Content-Type: text/plain; charset=utf-8');

if(BOT_TOKEN===''||BOT_TOKEN==='PASTE_TELEGRAM_BOT_TOKEN_HERE'||!preg_match('/^\d+:[A-Za-z0-9_-]+$/',BOT_TOKEN)||!filter_var(APP_URL,FILTER_VALIDATE_URL)||stripos(APP_URL,'https://')!==0){
  http_response_code(500);exit('TITAN bot configuration is incomplete.');
}
// احراز وب‌هوک خودکار است و از توکن اصلی ربات مشتق می‌شود.
$provided=(string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN']??'');
if($provided===''||!hash_equals(titanWebhookSecret(),$provided)){http_response_code(403);exit('Forbidden');}
if(!function_exists('curl_init')){http_response_code(500);exit('PHP cURL extension is required.');}
function telegram(string $method,array $payload): array {
  $ch=curl_init('https://api.telegram.org/bot'.BOT_TOKEN.'/'.$method);
  curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>18,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
  $raw=curl_exec($ch);$code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);$err=curl_error($ch);curl_close($ch);
  if($raw===false||$code<200||$code>=300){error_log('TITAN Telegram '.$method.' failed: '.$code.' '.$err);return ['ok'=>false,'description'=>'Telegram API request failed'];}
  $data=json_decode((string)$raw,true);return is_array($data)?$data:['ok'=>false];
}
function playlistCounts(): string {
  $groups=['پخش زنده'=>'live','لیست پخش 1'=>'list1','لیست پخش 2'=>'list2','لیست پخش 3'=>'list3'];$out=[];$total=0;
  foreach($groups as $label=>$file){$count=0;$path=__DIR__.'/playlists/'.$file.'.m3u';if(is_readable($path)){foreach(file($path,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)?:[] as $line){if(str_starts_with(trim($line),'#EXTINF'))$count++;}}$out[]=$label.': '.$count;$total+=$count;}
  $out[]='همه: '.$total;
  return implode("\n",$out);
}
$raw=file_get_contents('php://input');$update=json_decode($raw?:'',true);if(!is_array($update)){echo 'OK';exit;}
$message=$update['message']??$update['edited_message']??null;
if(!is_array($message)||!isset($message['chat']['id'])){if(isset($update['callback_query']['id']))telegram('answerCallbackQuery',['callback_query_id'=>$update['callback_query']['id']]);echo 'OK';exit;}
$chatId=$message['chat']['id'];$chatType=(string)($message['chat']['type']??'private');$text=trim((string)($message['text']??''));
$command='';if(preg_match('~^/([a-z_]+)(?:@\w+)?(?:\s|$)~iu',$text,$m))$command=strtolower($m[1]);
$keyboard=[];$reply='';
if(in_array($command,['start','app','open'],true)){
  $reply="به TITAN خوش آمدید!\n\nبرای باز کردن پخش‌کننده روی دکمه زیر بزنید. شبکه‌ها و لوگوها پس از بروزرسانی از فایل‌های سایت خوانده می‌شوند.";
  $button=['text'=>'📺 باز کردن TITAN'];if($chatType==='private')$button['web_app']=['url'=>APP_URL];else $button['url']=APP_URL;
  $keyboard=['inline_keyboard'=>[[$button]]];
}elseif($command==='playlists'){
  $reply="وضعیت فهرست شبکه‌ها در هاست:\n\n".playlistCounts()."\n\nبرای دریافت تغییرات، داخل برنامه دکمه بروزرسانی را بزنید.";
}elseif($command==='status'){
  $reply="TITAN آماده است.\n\nآدرس برنامه: ".APP_URL."\n\n".playlistCounts();
}elseif(in_array($command,['help','commands'],true)||$command===''){
  $reply="دستورهای ربات TITAN:\n/start — باز کردن برنامه\n/app — نمایش دکمه ورود\n/playlists — تعداد شبکه‌های هر فهرست\n/status — وضعیت برنامه\n/help — راهنما";
  if($chatType==='private')$keyboard=['inline_keyboard'=>[[['text'=>'📺 باز کردن TITAN','web_app'=>['url'=>APP_URL]]]]];
}else{
  $reply="دستور شناخته نشد. برای دیدن راهنما /help را بفرستید.";
}
$payload=['chat_id'=>$chatId,'text'=>$reply,'disable_web_page_preview'=>true];if($keyboard)$payload['reply_markup']=$keyboard;
$result=telegram('sendMessage',$payload);if(empty($result['ok'])){http_response_code(502);echo 'Telegram API request failed';exit;}echo 'OK';

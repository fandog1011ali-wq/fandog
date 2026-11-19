<?php
declare(strict_types=1);
require_once __DIR__.'/config.php';
header('Content-Type: text/plain; charset=utf-8');

// این فایل فقط یک بار اجرا می‌شود و پس از نصب، خودش را حذف می‌کند.
$doneFile=__DIR__.'/.titan-webhook-setup-done';
$lockFile=__DIR__.'/.titan-webhook-setup-lock';
if(is_file($doneFile)){http_response_code(410);exit('Webhook setup has already been completed.');}
if(PHP_SAPI!=='cli'){
  if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET'){http_response_code(405);exit('Method not allowed');}
}
if(BOT_TOKEN==='PASTE_TELEGRAM_BOT_TOKEN_HERE'||!preg_match('/^\d+:[A-Za-z0-9_-]+$/',BOT_TOKEN)||stripos(APP_URL,'https://')!==0){http_response_code(500);exit('Set BOT_TOKEN and APP_URL in config.php first.');}
if(!function_exists('curl_init')){http_response_code(500);exit('PHP cURL extension is required.');}
$lock=@fopen($lockFile,'x');if($lock===false){http_response_code(409);exit('Setup is already running or locked.');}
fwrite($lock,(string)time());fclose($lock);
function callTelegram(string $method,array $data): array{
  $c=curl_init('https://api.telegram.org/bot'.BOT_TOKEN.'/'.$method);
  curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($data),CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
  $r=curl_exec($c);$e=curl_error($c);curl_close($c);$j=json_decode((string)$r,true);
  if(!is_array($j))throw new RuntimeException($e?:'Invalid Telegram response');return $j;
}
try{
  $hook=callTelegram('setWebhook',['url'=>rtrim(APP_URL,'/').'/bot.php','secret_token'=>titanWebhookSecret(),'allowed_updates'=>json_encode(['message','edited_message','callback_query']),'drop_pending_updates'=>'false']);
  if(empty($hook['ok']))throw new RuntimeException('setWebhook failed: '.($hook['description']??'unknown error'));
  $commands=[['command'=>'start','description'=>'باز کردن برنامه'],['command'=>'app','description'=>'نمایش دکمه ورود'],['command'=>'playlists','description'=>'تعداد شبکه‌ها'],['command'=>'status','description'=>'وضعیت برنامه'],['command'=>'help','description'=>'راهنمای ربات']];
  $cmd=callTelegram('setMyCommands',['commands'=>json_encode($commands,JSON_UNESCAPED_UNICODE)]);
  $menu=callTelegram('setChatMenuButton',['menu_button'=>json_encode(['type'=>'web_app','text'=>'TITAN','web_app'=>['url'=>APP_URL]],JSON_UNESCAPED_UNICODE)]);
  file_put_contents($doneFile,date('c'),LOCK_EX);
  @unlink($lockFile);
  $removed=@unlink(__FILE__);
  echo "Webhook: OK\nCommands: ".(!empty($cmd['ok'])?'OK':'FAILED')."\nMenu button: ".(!empty($menu['ok'])?'OK':'FAILED')."\n\n";
  echo $removed?'Setup script removed automatically.':'IMPORTANT: delete setup-webhook.php manually now.';
}catch(Throwable $e){@unlink($lockFile);http_response_code(502);echo $e->getMessage();}

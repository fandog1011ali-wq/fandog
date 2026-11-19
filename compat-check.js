/* TITAN compatibility router - ES5 only for Android 4.x browsers. */
(function () {
  var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
  var androidMatch = /Android\s+([0-9]+)/i.exec(ua);
  var webkitMatch = /AppleWebKit\/(\d+)/i.exec(ua);
  var oldAndroid = !!(androidMatch && parseInt(androidMatch[1], 10) <= 4);
  var oldWebKit = !!(webkitMatch && parseInt(webkitMatch[1], 10) < 537);
  var modernSyntax = false;
  var unicodeRegex = false;
  try {
    modernSyntax = (new Function('var item = {}; return item?.value ?? 1;'))() === 1;
  } catch (syntaxError) { modernSyntax = false; }
  try {
    unicodeRegex = (new RegExp('\\p{L}', 'u')).test('A');
  } catch (regexError) { unicodeRegex = false; }
  var hasReplaceChildren = !!(document.createElement('div').replaceChildren);
  var lacksModernFeatures = !modernSyntax || !unicodeRegex || !window.fetch || !window.Promise ||
    !window.Promise.allSettled || !window.AbortController || !window.TextEncoder ||
    !window.URLSearchParams || !window.Map || !window.Set || !Array.prototype.includes ||
    !Array.prototype.find || !Array.prototype.findIndex || !Array.prototype.flatMap ||
    !String.prototype.includes || !String.prototype.startsWith || !String.prototype.padStart ||
    !String.prototype.normalize || !Object.entries || !Object.fromEntries ||
    !Number.isFinite || !hasReplaceChildren;
  var useLegacy = oldAndroid || oldWebKit || lacksModernFeatures;
  var path = (window.location && window.location.pathname) ? window.location.pathname : '/';
  var isLegacyPage = /\/legacy\.html$/i.test(path);
  var isModernPage = /\/modern\.html$/i.test(path);
  var isEntryPage = !isLegacyPage && !isModernPage;
  var suffix = (window.location.search || '') + (window.location.hash || '');
  var target = '';

  if (useLegacy && !isLegacyPage) {
    target = 'legacy.html' + suffix;
  } else if (!useLegacy && isEntryPage) {
    target = 'modern.html' + suffix;
  }
  if (target) {
    window.location.replace(target);
  }
}());

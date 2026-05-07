// ╔══════════════════════════════════════════════════════════════════════╗
// ║     THE GAHWA · AGGREGATE NEWSLETTERS v5                             ║
// ║     The Gulf Brief · Gmail + RSS → Daily Intel Dump                  ║
// ╠══════════════════════════════════════════════════════════════════════╣
// ║  Runs at 6:00am daily via setupAllTriggers()                         ║
// ║  Outputs: "Daily Intel Dump - [date]" Google Doc                     ║
// ║                                                                      ║
// ║  SOURCES (in order of appearance in the doc):                        ║
// ║  1.  Gmail newsletters                                               ║
// ║  2.  RSS_FEEDS_GULF          — Gulf/GCC/Saudi/GCC agencies           ║
// ║  3.  RSS_FEEDS_CAPITAL_MARKETS — Tadawul, Nomu, IPOs, sukuk         ║
// ║  4.  RSS_FEEDS_ENERGY        — Oil, OPEC+, gas, renewables          ║
// ║  5.  RSS_FEEDS_GIGAPROJECTS  — NEOM, Red Sea, Diriyah, Qiddiya      ║
// ║  6.  RSS_FEEDS_VISION2030    — Saudi reform & social transformation  ║
// ║  7.  RSS_FEEDS_MACRO         — Global macro & geopolitics            ║
// ║  8.  RSS_FEEDS_AI            — AI & Technology (global)              ║
// ║  9.  RSS_FEEDS_GULF_TECH     — Gulf digital economy & startups       ║
// ║  10. RSS_FEEDS_FINTECH       — Fintech, Islamic finance & crypto     ║
// ║  11. RSS_FEEDS_SUSTAINABILITY — ESG, net zero, green economy         ║
// ║  12. RSS_FEEDS_RESEARCH      — Think tanks & policy analysis         ║
// ║  13. RSS_FEEDS_LUXURY        — Luxury, wealth & private capital      ║
// ║  14. RSS_FEEDS_SPORTS        — Sports economy & entertainment        ║
// ║  15. RSS_FEEDS_TOURISM       — Tourism, travel & aviation            ║
// ║  16. RSS_FEEDS_FOOD          — Food, dining & hospitality            ║
// ║  17. RSS_FEEDS_CULTURE       — Arts, culture & heritage              ║
// ║  18. RSS_FEEDS_LIFESTYLE     — Gulf lifestyle & city culture         ║
// ║  19. RSS_FEEDS_HEALTH        — Health, wellness & medtech            ║
// ║  20. RSS_FEEDS_COFFEE        — Coffee & café culture                 ║
// ║                                                                      ║
// ║  TARGET: Per-category maxItems caps — no global daily cap            ║
// ║  DEDUP:  Title+date fingerprint — no duplicate articles              ║
// ║  YouTube removed — RSS endpoint returns 404 for all channels         ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════
// @agent-target: INTEL_FOLDER_ID
var INTEL_FOLDER_ID  = '14MfCtuSMSgnUGnxgduoxsXKQj5f4roI0';
var WEEKLY_FOLDER_ID = '10weeyxOqd0c7V3AsLeH7XPnPtKu-HDti';
var FITNESS_SHEET_ID = '1OpElJOuewVqo17fTB_7ugufx2OjfdtsAP2W4Wuk4LRI';
var GMAIL_LABEL      = 'label:Professional/News newer_than:1d -subject:"STARTUP SCOUT" -subject:"Gahwa"';

// @agent-target: RSS_HOURS_BACK
var RSS_HOURS_BACK = 26;

// ════════════════════════════════════════════════════════════════════════
// RSS FEED LISTS — by category
// maxItems = max articles per feed per day
// All feeds verified as public, no auth required, stable RSS endpoints
// ════════════════════════════════════════════════════════════════════════

// ── GULF / GCC / SAUDI ──
// @agent-target: RSS_FEEDS_GULF
var RSS_FEEDS_GULF = [
  { name: 'Arab News Business',        url: 'https://www.arabnews.com/cat/72/rss.xml',                   maxItems: 3 },
  { name: 'Saudi Gazette Business',    url: 'https://saudigazette.com.sa/rss/business',                  maxItems: 2 },
  { name: 'EnterpriseAM Saudi',        url: 'https://enterpriseam.com/ksa/feed/',                        maxItems: 3 },
  { name: 'EnterpriseAM UAE',          url: 'https://enterpriseam.com/uae/feed/',                        maxItems: 2 },
  { name: 'MEED',                      url: 'https://www.meed.com/rss/',                                 maxItems: 2 },
  { name: 'AGBI',                      url: 'https://www.agbi.com/feed/',                                maxItems: 3 },
  { name: 'Khaleej Times Business',    url: 'https://www.khaleejtimes.com/rss/business',                 maxItems: 2 },
  { name: 'Mubasher English',          url: 'https://english.mubasher.info/news/rss',                    maxItems: 2 },
  { name: 'Argaam English',            url: 'https://www.argaam.com/en/rss',                             maxItems: 2 },
  { name: 'SPA (Saudi Press Agency)',  url: 'https://www.spa.gov.sa/rss/en',                             maxItems: 2 },
];

// ── CAPITAL MARKETS ──
// @agent-target: RSS_FEEDS_CAPITAL_MARKETS
var RSS_FEEDS_CAPITAL_MARKETS = [
  { name: 'Argaam English Markets',    url: 'https://www.argaam.com/en/rss',                             maxItems: 3 },
  { name: 'Mubasher Markets',          url: 'https://english.mubasher.info/news/rss',                    maxItems: 3 },
  { name: 'AGBI Capital',              url: 'https://agbi.com/feed/',                                    maxItems: 2 },
];

// ── ENERGY & COMMODITIES ──
// @agent-target: RSS_FEEDS_ENERGY
var RSS_FEEDS_ENERGY = [
  { name: 'Arab News Energy',          url: 'https://www.arabnews.com/cat/3/rss.xml',                    maxItems: 2 },
  { name: 'AGBI Energy',               url: 'https://agbi.com/feed/',                                    maxItems: 2 },
  { name: 'Energy Monitor',            url: 'https://www.energymonitor.ai/feed/',                        maxItems: 2 },
  { name: 'Saudi Gazette Business',    url: 'https://saudigazette.com.sa/rss/business',                  maxItems: 2 },
];

// ── GIGAPROJECTS & REAL ESTATE ──
// @agent-target: RSS_FEEDS_GIGAPROJECTS
var RSS_FEEDS_GIGAPROJECTS = [
  { name: 'MEED Projects',             url: 'https://www.meed.com/rss/',                                 maxItems: 3 },
  { name: 'Arab News Real Estate',     url: 'https://www.arabnews.com/cat/12/rss.xml',                   maxItems: 2 },
];

// ── SAUDI VISION 2030 & REFORM ──
// @agent-target: RSS_FEEDS_VISION2030
var RSS_FEEDS_VISION2030 = [
  { name: 'Saudi Gazette',             url: 'https://saudigazette.com.sa/rss/saudi-arabia',              maxItems: 2 },
  { name: 'AGSIW',                     url: 'https://agsi.org/feed/',                                    maxItems: 2 },
  { name: 'Forbes Middle East',        url: 'https://www.forbesmiddleeast.com/feed/',                    maxItems: 1 },
];


// ── AI & TECHNOLOGY ──
// @agent-target: RSS_FEEDS_AI
var RSS_FEEDS_AI = [
  { name: 'TechCrunch AI',             url: 'https://techcrunch.com/category/artificial-intelligence/feed/', maxItems: 2 },
  { name: 'MIT Tech Review',           url: 'https://www.technologyreview.com/feed/',                    maxItems: 2 },
  { name: 'The Verge Tech',            url: 'https://www.theverge.com/rss/index.xml',                    maxItems: 2 },
  { name: 'VentureBeat AI',            url: 'https://venturebeat.com/category/ai/feed/',                 maxItems: 2 },
  { name: 'Wired Business',            url: 'https://www.wired.com/feed/category/business/latest/rss',   maxItems: 1 },
];

// ── GULF TECH & DIGITAL ECONOMY ──
// @agent-target: RSS_FEEDS_GULF_TECH
var RSS_FEEDS_GULF_TECH = [
  { name: 'Arab News Tech',            url: 'https://www.arabnews.com/cat/15/rss.xml',                   maxItems: 2 },
  { name: 'Gulf Business Tech',        url: 'https://gulfbusiness.com/category/technology/feed/',        maxItems: 2 },
  { name: 'Tahawultech',               url: 'https://www.tahawultech.com/feed/',                         maxItems: 3 },
];

// ── GLOBAL MACRO & GEOPOLITICS ──
// @agent-target: RSS_FEEDS_MACRO
var RSS_FEEDS_MACRO = [
  { name: 'Reuters Business',          url: 'https://feeds.reuters.com/reuters/businessNews',            maxItems: 3 },
  { name: 'FT World',                  url: 'https://www.ft.com/world?format=rss',                      maxItems: 2 },
  { name: 'Bloomberg Markets',         url: 'https://feeds.bloomberg.com/markets/news.rss',              maxItems: 2 },
  { name: 'WSJ Economy',               url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml',          maxItems: 2 },
  { name: 'Al Monitor MENA',           url: 'https://www.al-monitor.com/rss',                            maxItems: 2 },
  { name: 'Middle East Eye',           url: 'https://www.middleeasteye.net/rss',                         maxItems: 2 },
  { name: 'AGSIW Macro',               url: 'https://agsi.org/feed/',                                    maxItems: 1 },
  { name: 'Chatham House MENA',        url: 'https://www.chathamhouse.org/rss/region/middle-east-north-africa', maxItems: 1 },
  { name: 'IMF MENA Blog',             url: 'https://www.imf.org/en/Blogs/rss',                         maxItems: 1 },
];

// ── FINTECH & CRYPTO ──
// @agent-target: RSS_FEEDS_FINTECH
var RSS_FEEDS_FINTECH = [
  { name: 'CoinDesk',                  url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',           maxItems: 2 },
  { name: 'The Block',                 url: 'https://www.theblock.co/rss.xml',                           maxItems: 2 },
  { name: 'Finextra',                  url: 'https://www.finextra.com/rss/finextra-news.xml',            maxItems: 2 },
  { name: 'Crowdfund Insider',         url: 'https://www.crowdfundinsider.com/feed/',                    maxItems: 1 },
  { name: 'IFN Islamic Finance',       url: 'https://www.islamicfinancenews.com/feed',                   maxItems: 2 },
  { name: 'The Paypers',               url: 'https://thepaypers.com/rss/',                               maxItems: 2 },
  { name: 'Arab News Finance',         url: 'https://www.arabnews.com/cat/5/rss.xml',                    maxItems: 2 },
  { name: 'Zawya Islamic Finance',     url: 'https://www.zawya.com/rss/mena/islamic-finance',            maxItems: 2 },
];

// ── SUSTAINABILITY & GREEN ECONOMY ──
// @agent-target: RSS_FEEDS_SUSTAINABILITY
var RSS_FEEDS_SUSTAINABILITY = [
  { name: 'Arab News Environment',     url: 'https://www.arabnews.com/cat/14/rss.xml',                   maxItems: 2 },
  { name: 'Zawya Sustainability',      url: 'https://www.zawya.com/rss/mena/sustainability',             maxItems: 2 },
  { name: 'Carbon Brief',              url: 'https://www.carbonbrief.org/feed/',                         maxItems: 1 },
];

// ── THINK TANKS & POLICY RESEARCH ──
// @agent-target: RSS_FEEDS_RESEARCH
var RSS_FEEDS_RESEARCH = [
  { name: 'AGSIW Research',            url: 'https://agsi.org/feed/',                                    maxItems: 2 },
  { name: 'MEI Research',              url: 'https://www.mei.edu/publications/rss.xml',                  maxItems: 1 },
  { name: 'Chatham House MENA',        url: 'https://www.chathamhouse.org/rss/region/middle-east-north-africa', maxItems: 1 },
  { name: 'Brookings MENA',            url: 'https://www.brookings.edu/topic/middle-east/feed/',         maxItems: 1 },
  { name: 'IMF MENA Blog',             url: 'https://www.imf.org/en/Blogs/rss',                         maxItems: 1 },
  { name: 'World Bank MENA',           url: 'https://feeds.worldbank.org/worldbank/mena/rss',            maxItems: 1 },
];

// ── LUXURY & WEALTH ──
// @agent-target: RSS_FEEDS_LUXURY
var RSS_FEEDS_LUXURY = [
  { name: 'Forbes Middle East',        url: 'https://www.forbesmiddleeast.com/feed/',                    maxItems: 2 },
  { name: 'Robb Report',               url: 'https://robbreport.com/feed/',                              maxItems: 2 },
  { name: 'Campden FB Family Office',  url: 'https://www.campdenfb.com/feed',                            maxItems: 1 },
  { name: "Spear's Magazine",          url: 'https://spearswms.com/feed/',                               maxItems: 1 },
];

// ── SPORTS & ENTERTAINMENT ECONOMY ──
// @agent-target: RSS_FEEDS_SPORTS
var RSS_FEEDS_SPORTS = [
  { name: 'Arab News Sports',          url: 'https://www.arabnews.com/cat/2/rss.xml',                    maxItems: 2 },
  { name: 'SportsPro',                 url: 'https://www.sportspro.com/feed/',                           maxItems: 2 },
  { name: 'Front Office Sports',       url: 'https://frontofficesports.com/feed/',                       maxItems: 1 },
];

// ── TOURISM, TRAVEL & AVIATION ──
// @agent-target: RSS_FEEDS_TOURISM
var RSS_FEEDS_TOURISM = [
  { name: 'Arab News Tourism',         url: 'https://www.arabnews.com/cat/4/rss.xml',                    maxItems: 2 },
  { name: 'Skift',                     url: 'https://skift.com/feed/',                                   maxItems: 2 },
  { name: 'TTG Middle East',           url: 'https://www.ttgmena.com/feed/',                             maxItems: 2 },
  { name: 'Breaking Travel News',      url: 'https://www.breakingtravelnews.com/feed/',                  maxItems: 1 },
];

// ── FOOD, DINING & HOSPITALITY ──
// @agent-target: RSS_FEEDS_FOOD
var RSS_FEEDS_FOOD = [
  { name: 'Caterer Middle East',       url: 'https://www.caterermiddleeast.com/feed/',                   maxItems: 2 },
  { name: 'Hotelier Middle East',      url: 'https://www.hoteliermiddleeast.com/feed/',                  maxItems: 2 },
  { name: 'Hospitality News ME',       url: 'https://www.hospitalitynewsmag.com/feed/',                  maxItems: 2 },
];

// ── ARTS, CULTURE & HERITAGE ──
// @agent-target: RSS_FEEDS_CULTURE
var RSS_FEEDS_CULTURE = [
  { name: 'Arab News Culture',         url: 'https://www.arabnews.com/cat/6/rss.xml',                    maxItems: 2 },
  { name: 'Brownbook',                 url: 'https://brownbook.me/feed/',                                maxItems: 2 },
  { name: 'Hyphen Magazine',           url: 'https://hyphen.media/feed/',                                maxItems: 2 },
  { name: 'Doha News',                 url: 'https://dohanews.co/feed/',                                 maxItems: 1 },
];

// ── LIFESTYLE (GULF) ──
// @agent-target: RSS_FEEDS_LIFESTYLE
var RSS_FEEDS_LIFESTYLE = [
  { name: 'WhatsOn UAE',               url: 'https://whatson.ae/feed/',                                  maxItems: 2 },
  { name: 'Time Out Dubai',            url: 'https://www.timeoutdubai.com/feed/rss',                     maxItems: 2 },
  { name: 'Time Out Abu Dhabi',        url: 'https://www.timeoutabudhabi.com/feed/rss',                  maxItems: 1 },
  { name: 'Lovin Dubai',               url: 'https://lovin.co/dubai/en/news/feed/',                      maxItems: 2 },
  { name: 'Lovin Riyadh',              url: 'https://lovin.co/riyadh/en/feed/',                          maxItems: 2 },
];

// ── HEALTH, WELLNESS & MEDICAL TOURISM ──
// @agent-target: RSS_FEEDS_HEALTH
var RSS_FEEDS_HEALTH = [
  { name: 'Arab Hospital',             url: 'https://www.arabhospital.com/feed/',                        maxItems: 2 },
];


// ── COFFEE & CAFÉ CULTURE ──
// @agent-target: RSS_FEEDS_COFFEE
var RSS_FEEDS_COFFEE = [
  { name: 'Sprudge',                   url: 'https://sprudge.com/feed',                                  maxItems: 2 },
  { name: 'Perfect Daily Grind',       url: 'https://perfectdailygrind.com/feed/',                       maxItems: 2 },
  { name: 'Barista Magazine',          url: 'https://www.baristamagazine.com/feed/',                     maxItems: 1 },
  { name: 'WhatsOn UAE Cafes',         url: 'https://whatson.ae/feed/',                                  maxItems: 2 },
  { name: 'Lovin Riyadh Coffee',       url: 'https://lovin.co/riyadh/en/feed/',                          maxItems: 2 },
];


// ════════════════════════════════════════════════════════════════════════
// MAIN — aggregateNewsletters
// ════════════════════════════════════════════════════════════════════════
// @agent-target: aggregateNewsletters
function aggregateNewsletters() {
  autoSetupTriggers();

  var folder  = DriveApp.getFolderById(INTEL_FOLDER_ID);
  var dateStr = new Date().toDateString();
  var docName = 'Daily Intel Dump - ' + dateStr;

  var doc  = DocumentApp.create(docName);
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  var body = doc.getBody();

  try {
    body.appendParagraph(getTodayWorkout());
  } catch(e) {
    body.appendParagraph('⚠️ Workout fetch failed: ' + e.message);
  }
  body.appendPageBreak();

  body.appendParagraph(docName).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('TOTAL NEWSLETTERS WILL FOLLOW BELOW')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendHorizontalRule();

  var counter    = 0;
  var seenTitles = {};

  counter = appendGmailNewsletters(body, counter);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_GULF,            '🌍 GULF & GCC',                seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_CAPITAL_MARKETS, '📈 CAPITAL MARKETS',           seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_ENERGY,          '⛽ ENERGY & COMMODITIES',      seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_GIGAPROJECTS,    '🏗️ GIGAPROJECTS',              seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_VISION2030,      '🇸🇦 SAUDI VISION 2030',        seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_MACRO,           '📊 MACRO & GEOPOLITICS',       seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_AI,              '🤖 AI & TECHNOLOGY',           seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_GULF_TECH,       '💻 GULF TECH',                 seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_FINTECH,         '💳 FINTECH & CRYPTO',          seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_SUSTAINABILITY,  '🌿 SUSTAINABILITY',            seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_RESEARCH,        '🔬 THINK TANKS & RESEARCH',    seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_LUXURY,          '💎 LUXURY & WEALTH',           seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_SPORTS,          '🏆 SPORTS & ENTERTAINMENT',    seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_TOURISM,         '✈️ TOURISM & AVIATION',        seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_FOOD,            '🍽️ FOOD & HOSPITALITY',        seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_CULTURE,         '🎨 ARTS & CULTURE',            seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_LIFESTYLE,       '🌆 LIFESTYLE',                 seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_HEALTH,          '🏥 HEALTH & WELLNESS',         seenTitles);
  counter = appendRSSCategory(body, counter, RSS_FEEDS_COFFEE,          '☕ COFFEE & CAFÉ CULTURE',     seenTitles);

  body.insertParagraph(1, 'TOTAL NEWSLETTERS: ' + counter);

  Logger.log('✅ Intel Dump created: ' + docName + ' (' + counter + ' sources)');
}


// ════════════════════════════════════════════════════════════════════════
// RSS CATEGORY FETCHER
// ════════════════════════════════════════════════════════════════════════
// @agent-target: appendRSSCategory
function appendRSSCategory(body, counter, feeds, categoryLabel, seenTitles) {
  var cutoff   = new Date(Date.now() - RSS_HOURS_BACK * 60 * 60 * 1000);
  var catCount = 0;

  body.appendParagraph('══════ RSS: ' + categoryLabel + ' ══════')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

  feeds.forEach(function(feed) {
    try {
      var resp = UrlFetchApp.fetch(feed.url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheGahwa/1.0)' },
      });

      if (resp.getResponseCode() !== 200) {
        Logger.log('⚠️ RSS failed: ' + feed.name + ' (' + resp.getResponseCode() + ')');
        return;
      }

      var xml   = resp.getContentText();
      var items = xml.split('<item>').slice(1);

      if (items.length === 0) items = xml.split('<entry>').slice(1);

      var added = 0;

      items.forEach(function(item) {
        if (added >= feed.maxItems) return;

        var pubMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/)
                    || item.match(/<published>([^<]+)<\/published>/)
                    || item.match(/<updated>([^<]+)<\/updated>/);
        if (pubMatch) {
          var pubDate = new Date(pubMatch[1]);
          if (pubDate < cutoff) return;
        }

        var titleMatch   = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        var linkMatch    = item.match(/<link[^>]*href="([^"]+)"/)
                       || item.match(/<link>([^<]+)<\/link>/);
        var descMatch    = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        var contentMatch = item.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/)
                       || item.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/);
        var summaryMatch = item.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/);

        if (!titleMatch) return;

        var title = decodeXmlEntities(titleMatch[1].trim());
        if (!title || title.length < 5) return;

        var titleKey = title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
        if (seenTitles[titleKey]) return;
        seenTitles[titleKey] = true;

        var url     = linkMatch ? linkMatch[1].trim() : feed.url;
        var content = contentMatch ? contentMatch[1]
                    : (summaryMatch ? summaryMatch[1]
                    : (descMatch    ? descMatch[1] : ''));

        content = content
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s{2,}/g, ' ').trim();

        if (content.length < 80) return;
        if (content.length > 12000) content = content.substring(0, 12000) + '\n\n[TRUNCATED]';

        counter++;
        added++;
        catCount++;
        appendNewsletterBlock(body, counter, title, feed.name, url, content);
        Logger.log('📰 [' + categoryLabel + '] ' + title.substring(0, 70) + ' [' + feed.name + ']');
      });

      if (added === 0) Logger.log('📭 No fresh items in last ' + RSS_HOURS_BACK + 'h: ' + feed.name);

    } catch(e) {
      Logger.log('⚠️ RSS error [' + feed.name + ']: ' + e.message);
    }
  });

  Logger.log('📰 ' + categoryLabel + ': ' + catCount + ' articles added');
  return counter;
}


// ════════════════════════════════════════════════════════════════════════
// GMAIL SECTION
// ════════════════════════════════════════════════════════════════════════
// @agent-target: appendGmailNewsletters
function appendGmailNewsletters(body, counter) {
  var threads = GmailApp.search(GMAIL_LABEL);

  if (threads.length === 0) {
    body.appendParagraph('⛔ NO EMAIL NEWSLETTERS FOUND');
    return counter;
  }

  var seen = {};

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg     = messages[j];
      var subject = msg.getSubject().trim();

      if (seen[subject]) continue;
      seen[subject] = true;

      var sender      = cleanSender(msg.getFrom());
      var msgDate     = msg.getDate().toDateString();
      var fingerprint = sender + '|' + msgDate;
      if (seen[fingerprint]) continue;
      seen[fingerprint] = true;

      var bodyText = msg.getPlainBody();
      var url      = extractBestUrl(bodyText);

      if (bodyText.length > 20000) {
        bodyText = bodyText.substring(0, 20000) + '\n\n[TRUNCATED]';
      }

      counter++;
      appendNewsletterBlock(body, counter, subject, sender, url, bodyText);
    }
  }

  Logger.log('📧 Gmail: ' + counter + ' newsletters');
  return counter;
}


// ════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════════════════════════════════════
// @agent-target: appendNewsletterBlock
function appendNewsletterBlock(body, num, title, publisher, url, content) {
  body.appendParagraph('===== NEWSLETTER #' + num + ' START =====')
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph('Title: ' + title);
  body.appendParagraph('Publisher: ' + publisher);
  body.appendParagraph('Primary URL: ' + url);
  body.appendParagraph('CONTENT:');
  body.appendParagraph(content);
  body.appendParagraph('===== NEWSLETTER #' + num + ' END =====')
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendPageBreak();
}

// @agent-target: extractBestUrl
function extractBestUrl(text) {
  var urls = text.match(/https?:\/\/[^\s]+/g);
  if (!urls) return 'N/A';

  var priority = [
    'axios.com','morningbrew.com','alphasignal.ai',
    'theneurondaily.com','tldr.tech','cognitiverevolution.ai',
  ];

  for (var i = 0; i < urls.length; i++) {
    for (var j = 0; j < priority.length; j++) {
      if (urls[i].indexOf(priority[j]) !== -1) return cleanUrl(urls[i]);
    }
  }
  return cleanUrl(urls[0]);
}

// @agent-target: cleanUrl
function cleanUrl(url) {
  return url.split('?')[0];
}

// @agent-target: cleanSender
function cleanSender(rawFrom) {
  var match = rawFrom.match(/^(.*?)(<.*>)?$/);
  return match ? match[1].replace(/"/g, '').trim() : rawFrom;
}

// @agent-target: decodeXmlEntities
function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// @agent-target: formatNumber
function formatNumber(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
  return n.toString();
}


// ════════════════════════════════════════════════════════════════════════
// WORKOUT
// ════════════════════════════════════════════════════════════════════════
// @agent-target: getTodayWorkout
function getTodayWorkout() {
  var sheet = SpreadsheetApp.openById(FITNESS_SHEET_ID).getSheetByName('Fitness');
  var data  = sheet.getDataRange().getValues();
  var today = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == today) {
      return '⚡ TODAY\'S MARCHING ORDERS ⚡\n' +
        '🎯 ' + data[i][1] + '\n\n' +
        '🤸 ' + data[i][2] + '\n\n' +
        '⚔️ ' + data[i][3] + '\n\n' +
        '👟 ' + data[i][4];
    }
  }
  return '⚡ TODAY\'S MARCHING ORDERS ⚡ — Not found for ' + today;
}


// ════════════════════════════════════════════════════════════════════════
// WEEKLY CONSOLIDATION
// ════════════════════════════════════════════════════════════════════════
// @agent-target: consolidateWeeklyIntel
function consolidateWeeklyIntel() {
  var scoutFolder  = DriveApp.getFolderById('1fz_cnHzeu4IhrhPNzW-65rZVmX0A796S');
  var weeklyFolder = DriveApp.getFolderById(WEEKLY_FOLDER_ID);

  var weekEnd   = new Date();
  var weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  var docName   = 'THE GAHWA — WEEKLY INTEL — ' +
                  weekStart.toDateString() + ' → ' + weekEnd.toDateString();

  var doc  = DocumentApp.create(docName);
  DriveApp.getFileById(doc.getId()).moveTo(weeklyFolder);
  var body = doc.getBody();

  body.appendParagraph('THE GAHWA · THE GULF BRIEF — WEEKLY INTELLIGENCE CONSOLIDATION')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Period: ' + weekStart.toDateString() +
                       ' to ' + weekEnd.toDateString());
  body.appendParagraph(
    'This document consolidates the ranked signals, themes, startup ideas, ' +
    'and watch list from each daily Gahwa issue this week. ' +
    'It is optimised for strategic review in NotebookLM. ' +
    'Fitness and viral sections are excluded. ' +
    'Each day is clearly labelled and self-contained.'
  );
  body.appendHorizontalRule();

  var files = scoutFolder.getFiles();
  var days  = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    if (!name.match(/^Scout_.*\.html$/)) continue;
    var created = file.getDateCreated().getTime();
    if (created < weekStart.getTime() || created > weekEnd.getTime()) continue;
    days.push({ file: file, created: created, name: name });
  }

  if (days.length === 0) {
    body.appendParagraph('⛔ No Gahwa Scout HTML files found for this week.');
    Logger.log('No Gahwa Scout HTML files found for the past 7 days.');
    return;
  }

  days.sort(function(a, b) { return a.created - b.created; });
  Logger.log('Found ' + days.length + ' Gahwa Scout files to consolidate.');

  var allSignalHeadlines = [];
  var count = 0;

  days.forEach(function(day) {
    try {
      var html   = day.file.getBlob().getDataAsString();
      var parsed = parseScoutHTML(html);
      if (!parsed) return;

      count++;

      body.appendParagraph('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph('DAY ' + count + ' — ' + parsed.date)
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph(
        'Newsletters: ' + parsed.newsletters +
        ' · Signals: ' + parsed.signalCount +
        ' · Priority: ' + parsed.priority
      );

      if (parsed.sod) {
        body.appendParagraph('SIGNAL OF THE DAY:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
        body.appendParagraph(parsed.sod);
      }
      if (parsed.voice) {
        body.appendParagraph('EDITOR\'S LINE: ' + parsed.voice);
      }

      body.appendParagraph('RANKED SIGNALS:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
      parsed.signals.forEach(function(sig) {
        body.appendParagraph(
          '[' + sig.cat + '] ' + (sig.pri === 'YES' ? '🔴 ' : '') + sig.headline
        );
        if (sig.insight) body.appendParagraph('  → ' + sig.insight);
        if (sig.whynow)  body.appendParagraph('  ✦ ' + sig.whynow);
        body.appendParagraph('');
        allSignalHeadlines.push(sig.headline);
      });

      if (parsed.themes) {
        body.appendParagraph('THEMES:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
        body.appendParagraph(parsed.themes);
      }
      if (parsed.startups) {
        body.appendParagraph('STARTUP ENGINE:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
        body.appendParagraph(parsed.startups);
      }
      if (parsed.watchlist) {
        body.appendParagraph('WATCH LIST:').setHeading(DocumentApp.ParagraphHeading.HEADING3);
        body.appendParagraph(parsed.watchlist);
      }

      body.appendPageBreak();

    } catch(e) {
      Logger.log('Error processing ' + day.name + ': ' + e.message);
    }
  });

  if (allSignalHeadlines.length > 0) {
    body.appendParagraph('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('SIGNAL FREQUENCY INDEX — ALL ' + allSignalHeadlines.length + ' SIGNALS THIS WEEK')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(
      'Signals that appeared on multiple days indicate sustained trends.'
    );
    body.appendParagraph('');
    allSignalHeadlines.forEach(function(h, i) {
      body.appendParagraph((i + 1) + '. ' + h);
    });
  }

  body.insertParagraph(3,
    'WEEK SUMMARY: ' + count + ' daily issues · ' +
    allSignalHeadlines.length + ' total signals indexed'
  );

  Logger.log('✅ Weekly consolidation complete: ' + count +
             ' days, ' + allSignalHeadlines.length + ' signals → ' + docName);
}


// ════════════════════════════════════════════════════════════════════════
// HTML PARSER
// ════════════════════════════════════════════════════════════════════════
// @agent-target: parseScoutHTML
function parseScoutHTML(html) {
  if (!html || html.length < 500) return null;

  var text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ').trim();

  var dateMatch = html.match(/<title>[^·]+·\s*([^<]+)<\/title>/);
  var date      = dateMatch ? dateMatch[1].trim() : 'Unknown date';

  var nlMatch  = html.match(/(\d+)\s*<\/div>\s*<div class="mast-stat-l">Newsletters/);
  var sigMatch = html.match(/(\d+)\s*<\/div>\s*<div class="mast-stat-l">Signals/);
  var priMatch = html.match(/(\d+)\s*<\/div>\s*<div class="mast-stat-l">Priority/);

  var sodMatch   = html.match(/mast-sod-text[^>]*>([^<]+)</);
  var sod        = sodMatch ? sodMatch[1].trim() : '';
  var voiceMatch = html.match(/class="editorial"[^>]*>([^<]+)</);
  var voice      = voiceMatch ? voiceMatch[1].trim() : '';

  var signals      = [];
  var allHeadlines = html.match(/class="sig-h">([^<]+)<\/div>/g) || [];
  var allInsights  = html.match(/class="sig-i">([^<]+)<\/div>/g) || [];
  var allWhynow    = html.match(/class="sig-w"><strong>[^<]*<\/strong>\s*([^<]+)<\/div>/g) || [];
  var priBadges    = html.match(/class="badge b-pri"/g) || [];

  allHeadlines.forEach(function(h, i) {
    var headline = h.replace(/class="sig-h">/, '').replace(/<\/div>/, '').trim();
    var insight  = allInsights[i] ? allInsights[i].replace(/class="sig-i">/, '').replace(/<\/div>/, '').trim() : '';
    var whynow   = allWhynow[i]   ? allWhynow[i].replace(/class="sig-w"><strong>[^<]*<\/strong>\s*/, '').replace(/<\/div>/, '').trim() : '';
    signals.push({
      headline: headline,
      insight:  insight,
      whynow:   whynow,
      cat:      '',
      pri:      i < priBadges.length ? 'YES' : 'NO',
    });
  });

  var themesMatch  = html.match(/id="themes"[\s\S]*?id="viral"/);
  var themesText   = themesMatch ? stripTags(themesMatch[0]) : '';
  var startupMatch = html.match(/id="startup"[\s\S]*?id="watch"/);
  var startupText  = startupMatch ? stripTags(startupMatch[0]) : '';
  var watchMatch   = html.match(/id="watch"[\s\S]*?id="inspiration"/);
  if (!watchMatch) watchMatch = html.match(/id="watch"[\s\S]*?id="question"/);
  var watchText    = watchMatch ? stripTags(watchMatch[0]) : '';

  return {
    date:        date,
    newsletters: nlMatch  ? nlMatch[1]  : '?',
    signalCount: sigMatch ? sigMatch[1] : signals.length.toString(),
    priority:    priMatch ? priMatch[1] : '?',
    sod:         sod,
    voice:       voice,
    signals:     signals,
    themes:      themesText.substring(0, 4000),
    startups:    startupText.substring(0, 4000),
    watchlist:   watchText.substring(0, 2000),
  };
}

// @agent-target: stripTags
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s{2,}/g, ' ').trim();
}

"""Locate Japanese news: map article text to prefectures and judge national scope."""
import re

# JIS prefecture codes, matching the ids in web/japan.json.
PREFECTURES = [
    (1, "北海道", "北海道"), (2, "青森県", "東北"), (3, "岩手県", "東北"),
    (4, "宮城県", "東北"), (5, "秋田県", "東北"), (6, "山形県", "東北"),
    (7, "福島県", "東北"), (8, "茨城県", "関東"), (9, "栃木県", "関東"),
    (10, "群馬県", "関東"), (11, "埼玉県", "関東"), (12, "千葉県", "関東"),
    (13, "東京都", "関東"), (14, "神奈川県", "関東"), (15, "新潟県", "中部"),
    (16, "富山県", "中部"), (17, "石川県", "中部"), (18, "福井県", "中部"),
    (19, "山梨県", "中部"), (20, "長野県", "中部"), (21, "岐阜県", "中部"),
    (22, "静岡県", "中部"), (23, "愛知県", "中部"), (24, "三重県", "近畿"),
    (25, "滋賀県", "近畿"), (26, "京都府", "近畿"), (27, "大阪府", "近畿"),
    (28, "兵庫県", "近畿"), (29, "奈良県", "近畿"), (30, "和歌山県", "近畿"),
    (31, "鳥取県", "中国"), (32, "島根県", "中国"), (33, "岡山県", "中国"),
    (34, "広島県", "中国"), (35, "山口県", "中国"), (36, "徳島県", "四国"),
    (37, "香川県", "四国"), (38, "愛媛県", "四国"), (39, "高知県", "四国"),
    (40, "福岡県", "九州"), (41, "佐賀県", "九州"), (42, "長崎県", "九州"),
    (43, "熊本県", "九州"), (44, "大分県", "九州"), (45, "宮崎県", "九州"),
    (46, "鹿児島県", "九州"), (47, "沖縄県", "沖縄"),
]

PREF_NAME = {code: name for code, name, _ in PREFECTURES}
PREF_REGION = {code: region for code, _, region in PREFECTURES}

# Bare prefecture names (no 県/府/都 suffix) that are safe to match on their own.
# Excluded on purpose: 大分 (also the adverb だいぶ), 香川・千葉・宮崎 (common
# surnames), 三重 (also 三重に＝"triply"), 福井・山口・石川 (common surnames).
_BARE_SAFE = {
    1: ["北海道"], 2: ["青森"], 3: ["岩手"], 4: ["宮城"], 5: ["秋田"],
    6: ["山形"], 7: ["福島"], 8: ["茨城"], 9: ["栃木"], 10: ["群馬"],
    11: ["埼玉"], 13: ["東京"], 14: ["神奈川"], 15: ["新潟"], 16: ["富山"],
    19: ["山梨"], 20: ["長野"], 21: ["岐阜"], 22: ["静岡"], 23: ["愛知"],
    25: ["滋賀"], 26: ["京都"], 27: ["大阪"], 28: ["兵庫"], 29: ["奈良"],
    30: ["和歌山"], 31: ["鳥取"], 32: ["島根"], 33: ["岡山"], 34: ["広島"],
    38: ["愛媛"], 40: ["福岡"], 42: ["長崎"], 43: ["熊本"], 46: ["鹿児島"],
    47: ["沖縄"],
}

# Cities and landmarks that pin an article to a prefecture even when the
# prefecture itself is never named.
_PLACES = {
    1: ["札幌", "旭川", "函館", "帯広", "釧路", "苫小牧", "石狩", "新千歳", "知床",
        "富良野", "小樽", "北見", "室蘭"],
    2: ["八戸", "弘前", "青森市", "三沢"],
    3: ["盛岡", "花巻", "釜石", "陸前高田", "宮古市", "一関"],
    4: ["仙台", "石巻", "気仙沼", "名取"],
    5: ["秋田市", "横手", "大館", "能代"],
    6: ["山形市", "鶴岡", "酒田", "米沢", "蔵王"],
    7: ["いわき", "南相馬", "浪江", "福島ロボットテストフィールド", "郡山", "会津若松",
        "楢葉", "双葉町", "大熊町"],
    8: ["つくば", "水戸", "日立市", "鹿嶋", "神栖", "土浦"],
    9: ["宇都宮", "那須", "日光", "足利市"],
    10: ["前橋", "高崎", "太田市", "桐生", "草津温泉"],
    11: ["さいたま", "川越", "所沢", "熊谷", "秩父", "越谷"],
    12: ["千葉市", "成田", "船橋", "柏市", "幕張", "木更津", "銚子", "浦安"],
    13: ["渋谷", "新宿", "秋葉原", "有明", "臨海副都心", "多摩", "八王子", "羽田",
         "大手町", "丸の内", "豊洲", "台場", "世田谷", "練馬", "江東区", "品川区",
         "立川市", "町田市"],
    14: ["横浜", "川崎市", "相模原", "藤沢", "厚木", "鎌倉", "箱根", "横須賀", "小田原"],
    15: ["新潟市", "長岡", "佐渡", "上越市", "湯沢"],
    16: ["富山市", "高岡", "黒部市"],
    17: ["金沢", "能登", "輪島", "珠洲", "七尾"],
    18: ["福井市", "敦賀", "小浜市", "永平寺"],
    19: ["甲府", "富士吉田", "山中湖", "河口湖"],
    20: ["松本市", "軽井沢", "長野市", "諏訪", "上田市"],
    21: ["岐阜市", "高山市", "大垣", "白川郷"],
    22: ["浜松", "静岡市", "沼津", "富士市", "熱海", "伊豆", "御前崎", "掛川"],
    23: ["名古屋", "豊田市", "豊橋", "岡崎市", "中部国際空港", "常滑", "一宮市"],
    24: ["四日市", "伊勢市", "鈴鹿", "志摩", "桑名", "熊野市"],
    25: ["大津市", "彦根", "琵琶湖", "草津市"],
    26: ["京都市", "宇治", "舞鶴", "嵐山"],
    27: ["大阪市", "堺市", "吹田", "夢洲", "関西国際空港", "東大阪", "枚方", "豊中"],
    28: ["神戸", "姫路", "西宮", "尼崎", "淡路島", "明石市"],
    29: ["奈良市", "橿原", "吉野町"],
    30: ["和歌山市", "白浜", "串本", "那智", "高野山"],
    31: ["鳥取市", "米子", "境港"],
    32: ["松江", "出雲市", "隠岐", "浜田市"],
    33: ["岡山市", "倉敷", "津山"],
    34: ["広島市", "福山市", "尾道", "呉市", "宮島"],
    35: ["下関", "山口市", "岩国", "宇部", "萩市"],
    36: ["徳島市", "鳴門", "祖谷"],
    37: ["高松市", "丸亀", "小豆島", "琴平"],
    38: ["松山市", "今治", "新居浜", "宇和島"],
    39: ["高知市", "四万十", "室戸"],
    40: ["福岡市", "北九州", "博多", "久留米", "太宰府", "糸島"],
    41: ["佐賀市", "唐津", "有田町", "武雄"],
    42: ["長崎市", "佐世保", "五島", "対馬", "島原", "壱岐"],
    43: ["熊本市", "阿蘇", "天草", "八代市", "水俣"],
    44: ["大分市", "別府", "由布院", "中津市", "日田"],
    45: ["宮崎市", "都城", "日南", "延岡"],
    46: ["鹿児島市", "奄美", "種子島", "屋久島", "桜島", "霧島", "内之浦"],
    47: ["那覇", "石垣島", "宮古島", "沖縄本島", "名護", "宜野湾", "辺野古", "うるま市"],
}

# Full names always match; they are unambiguous.
_PATTERNS = []
for _code, _name, _ in PREFECTURES:
    _PATTERNS.append((_code, re.escape(_name)))
for _code, _names in _BARE_SAFE.items():
    for _n in _names:
        if _n != PREF_NAME[_code]:
            _PATTERNS.append((_code, re.escape(_n)))
for _code, _names in _PLACES.items():
    for _n in _names:
        _PATTERNS.append((_code, re.escape(_n)))

# 京都 must not fire on the tail of 東京都, and 東京 must not fire inside 東京都
# twice; longest-first matching plus a lookbehind on 京都 handles both.
_PATTERNS.sort(key=lambda p: -len(p[1]))
_PREF_RE = re.compile(
    "|".join("(?P<p%d_%d>%s)" % (c, i, pat) for i, (c, pat) in enumerate(_PATTERNS))
)
_GROUP_TO_CODE = {"p%d_%d" % (c, i): c for i, (c, _) in enumerate(_PATTERNS)}

# Signals that an article is nationwide rather than tied to one prefecture.
NATIONAL_TERMS = [
    "国土交通省", "国交省", "航空局", "経済産業省", "経産省", "総務省", "防衛省",
    "警察庁", "消防庁", "デジタル庁", "内閣府", "内閣官房", "政府", "閣議",
    "全国", "日本全国", "全都道府県", "改正航空法", "航空法", "省令", "告示",
    "パブリックコメント", "パブコメ", "法改正", "制度改正", "国家戦略特区",
    "レベル4", "レベル3.5", "機体認証", "型式認証", "技能証明", "無人航空機操縦者技能証明",
]

# A stricter subset: these make an item genuinely headline-worthy.
FLAGSHIP_TERMS = [
    "国土交通省", "国交省", "航空局", "航空法", "省令", "告示", "閣議",
    "パブリックコメント", "パブコメ", "法改正", "制度改正", "型式認証",
    "機体認証", "技能証明", "レベル4", "レベル3.5",
]

_OVERSEAS_RE = re.compile(
    r"米国|アメリカ|中国|欧州|EU|英国|ウクライナ|ロシア|韓国|台湾|インド|"
    r"ドイツ|フランス|イスラエル|FAA|EASA|NASA|DARPA"
)


# --------------------------------------------------------------------------
# Countries
# --------------------------------------------------------------------------
#
# Short display name + the spellings that actually turn up in drone coverage.
# Deliberately curated rather than generated from the map data: matching all
# 174 Natural Earth names produces constant false positives (Chad, Mali, Niger,
# Georgia, Jordan are ordinary words or US states in running text).
#
# Traps handled by ordering and by omission:
#   - インド must be tried after インドネシア, オーストリア after オーストラリア.
#   - Bare タイ (タイヤ/タイトル/タイム) and チリ (塵) are omitted; only the
#     unambiguous forms are matched.
#   - Bare "US" would match the pronoun, so only U.S./USA/United States count.
COUNTRIES = [
    ("JP", "日本", ["日本", "Japan", "Japanese"]),
    ("US", "米国", ["アメリカ合衆国", "アメリカ", "米国", "米軍", "United States",
                    "U.S.", "USA", "American"]),
    ("CN", "中国", ["中華人民共和国", "中国", "China", "Chinese"]),
    ("UA", "ウクライナ", ["ウクライナ", "Ukraine", "Ukrainian", "Kyiv", "キーウ"]),
    ("RU", "ロシア", ["ロシア", "Russia", "Russian", "Moscow", "モスクワ"]),
    ("KR", "韓国", ["韓国", "South Korea", "Seoul"]),
    ("KP", "北朝鮮", ["北朝鮮", "North Korea"]),
    ("TW", "台湾", ["台湾", "Taiwan"]),
    ("ID", "インドネシア", ["インドネシア", "Indonesia"]),
    ("IN", "インド", ["インド", "India", "Indian"]),
    ("GB", "英国", ["イギリス", "英国", "United Kingdom", "Britain", "British", "UK"]),
    ("FR", "フランス", ["フランス", "France", "French"]),
    ("DE", "ドイツ", ["ドイツ", "Germany", "German"]),
    ("IT", "イタリア", ["イタリア", "Italy", "Italian"]),
    ("ES", "スペイン", ["スペイン", "Spain", "Spanish"]),
    ("NL", "オランダ", ["オランダ", "Netherlands", "Dutch"]),
    ("CH", "スイス", ["スイス", "Switzerland", "Swiss"]),
    ("SE", "スウェーデン", ["スウェーデン", "Sweden", "Swedish"]),
    ("NO", "ノルウェー", ["ノルウェー", "Norway", "Norwegian"]),
    ("FI", "フィンランド", ["フィンランド", "Finland", "Finnish"]),
    ("DK", "デンマーク", ["デンマーク", "Denmark", "Danish"]),
    ("PL", "ポーランド", ["ポーランド", "Poland", "Polish"]),
    ("RO", "ルーマニア", ["ルーマニア", "Romania", "Romanian"]),
    ("AT", "オーストリア", ["オーストリア", "Austria"]),
    ("AU", "オーストラリア", ["オーストラリア", "Australia", "Australian"]),
    ("NZ", "ニュージーランド", ["ニュージーランド", "New Zealand"]),
    ("BE", "ベルギー", ["ベルギー", "Belgium"]),
    ("PT", "ポルトガル", ["ポルトガル", "Portugal"]),
    ("GR", "ギリシャ", ["ギリシャ", "Greece"]),
    ("CZ", "チェコ", ["チェコ", "Czech"]),
    ("HU", "ハンガリー", ["ハンガリー", "Hungary"]),
    ("IE", "アイルランド", ["アイルランド", "Ireland"]),
    ("EE", "エストニア", ["エストニア", "Estonia"]),
    ("LV", "ラトビア", ["ラトビア", "Latvia"]),
    ("LT", "リトアニア", ["リトアニア", "Lithuania"]),
    ("BY", "ベラルーシ", ["ベラルーシ", "Belarus"]),
    ("TR", "トルコ", ["トルコ", "Turkey", "Türkiye", "Turkish"]),
    ("IL", "イスラエル", ["イスラエル", "Israel", "Israeli"]),
    ("IR", "イラン", ["イラン", "Iran", "Iranian"]),
    ("IQ", "イラク", ["イラク", "Iraq"]),
    ("SY", "シリア", ["シリア", "Syria"]),
    ("YE", "イエメン", ["イエメン", "Yemen"]),
    ("AF", "アフガニスタン", ["アフガニスタン", "Afghanistan"]),
    ("SA", "サウジアラビア", ["サウジアラビア", "Saudi Arabia", "Saudi"]),
    ("AE", "UAE", ["アラブ首長国連邦", "UAE", "Emirates", "Dubai", "ドバイ", "Abu Dhabi"]),
    ("QA", "カタール", ["カタール", "Qatar"]),
    ("KW", "クウェート", ["クウェート", "Kuwait"]),
    ("EG", "エジプト", ["エジプト", "Egypt"]),
    ("MA", "モロッコ", ["モロッコ", "Morocco"]),
    ("DZ", "アルジェリア", ["アルジェリア", "Algeria"]),
    ("ZA", "南アフリカ", ["南アフリカ", "South Africa"]),
    ("NG", "ナイジェリア", ["ナイジェリア", "Nigeria", "Nigerian"]),
    ("KE", "ケニア", ["ケニア", "Kenya"]),
    ("RW", "ルワンダ", ["ルワンダ", "Rwanda"]),
    ("GH", "ガーナ", ["ガーナ", "Ghana"]),
    ("ET", "エチオピア", ["エチオピア", "Ethiopia"]),
    ("TZ", "タンザニア", ["タンザニア", "Tanzania"]),
    ("UG", "ウガンダ", ["ウガンダ", "Uganda"]),
    ("CA", "カナダ", ["カナダ", "Canada", "Canadian"]),
    ("MX", "メキシコ", ["メキシコ", "Mexico"]),
    ("BR", "ブラジル", ["ブラジル", "Brazil", "Brazilian"]),
    ("AR", "アルゼンチン", ["アルゼンチン", "Argentina"]),
    ("CL", "チリ", ["Chile"]),
    ("CO", "コロンビア", ["コロンビア", "Colombia"]),
    ("PE", "ペルー", ["ペルー", "Peru"]),
    ("SG", "シンガポール", ["シンガポール", "Singapore"]),
    ("MY", "マレーシア", ["マレーシア", "Malaysia"]),
    ("TH", "タイ", ["タイ王国", "タイ国", "Thailand", "Thai "]),
    ("VN", "ベトナム", ["ベトナム", "Vietnam"]),
    ("PH", "フィリピン", ["フィリピン", "Philippines"]),
    ("PK", "パキスタン", ["パキスタン", "Pakistan"]),
    ("BD", "バングラデシュ", ["バングラデシュ", "Bangladesh"]),
    ("LK", "スリランカ", ["スリランカ", "Sri Lanka"]),
    ("MM", "ミャンマー", ["ミャンマー", "Myanmar"]),
    ("NP", "ネパール", ["ネパール", "Nepal"]),
]

COUNTRY_JA = {iso: ja for iso, ja, _ in COUNTRIES}

_ASCII = re.compile(r"^[\x20-\x7e]+$")


def _country_pattern(alias):
    # ASCII aliases need word boundaries ("UK" must not fire inside "UKRAINE");
    # Japanese has no word breaks, so those match as plain substrings.
    if _ASCII.match(alias):
        return r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(alias)
    return re.escape(alias)


# Longest alias first so インドネシア wins over インド and オーストラリア over
# オーストリア at the same starting position.
_COUNTRY_ALIASES = sorted(
    ((iso, a) for iso, _, aliases in COUNTRIES for a in aliases),
    key=lambda p: -len(p[1]),
)
_COUNTRY_RE = re.compile(
    "|".join("(?P<c%d>%s)" % (i, _country_pattern(a))
             for i, (_, a) in enumerate(_COUNTRY_ALIASES)),
    re.IGNORECASE,
)
_CGROUP_TO_ISO = {"c%d" % i: iso for i, (iso, _) in enumerate(_COUNTRY_ALIASES)}


def find_countries(text):
    """ISO alpha-2 codes mentioned in the text, most-mentioned first."""
    if not text:
        return []
    hits = {}
    for m in _COUNTRY_RE.finditer(text):
        iso = _CGROUP_TO_ISO[m.lastgroup]
        hits[iso] = hits.get(iso, 0) + 1
    return [iso for iso, _ in sorted(hits.items(), key=lambda kv: -kv[1])]


def find_prefectures(text):
    """Return prefecture codes mentioned in the text, in order of appearance."""
    if not text:
        return []
    found = []
    for m in _PREF_RE.finditer(text):
        code = _GROUP_TO_CODE[m.lastgroup]
        # Guard the 京都 / 東京都 overlap: a 京都 hit directly after 東 is really
        # the tail of 東京都, which the longest-first ordering already matched.
        if code == 26 and m.start() > 0 and text[m.start() - 1] == "東":
            continue
        if code not in found:
            found.append(code)
    return found


def classify_scope(text, lang):
    """One of 'national', 'regional', 'overseas' or 'unknown'."""
    if lang != "ja":
        return "overseas"
    if any(t in text for t in NATIONAL_TERMS):
        return "national"
    if find_prefectures(text):
        return "regional"
    if _OVERSEAS_RE.search(text):
        return "overseas"
    return "unknown"


def flagship_score(text):
    """0-100 weight for how much an article deserves top billing."""
    if not text:
        return 0
    hits = [t for t in FLAGSHIP_TERMS if t in text]
    if not hits:
        return 0
    return min(100, 30 + 18 * len(hits))

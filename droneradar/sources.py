"""The default source catalogue.

Every entry here was checked against the live endpoint before being added.
Sites whose RSS has been retired (MLIT, FAA, DJI, Commercial UAV News) are
collected through Google News `site:` queries instead; Impress's ドローン
ジャーナル has no feed at all and gets a dedicated HTML scraper.
"""

CATEGORIES = [
    ("jp_news", "国内ニュース"),
    ("world_news", "海外ニュース"),
    ("defense", "防衛・軍事"),
    ("security", "対ドローン・安全"),
    ("regulation", "規制・制度"),
    ("aam", "eVTOL・空飛ぶクルマ"),
    ("disaster", "災害・救助"),
    ("survey", "測量・点検"),
    ("industry", "産業活用"),
    ("product", "製品・新機種"),
    ("research", "研究・論文"),
    ("dev", "開発・OSS"),
    ("video", "動画"),
    ("community", "コミュニティ"),
    ("business", "ビジネス・投資"),
    ("events", "イベント・大会"),
    ("hobby", "空撮・FPV"),
]

CATEGORY_LABEL = dict(CATEGORIES)


def _gnews(query, lang):
    """Build a Google News RSS URL for a query."""
    from urllib.parse import quote
    if lang == "ja":
        tail = "hl=ja&gl=JP&ceid=JP:ja"
    else:
        tail = "hl=en-US&gl=US&ceid=US:en"
    return "https://news.google.com/rss/search?q=%s&%s" % (quote(query), tail)


DEFAULT_SOURCES = [
    # --- 国内ニュース ---
    dict(id="dronejournal", name="ドローンジャーナル", type="dronejournal",
         url="https://drone-journal.impress.co.jp/category/news/",
         category="jp_news", lang="ja"),
    dict(id="dronejp", name="DRONE.jp", type="rss",
         url="https://www.drone.jp/feed/", category="jp_news", lang="ja"),
    dict(id="dronetribune", name="DroneTribune", type="rss",
         url="https://dronetribune.jp/feed/", category="jp_news", lang="ja"),
    dict(id="sorabatake", name="宙畑", type="rss",
         url="https://sorabatake.jp/feed/", category="jp_news", lang="ja"),
    dict(id="gn_drone_ja", name="Googleニュース「ドローン」", type="rss",
         url=_gnews("ドローン", "ja"), category="jp_news", lang="ja"),
    dict(id="gn_uav_ja", name="Googleニュース「無人航空機」", type="rss",
         url=_gnews("無人航空機 OR ドローン配送 OR ドローン点検", "ja"),
         category="jp_news", lang="ja"),
    dict(id="gn_aam_ja", name="Googleニュース「空飛ぶクルマ」", type="rss",
         url=_gnews('"空飛ぶクルマ" OR eVTOL', "ja"), category="jp_news", lang="ja"),

    # --- 規制・制度 ---
    dict(id="gn_mlit", name="国土交通省（site:検索）", type="rss",
         url=_gnews("site:mlit.go.jp ドローン OR 無人航空機", "ja"),
         category="regulation", lang="ja"),
    dict(id="gn_reg_ja", name="航空法・制度改正", type="rss",
         url=_gnews("ドローン 航空法 OR 機体認証 OR 型式認証 OR 技能証明", "ja"),
         category="regulation", lang="ja"),
    dict(id="gn_faa", name="FAA（site:検索）", type="rss",
         url=_gnews("site:faa.gov drone OR UAS", "en"),
         category="regulation", lang="en"),
    dict(id="easa", name="EASA", type="rss",
         url="https://www.easa.europa.eu/en/newsroom-and-events/news/rss.xml",
         category="regulation", lang="en"),

    # --- 海外ニュース ---
    dict(id="dronedj", name="DroneDJ", type="rss",
         url="https://dronedj.com/feed/", category="world_news", lang="en"),
    dict(id="dronelife", name="DroneLife", type="rss",
         url="https://dronelife.com/feed/", category="world_news", lang="en"),
    dict(id="suasnews", name="sUAS News", type="rss",
         url="https://www.suasnews.com/feed/", category="world_news", lang="en"),
    dict(id="dronegirl", name="The Drone Girl", type="rss",
         url="https://www.thedronegirl.com/feed/", category="world_news", lang="en"),
    dict(id="uasvision", name="UAS Vision", type="rss",
         url="https://www.uasvision.com/feed/", category="world_news", lang="en"),
    dict(id="gn_drone_en", name="Google News \"drone\"", type="rss",
         url=_gnews("drone OR UAV OR UAS", "en"), category="world_news", lang="en"),
    # Feeds that ship real article images — these carry the visual weight of the
    # grid, since Google News items resolve to opaque redirect URLs with none.
    dict(id="newatlas", name="New Atlas（ドローン）", type="rss",
         url="https://newatlas.com/drones/index.rss",
         category="world_news", lang="en"),
    dict(id="verticalmag", name="Vertical Magazine", type="rss",
         url="https://verticalmag.com/feed/", category="world_news", lang="en"),
    dict(id="droneii", name="Drone Industry Insights", type="rss",
         url="https://droneii.com/feed", category="business", lang="en"),
    dict(id="dronebelow", name="Drone Below", type="rss",
         url="https://dronebelow.com/feed/", category="world_news", lang="en"),
    dict(id="droneagent", name="DroneAgent", type="rss",
         url="https://drone-agent.jp/feed", category="jp_news", lang="ja"),

    # --- 製品・新機種 ---
    dict(id="gn_dji", name="DJI・新機種", type="rss",
         url=_gnews("DJI OR Skydio OR Autel drone launch OR release", "en"),
         category="product", lang="en"),
    dict(id="gn_product_ja", name="新製品（国内）", type="rss",
         url=_gnews("ドローン 新製品 OR 新機種 OR 発売", "ja"),
         category="product", lang="ja"),

    # --- ビジネス・投資 ---
    dict(id="gn_biz_en", name="資金調達・M&A", type="rss",
         url=_gnews("drone startup funding OR acquisition OR IPO", "en"),
         category="business", lang="en"),
    dict(id="gn_biz_ja", name="ドローン事業・市場", type="rss",
         url=_gnews("ドローン 資金調達 OR 業務提携 OR 実証実験", "ja"),
         category="business", lang="ja"),

    # --- 研究・論文 ---
    dict(id="arxiv_uav", name="arXiv（UAV/drone）", type="arxiv",
         url="UAV OR drone OR quadrotor", category="research", lang="en"),

    # --- 開発・OSS ---
    dict(id="ardupilot", name="ArduPilot", type="rss",
         url="https://discuss.ardupilot.org/c/blog.rss", category="dev", lang="en"),
    dict(id="px4", name="PX4", type="rss",
         url="https://discuss.px4.io/latest.rss", category="dev", lang="en"),
    dict(id="github_uav", name="GitHub（drone/UAV）", type="github",
         url="drone OR uav OR px4 OR ardupilot", category="dev", lang="en"),
    dict(id="hn_drone", name="Hacker News", type="hn",
         url="drone", category="dev", lang="en"),

    # --- コミュニティ ---
    dict(id="reddit_drones", name="r/drones", type="rss",
         url="https://www.reddit.com/r/drones/new/.rss",
         category="community", lang="en"),
    dict(id="reddit_search", name="Reddit 検索「drone」", type="rss",
         url="https://www.reddit.com/search.rss?q=drone&sort=new",
         category="community", lang="en"),

    # --- 動画（チャンネルIDは実際に解決して確認済み） ---
    dict(id="yt_dji", name="DJI", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UCsNGtpqGsyw0U6qEG-WHadA",
         category="video", lang="en"),
    dict(id="yt_autel", name="Autel Robotics", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UC1QYiRZkTUkmyW7atm776nA",
         category="video", lang="en"),
    dict(id="yt_dronedj", name="DroneDJ", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UCXQ8Rk4HPF5LZ-a0My7wDlw",
         category="video", lang="en"),
    dict(id="yt_parrot", name="Parrot", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UC8F2tpERSe3I8ZpdR4V8ung",
         category="video", lang="en"),
    dict(id="yt_rotorriot", name="Rotor Riot（FPV）", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UCAqyeI0hciWBF-CoNIMP49Q",
         category="video", lang="en"),
    dict(id="yt_uavfutures", name="UAV Futures", type="rss",
         url="https://www.youtube.com/feeds/videos.xml?channel_id=UCLtBvixg3XdD5I6S0J6HluQ",
         category="video", lang="en"),

    # --- YouTube 検索（個人投稿の空撮・FPV・ドローンショーはここでしか拾えない） ---
    dict(id="yts_aerial_ja", name="YouTube「ドローン空撮」", type="youtube_search",
         url="ドローン 空撮", category="video", lang="ja"),
    dict(id="yts_fpv_ja", name="YouTube「FPVドローン」", type="youtube_search",
         url="FPV ドローン", category="video", lang="ja"),
    dict(id="yts_show_ja", name="YouTube「ドローンショー」", type="youtube_search",
         url="ドローンショー", category="video", lang="ja"),
    dict(id="yts_news_ja", name="YouTube「ドローン ニュース」", type="youtube_search",
         url="ドローン ニュース", category="video", lang="ja"),
    dict(id="yts_fpv_en", name="YouTube \"FPV freestyle\"", type="youtube_search",
         url="FPV drone freestyle", category="video", lang="en"),
    dict(id="yts_aerial_en", name="YouTube \"drone footage\"", type="youtube_search",
         url="drone aerial footage 4K", category="video", lang="en"),

    # --- 空撮・FPV・ショー（記事側） ---
    dict(id="gn_hobby_ja", name="空撮・FPV", type="rss",
         url=_gnews("ドローン空撮 OR FPVドローン OR 空撮映像", "ja"),
         category="hobby", lang="ja"),

    # --- イベント・大会 ---
    dict(id="gn_events_ja", name="イベント・大会（国内）", type="rss",
         url=_gnews("ドローンショー OR ドローンレース OR ドローン大会 OR "
                    "ドローン 展示会 OR ドローン 実演", "ja"),
         category="events", lang="ja"),
    dict(id="gn_expo_ja", name="展示会・見本市", type="rss",
         url=_gnews("ジャパンドローン OR ドローン EXPO OR ドローン 見本市 OR "
                    "ドローン フェス", "ja"),
         category="events", lang="ja"),
    dict(id="gn_events_en", name="Races and shows", type="rss",
         url=_gnews("drone racing league OR drone light show OR drone championship "
                    "OR drone expo", "en"),
         category="events", lang="en"),
    dict(id="reddit_fpv", name="r/fpv", type="rss",
         url="https://www.reddit.com/r/fpv/new/.rss",
         category="hobby", lang="en"),
    dict(id="reddit_dronephoto", name="r/dronephotography", type="rss",
         url="https://www.reddit.com/r/dronephotography/new/.rss",
         category="hobby", lang="en"),

    # --- 防衛・軍事 ---
    dict(id="gn_defense_ja", name="防衛・軍事（国内）", type="rss",
         url=_gnews("ドローン 防衛省 OR 自衛隊 OR 無人機 攻撃", "ja"),
         category="defense", lang="ja"),
    dict(id="gn_defense_en", name="Defense drones", type="rss",
         url=_gnews("military drone OR loitering munition OR counter-UAS", "en"),
         category="defense", lang="en"),

    # --- 追加ジャンル専用のクエリ ---
    dict(id="gn_aam_ja2", name="eVTOL・空飛ぶクルマ（国内）", type="rss",
         url=_gnews('"空飛ぶクルマ" OR eVTOL OR エアタクシー OR バーティポート', "ja"),
         category="aam", lang="ja"),
    dict(id="gn_aam_en", name="Advanced air mobility", type="rss",
         url=_gnews("eVTOL OR air taxi OR advanced air mobility OR vertiport", "en"),
         category="aam", lang="en"),
    dict(id="gn_sec_ja", name="対ドローン・安全（国内）", type="rss",
         url=_gnews("ドローン 対策 OR 侵入 OR 無許可飛行 OR 書類送検 OR 飛行禁止", "ja"),
         category="security", lang="ja"),
    dict(id="gn_sec_en", name="Counter-UAS", type="rss",
         url=_gnews("counter-drone OR counter-UAS OR drone incursion OR drone jamming", "en"),
         category="security", lang="en"),
    dict(id="gn_disaster_ja", name="災害・救助（国内）", type="rss",
         url=_gnews("ドローン 災害 OR 救助 OR 捜索 OR 消防 OR 被災", "ja"),
         category="disaster", lang="ja"),
    dict(id="gn_disaster_en", name="Rescue and disaster", type="rss",
         url=_gnews("drone rescue OR disaster response drone OR wildfire drone", "en"),
         category="disaster", lang="en"),
    dict(id="gn_survey_ja", name="測量・点検（国内）", type="rss",
         url=_gnews("ドローン 測量 OR 点検 OR インフラ OR 三次元 OR 点群", "ja"),
         category="survey", lang="ja"),
    dict(id="gn_survey_en", name="Survey and inspection", type="rss",
         url=_gnews("drone survey OR drone inspection OR photogrammetry OR lidar drone", "en"),
         category="survey", lang="en"),
    dict(id="gn_industry_ja", name="物流・農業・資格", type="rss",
         url=_gnews("ドローン 配送 OR 物流 OR 農薬散布 OR スマート農業 OR 国家資格", "ja"),
         category="industry", lang="ja"),
    dict(id="gn_industry_en", name="Delivery and agriculture", type="rss",
         url=_gnews("drone delivery OR agricultural drone OR crop spraying drone", "en"),
         category="industry", lang="en"),

    # ======================================================================
    # Second pass. Everything below was fetched and parsed before being added;
    # `strict=True` marks the general-interest feeds, which carry drone stories
    # among a great deal else and so go through the same relevance test the
    # search feeds do.
    # ======================================================================

    # --- 海外ニュース ---
    dict(id="dronexl", name="DroneXL", type="rss",
         url="https://dronexl.co/feed", category="world_news", lang="en"),
    dict(id="droneblog", name="Droneblog", type="rss",
         url="https://www.droneblog.com/feed/", category="world_news", lang="en"),

    # --- 防衛・軍事 ---
    dict(id="twz", name="The War Zone", type="rss", strict=True,
         url="https://www.twz.com/feed", category="defense", lang="en"),
    dict(id="defensenews_uas", name="Defense News（無人機）", type="rss", strict=True,
         url="https://www.defensenews.com/arc/outboundfeeds/rss/category/unmanned/?outputType=xml",
         category="defense", lang="en"),
    dict(id="navalnews", name="Naval News", type="rss", strict=True,
         url="https://www.navalnews.com/feed/", category="defense", lang="en"),
    dict(id="dronewars", name="Drone Wars UK", type="rss",
         url="https://dronewars.net/feed/", category="defense", lang="en"),

    # --- 研究・論文 ---
    dict(id="ieee_robotics", name="IEEE Spectrum（ロボティクス）", type="rss", strict=True,
         url="https://spectrum.ieee.org/feeds/topic/robotics.rss",
         category="research", lang="en"),
    dict(id="techxplore_rob", name="TechXplore（ロボティクス）", type="rss", strict=True,
         url="https://techxplore.com/rss-feed/robotics-news/",
         category="research", lang="en"),

    # --- 開発・OSS（リリースそのものを拾う） ---
    dict(id="dronecode", name="Dronecode Foundation", type="rss",
         url="https://www.dronecode.org/feed/", category="dev", lang="en"),
    dict(id="rel_px4", name="PX4 リリース", type="rss",
         url="https://github.com/PX4/PX4-Autopilot/releases.atom",
         category="dev", lang="en"),
    dict(id="rel_ardupilot", name="ArduPilot リリース", type="rss",
         url="https://github.com/ArduPilot/ardupilot/releases.atom",
         category="dev", lang="en"),
    dict(id="rel_betaflight", name="Betaflight リリース", type="rss",
         url="https://github.com/betaflight/betaflight/releases.atom",
         category="dev", lang="en"),
    dict(id="rel_inav", name="INAV リリース", type="rss",
         url="https://github.com/iNavFlight/inav/releases.atom",
         category="dev", lang="en"),
    dict(id="rel_odm", name="OpenDroneMap リリース", type="rss",
         url="https://github.com/OpenDroneMap/ODM/releases.atom",
         category="dev", lang="en"),
    dict(id="ros_discourse", name="ROS Discourse", type="rss", strict=True,
         url="https://discourse.ros.org/latest.rss", category="dev", lang="en"),
    dict(id="auterion", name="Auterion", type="rss",
         url="https://auterion.com/feed/", category="dev", lang="en"),

    # --- 製品・現場（メーカー／ソリューション側） ---
    dict(id="flyability", name="Flyability（点検）", type="rss",
         url="https://www.flyability.com/blog/rss.xml",
         category="product", lang="en"),

    # --- 空撮・FPV ---
    dict(id="oscarliang", name="Oscar Liang（FPV）", type="rss",
         url="https://oscarliang.com/feed/", category="hobby", lang="en"),
    dict(id="reddit_fpvracing", name="r/fpvracing", type="rss",
         url="https://www.reddit.com/r/fpvracing/new/.rss",
         category="hobby", lang="en"),

    # --- 国内（汎用媒体をドローン語で濾す） ---
    dict(id="prtimes", name="PR TIMES", type="rss", strict=True,
         url="https://prtimes.jp/index.rdf", category="jp_news", lang="ja"),
    dict(id="nikkei_xtech", name="日経クロステック", type="rss", strict=True,
         url="https://xtech.nikkei.com/rss/index.rdf", category="jp_news", lang="ja"),
    dict(id="aviationwire", name="Aviation Wire", type="rss", strict=True,
         url="https://www.aviationwire.jp/feed", category="jp_news", lang="ja"),
    dict(id="logitoday", name="LOGISTICS TODAY", type="rss", strict=True,
         url="https://www.logi-today.com/feed", category="jp_news", lang="ja"),
    dict(id="netsecurity", name="ScanNetSecurity", type="rss", strict=True,
         url="https://scan.netsecurity.ne.jp/rss/index.rdf",
         category="jp_news", lang="ja"),

    # ======================================================================
    # Third pass. Filling in what the catalogue had no way of reaching.
    #
    # The gaps were not obscure corners — they were whole subjects. Nothing
    # here collected the licence system that every Japanese operator has to
    # pass, or accidents, or radio law (the aviation half of the rules was
    # covered and the spectrum half was not), or agriculture beyond a share of
    # one mixed query. Abroad, two of the larger trade titles have no working
    # feed at all, and neither did the American manufacturers that the
    # restrictions on DJI have been pushing buyers towards.
    #
    # Everything below was fetched and counted before being added. Sites whose
    # feed is retired or empty — Commercial UAV News, Unmanned Systems
    # Technology, JUIDA, Skydio — are collected through Google News `site:` or
    # name queries instead, the same way MLIT and FAA already were.
    # ======================================================================

    # --- 制度・資格・電波 ---
    dict(id="gn_licence_ja", name="国家資格・操縦士", type="rss",
         url=_gnews("ドローン 国家資格 OR 無人航空機操縦士 OR 技能証明 OR 機体認証", "ja"),
         category="regulation", lang="ja"),
    dict(id="gn_radio_ja", name="電波・無線（総務省）", type="rss",
         url=_gnews("ドローン 電波 OR 無線局 OR 免許 総務省 OR 携帯電話上空利用", "ja"),
         category="regulation", lang="ja"),
    dict(id="gn_bvlos_en", name="BVLOS・回廊", type="rss",
         url=_gnews("BVLOS waiver OR drone corridor OR Part 108 OR remote ID", "en"),
         category="regulation", lang="en"),

    # --- 事故・安全 ---
    dict(id="gn_incident_ja", name="事故・トラブル（国内）", type="rss",
         url=_gnews("ドローン 墜落 OR 事故 OR 落下 OR 違反 書類送検", "ja"),
         category="security", lang="ja"),
    dict(id="gn_airport_en", name="空港・妨害", type="rss",
         url=_gnews("drone airport disruption OR drone sighting airspace closed", "en"),
         category="security", lang="en"),

    # --- 産業・現場 ---
    dict(id="gn_agri_ja", name="農業ドローン", type="rss",
         url=_gnews("農業用ドローン OR 農薬散布 ドローン OR スマート農業 ドローン", "ja"),
         category="industry", lang="ja"),
    dict(id="gn_local_ja", name="自治体・実証実験", type="rss",
         url=_gnews("ドローン 実証実験 自治体 OR 過疎地 配送 OR 離島 物流", "ja"),
         category="industry", lang="ja"),
    dict(id="gn_marine_ja", name="海洋・水中", type="rss",
         url=_gnews("水中ドローン OR 港湾 ドローン OR 海洋 無人機 調査", "ja"),
         category="survey", lang="ja"),

    # --- 業界団体 ---
    dict(id="gn_juida_ja", name="JUIDA・業界団体", type="rss",
         url=_gnews("JUIDA OR 日本UAS産業振興協議会 OR ドローン 協議会 OR 官民協議会", "ja"),
         category="community", lang="ja"),

    # --- 海外メディア（フィードが無いので site: 検索） ---
    dict(id="gn_cuav", name="Commercial UAV News", type="rss",
         url=_gnews("site:commercialuavnews.com", "en"),
         category="world_news", lang="en"),
    dict(id="gn_ust", name="Unmanned Systems Technology", type="rss",
         url=_gnews("site:unmannedsystemstechnology.com", "en"),
         category="product", lang="en"),

    # --- メーカー・事業者 ---
    dict(id="gn_skydio", name="Skydio", type="rss",
         url=_gnews("Skydio drone", "en"), category="product", lang="en"),
    dict(id="gn_delivery_en", name="Zipline・Wing（配送）", type="rss",
         url=_gnews('Zipline drone OR "Wing" drone delivery OR Wingcopter', "en"),
         category="industry", lang="en"),
    dict(id="gn_defensetech", name="Anduril・Shield AI", type="rss",
         url=_gnews('Anduril OR "Shield AI" OR Skydio defense drone', "en"),
         category="defense", lang="en"),

    # --- 直接フィード（取得を確認済み） ---
    dict(id="coptrz", name="Coptrz（英・法人向け）", type="rss",
         url="https://www.coptrz.com/feed/", category="industry", lang="en"),
    dict(id="aeronews", name="Aero-News Journal", type="rss", strict=True,
         url="https://aeronewsjournal.com/feed/", category="world_news", lang="en"),
    dict(id="robotreport", name="The Robot Report", type="rss", strict=True,
         url="https://www.therobotreport.com/feed/", category="research", lang="en"),
    dict(id="breakingdefense", name="Breaking Defense", type="rss", strict=True,
         url="https://breakingdefense.com/feed/", category="defense", lang="en"),
    dict(id="geospatialworld", name="Geospatial World", type="rss", strict=True,
         url="https://geospatialworld.net/feed/", category="survey", lang="en"),
]

# Live social stream for the ticker panel. Polled far more often than the news
# sources, so everything here has to be cheap and keyless.
#
# X/Twitter is deliberately absent: it has no free read API any more, and every
# public Nitter mirror we probed returns 403. If a working mirror ever turns up,
# add it as a normal `rss` source and it will appear in the ticker.
DEFAULT_SOCIAL = [
    dict(id="yrt_drone", name="X「ドローン」", type="yahoo_realtime",
         url="", query="ドローン", lang="ja"),
    dict(id="yrt_uav", name="X「無人航空機」", type="yahoo_realtime",
         url="", query="無人航空機", lang="ja"),
    dict(id="yrt_aam", name="X「空飛ぶクルマ」", type="yahoo_realtime",
         url="", query="空飛ぶクルマ", lang="ja"),
    dict(id="yrt_en", name="X「drone」", type="yahoo_realtime",
         url="", query="drone", lang="en"),
    dict(id="yrt_aerial", name="X「ドローン空撮」", type="yahoo_realtime",
         url="", query="ドローン空撮", lang="ja"),
    dict(id="yrt_show", name="X「ドローンショー」", type="yahoo_realtime",
         url="", query="ドローンショー", lang="ja"),
    dict(id="yrt_fpv", name="X「FPV」", type="yahoo_realtime",
         url="", query="FPVドローン", lang="ja"),
    dict(id="mstdn_social_drone", name="Mastodon #drone", type="mastodon",
         url="https://mastodon.social", query="drone", lang="en"),
    dict(id="mstdn_jp_drone", name="mstdn.jp #ドローン", type="mastodon",
         url="https://mstdn.jp", query="ドローン", lang="ja"),
    dict(id="fedibird_drone", name="Fedibird #ドローン", type="mastodon",
         url="https://fedibird.com", query="ドローン", lang="ja"),
    dict(id="mstdn_social_uav", name="Mastodon #uav", type="mastodon",
         url="https://mastodon.social", query="uav", lang="en"),
    dict(id="reddit_live", name="r/drones", type="reddit",
         url="https://www.reddit.com/r/drones/new/.rss", lang="en"),
    dict(id="reddit_mc", name="r/Multicopter", type="reddit",
         url="https://www.reddit.com/r/Multicopter/new/.rss", lang="en"),
    dict(id="hn_live", name="Hacker News", type="hn_live",
         url="drone", lang="en"),
]

# Drone / eVTOL pure-plays and the closest listed proxies. `g` is the Google
# Finance fallback symbol used when Yahoo rate-limits us.
DEFAULT_STOCKS = [
    dict(symbol="AVAV", g="AVAV:NASDAQ", name="AeroVironment", region="US"),
    dict(symbol="KTOS", g="KTOS:NASDAQ", name="Kratos", region="US"),
    dict(symbol="RCAT", g="RCAT:NASDAQ", name="Red Cat", region="US"),
    dict(symbol="ONDS", g="ONDS:NASDAQ", name="Ondas", region="US"),
    dict(symbol="UMAC", g="UMAC:NYSEAMERICAN", name="Unusual Machines", region="US"),
    dict(symbol="DPRO", g="DPRO:NASDAQ", name="Draganfly", region="US"),
    dict(symbol="UAVS", g="UAVS:NYSEAMERICAN", name="AgEagle", region="US"),
    dict(symbol="EH", g="EH:NASDAQ", name="EHang", region="US"),
    dict(symbol="JOBY", g="JOBY:NYSE", name="Joby Aviation", region="US"),
    dict(symbol="ACHR", g="ACHR:NYSE", name="Archer Aviation", region="US"),
    dict(symbol="6232.T", g="6232:TYO", name="ACSL", region="JP"),
    dict(symbol="278A.T", g="278A:TYO", name="テラドローン", region="JP"),
]


def default_sources():
    out = []
    for s in DEFAULT_SOURCES:
        item = dict(s)
        item.setdefault("enabled", True)
        item["builtin"] = True
        item.setdefault("last_ok", 0)
        item.setdefault("last_count", 0)
        item.setdefault("error", "")
        out.append(item)
    return out


def default_social():
    out = []
    for s in DEFAULT_SOCIAL:
        item = dict(s)
        item.setdefault("enabled", True)
        item["builtin"] = True
        out.append(item)
    return out


def default_config():
    return {
        "interval_minutes": 15,   # news + video refresh
        "social_seconds": 60,     # ticker refresh
        "stocks_minutes": 5,      # quote refresh
        "keywords": [],           # extra Google News queries added by the user
        "exclude": [],            # substrings that drop an item entirely
        "retention_days": 45,
        "image_budget": 70,       # per-run cap on og:image lookups
        "translate_budget": 400,  # per-run cap on translation requests
        "stocks": DEFAULT_STOCKS,
    }


def gnews_url(query, lang):
    return _gnews(query, lang)

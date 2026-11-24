/*
 * 配置说明 (2026-11-24 境内出差增强版):
 * 1. 使用 rule 模式、fake-ip、geodata-mode、sniffer 域名嗅探和 lazy 测速；
 *    自动测速容差默认放宽至 120ms，减少高铁/酒店弱网环境下的频繁切节点断流。
 * 2. 使用 GEOSITE 与 GEOIP 数据分类；自定义 direct.list / proxy.list 规则集
 *    指向本仓库 (laiquziru/share)，默认直连 GitHub Raw 并走 PROXY（支持可选镜像前缀），
 *    置于广告规则之前 (direct 优先于 proxy)。
 * 3. GFW、Instagram、Google、GitHub、X、YouTube、Netflix、Spotify、TikTok
 *    以及非中国学术站点走 PROXY；国外 AI 服务走 AI 连通性故障转移组 (US/SG/JP/TW，排除 HK)。
 *    默认屏蔽 YouTube 的 QUIC (UDP 443) 强制回落 TCP，可通过顶部开关控制。
 * 4. 适配境内出差默认策略：「📱 Telegram」与「🐟 漏网之鱼」首次默认走 PROXY，
 *    之后由 store-selected 记忆选择；顶部 POLICY_DEFAULTS 可一键切回 DIRECT。
 * 5. 广告与国内 HTTPDNS 规则前置 REJECT；局域网、私有地址与 Captive Portal 探测域名
 *    (如 captive.apple.com) 直连并跳过 Fake-IP，确保酒店/机场 Wi-Fi 认证页正常弹出。
 * 6. 国内流量通过 push.apple.com、GEOSITE apple-cn/cn 与 GEOIP cn 保底直连。
 * 7. 国内 DoH 采用 IP 形式 (223.5.5.5 / 1.12.12.12) 并以 system DNS 兜底，避免酒店/企业
 *    Wi-Fi 拦截外部 53 端口导致解析失败；代理类域名使用 #PROXY 远端 DoH。
 * 8. 自动测速组过滤信息提示类节点与 ≥2 倍率节点 (0.5x、1.5x 保留；收紧正则避免误伤
 *    HK-x2 类编号)；支持 US/JP/SG/TW/HK 五区识别并修复括号右边界。
 * 9. Tailscale (见下方 TAILSCALE 开关)：新增 Tailscale-Local 节点与 TAILNET 组，
 *    ts.net 与 100.64.0.0/10 规则置于最前；+.ts.net 的 DNS 策略也置于最前。
 *    已移除公开仓库中硬编码的个人 Tailnet hosts，请按需在本地私有配置中填写 TAILSCALE.hosts。
 * 10. 日志固定 warning；Tailscale 需要重新登录时，临时改成 info 才能在日志里看到登录链接。
 */

// Tailscale 开关：目前只有手机加载本脚本。其他已装原生 Tailscale 的设备
// 若要复用本脚本，请把 enabled 改为 false，避免重复注册设备、抢占 100.64.0.0/10。
// 首次使用在日志中打开登录链接即可，不要把 auth-key 或个人 Tailnet 域名/IP 写进公开仓库。
const TAILSCALE = {
  enabled: true,
  hostname: "roam",
  // 若需固定个别 Tailnet 主机解析，请仅在本地私有副本中填写，例如：
  // hosts: { "node.tailxxxx.ts.net": "100.x.y.z" }
  hosts: {}
};

// 策略默认值与测速参数（适配中国境内出差场景；出境漫游时可按需改回 "DIRECT"）：
// - telegramDefault: 「📱 Telegram」首次默认出口 ("PROXY" 或 "DIRECT")
// - telegramDnsViaProxy: true 时 geosite:telegram 走 #PROXY 远端 DoH 防污染
// - finalDefault: 「🐟 漏网之鱼」首次默认出口 ("PROXY" 或 "DIRECT")
// - autoTolerance: url-test 切换容差 (ms)，120ms 可减少高铁/弱网下的抖动断流
const POLICY_DEFAULTS = {
  telegramDefault: "PROXY",
  telegramDnsViaProxy: true,
  finalDefault: "PROXY",
  autoTolerance: 120
};

// 域名嗅探与 QUIC 控制：
// - snifferEnabled: 为 HTTP/TLS (80/443) 开启域名嗅探，防止直连 IP 的客户端绕过域名分流
// - blockYoutubeQuic: 拦截 YouTube 的 UDP 443 (QUIC)，强制回落 TCP 减少移动端转圈
const TRAFFIC_OPTIONS = {
  snifferEnabled: true,
  blockYoutubeQuic: true
};

// 自定义规则集来源：
// - mirrorPrefix 为空时，直接从 GitHub Raw 拉取并自动经由 PROXY 组下载，避免第三方反代单点风险；
// - 若需使用自建或可信镜像（如 "https://your-mirror.example/"），填入后将直连镜像下载。
const RULE_SOURCE = {
  rawBaseUrl: "https://raw.githubusercontent.com/laiquziru/share/main",
  mirrorPrefix: ""
};

function buildCustomRuleProviders() {
  const buildProvider = (filename, path) => {
    const rawUrl = RULE_SOURCE.rawBaseUrl + "/" + filename;
    const useMirror = Boolean(RULE_SOURCE.mirrorPrefix);
    const provider = {
      type: "http",
      behavior: "classical",
      format: "text",
      url: useMirror ? RULE_SOURCE.mirrorPrefix + rawUrl : rawUrl,
      path: path,
      interval: 86400
    };
    if (!useMirror) {
      provider.proxy = "PROXY";
    }
    return provider;
  };

  return {
    direct: buildProvider("direct.list", "./ruleset/direct.list"),
    proxy: buildProvider("proxy.list", "./ruleset/proxy.list")
  };
}

function main(config) {
  try {
    // -----------------------------------------------------------------
    // 0. 前置校验与配置覆写
    // -----------------------------------------------------------------
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Runestone: expected a configuration object");
    }

    const currentProxies = Array.isArray(config.proxies) ? config.proxies : [];
    const currentProxyNames = currentProxies
      .map(p => (p && typeof p.name === "string" ? p.name : null))
      .filter(Boolean);

    if (!currentProxies.length) {
      throw new Error("Runestone: no materialized nodes; select node sources and use the post-merge script stage");
    }
    if (currentProxies.some(p => !p || typeof p !== "object" || typeof p.name !== "string" || !p.name.trim())) {
      throw new Error("Runestone: every node must be an object with a non-empty name");
    }
    if (new Set(currentProxyNames).size !== currentProxyNames.length) {
      throw new Error("Runestone: duplicate node names; rename conflicting nodes in the source");
    }

    const fixed = Object.assign({}, config);
    fixed.mode = "rule";
    fixed["geodata-mode"] = true;

    fixed.profile = Object.assign({}, config.profile, {
      "store-selected": true,
      "store-fake-ip": true
    });

    if (fixed["unified-delay"] === undefined) {
      fixed["unified-delay"] = true;
    }
    // info 会记录每条连接，iOS 上更费电；排查问题时再临时改为 info。
    fixed["log-level"] = "warning";

    fixed.proxies = currentProxies;
    fixed["proxy-groups"] = [];
    // 路由与 DNS 策略由本脚本重建；仅保留指向自有 share 仓库的自定义规则集。
    fixed["rule-providers"] = buildCustomRuleProviders();
    delete fixed["sub-rules"];

    const aiGeosite = "category-ai-!cn";
    const telegramGroupName = "📱 Telegram";
    const proxyGeosites = [
      "instagram", "google", "github", "twitter", "youtube",
      "netflix", "spotify", "tiktok", "category-scholar-!cn", "gfw"
    ];

    // 使用 IP 形式的国内 DoH，避免酒店/企业 Wi-Fi 封禁外部 53 端口时无法解析 DoH 域名本身。
    const domesticDns = [
      "https://223.5.5.5/dns-query",
      "https://1.12.12.12/dns-query"
    ];
    const remoteDns = [
      "https://1.1.1.1/dns-query#PROXY",
      "https://dns.google/dns-query#PROXY"
    ];
    // Cloudflare 1.1.1.1 不透传 EDNS Client Subnet，避免 PROXY 选到 HK 时影响 AI 服务解析。
    const aiRemoteDns = [
      "https://1.1.1.1/dns-query#PROXY"
    ];

    const nameserverPolicy = {
      "geosite:private": ["system"],
      // 酒店/机场 Wi-Fi 认证页探测域名走系统 DNS，以便本地网关劫持弹出登录页。
      "captive.apple.com": ["system"],
      "+.captive.apple.com": ["system"],
      "rule-set:direct": domesticDns.slice(),
      "rule-set:proxy": remoteDns.slice(),
      ["geosite:" + aiGeosite]: aiRemoteDns.slice(),
      "geosite:telegram": POLICY_DEFAULTS.telegramDnsViaProxy ? remoteDns.slice() : domesticDns.slice()
    };
    // 与业务规则共用分类，避免新增代理服务却遗漏 DNS 分流。
    proxyGeosites.forEach(site => {
      nameserverPolicy["geosite:" + site] = remoteDns.slice();
    });
    nameserverPolicy["+.push.apple.com"] = domesticDns.slice();
    nameserverPolicy["geosite:apple-cn"] = domesticDns.slice();
    nameserverPolicy["geosite:cn"] = domesticDns.slice();

    // -----------------------------------------------------------------
    // 1. DNS 分流与域名嗅探配置 (不代替系统 DNS 接管)
    // -----------------------------------------------------------------
    fixed.dns = Object.assign({}, config.dns, {
      enable: true,
      ipv6: false,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "use-hosts": true,
      "use-system-hosts": true,
      "prefer-h3": false,
      "fake-ip-filter-mode": "blacklist",
      "fake-ip-filter": [
        "geosite:private",
        "*.lan", "*.local", "*.localdomain", "*.localhost", "*.home.arpa",
        "time.*.com", "ntp.*.com",
        // Captive Portal 探测域名：放行 iOS/Android/Windows 酒店与机场 Wi-Fi 认证页
        "captive.apple.com", "+.captive.apple.com",
        "connectivitycheck.gstatic.com", "connectivitycheck.platform.hicloud.com",
        "connect.rom.miui.com",
        "+.msftconnecttest.com", "+.msftncsi.com",
        "localhost.ptlogin2.qq.com", "+.stun.*.*", "+.stun.*.*.*",
        "+.srv.nintendo.net", "+.stun.playstation.net"
      ],
      // system 置前兼容拦截外部 53 端口的企业/酒店 Wi-Fi，公网 DNS 作为兜底。
      "default-nameserver": ["system", "223.5.5.5", "119.29.29.29"],
      nameserver: domesticDns.slice(),
      "proxy-server-nameserver": domesticDns.slice(),
      "direct-nameserver": domesticDns.slice(),
      "direct-nameserver-follow-policy": true,
      "respect-rules": true,
      "nameserver-policy": nameserverPolicy
    });
    delete fixed.dns.fallback;
    delete fixed.dns["fallback-filter"];
    // 节点域名固定使用独立的国内 DNS，不继承可能引用旧规则集或代理的策略。
    delete fixed.dns["proxy-server-nameserver-policy"];

    // Mihomo 域名嗅探：跳过局域网、私有地址、Apple 推送、Captive Portal 与 Tailscale 域名。
    if (TRAFFIC_OPTIONS.snifferEnabled) {
      fixed.sniffer = {
        enable: true,
        "force-dns-mapping": true,
        "parse-pure-ip": true,
        "override-destination": false,
        sniff: {
          HTTP: {
            ports: [80, "8080-8880"],
            "override-destination": true
          },
          TLS: {
            ports: [443, 8443]
          }
        },
        "skip-domain": [
          "Mijia Cloud",
          "+.push.apple.com",
          "captive.apple.com",
          "+.captive.apple.com",
          "+.ts.net",
          "+.lan",
          "+.local",
          "+.localdomain",
          "+.localhost",
          "+.home.arpa"
        ],
        "skip-dst-address": [
          "10.0.0.0/8",
          "100.64.0.0/10",
          "127.0.0.0/8",
          "169.254.0.0/16",
          "172.16.0.0/12",
          "192.168.0.0/16"
        ]
      };
    }

    // -----------------------------------------------------------------
    // 2. 地区识别与无效/高倍率节点过滤
    // -----------------------------------------------------------------
    // 过滤账单提示节点及大于等于 2 倍率的节点，避免混入 Auto 自动测速池。
    // 收紧倍率正则：仅匹配明确倍率写法（2x / 2.5× / ×2 / 3倍 / 倍率2），
    // 避免把 HK-x2、JP-x3 这类字母编号误判为高倍率；0.5x / 1.5x 等低倍率节点保留。
    const infoNodeFilter = /剩余|流量|到期|官网|群组|重置|套餐|过期|失联|测试/;
    const multiplierPatterns = [
      /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:x(?![a-z])|×|倍)/gi,
      /×\s*(\d+(?:\.\d+)?)/g,
      /倍率\s*[:：]?\s*(\d+(?:\.\d+)?)/g
    ];
    const isHighMultiplier = name => multiplierPatterns.some(pattern =>
      [...name.matchAll(pattern)].some(m => parseFloat(m[1]) >= 2)
    );
    const validProxyNames = currentProxyNames.filter(name =>
      !infoNodeFilter.test(name) && !isHighMultiplier(name)
    );
    // 若极端情况下全部被过滤，则回退使用全部节点
    const basePoolForAuto = validProxyNames.length > 0 ? validProxyNames : currentProxyNames;

    // 地区正则：右边界兼容 ) 和 ]，确保 [US]、(HK)、[TW] 等括号命名正常匹配。
    const regionGroups = [
      { key: "US", name: "🇺🇸 US", filter: /(?:^|[\s_\-(\[])(US|USA|SJC|LAX|SEA)(?:$|[\s_\-)\]])|United[ _-]?States|America|美国|美國|洛杉矶|硅谷|西雅图|圣何塞|芝加哥|达拉斯|🇺🇸/i },
      { key: "JP", name: "🇯🇵 JP", filter: /(?:^|[\s_\-(\[])(JP|JPN|NRT|KIX)(?:$|[\s_\-)\]])|Japan|Tokyo|Osaka|日本|东京|大阪|名古屋|埼玉|🇯🇵/i },
      { key: "SG", name: "🇸🇬 SG", filter: /(?:^|[\s_\-(\[])(SG|SGP|SIN)(?:$|[\s_\-)\]])|Singapore|新加坡|狮城|🇸🇬/i },
      { key: "TW", name: "🇹🇼 TW", filter: /(?:^|[\s_\-(\[])(TW|TWN|TPE)(?:$|[\s_\-)\]])|Taiwan|Taipei|台湾|臺灣|台北|高雄|台中|新北|彰化|🇹🇼/i },
      { key: "HK", name: "🇭🇰 HK", filter: /(?:^|[\s_\-(\[])(HK|HKG)(?:$|[\s_\-)\]])|Hong[ _-]?Kong|香港|港岛|九龙|新界|深港|沪港|广港|🇭🇰/i }
    ];

    const regionalNodes = {};
    const regionalAutos = [];

    regionGroups.forEach(region => {
      // 地区 Auto 组仅从有效测速池中筛选
      const matched = basePoolForAuto.filter(name => region.filter.test(name));
      if (matched.length === 0) return;
      regionalNodes[region.key] = matched;
      regionalAutos.push({ key: region.key, name: region.name + "-Auto", nodes: matched });
    });

    const autoNames = regionalAutos.map(a => a.name);
    const autoByKey = {};
    regionalAutos.forEach(a => { autoByKey[a.key] = a.name; });

    const allRegionalNodes = [];
    regionalAutos.forEach(a => a.nodes.forEach(n => { if (!allRegionalNodes.includes(n)) allRegionalNodes.push(n); }));
    const unmatchedNodes = basePoolForAuto.filter(n => !allRegionalNodes.includes(n));
    const autoPool = allRegionalNodes.length
      ? [...allRegionalNodes, ...unmatchedNodes]
      : basePoolForAuto.slice();

    // -----------------------------------------------------------------
    // 3. 策略组 (包含 AI Fallback、漏网之鱼 与省电优化)
    // -----------------------------------------------------------------
    const groupIcon = {
      PROXY: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Proxy.png",
      AUTO: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png",
      FINAL: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png",
      US: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png",
      JP: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png",
      SG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png",
      TW: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Taiwan.png",
      HK: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png",
      AI: "https://raw.githubusercontent.com/laiquziru/share/refs/heads/main/chatgpt.png",
      TG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png"
    };

    const healthCheck = {
      url: "https://www.gstatic.com/generate_204",
      interval: 600,
      lazy: true
    };
    const aiHealthCheck = {
      // AI fallback checks an actual AI service landing page, not only generic reachability.
      url: "https://chatgpt.com/robots.txt",
      interval: 600,
      lazy: true
    };

    // 主代理选择组：保持 PROXY 里内部顺序为 AUTO -> 🇭🇰 HK -> HK-Auto -> 其余 Auto -> 全部原始节点
    const proxyTargets = ["AUTO"];
    if (regionalNodes.HK) {
      proxyTargets.push("🇭🇰 HK");
      if (autoByKey.HK) proxyTargets.push(autoByKey.HK);
    }
    autoNames.forEach(name => {
      if (name !== autoByKey.HK && !proxyTargets.includes(name)) {
        proxyTargets.push(name);
      }
    });
    currentProxyNames.forEach(name => {
      if (!proxyTargets.includes(name)) {
        proxyTargets.push(name);
      }
    });

    fixed["proxy-groups"].push({
      name: "PROXY",
      type: "select",
      icon: groupIcon.PROXY,
      proxies: proxyTargets
    });

    // 全局自动测速组
    fixed["proxy-groups"].push(Object.assign({
      name: "AUTO",
      type: "url-test",
      icon: groupIcon.AUTO,
      tolerance: POLICY_DEFAULTS.autoTolerance,
      proxies: autoPool.slice()
    }, healthCheck));

    // 外层顺序：AUTO -> 🇭🇰 HK -> HK-Auto -> 其它 Auto (仅在存在香港节点时生成)
    if (regionalNodes.HK) {
      fixed["proxy-groups"].push({
        name: "🇭🇰 HK",
        type: "select",
        icon: groupIcon.HK,
        proxies: ["DIRECT", ...(autoByKey.HK ? [autoByKey.HK] : []), ...regionalNodes.HK.slice()].filter(Boolean)
      });

      if (autoByKey.HK) {
        fixed["proxy-groups"].push(Object.assign({
          name: autoByKey.HK,
          type: "url-test",
          icon: groupIcon.HK,
          tolerance: POLICY_DEFAULTS.autoTolerance,
          proxies: regionalNodes.HK.slice()
        }, healthCheck));
      }
    }

    // 只保留 HK 相关手动/自动组；US/JP/SG/TW 不再额外创建手动组
    ["US", "JP", "SG", "TW"].forEach(key => {
      const matched = regionalNodes[key];
      if (!matched) return;
      fixed["proxy-groups"].push(Object.assign({
        name: autoByKey[key],
        type: "url-test",
        icon: groupIcon[key],
        tolerance: POLICY_DEFAULTS.autoTolerance,
        proxies: matched.slice()
      }, healthCheck));
    });

    // 仅检测 HTTPS 连通性，顺序为 US -> SG -> JP -> TW (排除 HK 避免触发 AI 地区封锁)。
    // 仅在订阅中完全没有 US/SG/JP/TW 节点时，才回退到 AUTO。
    const aiFallbackProxies = [];
    ["US", "SG", "JP", "TW"].forEach(key => {
      if (regionalNodes[key]) {
        aiFallbackProxies.push(autoByKey[key]);
      }
    });
    if (aiFallbackProxies.length === 0) {
      aiFallbackProxies.push("AUTO");
    }

    fixed["proxy-groups"].push(Object.assign({
      name: "🤖 AI",
      type: "fallback",
      icon: groupIcon.AI,
      proxies: aiFallbackProxies
    }, aiHealthCheck));

    // Telegram 独立开关；PROXY 跟随主代理组，选择会被 profile 记忆。
    const telegramTargets = POLICY_DEFAULTS.telegramDefault === "PROXY"
      ? ["PROXY", "DIRECT"]
      : ["DIRECT", "PROXY"];
    fixed["proxy-groups"].push({
      name: telegramGroupName,
      type: "select",
      icon: groupIcon.TG,
      proxies: telegramTargets
    });

    // 漏网之鱼：首次默认由 POLICY_DEFAULTS.finalDefault 决定；store-selected 会保留后续选择。
    const finalTargets = POLICY_DEFAULTS.finalDefault === "PROXY"
      ? ["PROXY", "DIRECT", "AUTO", ...autoNames]
      : ["DIRECT", "PROXY", "AUTO", ...autoNames];
    fixed["proxy-groups"].push({
      name: "🐟 漏网之鱼",
      type: "select",
      icon: groupIcon.FINAL,
      proxies: finalTargets
    });

    // -----------------------------------------------------------------
    // 4. 冲突校验
    // -----------------------------------------------------------------
    const reserved = new Set([
      "DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE", "GLOBAL",
      ...fixed["proxy-groups"].map(g => g.name)
    ]);
    if (currentProxyNames.some(name => reserved.has(name))) {
      throw new Error("Runestone: node name conflicts");
    }
    if (fixed["proxy-groups"].some(g => Object.prototype.hasOwnProperty.call(config["proxy-providers"] || {}, g.name))) {
      throw new Error("Runestone: provider name conflicts");
    }

    const availableTargets = new Set([...reserved, ...currentProxyNames]);
    const validateTarget = (target, owner) => {
      if (target === undefined || target === "") return;
      if (typeof target !== "string" || !availableTargets.has(target)) {
        throw new Error("Runestone: " + owner + " references an unavailable proxy: " + String(target));
      }
    };
    currentProxies.forEach(proxy => {
      validateTarget(proxy["dialer-proxy"], "node " + proxy.name + " dialer-proxy");
    });
    Object.keys(fixed["proxy-providers"] || {}).forEach(name => {
      const provider = fixed["proxy-providers"][name];
      if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
        throw new Error("Runestone: invalid proxy provider: " + name);
      }
      validateTarget(provider.proxy, "provider " + name + " download proxy");
      if (provider.override) {
        validateTarget(provider.override["dialer-proxy"], "provider " + name + " dialer-proxy override");
      }
    });

    // -----------------------------------------------------------------
    // 5. 分流规则 (内置 GEOSITE/GEOIP + share 仓库自定义规则集)
    // -----------------------------------------------------------------
    fixed.rules = [
      // 1. 局域网、私有域名/IP 与 Captive Portal 探测域名直连
      "GEOSITE,private,DIRECT",
      "GEOIP,private,DIRECT,no-resolve",
      "DOMAIN,captive.apple.com,DIRECT",

      // 1.5 自定义规则集 (direct 优先于 proxy，置于广告拦截之前以便处理误杀)
      "RULE-SET,direct,DIRECT",
      "RULE-SET,proxy,PROXY",

      // 2. 广告域名与国内应用内置 HTTPDNS 拦截前置
      "GEOSITE,category-ads-all,REJECT",
      "GEOSITE,category-httpdns-cn,REJECT",

      // 2.5 按需屏蔽 YouTube QUIC (UDP 443)，强制回落 TCP 提升移动端视频稳定性
      ...(TRAFFIC_OPTIONS.blockYoutubeQuic
        ? ["AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,youtube)),REJECT"]
        : []),

      // 3. 国外 AI -> 连通性 Fallback 组
      "GEOSITE," + aiGeosite + ",🤖 AI",

      // 4. Telegram 域名与数据中心 IP -> 独立手动选择组
      "GEOSITE,telegram," + telegramGroupName,
      "GEOIP,telegram," + telegramGroupName + ",no-resolve",

      // 5. 常用境外服务域名 -> 代理
      ...proxyGeosites.map(site => "GEOSITE," + site + ",PROXY"),

      // 6. 常用境外服务纯 IP 流量补充 -> 代理 (带 no-resolve 避免阻塞 DNS)
      "GEOIP,google,PROXY,no-resolve",
      "GEOIP,netflix,PROXY,no-resolve",
      "GEOIP,twitter,PROXY,no-resolve",

      // 7. Apple 国内服务、推送及国内域名/IP 保底直连
      //    (移除 GEOIP,cn 的 no-resolve，确保未收录的国内冷门域名能通过解析 IP 精准直连)
      "DOMAIN-SUFFIX,push.apple.com,DIRECT",
      "GEOSITE,apple-cn,DIRECT",
      "GEOSITE,cn,DIRECT",
      "GEOIP,cn,DIRECT",

      // 8. 最终未匹配流量 -> 交由「🐟 漏网之鱼」策略组决定
      "MATCH,🐟 漏网之鱼"
    ];

    // Tailscale：开关与设备名见文件顶部 TAILSCALE；首次访问时在日志中完成网页登录。
    const tailnetNode = "Tailscale-Local";
    const tailnetGroup = "TAILNET";
    const proxyProviders = fixed["proxy-providers"] || {};
    if (!TAILSCALE.enabled) {
      // 已关闭：不添加任何 Tailscale 节点、规则或 DNS 策略。
    } else if ([tailnetNode, tailnetGroup].some(name =>
      availableTargets.has(name) || Object.prototype.hasOwnProperty.call(proxyProviders, name)
    )) {
      console.error("Runestone: Tailscale 未启用，节点或策略组名称冲突");
    } else {
      // 原策略组已构建，不把 Tailscale 纳入 PROXY 或 AUTO 测速池。
      fixed.proxies = fixed.proxies.concat({
        name: tailnetNode,
        type: "tailscale",
        hostname: TAILSCALE.hostname,
        udp: true
      });
      fixed["proxy-groups"].push({
        name: tailnetGroup,
        type: "select",
        proxies: [tailnetNode]
      });
      // 仅在本地配置了 TAILSCALE.hosts 时合并，保留订阅已有 hosts。
      if (TAILSCALE.hosts && Object.keys(TAILSCALE.hosts).length > 0) {
        fixed.hosts = Object.assign({}, fixed.hosts, TAILSCALE.hosts);
      }
      // 其他 ts.net 域名仍使用 MagicDNS。
      // geosite:private 包含 +.ts.net：fake-ip-filter 已经通过它排除了 ts.net，
      // 但它的 system DNS 策略排在最前，所以 MagicDNS 策略必须置顶。
      fixed.dns["nameserver-policy"] = Object.assign(
        { "+.ts.net": ["tailscale://" + tailnetNode] },
        fixed.dns["nameserver-policy"]
      );
      fixed.rules.unshift(
        "DOMAIN-SUFFIX,ts.net," + tailnetGroup,
        "IP-CIDR,100.64.0.0/10," + tailnetGroup + ",no-resolve"
      );
    }

    // 去重仅保留每条规则首次出现的位置
    fixed.rules = [...new Set(fixed.rules)];

    return fixed;

  } catch (err) {
    console.error("Runestone 脚本执行失败，已回退至原始配置：" + err.message);
    return config;
  }
}
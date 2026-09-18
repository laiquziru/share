/* Runestone V3 — routing-only Hako post-merge override.
 * Import the raw JavaScript URL, save, and select it after node-source merging.
 * Network settings and node objects are retained. Rules and groups are replaced.
 * URL import is a snapshot: re-import to upgrade. See docs/RUNESTONE_V3.md.
 */
const RUNESTONE = {repository: "Sydney-Moses/Network-Profiles", personal: false};

function main(config) {
  // Hako 当前选中的所有机场节点都会合并到 config.proxies。
  const currentProxies = Array.isArray(config && config.proxies)
    ? config.proxies
    : [];

  const currentProxyNames = currentProxies
    .map(p =>
      typeof p === "string"
        ? p
        : (p && typeof p.name === "string" ? p.name : null)
    )
    .filter(Boolean);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Runestone: expected a configuration object");
  }
  if (!currentProxies.length) {
    throw new Error("Runestone: no materialized nodes; select node sources and use the post-merge script stage");
  }
  if (currentProxies.some(p => !p || typeof p !== "object" || typeof p.name !== "string" || !p.name.trim())) {
    throw new Error("Runestone: every node must be an object with a non-empty name");
  }
  if (new Set(currentProxyNames).size !== currentProxyNames.length) {
    throw new Error("Runestone: duplicate node names; rename conflicting nodes in the source");
  }
  // Preserve client-owned networking and provider fields. Replace routing below.
  const fixed = Object.assign({}, config);
  fixed.mode = "rule";
  fixed.profile = Object.assign({}, config.profile, {"store-selected": true});

  fixed.proxies = currentProxies;
  fixed["proxy-groups"] = [
    {
      name: "PROXY",
      type: "select",
      "include-all": true,
      proxies: ["AUTO", "US", "JP", "SG"],
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png"
    },
    {
      name: "AUTO",
      type: "url-test",
      "include-all": true,
      "exclude-filter": "(?i)官网|流量|剩余|到期|套餐|订阅|expire|traffic",
      url: "http://www.gstatic.com/generate_204",
      interval: 900,
      tolerance: 50,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png"
    },
    {
      name: "US",
      type: "url-test",
      "include-all": true,
      filter: "(?i)([\\[]US[\\]]|^US$|USA|United[ _-]?States|\\bUS\\b|美国|美國|🇺🇸)",
      url: "http://www.gstatic.com/generate_204",
      interval: 900,
      tolerance: 50,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png"
    },
    {
      name: "JP",
      type: "url-test",
      "include-all": true,
      filter: "(?i)([\\[]JP[\\]]|^JP$|Japan|\\bJP\\b|日本|东京|大阪|🇯🇵)",
      url: "http://www.gstatic.com/generate_204",
      interval: 900,
      tolerance: 50,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png"
    },
    {
      name: "SG",
      type: "url-test",
      "include-all": true,
      filter: "(?i)([\\[]SG[\\]]|^SG$|Singapore|\\bSG\\b|新加坡|狮城|🇸🇬)",
      url: "http://www.gstatic.com/generate_204",
      interval: 900,
      tolerance: 50,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
    }
  ];

  fixed.dns = Object.assign({}, config.dns, {
    enable: true,
    ipv6: false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": [
      "geosite:private",
      "geosite:cn",
      "geosite:apple-cn",
      "+.lan",
      "+.local",
      "+.localhost",
      "dns.msftncsi.com",
      "www.msftconnecttest.com"
    ],
    listen: "127.0.0.1:1053",
    nameserver: [
      "https://doh.pub/dns-query",
      "https://dns.alidns.com/dns-query"
    ],
    fallback: [
      "https://cloudflare-dns.com/dns-query",
      "https://dns.google/dns-query"
    ],
    "fallback-filter": {
      geoip: true,
      "geoip-code": "CN",
      geosite: ["gfw", "geolocation-!cn"]
    },
    "nameserver-policy": {
      "geosite:private,cn,apple-cn": [
        "https://doh.pub/dns-query",
        "https://dns.alidns.com/dns-query"
      ],
      "rule-set:ai_domain,geolocation-!cn,youtube,google": [
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query"
      ]
    },
    "respect-rules": true
  });

  fixed.tun = Object.assign({}, config.tun, {
    enable: true,
    "auto-route": true,
    "strict-route": true,
    "dns-hijack": ["any:53", "tcp://any:53"]
  });
  // ============================================================
  // Rules
  // ============================================================

  fixed.rules = [
    "GEOIP,PRIVATE,DIRECT,no-resolve",
    "GEOSITE,private,DIRECT",
    "GEOSITE,cn,DIRECT",
    "GEOIP,CN,DIRECT,no-resolve",
    "RULE-SET,AdvertisingLite,REJECT",
    "RULE-SET,ai_domain,PROXY",
    "GEOSITE,youtube,PROXY",
    "RULE-SET,x_twitter,PROXY",
    "GEOSITE,google,PROXY",
    "GEOIP,!CN,PROXY,no-resolve",
    "MATCH,DIRECT"
  ];


  // ============================================================
  // Rule Providers
  // ============================================================

  fixed["rule-providers"] = {
    "Apple": {
      "type": "http",
      "behavior": "classical",
      "format": "yaml",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Apple/Apple.yaml"
    },

    "Apple_Domain": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/Sydney-Moses/Network-Profiles/refs/heads/main/MRS/Apple_Domain.mrs"
    },

    "AdvertisingLite": {
      "type": "http",
      "behavior": "classical",
      "format": "yaml",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/AdvertisingLite/AdvertisingLite.yaml"
    },

    "AdvertisingLite_Domain": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/Sydney-Moses/Network-Profiles/refs/heads/main/MRS/AdvertisingLite_Domain.mrs"
    },

    "Privacy": {
      "type": "http",
      "behavior": "classical",
      "format": "yaml",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/Privacy/Privacy.yaml"
    },

    "Privacy_Domain": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/Sydney-Moses/Network-Profiles/refs/heads/main/MRS/Privacy_Domain.mrs"
    },

    "ACL4SSR_BanAD": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/mrs/BanAD_domain.mrs"
    },

    "ACL4SSR_BanProgramAD": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/mrs/BanProgramAD_domain.mrs"
    },

    "ChinaMax": {
      "type": "http",
      "behavior": "classical",
      "format": "yaml",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/ChinaMax/ChinaMax.yaml"
    },

    "ChinaMax_Domain": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/Sydney-Moses/Network-Profiles/refs/heads/main/MRS/ChinaMax_Domain.mrs"
    },

    "ChinaMax_IP": {
      "type": "http",
      "behavior": "ipcidr",
      "format": "mrs",
      "interval": 86400,
      "url": "https://raw.githubusercontent.com/Sydney-Moses/Network-Profiles/refs/heads/main/MRS/ChinaMax_IP.mrs"
    }
  };

  fixed["rule-providers"]["x_twitter"] = {
    type: "inline",
    behavior: "classical",
    payload: [
      "DOMAIN-SUFFIX,x.com",
      "DOMAIN-SUFFIX,twitter.com",
      "DOMAIN-SUFFIX,t.co",
      "DOMAIN-SUFFIX,twimg.com"
    ]
  };
  fixed["rule-providers"]["ai_domain"] = {
    type: "http",
    behavior: "domain",
    format: "mrs",
    interval: 86400,
    url: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-ai-!cn.mrs"
  };

  // All project-owned MRS resources follow one configurable repository.
  Object.values(fixed["rule-providers"]).forEach(provider => {
    if (provider && typeof provider.url === "string") {
      provider.url = provider.url.replace("Sydney-Moses/Network-Profiles", RUNESTONE.repository);
    }
  });
  fixed.rules = [...new Set(fixed.rules)];
  const groups = fixed["proxy-groups"];
  const available = new Set(groups.map(g => g.name));
  const regions = {JP: "🇯🇵 JP", SG: "🇸🇬 SG", HK: "🇭🇰 HK", TW: "🇹🇼 TW", US: "🇺🇸 US", UK: "🇬🇧 UK", MY: "🇲🇾 MY", AU: "🇦🇺 AU", IN: "🇮🇳 IN"};
  const order = {
    "PROXY": ["SG", "JP", "US"], YouTube: ["JP", "SG", "US"],
    Spotify: ["JP", "SG", "US"], GPT: ["US", "JP", "SG"],
    Claude: ["US", "JP", "SG"], Gemini: ["US", "JP", "SG"],
    Google: ["JP", "SG", "US"], Github: ["JP", "SG", "US"],
    X: ["JP", "SG", "US"], Pixiv: ["JP", "SG", "US"],
    Facebook: ["SG", "JP", "US"], Instagram: ["SG", "JP", "US"], Threads: ["SG", "JP", "US"],
    WhatsApp: ["SG", "JP", "US"], Telegram: ["SG", "JP", "US"], LinkedIn: ["SG", "US", "JP"]
  };
  if (RUNESTONE.personal) {
    groups.forEach(group => {
      if (order[group.name]) {
        const preferred = order[group.name].map(k => regions[k]).filter(n => available.has(n));
        group.proxies = [...new Set([...preferred, ...group.proxies])];
      }
      if (group.name === "Apple") group.proxies = ["DIRECT", ...group.proxies.filter(n => n !== "DIRECT")];
      if (group.name === "Apple Push") group.proxies = ["DIRECT", "APNs-Fallback"];
    });
  }
  // Never silently shadow a node with a generated group or built-in outbound.
  const reserved = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE", ...groups.map(g => g.name)]);
  if (currentProxyNames.some(name => reserved.has(name))) throw new Error("Runestone: node name conflicts with a generated group or built-in outbound");
  if (groups.some(g => Object.prototype.hasOwnProperty.call(config["proxy-providers"] || {}, g.name))) {
    throw new Error("Runestone: provider name conflicts with a generated group");
  }
  const knownOutbounds = new Set([...reserved, ...currentProxyNames]);
  if (currentProxies.some(p => p["dialer-proxy"] && !knownOutbounds.has(p["dialer-proxy"]))) {
    throw new Error("Runestone: dialer-proxy references a source group that routing replacement would remove");
  }
  return fixed;
}

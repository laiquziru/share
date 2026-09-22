/*
 * Runestone Configuration Override (Loyalsoldier Rule-Set 版)
 * Repository: Sydney-Moses/Network-Profiles
 * 
 * 优化说明 (2026-09-22):
 * 1. 仅将 GEOIP 规则替换为 Loyalsoldier 纯文本 .txt Rule-Set。
 * 2. GEOSITE 规则保持不变，继续使用客户端内置数据库。
 * 3. 保留 try...catch 防断网、lazy 测速、AI Fallback 高可用、DNS 容灾。
 */

const RUNESTONE = { repository: "Sydney-Moses/Network-Profiles" };

function main(config) {
  try {
    // ------------------------------------------------------------
    // 0. 前置校验与备份
    // ------------------------------------------------------------
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Runestone: expected a configuration object");
    }

    const currentProxies = Array.isArray(config.proxies) ? config.proxies : [];
    const currentProxyNames = currentProxies
      .map(p => (typeof p === "string" ? p : (p && typeof p.name === "string" ? p.name : null)))
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
    
    fixed.profile = Object.assign({}, config.profile, {
      "store-selected": true,
      "store-fake-ip": true
    });

    if (fixed["unified-delay"] === undefined) {
      fixed["unified-delay"] = true;
    }

    fixed.proxies = currentProxies;
    fixed["proxy-groups"] = [];

    // ------------------------------------------------------------
    // 1. DNS 防泄露配置 (保持不变)
    // ------------------------------------------------------------
    fixed.dns = Object.assign({}, config.dns, {
      enable: true,
      ipv6: false,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "use-hosts": true,
      "use-system-hosts": true,
      "prefer-h3": false,
      "fake-ip-filter": [
        "*.lan", "*.local", "*.localdomain", "*.localhost", "*.home.arpa",
        "time.*.com", "ntp.*.com", "+.msftconnecttest.com", "+.msftncsi.com",
        "localhost.ptlogin2.qq.com", "+.stun.*.*", "+.stun.*.*.*",
        "+.srv.nintendo.net", "+.stun.playstation.net"
      ],
      "default-nameserver": ["223.5.5.5", "119.29.29.29", "1.1.1.1"],
      nameserver: [
        "https://dns.alidns.com/dns-query#RULES",
        "https://doh.pub/dns-query#RULES"
      ],
      "proxy-server-nameserver": ["https://1.1.1.1/dns-query", "https://dns.google/dns-query"],
      "direct-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query",
        "223.5.5.5",
        "119.29.29.29"
      ],
      "direct-nameserver-follow-policy": true,
      "respect-rules": true,
      "nameserver-policy": {
        "geosite:cn": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
        "geosite:private": ["223.5.5.5", "119.29.29.29"]
      }
    });

    // ------------------------------------------------------------
    // 2. 地区识别 (保持不变)
    // ------------------------------------------------------------
    const regionGroups = [
      { key: "US", name: "🇺🇸 US", filter: /([\[]US[\]]|^US$|USA|United[ _-]?States|\bUS\b|美国|美國|🇺🇸)/i, icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png" },
      { key: "JP", name: "🇯🇵 JP", filter: /([\[]JP[\]]|^JP$|Japan|\bJP\b|日本|东京|大阪|🇯🇵)/i, icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png" },
      { key: "SG", name: "🇸🇬 SG", filter: /([\[]SG[\]]|^SG$|Singapore|\bSG\b|新加坡|狮城|🇸🇬)/i, icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png" }
    ];

    const regionalNodes = {};
    const regionalAutos = [];

    regionGroups.forEach(region => {
      const matched = currentProxyNames.filter(name => region.filter.test(name));
      if (matched.length === 0) return;
      regionalNodes[region.key] = matched;
      regionalAutos.push({ key: region.key, name: region.name + "-Auto", nodes: matched });
    });

    const autoNames = regionalAutos.map(a => a.name);
    const autoByKey = {};
    regionalAutos.forEach(a => { autoByKey[a.key] = a.name; });

    const allRegionalNodes = [];
    regionalAutos.forEach(a => a.nodes.forEach(n => { if (!allRegionalNodes.includes(n)) allRegionalNodes.push(n); }));
    const autoPool = allRegionalNodes.length ? allRegionalNodes : currentProxyNames.slice();

    // ------------------------------------------------------------
    // 3. 策略组 (包含 AI Fallback 与省电优化)
    // ------------------------------------------------------------
    const groupIcon = {
      PROXY: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png",
      AUTO: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png",
      US: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png",
      JP: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png",
      SG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
    };

    const healthCheck = { url: "http://www.gstatic.com/generate_204", interval: 600, tolerance: 50, lazy: true };

    fixed["proxy-groups"].push({
      name: "PROXY", type: "select", icon: groupIcon.PROXY,
      proxies: ["AUTO", ...autoNames, ...currentProxyNames]
    });

    fixed["proxy-groups"].push(Object.assign({
      name: "AUTO", type: "url-test", icon: groupIcon.AUTO, proxies: autoPool.slice()
    }, healthCheck));

    ["US", "JP", "SG"].forEach(key => {
      const matched = regionalNodes[key];
      if (!matched) return;
      fixed["proxy-groups"].push(Object.assign({
        name: autoByKey[key], type: "url-test", icon: groupIcon[key], proxies: matched.slice()
      }, healthCheck));
    });

    const aiFallbackProxies = [];
    if (regionalNodes.US) aiFallbackProxies.push(autoByKey.US);
    aiFallbackProxies.push("AUTO", "DIRECT");

    fixed["proxy-groups"].push({
      name: "🤖 AI-Fallback", type: "fallback", icon: groupIcon.US, proxies: aiFallbackProxies
    });

    // ------------------------------------------------------------
    // 4. 校验 (保持不变)
    // ------------------------------------------------------------
    const reserved = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE", ...fixed["proxy-groups"].map(g => g.name)]);
    if (currentProxyNames.some(name => reserved.has(name))) throw new Error("Runestone: node name conflicts");
    if (fixed["proxy-groups"].some(g => Object.prototype.hasOwnProperty.call(config["proxy-providers"] || {}, g.name))) throw new Error("Runestone: provider name conflicts");

    // ============================================================
    // 5. 核心：使用 Loyalsoldier 纯文本 IP 规则集 (format: "text")
    // ============================================================
    const ruleBase = "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release";

    fixed["rule-providers"] = Object.assign({}, config["rule-providers"], {
      "lan-ip": {
        type: "http",
        behavior: "ipcidr",
        format: "text",
        url: `${ruleBase}/lancidr.txt`,
        path: "./ruleset/lancidr.txt",
        interval: 86400
      },
      "private-ip": {
        type: "http",
        behavior: "ipcidr",
        format: "text",
        url: `${ruleBase}/private.txt`,
        path: "./ruleset/private.txt",
        interval: 86400
      },
      "cn-ip": {
        type: "http",
        behavior: "ipcidr",
        format: "text",
        url: `${ruleBase}/cncidr.txt`,
        path: "./ruleset/cncidr.txt",
        interval: 86400
      },
      "telegram-ip": {
        type: "http",
        behavior: "ipcidr",
        format: "text",
        url: `${ruleBase}/telegramcidr.txt`,
        path: "./ruleset/telegramcidr.txt",
        interval: 86400
      }
    });

    // ------------------------------------------------------------
    // 6. 规则 (Rule-Set 只用于 GeoIP，GeoSite 保持不变)
    // ------------------------------------------------------------
    fixed.rules = [
      // 局域网与私有 IP 直连 (基于纯文本 .txt 规则集)
      "RULE-SET,lan-ip,DIRECT,no-resolve",
      "RULE-SET,private-ip,DIRECT,no-resolve",

      // 国外 AI -> 使用高可用 Fallback 组 (保留 GeoSite)
      "GEOSITE,category-ai-!cn,🤖 AI-Fallback",

      // Telegram -> 直连 (GeoSite 管域名，Rule-Set 管 IP)
      "GEOSITE,telegram,DIRECT",
      "RULE-SET,telegram-ip,DIRECT,no-resolve",

      // 广告拦截 (保留 GeoSite)
      "GEOSITE,category-ads-all,REJECT",

      // 中国大陆直连 (GeoSite 管域名，Rule-Set 管 IP)
      "GEOSITE,CN,DIRECT",
      "RULE-SET,cn-ip,DIRECT,no-resolve",

      // 最终兜底
      "MATCH,PROXY"
    ];

    fixed.rules = [...new Set(fixed.rules)];

    return fixed;

  } catch (err) {
    console.error("Runestone 脚本执行失败，已回退至原始配置: " + err.message);
    return config;
  }
}

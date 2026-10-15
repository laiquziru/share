/*
 * Runestone Configuration Override (常用境外服务代理版 - 修复优化版)
 * Repository: Sydney-Moses/Network-Profiles
 *
 * 配置说明 (2026-10-15):
 * 1. 使用 rule 模式、fake-ip 和 lazy 测速。
 * 2. GFW、Instagram、Google、GitHub、X、YouTube、Netflix、Spotify、TikTok
 *    以及非中国学术站点走 PROXY；国外 AI 服务走 AI-Fallback 高可用组。
 * 3. Telegram 保持 DIRECT，由 Telegram 自带代理负责连接（如需浏览器打开 t.me 链接可改为 PROXY）。
 * 4. 广告规则前置 REJECT；局域网和私有地址使用 blackmatrix7 Lan 规则集（CDN 加速）直连。
 * 5. 不再设置 CN 直连规则，未匹配流量最终使用 MATCH,DIRECT。
 * 6. DNS 使用 DoH、fake-ip 和分流策略；GFW 域名通过 #PROXY 远端解析，私有域名使用系统 DNS。
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
    // 1. DNS 防泄露配置
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
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ],
      "proxy-server-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ],
      "direct-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ],
      "direct-nameserver-follow-policy": true,
      "respect-rules": true,
      "nameserver-policy": {
        "geosite:cn": [
          "https://dns.alidns.com/dns-query",
          "https://doh.pub/dns-query"
        ],
        "geosite:private": ["system"],
        "geosite:gfw": [
          "https://1.1.1.1/dns-query#PROXY",
          "https://dns.google/dns-query#PROXY"
        ]
      }
    });

    // ------------------------------------------------------------
    // 2. 地区识别
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
    const unmatchedNodes = currentProxyNames.filter(n => !allRegionalNodes.includes(n));
    const autoPool = allRegionalNodes.length
      ? [...allRegionalNodes, ...unmatchedNodes]
      : currentProxyNames.slice();

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

    const healthCheck = {
      url: "http://www.gstatic.com/generate_204",
      interval: 600,
      tolerance: 50,
      lazy: true
    };

    fixed["proxy-groups"].push({
      name: "PROXY",
      type: "select",
      icon: groupIcon.PROXY,
      proxies: ["AUTO", ...autoNames, ...currentProxyNames]
    });

    fixed["proxy-groups"].push(Object.assign({
      name: "AUTO",
      type: "url-test",
      icon: groupIcon.AUTO,
      proxies: autoPool.slice()
    }, healthCheck));

    ["US", "JP", "SG"].forEach(key => {
      const matched = regionalNodes[key];
      if (!matched) return;
      fixed["proxy-groups"].push(Object.assign({
        name: autoByKey[key],
        type: "url-test",
        icon: groupIcon[key],
        proxies: matched.slice()
      }, healthCheck));
    });

    const aiFallbackProxies = [];
    if (regionalNodes.US) aiFallbackProxies.push(autoByKey.US);
    aiFallbackProxies.push("AUTO");

    fixed["proxy-groups"].push(Object.assign({
      name: "🤖 AI-Fallback",
      type: "fallback",
      icon: groupIcon.US,
      proxies: aiFallbackProxies
    }, healthCheck));

    // ------------------------------------------------------------
    // 4. 校验
    // ------------------------------------------------------------
    const reserved = new Set([
      "DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE",
      ...fixed["proxy-groups"].map(g => g.name)
    ]);
    if (currentProxyNames.some(name => reserved.has(name))) {
      throw new Error("Runestone: node name conflicts");
    }
    if (fixed["proxy-groups"].some(g => Object.prototype.hasOwnProperty.call(config["proxy-providers"] || {}, g.name))) {
      throw new Error("Runestone: provider name conflicts");
    }

    // ------------------------------------------------------------
    // 5. 局域网与私有地址规则集 (使用 jsDelivr CDN 避免冷启动死锁)
    // ------------------------------------------------------------
    const ruleBase = "https://fastly.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash";

    fixed["rule-providers"] = Object.assign({}, config["rule-providers"], {
      "lan-ip": {
        type: "http",
        behavior: "classical",
        url: `${ruleBase}/Lan/Lan.yaml`,
        path: "./ruleset/Lan.yaml",
        interval: 86400
      }
    });

    // ------------------------------------------------------------
    // 6. 分流规则
    // ------------------------------------------------------------
    fixed.rules = [
      // 局域网与私有 IP 直连 (Lan.yaml 已完整包含私有 IP 段与局域网域名)
      "RULE-SET,lan-ip,DIRECT,no-resolve",

      // 广告拦截前置，防止被后续代理规则抢先放行
      "GEOSITE,category-ads-all,REJECT",

      // 国外 AI -> 使用高可用 Fallback 组
      "GEOSITE,category-ai-!cn,🤖 AI-Fallback",

      // Telegram -> 保持直连，由客户端自带代理负责连接
      // (若需在浏览器中直接打开 t.me 链接，可将 DIRECT 改为 PROXY)
      "GEOSITE,telegram,DIRECT",

      // Instagram -> 代理
      "GEOSITE,instagram,PROXY",

      // 常用境外服务 -> 代理
      "GEOSITE,google,PROXY",
      "GEOSITE,github,PROXY",
      "GEOSITE,twitter,PROXY",
      "GEOSITE,youtube,PROXY",
      "GEOSITE,netflix,PROXY",
      "GEOSITE,spotify,PROXY",
      "GEOSITE,tiktok,PROXY",
      "GEOSITE,category-scholar-!cn,PROXY",

      // GFW 域名走代理
      "GEOSITE,gfw,PROXY",

      // 最终兜底直连
      "MATCH,DIRECT"
    ];

    fixed.rules = [...new Set(fixed.rules)];

    return fixed;

  } catch (err) {
    console.error("Runestone 脚本执行失败，已回退至原始配置: " + err.message);
    return config;
  }
}

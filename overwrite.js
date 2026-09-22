/*
 * Runestone Configuration Override
 * Repository: Sydney-Moses/Network-Profiles
 * 
 * 优化说明 (2026-09-22):
 * 1. 增加 try...catch 容错，脚本报错时返回原配置，防止断网。
 * 2. 优化测速机制：加入 lazy: true 并按需测速，延长 interval 省电。
 * 3. AI 策略高可用：引入 fallback 组，主用 US 节点，故障自动切 AUTO。
 * 4. DNS 容灾：direct-nameserver 增加 UDP 兜底，防止极端环境下 DoH 阻塞。
 * 5. GeoIP 依赖：如果你希望使用旧版数据，请在客户端资源管理中删除 geoip.metadb。
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

    // 保留客户端自有网络字段，替换路由
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
    // 1. DNS 防泄露配置 (优化：加入 UDP 容灾)
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
      // 优化 4：加入 UDP 国内 DNS 兜底，防止 DoH 被阻断导致直连解析失败
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
    // 2. 地区识别
    // ------------------------------------------------------------
    const regionGroups = [
      {
        key: "US", name: "🇺🇸 US",
        filter: /([\[]US[\]]|^US$|USA|United[ _-]?States|\bUS\b|美国|美國|🇺🇸)/i,
        icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png"
      },
      {
        key: "JP", name: "🇯🇵 JP",
        filter: /([\[]JP[\]]|^JP$|Japan|\bJP\b|日本|东京|大阪|🇯🇵)/i,
        icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png"
      },
      {
        key: "SG", name: "🇸🇬 SG",
        filter: /([\[]SG[\]]|^SG$|Singapore|\bSG\b|新加坡|狮城|🇸🇬)/i,
        icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
      }
    ];

    const regionalNodes = {};
    const regionalAutos = [];

    regionGroups.forEach(region => {
      const matched = currentProxyNames.filter(name => region.filter.test(name));
      if (matched.length === 0) return;
      const autoName = region.name + "-Auto";
      regionalNodes[region.key] = matched;
      regionalAutos.push({ key: region.key, name: autoName, nodes: matched });
    });

    const autoNames = regionalAutos.map(a => a.name);
    const autoByKey = {};
    regionalAutos.forEach(a => { autoByKey[a.key] = a.name; });

    const allRegionalNodes = [];
    regionalAutos.forEach(a => {
      a.nodes.forEach(n => {
        if (!allRegionalNodes.includes(n)) allRegionalNodes.push(n);
      });
    });
    const autoPool = allRegionalNodes.length ? allRegionalNodes : currentProxyNames.slice();

    // ------------------------------------------------------------
    // 3. 策略组 (优化：AI fallback 与 lazy 测速)
    // ------------------------------------------------------------
    const groupIcon = {
      PROXY: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png",
      AUTO: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png",
      US: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png",
      JP: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png",
      SG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
    };

    // 优化 2：加入 lazy: true，延长 interval 至 600s，避免频繁测速耗电
    const healthCheck = {
      url: "http://www.gstatic.com/generate_204",
      interval: 600,
      tolerance: 50,
      lazy: true
    };

    // 基础策略组
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

    // 优化 3：生成 AI Fallback 组 (故障自动切换)
    // 策略：优先选 US-Auto，如果 US 节点不存在或全部超时，自动回退到 AUTO，最后兜底 DIRECT
    const aiFallbackProxies = [];
    if (regionalNodes.US) aiFallbackProxies.push(autoByKey.US);
    aiFallbackProxies.push("AUTO", "DIRECT");

    fixed["proxy-groups"].push({
      name: "🤖 AI-Fallback",
      type: "fallback",
      icon: groupIcon.US,
      proxies: aiFallbackProxies
    });

    // ------------------------------------------------------------
    // 4. 校验
    // ------------------------------------------------------------
    const reserved = new Set([
      "DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE",
      ...fixed["proxy-groups"].map(g => g.name)
    ]);

    if (currentProxyNames.some(name => reserved.has(name))) {
      throw new Error("Runestone: node name conflicts with a generated group or built-in outbound");
    }
    if (fixed["proxy-groups"].some(g => Object.prototype.hasOwnProperty.call(config["proxy-providers"] || {}, g.name))) {
      throw new Error("Runestone: provider name conflicts with a generated group");
    }

    const knownOutbounds = new Set([...reserved, ...currentProxyNames]);
    if (currentProxies.some(p => p["dialer-proxy"] && !knownOutbounds.has(p["dialer-proxy"]))) {
      throw new Error("Runestone: dialer-proxy references a source group that routing replacement would remove");
    }

    // ------------------------------------------------------------
    // 5. 规则 (优化：AI 指向新的 Fallback 组)
    // ------------------------------------------------------------
    fixed.rules = [
      "GEOIP,LAN,DIRECT,no-resolve",
      "GEOIP,PRIVATE,DIRECT,no-resolve",

      // 国外 AI：改为指向 Fallback 组，避免单一地区故障导致断联
      "GEOSITE,category-ai-!cn,🤖 AI-Fallback",

      "GEOSITE,telegram,DIRECT",
      "GEOIP,TELEGRAM,DIRECT,no-resolve",

      "GEOSITE,category-ads-all,REJECT",

      "GEOSITE,CN,DIRECT",
      "GEOIP,CN,DIRECT,no-resolve",

      "MATCH,PROXY"
    ];

    fixed.rules = [...new Set(fixed.rules)];

    return fixed;

  } catch (err) {
    // 优化 1：防断网兜底。如果脚本执行出错，打印错误并返回原配置，保证基础网络可用。
    console.error("Runestone 脚本执行失败，已回退至原始配置: " + err.message);
    return config;
  }
}
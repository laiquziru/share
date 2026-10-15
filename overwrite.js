/*
 * Runestone Configuration Override (常用境外服务代理版 - 纯 GeoSite/GeoIP 增强版)
 * Repository: Sydney-Moses/Network-Profiles
 *
 * 配置说明 (2026-10-15):
 * 1. 使用 rule 模式、fake-ip、geodata-mode 和 lazy 测速。
 * 2. 完全使用内置 GEOSITE 与 GEOIP 规则，无需下载外部 Rule-Set 规则集。
 * 3. GFW、Instagram、Google、GitHub、X、YouTube、Netflix、Spotify、TikTok
 *    以及非中国学术站点走 PROXY；国外 AI 服务走 AI 高可用组。
 * 4. Telegram 域名与 IP 保持 DIRECT，由 Telegram 自带代理负责连接。
 * 5. 广告规则前置 REJECT；局域网和私有地址使用 GEOSITE/GEOIP private 直连。
 * 6. 国内流量通过 GEOSITE/GEOIP cn 保底直连，最终未匹配流量交由「🐟 漏网之鱼」策略组自由切换（默认 DIRECT）。
 * 7. DNS 使用 DoH、fake-ip 和分流策略；GFW 域名通过 #PROXY 远端解析，私有域名使用系统 DNS。
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
    fixed["geodata-mode"] = true;

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
    // 3. 策略组 (包含 AI Fallback、漏网之鱼 与省电优化)
    // ------------------------------------------------------------
    const groupIcon = {
      PROXY: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Proxy.png",
      AUTO: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png",
      FINAL: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png",
      US: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png",
      JP: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png",
      SG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png",
      AI: "https://raw.githubusercontent.com/laiquziru/share/refs/heads/main/chatgpt.png"
    };

    const healthCheck = {
      url: "http://www.gstatic.com/generate_204",
      interval: 600,
      tolerance: 50,
      lazy: true
    };

    // 主代理选择组
    fixed["proxy-groups"].push({
      name: "PROXY",
      type: "select",
      icon: groupIcon.PROXY,
      proxies: ["AUTO", ...autoNames, ...currentProxyNames]
    });

    // 全局自动测速组
    fixed["proxy-groups"].push(Object.assign({
      name: "AUTO",
      type: "url-test",
      icon: groupIcon.AUTO,
      proxies: autoPool.slice()
    }, healthCheck));

    // 地区自动测速组
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

    // 国外 AI 故障转移组 (优先美国自动测速，异常时回退至全局 AUTO)
    const aiFallbackProxies = [];
    if (regionalNodes.US) {
    aiFallbackProxies.push(autoByKey.US);
    }

    if (regionalNodes.SG) {
      aiFallbackProxies.push(autoByKey.SG);
      }
    if (regionalNodes.JP) {
      aiFallbackProxies.push(autoByKey.JP);
    }

// 始终保留全局 AUTO 作为最后候选项
  aiFallbackProxies.push("AUTO");

    fixed["proxy-groups"].push(Object.assign({
      name: "🤖 AI",
      type: "fallback",
      icon: groupIcon.AI,
      proxies: aiFallbackProxies
    }, healthCheck));

    // 兜底分流手动选择组 (默认 DIRECT，遇到冷门外网可随时在面板切为 PROXY)
    fixed["proxy-groups"].push({
      name: "🐟 漏网之鱼",
      type: "select",
      icon: groupIcon.FINAL,
      proxies: ["DIRECT", "PROXY", "AUTO", ...autoNames]
    });

    // ------------------------------------------------------------
    // 4. 冲突校验
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
    // 5. 分流规则 (纯内置 GEOSITE 与 GEOIP，零外部规则集依赖)
    // ------------------------------------------------------------
    fixed.rules = [
      // 1. 局域网与私有域名/IP 直连
      "GEOSITE,private,DIRECT",
      "GEOIP,private,DIRECT,no-resolve",

      // 2. 广告域名拦截前置
      "GEOSITE,category-ads-all,REJECT",

      // 3. 国外 AI -> 高可用 Fallback 组
      "GEOSITE,category-ai-!cn,🤖 AI",

      // 4. Telegram 域名与数据中心 IP -> 保持直连，由客户端自带代理负责连接
      // (若需在浏览器直接打开 t.me 链接，可将下方 DIRECT 改为 PROXY)
      "GEOSITE,telegram,DIRECT",
      "GEOIP,telegram,DIRECT,no-resolve",

      // 5. 常用境外服务域名 -> 代理
      "GEOSITE,instagram,PROXY",
      "GEOSITE,google,PROXY",
      "GEOSITE,github,PROXY",
      "GEOSITE,twitter,PROXY",
      "GEOSITE,youtube,PROXY",
      "GEOSITE,netflix,PROXY",
      "GEOSITE,spotify,PROXY",
      "GEOSITE,tiktok,PROXY",
      "GEOSITE,category-scholar-!cn,PROXY",
      "GEOSITE,gfw,PROXY",

      // 6. 常用境外服务纯 IP 流量补充 -> 代理 (带 no-resolve 避免阻塞 DNS)
      "GEOIP,google,PROXY,no-resolve",
      "GEOIP,netflix,PROXY,no-resolve",
      "GEOIP,twitter,PROXY,no-resolve",

      // 7. 国内域名与 IP 保底直连 (确保切换「🐟 漏网之鱼」至 PROXY 时国内流量仍走直连)
      "GEOSITE,cn,DIRECT",
      "GEOIP,cn,DIRECT,no-resolve",

      // 8. 最终未匹配流量 -> 交由「🐟 漏网之鱼」策略组决定 (默认 DIRECT)
      "MATCH,🐟 漏网之鱼"
    ];

    fixed.rules = [...new Set(fixed.rules)];

    return fixed;

  } catch (err) {
    console.error("Runestone 脚本执行失败，已回退至原始配置: " + err.message);
    return config;
  }
}

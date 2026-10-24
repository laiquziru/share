/*
 * 配置说明 (2026-10-15):
 * 1. 使用 rule 模式、fake-ip、geodata-mode 和 lazy 测速。
 * 2. 使用 GEOSITE 与 GEOIP 数据分类；自定义 direct.list / proxy.list 规则集
 *    指向本仓库（laiquziru/share），置于广告规则之前。
 * 3. GFW、Instagram、Google、GitHub、X、YouTube、Netflix、Spotify、TikTok
 *    以及非中国学术站点走 PROXY；国外 AI 服务走 AI 连通性故障转移组。
 * 4. Telegram 域名与 IP 交由「📱 Telegram」组选择 DIRECT 或 PROXY，首次默认 DIRECT。
 * 5. 广告规则前置 REJECT；局域网和私有地址使用 GEOSITE/GEOIP private 直连。
 * 6. 国内流量通过 GEOSITE/GEOIP cn 保底直连；「🐟 漏网之鱼」首次默认 DIRECT，之后记忆选择。
 * 7. 代理类域名需要真实解析时使用 #PROXY 远端 DoH；私有域名使用系统 DNS。
 * 8. DNS 引导及系统 DNS 不保证加密；应用 DNS 接管需另行配置。AI 测速不验证服务解锁。
 */

const RUNESTONE = { repository: "Sydney-Moses/Network-Profiles" };

// 自定义规则集：指向 share 仓库的 direct.list / proxy.list，编辑 list 无需改动本脚本。
const customRuleProviders = {
  direct: {
    type: "http",
    behavior: "classical",
    format: "text",
    url: "https://raw.githubusercontent.com/laiquziru/share/main/direct.list",
    path: "./ruleset/direct.list",
    interval: 86400
  },
  proxy: {
    type: "http",
    behavior: "classical",
    format: "text",
    url: "https://raw.githubusercontent.com/laiquziru/share/main/proxy.list",
    path: "./ruleset/proxy.list",
    interval: 86400
  }
};

function main(config) {
  try {
    // ------------------------------------------------------------
    // 0. 前置校验与配置覆写
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
    // 路由与 DNS 策略均由本脚本重建；仅保留指向自有 share 仓库的自定义规则集。
    fixed["rule-providers"] = customRuleProviders;
    delete fixed["sub-rules"];

    const aiGeosite = "category-ai-!cn";
    const telegramGroupName = "📱 Telegram";
    const proxyGeosites = [
      "instagram", "google", "github", "twitter", "youtube",
      "netflix", "spotify", "tiktok", "category-scholar-!cn", "gfw"
    ];
    const domesticDns = [
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query"
    ];
    const remoteDns = [
      "https://1.1.1.1/dns-query#PROXY",
      "https://dns.google/dns-query#PROXY"
    ];
    const nameserverPolicy = {
      "geosite:private": ["system"],
      ["geosite:" + aiGeosite]: remoteDns.slice(),
       // Telegram DNS uses remote DoH to avoid local pollution. Traffic remains
       // selectable through the Telegram policy group below.
       "geosite:telegram": remoteDns.slice()
    };
    // 与业务规则共用分类，避免新增代理服务却遗漏 DNS 分流。
    proxyGeosites.forEach(site => {
      nameserverPolicy["geosite:" + site] = remoteDns.slice();
    });
    nameserverPolicy["geosite:cn"] = domesticDns.slice();

    // ------------------------------------------------------------
    // 1. DNS 分流配置（不代替系统 DNS 接管）
    // ------------------------------------------------------------
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
        "time.*.com", "ntp.*.com", "+.msftconnecttest.com", "+.msftncsi.com",
        "localhost.ptlogin2.qq.com", "+.stun.*.*", "+.stun.*.*.*",
        "+.srv.nintendo.net", "+.stun.playstation.net"
      ],
      "default-nameserver": ["223.5.5.5", "119.29.29.29"],
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

    // ------------------------------------------------------------
    // 2. 地区识别
    // ------------------------------------------------------------
    const regionGroups = [
      { key: "US", name: "🇺🇸 US", filter: /(?:^|[\s_\-()[\]])US(?:$|[\s_\-()[\]])|USA|United[ _-]?States|美国|美國|🇺🇸/i },
      { key: "JP", name: "🇯🇵 JP", filter: /(?:^|[\s_\-()[\]])JP(?:$|[\s_\-()[\]])|Japan|日本|东京|大阪|🇯🇵/i },
      { key: "SG", name: "🇸🇬 SG", filter: /(?:^|[\s_\-()[\]])SG(?:$|[\s_\-()[\]])|Singapore|新加坡|狮城|🇸🇬/i },
      { key: "HK", name: "🇭🇰 HK", filter: /(?:^|[\s_\-()[\]])HK(?:$|[\s_\-()[\]])|Hong[ _-]?Kong|香港|港島|🇭🇰/i }
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

    // 主代理选择组：保持 PROXY 里内部顺序为 AUTO -> 🇭🇰 HK -> HK-Auto -> 其余 Auto -> 节点
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
      tolerance: 50,
      proxies: autoPool.slice()
    }, healthCheck));

    // 外层顺序：AUTO -> 🇭🇰 HK -> HK-Auto -> 其它 Auto（仅保留 HK）
    fixed["proxy-groups"].push({
      name: "🇭🇰 HK",
      type: "select",
      icon: groupIcon.HK,
      proxies: ["DIRECT", ...(autoByKey.HK ? [autoByKey.HK] : []), ...(regionalNodes.HK ? regionalNodes.HK.slice() : [])].filter(Boolean)
    });

    if (autoByKey.HK) {
      fixed["proxy-groups"].push(Object.assign({
        name: autoByKey.HK,
        type: "url-test",
        icon: groupIcon.HK,
        tolerance: 50,
        proxies: regionalNodes.HK.slice()
      }, healthCheck));
    }

    // 只保留 HK 相关手动/自动组；US/JP/SG 不再额外创建手动组
    ["US", "JP", "SG"].forEach(key => {
      const matched = regionalNodes[key];
      if (!matched) return;
      fixed["proxy-groups"].push(Object.assign({
        name: autoByKey[key],
        type: "url-test",
        icon: groupIcon[key],
        tolerance: 50,
        proxies: matched.slice()
      }, healthCheck));
    });

    // 仅检测 HTTPS 连通性，不验证 AI 地区/IP 限制；顺序为 US -> SG -> JP -> AUTO。
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
    if (regionalNodes.HK) {
      aiFallbackProxies.push(autoByKey.HK);
    }

    // 保留原有全局备用路径，但 AUTO 不保证选择 AI 支持的地区。
    aiFallbackProxies.push("AUTO");

    fixed["proxy-groups"].push(Object.assign({
      name: "🤖 AI",
      type: "fallback",
      icon: groupIcon.AI,
      proxies: aiFallbackProxies
    }, aiHealthCheck));

    // Telegram 独立开关；PROXY 跟随主代理组，选择会被 profile 记忆。
    fixed["proxy-groups"].push({
      name: telegramGroupName,
      type: "select",
      icon: groupIcon.TG,
      proxies: ["DIRECT", "PROXY"]
    });

    // 首次默认 DIRECT；store-selected 会保留用户之后的选择。
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

    // ------------------------------------------------------------
    // 5. 分流规则 (内置 GEOSITE/GEOIP + share 仓库自定义规则集)
    // ------------------------------------------------------------
    fixed.rules = [
      // 1. 局域网与私有域名/IP 直连
      "GEOSITE,private,DIRECT",
      "GEOIP,private,DIRECT,no-resolve",

      // 1.5 自定义规则集（share 仓库 direct.list / proxy.list），置于广告规则之前
      "RULE-SET,direct,DIRECT",
      "RULE-SET,proxy,PROXY",

      // 2. 广告域名拦截前置
      "GEOSITE,category-ads-all,REJECT",

      // 3. 国外 AI -> 连通性 Fallback 组
      "GEOSITE," + aiGeosite + ",🤖 AI",

      // 4. Telegram 域名与数据中心 IP -> 独立手动选择组
      // 客户端自带代理服务器的连接仍按本配置分流，不保证避免代理套代理。
      "GEOSITE,telegram," + telegramGroupName,
      "GEOIP,telegram," + telegramGroupName + ",no-resolve",

      // 5. 常用境外服务域名 -> 代理
      ...proxyGeosites.map(site => "GEOSITE," + site + ",PROXY"),

      // 6. 常用境外服务纯 IP 流量补充 -> 代理 (带 no-resolve 避免阻塞 DNS)
      "GEOIP,google,PROXY,no-resolve",
      "GEOIP,netflix,PROXY,no-resolve",
      "GEOIP,twitter,PROXY,no-resolve",

      // 7. 未分类域名不主动解析，减少国内 DNS 暴露；GEOSITE,cn 覆盖国内域名。
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

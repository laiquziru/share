/* Runestone V4 — routing-only Hako post-merge override.
 * Import the raw JavaScript URL, save, and select it after node-source merging.
 * Network settings and node objects are retained. Rules and groups are replaced.
 * URL import is a snapshot: re-import to upgrade. See docs/RUNESTONE_V4.md.
 *
 * 5 groups only: PROXY / AUTO / US / JP / SG.
 * All rules default to PROXY except overseas AI, which goes to US.
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
  fixed["proxy-groups"] = [];

  // ============================================================
  // 0. 地区识别
  //
  // 先算好 US / JP / SG 的节点归属，因为策略组要引用它们。
  // 没有任何节点命中的地区不会生成策略组。
  // ============================================================

  const regionGroups = [
    {
      key: "US",
      name: "🇺🇸 US",
      filter: /([\[]US[\]]|^US$|USA|United[ _-]?States|\bUS\b|美国|美國|🇺🇸)/i,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png"
    },

    {
      key: "JP",
      name: "🇯🇵 JP",
      filter: /([\[]JP[\]]|^JP$|Japan|\bJP\b|日本|东京|大阪|🇯🇵)/i,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png"
    },

    {
      key: "SG",
      name: "🇸🇬 SG",
      filter: /([\[]SG[\]]|^SG$|Singapore|\bSG\b|新加坡|狮城|🇸🇬)/i,
      icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
    }
  ];

  const regionalNodes = {};
  const regionalAutos = [];

  regionGroups.forEach(region => {
    const matched = currentProxyNames.filter(name => region.filter.test(name));

    // 没有节点则完全不生成该地区组。
    if (matched.length === 0) {
      return;
    }

    const autoName = region.name + "-Auto";
    regionalNodes[region.key] = matched;
    regionalAutos.push({key: region.key, name: autoName, nodes: matched});
  });

  const autoNames = regionalAutos.map(a => a.name);
  const autoByKey = {};
  regionalAutos.forEach(a => { autoByKey[a.key] = a.name; });

  // 所有地区节点合并进 AUTO；没有任何地区命中时回退到全部节点。
  const allRegionalNodes = [];
  regionalAutos.forEach(a => {
    a.nodes.forEach(n => {
      if (!allRegionalNodes.includes(n)) allRegionalNodes.push(n);
    });
  });

  const autoPool = allRegionalNodes.length
    ? allRegionalNodes
    : currentProxyNames.slice();

  // US 组的节点池：仅当存在美国节点时才有这个组。
  const usPool = regionalNodes.US || null;

  // ============================================================
  // 1. 五个策略组
  //
  // PROXY  —— 全部节点，手动选择，最终兜底
  // AUTO   —— 按延迟自动选择（在所有地区节点中选最快）
  // US/JP/SG—— 地区自动选择
  //
  // 地区组不存在时不生成，PROXY / AUTO 会过滤掉它们。
  // ============================================================

  const groupIcon = {
    PROXY: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Final.png",
    AUTO: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Auto.png",
    US: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png",
    JP: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png",
    SG: "https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png"
  };

  const healthCheck = {
    url: "http://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 50
  };

  fixed["proxy-groups"].push({
    name: "PROXY",
    type: "select",
    icon: groupIcon.PROXY,
    proxies: [
      "AUTO",
      ...autoNames,
      ...currentProxyNames
    ]
  });

  fixed["proxy-groups"].push(Object.assign({
    name: "AUTO",
    type: "url-test",
    icon: groupIcon.AUTO,
    proxies: autoPool.slice()
  }, healthCheck));

  // 地区组：US / JP / SG，按 US → JP → SG 顺序（与「AI 走 US」的直觉一致）。
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

  // ============================================================
  // 2. 校验：节点名不得与生成的组或内置 outbound 冲突
  // ============================================================

  const groups = fixed["proxy-groups"];

  const reserved = new Set([
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "PASS-RULE",
    "COMPATIBLE",
    ...groups.map(g => g.name)
  ]);

  if (currentProxyNames.some(name => reserved.has(name))) {
    throw new Error(
      "Runestone: node name conflicts with a generated group or built-in outbound"
    );
  }

  if (
    groups.some(g =>
      Object.prototype.hasOwnProperty.call(
        config["proxy-providers"] || {},
        g.name
      )
    )
  ) {
    throw new Error(
      "Runestone: provider name conflicts with a generated group"
    );
  }

  const knownOutbounds = new Set([
    ...reserved,
    ...currentProxyNames
  ]);

  if (
    currentProxies.some(
      p =>
        p["dialer-proxy"] &&
        !knownOutbounds.has(p["dialer-proxy"])
    )
  ) {
    throw new Error(
      "Runestone: dialer-proxy references a source group that routing replacement would remove"
    );
  }

  // ============================================================
  // 3. 规则
  //
  // 默认全部走 PROXY。
  // 唯一例外：国外 AI 服务走 US。
  //
  // AI 规则集中在 REJECT 之前、其它规则之前，
  // 避免被广告拦截或通用后缀规则抢先匹配。
  // ============================================================

  // 国外 AI：按 US 组的实际可用性决定落地策略组。
  const AI = usPool ? autoByKey.US : "PROXY";

  fixed.rules = [
    // 局域网直连
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "GEOIP,LAN,DIRECT,no-resolve",

    // ============================================================
    // 国外 AI → US（必须位于广告 REJECT 与通用规则之前）
    // ============================================================

    // OpenAI / ChatGPT
    "DOMAIN-SUFFIX,chatgpt.com," + AI,
    "DOMAIN-SUFFIX,openai.com," + AI,
    "DOMAIN-SUFFIX,oaistatic.com," + AI,
    "DOMAIN-SUFFIX,oaiusercontent.com," + AI,
    "DOMAIN-KEYWORD,openai," + AI,
    "DOMAIN,chat.openai.com," + AI,

    // Anthropic / Claude
    "DOMAIN-SUFFIX,claude.ai," + AI,
    "DOMAIN-SUFFIX,anthropic.com," + AI,
    "DOMAIN-SUFFIX,claudeusercontent.com," + AI,

    // Google Gemini / DeepMind / AI Studio
    "DOMAIN-SUFFIX,gemini.google.com," + AI,
    "DOMAIN-SUFFIX,aistudio.google.com," + AI,
    "DOMAIN-SUFFIX,deepmind.com," + AI,
    "DOMAIN-SUFFIX,deepmind.google," + AI,
    "DOMAIN-SUFFIX,makersuite.google.com," + AI,
    "DOMAIN-KEYWORD,bard.google," + AI,

    // xAI / Grok
    "DOMAIN-SUFFIX,grok.com," + AI,
    "DOMAIN-SUFFIX,x.ai," + AI,

    // Microsoft Copilot / Bing Chat
    "DOMAIN-SUFFIX,copilot.microsoft.com," + AI,
    "DOMAIN-SUFFIX,copilot.com," + AI,
    "DOMAIN-SUFFIX,ai.microsoft.com," + AI,
    "DOMAIN-SUFFIX,designer.microsoft.com," + AI,
    "DOMAIN-KEYWORD,copilot," + AI,
    "DOMAIN-SUFFIX,bing.com," + AI,
    "DOMAIN-SUFFIX,bing.net," + AI,

    // Perplexity / Mistral / Cohere / Meta AI
    "DOMAIN-SUFFIX,perplexity.ai," + AI,
    "DOMAIN-SUFFIX,mistral.ai," + AI,
    "DOMAIN-SUFFIX,cohere.ai," + AI,
    "DOMAIN-SUFFIX,cohere.com," + AI,
    "DOMAIN-SUFFIX,meta.ai," + AI,
    "DOMAIN-SUFFIX,poe.com," + AI,
    "DOMAIN-SUFFIX,character.ai," + AI,

    // AI 通用 keyword 兜底（放在具体域名之后）
    "DOMAIN-KEYWORD,claude," + AI,

    // 广告 / 隐私
    "RULE-SET,AdvertisingLite,REJECT",
    "RULE-SET,AdvertisingLite_Domain,REJECT",
    "RULE-SET,Privacy,REJECT",
    "RULE-SET,Privacy_Domain,REJECT",
    "RULE-SET,ACL4SSR_BanAD,REJECT",
    "RULE-SET,ACL4SSR_BanProgramAD,REJECT",

    // ============================================================
    // 中国大陆直连
    // ============================================================
    "RULE-SET,ChinaMax,DIRECT",
    "RULE-SET,ChinaMax_Domain,DIRECT",
    "RULE-SET,ChinaMax_IP,DIRECT",
    "GEOSITE,CN,DIRECT",
    "GEOIP,CN,DIRECT,no-resolve",

    // 最终兜底：其余全部走 PROXY
    "MATCH,PROXY"
  ];

  // ============================================================
  // Rule Providers
  // ============================================================

  fixed["rule-providers"] = {
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

  // All project-owned MRS resources follow one configurable repository.
  Object.values(fixed["rule-providers"]).forEach(provider => {
    provider.url = provider.url.replace(
      "Sydney-Moses/Network-Profiles",
      RUNESTONE.repository
    );
  });

  fixed.rules = [...new Set(fixed.rules)];

  return fixed;
}

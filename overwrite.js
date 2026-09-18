/* Runestone V4 — routing-only Hako post-merge override.
 * Import the raw JavaScript URL, save, and select it after node-source merging.
 * Network settings and node objects are retained. Rules and groups are replaced.
 * URL import is a snapshot: re-import to upgrade.
 *
 * 5 groups only: PROXY / AUTO / US / JP / SG.
 * Rules are all GEOSITE / GEOIP inline rules (no rule-providers), so they
 * follow the device's geosite.db / geoip.db and update dynamically.
 * Default route is PROXY; overseas AI goes to US; Telegram goes DIRECT.
 */
const RUNESTONE = {repository: "Sydney-Moses/Network-Profiles"};

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
  // 全部使用 GEOSITE / GEOIP 内联规则，依赖设备自带的
  // geosite.db / geoip.db，可随数据库更新而动态变化。
  //
  // 默认全部走 PROXY。
  // 两个例外：
  //   国外 AI  → US
  //   Telegram → DIRECT
  // ============================================================

  // 国外 AI：按 US 组的实际可用性决定落地策略组。
  const AI = usPool ? autoByKey.US : "PROXY";

  fixed.rules = [
    // 局域网直连（GEOIP 类别名必须大写）
    "GEOIP,LAN,DIRECT,no-resolve",
    "GEOIP,PRIVATE,DIRECT,no-resolve",

    // ============================================================
    // 国外 AI → US
    //
    // 必须位于广告拦截与其它规则之前。
    // ============================================================

    "GEOSITE,category-ai-!cn," + AI,

    // ============================================================
    // Telegram → DIRECT
    //
    // 只用 GEOSITE：geoip 库中没有 telegram 这个类别，
    // 写 GEOIP,TELEGRAM 是空规则（永远匹配 0 条）。
    // ============================================================

    "GEOSITE,telegram,DIRECT",

    // ============================================================
    // 广告拦截
    // ============================================================

    "GEOSITE,category-ads-all,REJECT",

    // ============================================================
    // 中国大陆直连
    //
    // GEOIP 的类别名必须大写（CN / LAN / PRIVATE）。
    // ============================================================

    "GEOSITE,CN,DIRECT",
    "GEOIP,CN,DIRECT,no-resolve",

    // ============================================================
    // 最终兜底：其余全部走 PROXY
    // ============================================================

    "MATCH,PROXY"
  ];

  fixed.rules = [...new Set(fixed.rules)];

  return fixed;
}

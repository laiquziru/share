/* Runestone V5 — routing-only Hako post-merge override.
 * Import the raw JavaScript URL, save, and select it after node-source merging.
 * Network settings and node objects are retained. Rules and groups are replaced.
 * URL import is a snapshot: re-import to upgrade.
 *
 * 5 groups only: PROXY / AUTO / US / JP / SG.
 * Rules are all GEOSITE / GEOIP inline rules (no rule-providers), so they
 * follow the device's geosite.db / geoip.db and update dynamically.
 * Default route is PROXY; overseas AI goes to US; Telegram goes DIRECT.
 *
 * DNS: 防泄露（Hako / mihomo 内核）。
 *   respect-rules + proxy-server-nameserver + direct-nameserver
 *   代理域名从节点侧远程加密解析（本地零泄露），
 *   直连域名走国内加密 DoH，全程无明文查询外泄。
 *   direct-nameserver 需要 mihomo >= v1.18.10，旧版会忽略该字段。
 *   字段语义与平台限制参照 clash.md（Hako 参考，2026-09-14 校对）。
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

  // store-selected 记住手选的策略组；store-fake-ip 持久化 fake-ip 映射，
  // 否则每次重载内核都要重新解析一遍域名。两者 mihomo 默认已开，
  // 但显式写出来防止上游模板关掉。
  fixed.profile = Object.assign({}, config.profile, {
    "store-selected": true,
    "store-fake-ip": true
  });

  // Hako（Apple 端）说明：unified-delay 省略时默认 true，显式 false 会被保留。
  // 这里显式开 true，让测速走统一延迟口径，避免 url-test 选出虚低延迟的节点。
  if (fixed["unified-delay"] === undefined) {
    fixed["unified-delay"] = true;
  }

  fixed.proxies = currentProxies;
  fixed["proxy-groups"] = [];

  // ============================================================
  // 0. DNS 防泄露（Hako / mihomo 内核）
  //
  // 目标：代理流量的域名解析绝不经过本地 / 明文 DNS。
  //
  // 思路：不用 fallback（Clash 文档明确说 fallback 是「按域名或
  // 主答案条件性地换一个结果」，不是超时重试；fake-ip 下易误判），
  // 改用官方推荐的「按规则分流解析」：
  //
  //   respect-rules: true
  //       让 nameserver / nameserver-policy 里没写 #出口 的条目，
  //       自动按路由规则选出口解析。配合下面两条：
  //       - 走 PROXY 的域名 → proxy-server-nameserver（节点侧远程解析）
  //       - 走 DIRECT 的域名 → direct-nameserver（本地加密解析）
  //
  //   proxy-server-nameserver
  //       代理出口下的域名解析器。走加密 DoH，查询直接从节点发出，
  //       本地运营商完全看不到，这是防泄露的核心。
  //       ⚠️ respect-rules 打开时此项不能为空，否则内核直接报错。
  //       ⚠️ 该项自身「不会」递归套用 respect-rules，必须是能独立
  //          直连到达的解析器，否则解析节点地址时会成环。
  //
  //   direct-nameserver
  //       直连出口下的域名解析器。同样加密，避免国内明文外泄。
  //       需要 mihomo >= v1.18.10；旧内核会忽略该字段并退回
  //       nameserver，所以低版本也不会崩。
  //
  //   nameserver / nameserver-policy
  //       写入 #RULES 后缀，等价于「按规则选出口」，与上面两条联动。
  //
  // 关键点：
  //   - 所有对外查询都是 https:// 加密，运营商看不到明文。
  //   - 代理域名由节点侧解析，不在本地暴露。
  //   - enable 保持 true（Hako 下连接期间 DNS 恒开，写 false 也关不掉）。
  //   - 绝不 listen 到 0.0.0.0 对外暴露。
  //
  // 平台注意事项（clash.md Hako 参考，2026-09-14 校对）：
  //   - prefer-h3 不建议与 respect-rules 同开，故显式关掉。
  //   - iOS/tvOS 用预编译地理资源，geodata-loader / geosite-matcher
  //     等字段在 Apple 端不按字面生效，无需在脚本里设置。
  //   - geox-url / geo-auto-update 在隧道内不会触发下载，geo 数据
  //     由 Clash 客户端管理，别指望脚本改这些 URL 能自动更新。
  // ============================================================

  fixed.dns = Object.assign({}, config.dns, {
    enable: true,
    ipv6: false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "use-hosts": true,
    "use-system-hosts": true,
    "prefer-h3": false,
    "fake-ip-filter": [
      "*.lan",
      "*.local",
      "*.localdomain",
      "*.localhost",
      "*.home.arpa",
      "time.*.com",
      "ntp.*.com",
      "+.msftconnecttest.com",
      "+.msftncsi.com",
      "localhost.ptlogin2.qq.com",
      "+.stun.*.*",
      "+.stun.*.*.*",
      "+.srv.nintendo.net",
      "+.stun.playstation.net"
    ],

    // 只用于解析下面 nameserver 里的域名（正常情况全是 IP，不会实际用到）
    "default-nameserver": [
      "223.5.5.5",
      "119.29.29.29",
      "1.1.1.1"
    ],

    // 主解析器：交给规则决定出口（国内直连 / 代理远程）
    nameserver: [
      "https://dns.alidns.com/dns-query#RULES",
      "https://doh.pub/dns-query#RULES"
    ],

    // 代理出口下的解析：从节点侧发起，本地零泄露（防泄露核心）
    "proxy-server-nameserver": [
      "https://1.1.1.1/dns-query",
      "https://dns.google/dns-query"
    ],

    // 直连出口下的解析：国内加密 DoH
    "direct-nameserver": [
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query"
    ],
    "direct-nameserver-follow-policy": true,

    // 打开 respect-rules 后，未标注出口的 DNS 条目会自动按路由规则分流
    "respect-rules": true,

    // 国内域名固定走国内 DNS 直连解析（快且 CDN 正确）
    "nameserver-policy": {
      "geosite:cn": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ],
      "geosite:private": [
        "223.5.5.5",
        "119.29.29.29"
      ]
    }
  });

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
    // GEOSITE 管域名，GEOIP 管裸 IP 直连（Telegram 客户端
    // 大量走 IP 而不是域名）。
    // ============================================================

    "GEOSITE,telegram,DIRECT",
    "GEOIP,TELEGRAM,DIRECT,no-resolve",

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

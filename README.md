# share

个人配置仓库：Clash 覆写脚本、分流清单、Clash Mi / 小火箭模块、油猴脚本等。

## 目录

### 🛡️ 代理配置（当前使用）

| 文件 | 说明 |
|---|---|
| [`overwrite.js`](overwrite.js) | Clash（mihomo 内核）覆写脚本：GEOSITE/GEOIP 分流、策略组重建、DNS 分流，并通过 rule-providers 引用下面两个清单（gh-proxy 地址，每日自动更新） |
| [`direct.list`](direct.list) | 自定义**直连**清单 ✅ 生效中 |
| [`proxy.list`](proxy.list) | 自定义**代理**清单 ✅ 生效中 |
| [`lqzr.sgmodule`](lqzr.sgmodule) | Clash Mi / Shadowrocket 模块（备用）：AI / Telegram / 流媒体分流 + 去广告重写 + GitHub 加速 |
| [`chatgpt.png`](chatgpt.png) | 覆写脚本中 🤖 AI 策略组的图标 |

**怎么用**：在 Clash 类客户端（Clash Mi / Stash 等）把 `overwrite.js` 配置为覆写脚本，订阅拉取后自动生效。

**加域名**：编辑 `direct.list` / `proxy.list` 加一行提交即可，脚本不用动：

```
DOMAIN-SUFFIX,example.com        ← 域名
IP-CIDR,1.2.3.4/32,no-resolve    ← 单个 IP
```

**模块地址**（备用）：

```
https://gh-proxy.com/https://raw.githubusercontent.com/laiquziru/share/main/lqzr.sgmodule
```

**缓存**：jsdelivr 路径更新后可访问
`https://purge.jsdelivr.net/gh/laiquziru/share@main/<文件名>` 刷新；gh-proxy 路径缓存短，一般无需处理。

### 📜 存档（未引用）

| 文件 | 说明 |
|---|---|
| [`overwrite.yaml`](overwrite.yaml) | 旧版 YAML 覆写 |
| [`AI.list`](AI.list) | AI 域名清单（早期版本） |
| [`lqzr.list`](lqzr.list) | 综合分流清单（早期版本） |

### 🧩 油猴 / 自用脚本

| 文件 | 说明 |
|---|---|
| [`翻译机.js`](翻译机.js) | 网页翻译脚本 |
| [`douyin_auto_filter.js`](douyin_auto_filter.js) | 抖音自动过滤 |
| [`linux-do-keyword-monitor.user.js`](linux-do-keyword-monitor.user.js) | LINUX DO 关键词监控 |
| [`x-user-timeline-collector.user.js`](x-user-timeline-collector.user.js) | X(Twitter) 用户时间线采集 |
| [`realistic_water_surface_user.js`](realistic_water_surface_user.js) | 网页水面特效 |
| [`鼠标点击绿色涟漪 + 点击后加 ☑️ 标记-1.1.js`](鼠标点击绿色涟漪%20+%20点击后加%20☑️%20标记-1.1.js) | 点击涟漪特效 |
| [`mm.js`](mm.js) / [`mm2.js`](mm2.js) | 备用脚本 |

## 维护约定

工程与仓库维护规则见 [`AGENTS.md`](AGENTS.md)。

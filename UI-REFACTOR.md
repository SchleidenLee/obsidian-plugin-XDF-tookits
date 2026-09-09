# XDF Toolkits UI 改造方案

## 状态：📋 待改造

## 现状问题

- ❌ 没有 Banner，直接 `h2` 标题
- ❌ 所有设置线性排列（开关/端口/Token/局域网/模型）
- ❌ 没有版本/作者信息

## 改造方案

### 1. 添加 Banner

```html
<div class="xdf-banner">
  <div class="xdf-banner-icon">🔧</div>
  <div>
    <h1 class="xdf-banner-title">XDF Toolkits</h1>
    <p class="xdf-banner-desc">教学档案 MCP 服务端</p>
  </div>
</div>
```

### 2. 调整设置分区

**首页（高频设置）：**
- 服务状态提示
- 启用 MCP 服务（开关）
- 端口
- 允许局域网（开关）

**高级设置（折叠区）：**
- 访问令牌
- 模型配置（Base URL、API Key、模型名称）

### 3. 添加 Footer

```html
<div class="xdf-footer">
  <span class="xdf-version">v0.1.6</span>
  <span class="xdf-author">· Schleiden</span>
</div>
```

## 改动文件

- `src/settings.ts` — 添加 Banner/Footer，把模型配置移到折叠区

## 预估工作量

- Banner/Footer：~20 行 HTML
- 设置分区调整：~15 行（把模型配置 Setting 移到 details 里）

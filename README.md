<h1 align="center">🗂️ Skills Hub：多 Agent Skills 版本管理平台</h1>

<p align="center">
  <strong>集中管理多 Agent 的 Skills，追踪版本演进，支持团队协作分发</strong>
</p>

<p align="center">
  <a href="#-快速开始"><img src="https://img.shields.io/badge/快速开始-3_分钟-blue?style=for-the-badge" alt="Quick Start"></a>
  <a href="#-功能特性"><img src="https://img.shields.io/badge/功能-7+-purple?style=for-the-badge" alt="Features"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/开源协议-MIT-yellow?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.x-green?logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/React-18-blue?logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Rust-orange?logo=rust" alt="Rust">
</p>

**Skills Hub** 是一个桌面应用，帮助你集中管理 Claude Code 的 Skills。统一存储在本地 Hub，支持版本控制、一键推送订阅、多 Agent 分发。

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🗂️ **Skills 管理** | 集中存储所有 Claude Code Skills，统一管理 |
| 📜 **版本历史** | 每个 Skill 保留完整版本记录，随时回溯 |
| ⬆️ **推送到 Hub** | 将 Agent 的 Skills 推送到 Hub 统一管理 |
| ⬇️ **从 Hub 同步** | 将 Hub 中的 Skills 同步到本地 Agent |
| 🔔 **订阅管理** | 配置 Agent 订阅的 Skills，自动同步更新 |
| 🔄 **Git 集成** | 支持 Git pull/push，团队协作更方便 |

---

## 🤔 为什么需要 Skills Hub？

不同的 Agent（Claude Code、OpenClaw、nanobot 等）各自有独立的 Skills 目录，分散在机器各处。更关键的是：**Agent 在执行任务过程中会不断优化调整 Skills，导致同一个 Skill 在本地出现多个版本**，难以追踪哪个是最新的、哪个版本效果更好。

**Skills Hub 帮你解决：**

- 📦 **集中存储** —— 所有 Skills 统一存放在 Hub 目录
- 🔢 **版本控制** —— 每个 Skill 保留完整的版本历史，记录优化过程，随时回溯
- 🤝 **团队共享** —— 通过 Git push/pull 与团队共享 Skills
- 📡 **自动分发** —— 配置订阅关系，Skill 更新自动同步

```
Git Remote (Hub) ←→ Hub 本地 ←→ skills-inventory 桌面应用 ←→ 各 Agent 目录
                      │
                      └─ CLI 工具（Phase 2，供 Agent 调用）
```

---

## 🚀 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/my-skills.git
cd my-skills

# 安装依赖
cd skills-inventory
npm install

# 启动开发模式
npm run tauri dev

# 或构建生产版本
npm run tauri build
```

### 使用流程

1. **初始化 Hub** —— 指定 Hub 存储路径（本地目录或 Git 仓库）
2. **添加 Agent** —— 配置本地 Agent 目录路径
3. **推送 Skills** —— 选择 Agent 和 Skills，推送到 Hub
4. **订阅 Skills** —— 配置 Agent 订阅的 Skills
5. **同步更新** —— 一键同步最新 Skills 到 Agent

---

## 📖 界面预览

### Skills 列表

浏览 Hub 中所有 Skills，支持搜索和筛选。点击查看详情，包括版本历史和完整内容。

### 推送界面

选择源 Agent 和目标 Skills，一键推送到 Hub。支持批量操作和操作日志。

### 订阅管理

配置 Agent 与 Skills 的订阅关系，支持一键同步全部订阅。

---

## 🎯 功能特性

### 🗂️ Hub 目录结构

```
~/skills-hub/
├── skills/                    # 所有 skills（git 管理）
│   ├── skill-A/
│   │   ├── v1.0.0/
│   │   ├── v1.1.0/
│   │   └── current/
│   └── skill-B/
├── agents/                   # 分发目录
│   ├── claude-code/
│   ├── openclaw/
│   └── ...
└── hub.config.json           # Hub 配置
```

### 📜 版本管理

- 每个 Skill 推送时自动创建新版本
- 保留完整版本历史
- 支持切换查看不同版本
- 自动清理旧版本（可配置保留数量）

### 🔔 订阅机制

- Agent 可订阅 Hub 中的多个 Skills
- Skill 更新时自动提醒
- 一键同步全部订阅到本地

---

## 🗺️ 开发路线

| 阶段 | 内容 | 状态 |
|------|------|------|
| **Phase 1** | Desktop App (skills-inventory) | 🔜 开发中 |
| **Phase 2** | CLI Tool —— 封装 CLI 供 Agent 调用 | 📋 计划中 |

---

## 📦 技术栈

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Tauri 2.x (Rust)
- **Package Manager**: npm

---

## 📄 开源协议

MIT License

---

<div align="center">

**Skills Hub** — *Claude Code Skills 集中管理* 🗂️

</div>

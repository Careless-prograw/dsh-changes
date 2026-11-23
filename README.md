# dsh-changes（变更）

给 DeepSeek Harness Web GUI 用的**代码变更审查 + 回退**插件：把 Agent 每一轮改过的文件做成输入框上方的**一条待审条**和右侧栏的**变更面板**，逐块接受 / 撤销，并支持 Git / SVN 整区回退。

装上之后，会话流里不再出现 DSH 原生的「已编辑 N 个文件」卡片，变更提示只保留一处。

## 它提供什么

| 表面 | 位置 | 作用 |
|---|---|---|
| 待审条 | 输入框上方 | 唯一的变更提示：待审文件数、`+A −D`、全部保留 / 全部撤销、逐文件处置 |
| 变更面板 | 右侧栏「变更」页 | 逐块审查、切换审查基线、整区回退 |
| 配置开关 | 插件详情页 | 控制是否隐藏 DSH 原生的变更 / 交付卡片（默认隐藏） |

- 待审文件数归零后，待审条自动消失，界面上不留任何变更提示。
- 拒绝（撤销）会**写回磁盘**：逐块撤销按行号精确匹配，文件漂移时显式报错而不是猜测。
- 撤销一个本轮**新建**的文件会把它删除。

## 环境要求

- DeepSeek Harness **0.2.2-rc.5** 或更高版本（Web / Desktop GUI；TUI 没有这套界面）。
- 变更数据来自 DSH 内置的 `workspaceChanges` 记录器，因此：
  - 记录只在当前 DSH 进程内有效，**应用重启后之前回合没有提示也没有 diff**（下一轮有改动的回合结束后恢复）。
  - Git / SVN 功能需要工作目录确实是仓库。
- 跨块撤销依赖行号匹配；如需回退到更早的状态，用 VCS 整区回退。

## 安装

这是一个 **dsh bundle**（`package.json` 里声明了 `dsh.bundle.patch`），不是普通 npm 库，要用 DSH 自己的插件安装入口装。

### 方式一：从 GitHub Release 安装（推荐）

本仓库每个版本都会在 **Releases** 里挂一个预打包的 `dsh-changes-<版本>.tgz`。纯 JS、无构建步骤，装上即用。

在 DSH 里：**插件 → 添加插件**，粘贴下面这条链接（把用户名与版本换成实际值）：

```
https://github.com/Careless-prograw/dsh-changes/releases/download/v1.0.0/dsh-changes-1.0.0.tgz
```

或从命令行（把 `<profile>` 换成你宿主实际的 profile 名，桌面版通常是 `desktop`，`dsh web` 是 `web`）：

```bash
dsh plugin --profile <profile> add https://github.com/Careless-prograw/dsh-changes/releases/download/v1.0.0/dsh-changes-1.0.0.tgz
```

> 用桌面版时，命令行可能装到 `profiles/web` 而不是桌面版用的那个 profile，插件不会出现在桌面版里。这种情况请用 **设置 → 插件 → 添加插件** 的界面安装。

### 方式二：从仓库源码安装

不下载 Release 资产，直接让 pnpm 拉取仓库（第一次会多花几秒下载整包）：

```bash
dsh plugin --profile <profile> add github:Careless-prograw/dsh-changes
```

也可以写成完整地址 `git+https://github.com/Careless-prograw/dsh-changes.git`。本插件没有 `prepare`/`postinstall` 脚本，构建脚本不会被触发。

### 方式三：本地目录（自己开发时）

**添加插件** → 选择本地目录，或 `dsh plugin install <本目录绝对路径>`。这种方式是链接，改完源码重新加载插件即生效。

### 装好之后

1. 在插件列表里确认 `dsh-changes` 那一行是启用状态；
2. **刷新一次页面**（首次安装需要，让浏览器拿到新的客户端模块）；
3. 让 Agent 改一个文件，回合结束后输入框上方就会出现待审条。

## 发布新版本（维护者）

版本号只在 `package.json` 里改；打 tag 后由 GitHub Actions 自动打包并建 Release（见 `.github/workflows/release.yml`）：

```bash
# 1. 改版本号（例如 1.0.0 → 1.0.1），提交
# 2. 打 tag 并推送，工作流会生成 dsh-changes-1.0.1.tgz 并挂到 Release
git tag v1.0.1
git push origin main --tags
```

工作流会校验 **tag 与 `package.json` 的 version 一致**，不一致直接失败，避免发出一个版本号对不上的包。

要在 DSH 的**插件市场里被搜到**，需要向社区索引 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR（市场本身不接收插件条目）。

## 用法

1. 让 Agent 改几个文件，回合结束后输入框上方出现待审条。
2. 点条子展开文件清单，逐行「保留 / 撤销」；或点「全部保留 / 全部撤销」。
3. 点某个文件 → 右侧「变更」页打开并定位到它：顶部固定「接受 / 拒绝」作用于当前待审块，处理后自动推进。
4. 想把工作区对齐到某个提交：把基线切到 `Git commit` / `SVN 版本`，选一个版本点，点「整区回退」（会二次确认，**丢弃其后所有改动**）。

## 配置

插件详情页有一个开关 **DSH 原生交付卡片**（默认：隐藏）。关闭后会话流里不再显示「已编辑 N 个文件」卡片。

该卡片与「交付卡片」「正文文件提及」「原生变更审查 tab」同属原生包 `dsh-client-ui-deliverables`，因此会一并隐藏；本插件的待审条与右侧面板不受影响。改动**立即生效**（不需要重启应用），停用或卸载本插件会自动恢复原生卡片。

## 已知限制

1. 改动数据只在当前 DSH 进程内有效；应用重启后，重启前的回合没有提示也没有 diff。
2. 每个文件只展示并处置它**最近一轮**的改动；更早回合的改动不会被这里撤销，需要时用 VCS 回退兜底。
3. 撤销依赖行号精确匹配，文件在记录之后被其他途径改过会显式失败（「文件已漂移」），不做猜测。
4. 撤销「本轮被删除的文件」暂不支持，需要 VCS 兜底。
5. 二进制与超大文件只能「保留」，不能「撤销」。
6. 决策记录在宿主内存中：刷新页面仍在；插件停用或宿主重启后清空，相关文件重新变回待审。
7. 关闭原生卡片等于关闭整个 `dsh-client-ui-deliverables` 包，`present` 工具会回落到通用工具视图。
8. 启动首帧可能短暂闪现原生卡片（该包在组合期默认加载，本插件激活后才按配置关闭）。

## 目录结构

```
index.js            Host 半：变更聚合、决策、反向写回、Git/SVN、原生卡开关
client.js           浏览器半：待审条、变更面板、插件详情页配置开关
cordis.patch.yml    bundle 补丁：插入本插件的 loader 行
locale/{zh,en}.json 插件卡片的多语言标题与描述
docs/DETAIL.md      插件详情页正文
icon.svg            插件图标
CHANGELOG.md        更新记录（随仓库发布，不打进 tgz）
.github/workflows/release.yml  打 tag 自动打包并建 Release
```

## 发布前检查清单

推送前确认这几处（`package.json` 的 `name` 与 `version` 是唯一版本来源）：

1. **替换 README 里的 `Careless-prograw`**：安装命令中有 4 处占位符（第 38、44、54、57 行），换成你的 GitHub 用户名，否则用户复制出来的链接是坏的。
2. 可选：在 `package.json` 里补上 `repository` 与 `bugs` 字段（当前故意留空——我不知道你的用户名，不想在清单里写死一个坏链接）：
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/Careless-prograw/dsh-changes.git" },
   "bugs": { "url": "https://github.com/Careless-prograw/dsh-changes/issues" }
   ```
3. 版本号与 tag 不一致时工作流会失败，所以先改 `package.json` 再打 tag。
4. `pnpm pack` 的产物名必须是 `dsh-changes-<version>.tgz`（工作流据此挂资产，README 据此给安装链接）。

## 维护者注意

- **`client.js` 里的模块 id 必须与包名完全一致**（当前都是 `dsh-changes`）。DSH 用包名作为客户端模块行的 key，两者不一致会让浏览器报
  `duplicate factory registration for "..."`。要改包名（例如加 npm scope）时，请同时改这三处：`package.json` 的 `name`、`client.js` 里
  `window.__ModuleLoader__.load({ id })` 与 `const packageName`、以及 `cordis.patch.yml` 的 `name`。
- 改包名之后，**已装的旧版本要在宿主里移除，并让浏览器整页刷新**：旧的模块行还留在页面里，会和新的行撞成同一个工厂注册两次。
- `Config` 的字段必须带 `.volatile()`：DSH 只为含 volatile 字段的插件生成配置表单，否则插件详情页不会出现任何配置项。
- **在本插件自己的开发会话里慎用「全部撤销」**：它会把待审条上属于你正在编辑的源码文件写回上一轮记录的内容，新建的文件会被直接删除。
  开发时优先用「全部保留」，否则可能亲眼看着 `package.json`、`README.md` 被回退成旧版本。

## 许可

[MIT](LICENSE)

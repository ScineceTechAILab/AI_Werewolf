# AI卧底游戏 — 双AI协同开发规范

## 角色分工

本项目由两个 Claude Code 实例协同开发，角色固定如下：

| 角色 | 代号 | 负责领域 |
|------|------|----------|
| **Agent-A（后端）** | BACKEND | server.js、game.js、claude.js、questions.js |
| **Agent-B（前端）** | FRONTEND | public/index.html、public/style.css、public/game.js |

**每个 Agent 启动时必须先确认自己的角色代号**，并在所有 git commit 信息中标注，例如：
```
[BACKEND] 实现房间状态机
[FRONTEND] 完成投票界面渲染
```

---

## 文件所有权（强制）

每个文件只能由指定 Agent 修改。未经协商不得越界写入。

```
BACKEND 独占：
  server.js
  game.js
  claude.js
  questions.js
  package.json
  .env / .env.example

FRONTEND 独占：
  public/index.html
  public/style.css
  public/game.js

共享（只读，双方均不可单方面修改）：
  CLAUDE.md          ← 本文件，修改需双方同意
  INTERFACE.md       ← Socket事件契约（见下）
  README.md
```

---

## 接口契约文件：INTERFACE.md

`INTERFACE.md` 是两个 Agent 的**唯一通信协议**，定义所有 Socket.io 事件的名称、方向和数据结构。

- **任何一方需要新增或修改事件，必须先更新 INTERFACE.md**
- 另一方看到 INTERFACE.md 变更后，再实现对应的客户端/服务端逻辑
- 禁止在代码里使用 INTERFACE.md 未定义的事件名

---

## 工作流程

### 正常开发循环

```
1. 拉取最新代码（git pull）
2. 读取 INTERFACE.md 确认契约是否有更新
3. 在自己负责的文件内工作
4. 完成后 commit（带角色前缀）并 push
```

### 需要对方配合时

在项目根目录创建 `HANDOFF.md`，写明：
- 我是谁（BACKEND / FRONTEND）
- 需要对方做什么
- 依赖的接口变更（已在 INTERFACE.md 更新了哪些）
- 完成标志（对方完成后删除此文件或追加 DONE 标记）

```markdown
<!-- HANDOFF.md 示例 -->
FROM: BACKEND
TO: FRONTEND
需求: 新增了 vote:result 事件，数据结构见 INTERFACE.md#vote-result
请在结果页面渲染胜者和身份揭示
完成后: 删除此文件
```

### 发现对方代码有问题时

- **不要直接修改对方文件**
- 在 `ISSUES.md` 里记录问题，注明文件和行号
- 等对方确认后由对方修复

---

## 冲突预防规则

1. **每次开工前必须 git pull**，确保基于最新代码
2. **禁止 force push**
3. 若发生 merge conflict：冲突在谁的文件里，谁来解决
4. `package.json` 的依赖变更由 BACKEND 负责，FRONTEND 需要新依赖时通过 HANDOFF.md 提请
5. 不在对方文件里留 TODO 或临时注释

---

## 开发状态追踪

使用 `STATUS.md` 记录当前进度，双方均可更新自己那栏：

```markdown
## BACKEND
- [x] 项目初始化 / package.json
- [ ] game.js 状态机
- [ ] server.js Socket路由
- [ ] claude.js API封装

## FRONTEND
- [ ] 登录/创建房间页
- [ ] 游戏主界面
- [ ] 投票界面
- [ ] 结果页
```

---

## 禁止事项

- ❌ 不读 INTERFACE.md 就写 Socket 事件
- ❌ 修改对方负责的文件
- ❌ 在没有 HANDOFF.md 的情况下期待对方"自动理解"需求
- ❌ commit 信息不带角色前缀
- ❌ 未 pull 就直接 push

# Codex-mini 产品化路线

结合 Codex 和 Claude Code 的分析，阶段四不应该只做成“加几个高级功能”，而应升级为：

## Codex-mini 产品化路线：从本地 Agent Runtime 进化成可恢复、可审查、可扩展的 Coding Agent 工作台

### 参考基准

- **OpenAI Codex 官方方向**：CLI、本地运行、IDE、Desktop App、Codex Web、resume、MCP、skills、hooks、subagents、sandbox、GitHub/Slack/Linear 集成。
- **Claude Code analysis 启发**：append-only transcript、resume 恢复流水线、context compact、memory 分层、skills/MCP 扩展、sandbox + permission 一体化、multi-agent sidechain。

### 总体架构

```text
Codex-mini
├── Clients
│   ├── CLI
│   ├── Desktop Electron
│   └── Future IDE Extension
├── Runtime Service
│   ├── Agent Loop
│   ├── Event Protocol
│   ├── Tool Scheduler
│   └── Model Router
├── Session Layer
│   ├── Transcript JSONL
│   ├── SQLite Session Index
│   ├── Resume / Recovery
│   └── Sidechain Sessions
├── Context Layer
│   ├── Token Budget
│   ├── Auto Compact
│   ├── Project Profile
│   └── Memory Injection
├── Tool Layer
│   ├── Built-in Tools
│   ├── Git Tools
│   ├── Patch Tools
│   ├── LSP Tools
│   ├── MCP Tools
│   └── Skills
├── Safety Layer
│   ├── Permission Mode
│   ├── Path Policy
│   ├── Command Policy
│   ├── macOS Seatbelt / Future Docker Sandbox
│   └── Audit Log
└── Product Layer
    ├── Diff Review
    ├── Task Modes
    ├── Hooks
    ├── Automations
    └── Subagents
```

## 第一阶段：Session / Transcript / Resume

**这是最应该先做的。** 没有它，后面的 memory、context、multi-agent 都会漂。

### 目标

- 每次对话都有 `session_id`
- 所有关键事件写入 append-only JSONL
- SQLite 只做索引，不做唯一真相
- 支持 `/resume`
- 支持 Desktop 断线重连后恢复

### 建议结构

```text
.codex-mini/
  sessions/
    index.sqlite
    transcripts/
      <session_id>.jsonl
      <session_id>/
        subagents/
          agent-<id>.jsonl
```

### 事件类型

```text
user_message
assistant_message
assistant_delta
tool_call_started
tool_call_result
permission_request
permission_decision
summary
mode_changed
project_profile
git_state
session_title
session_tag
```

### 交付物

- `session/store.py`
- `session/transcript.py`
- `session/recovery.py`
- WebSocket `resume_session`
- CLI `codex-mini resume`
- Desktop session picker

### 验收标准

- 后端重启后能恢复最近会话
- 旧工具结果仍能作为上下文被模型理解
- 权限记录、模式、项目目录能恢复
- 单元测试覆盖 transcript append / load / resume

## 第二阶段：Context Manager / Auto Compact

你原来写的“上下文窗口管理”方向对，但要产品化。

### 目标

- 不直接把所有 `messages` 丢给模型
- 由 `ContextManager` 组装最终 prompt
- 超阈值自动 compact
- 保留目标、约束、最近工具结果、最近 diff、用户偏好、项目规则

### 核心模块

```text
context/
  token_counter.py
  builder.py
  compactor.py
  summaries.py
```

### 策略

| 内容类型 | 处理方式 |
| --- | --- |
| 系统提示 | 永远保留 |
| AGENTS.md / project profile | 压缩后保留 |
| 用户原始目标 | 永远保留 |
| 最近 N 轮 | 完整保留 |
| 旧工具结果 | 摘要保留 |
| 大 stdout | 截断 + 文件引用 |
| diff | 只保留摘要和文件列表 |

### compact 触发条件

- 超过 **70% context**：轻量压缩
- 超过 **85% context**：强制压缩
- compact 失败 **3 次**：停止自动压缩，提示用户

### 交付物

- `ContextManager.build_messages()`
- `TokenBudget`
- `ConversationSummary`
- 小模型摘要调用
- 测试长会话不爆 context

## 第三阶段：Project Profile / 项目感知

**这个应该排在 Chroma 前面。**

### 目标

- 启动时自动理解项目
- 自动读取规则文件
- 自动发现测试、构建、包管理器、语言栈
- 遵守 `.gitignore`

### 扫描内容

```text
AGENTS.md
README.md
pyproject.toml
package.json
Makefile
requirements.txt
.gitignore
tests/
src/
desktop/
server/
tools/
```

### 生成

```text
.codex-mini/project_profile.json
.codex-mini/project_summary.md
```

### 包含信息

- 项目目标
- 主要语言
- 入口文件
- 测试命令
- 运行命令
- 重要目录
- 受保护路径
- 代码风格
- 用户规则
- 当前 git 状态摘要

### 交付物

- `project/scanner.py`
- `project/gitignore.py`
- `project/profile.py`
- runtime 启动时注入隐藏上下文

## 第四阶段：Diff / Patch / Git Review

**这是你和成熟产品差距最大的体验点之一。**

现在 `write_file` / `edit_file` 是“批准后直接写”。下一步应该变成：

```text
模型提出修改 -> 生成 patch -> 展示 diff -> 用户 approve -> apply patch -> 自动测试 -> 总结变更
```

### 核心模块

```text
patch/
  diff_builder.py
  apply_patch.py
  rollback.py
  review.py
git/
  status.py
  branch.py
  commit.py
  pr_summary.py
```

### 工具升级

```text
write_file_preview
edit_file_preview
apply_patch
reject_patch
git_status
git_diff
git_commit
```

### Desktop UI 应新增

- 文件变更列表
- inline diff
- approve / reject
- apply all / apply selected
- command output 面板
- git status 面板

### 验收标准

- 默认写入前可看到 diff
- 可撤销最近一次 agent 修改
- agent 能解释改了哪些文件
- 测试失败时能定位到对应 patch

## 第五阶段：Permission Mode / Sandbox Policy

你现在已有安全策略和 macOS Seatbelt executor，下一步要变成“可解释的模式系统”。

### 建议模式

```text
read_only
confirm
auto_safe
full_auto
dangerous_deny
```

### 策略矩阵

| 动作 | read_only | confirm | auto_safe | full_auto |
| --- | --- | --- | --- | --- |
| read_file | 自动 | 自动 | 自动 | 自动 |
| grep | 自动 | 自动 | 自动 | 自动 |
| write_file | 禁止 | 询问 | 询问 | 自动 |
| edit_file | 禁止 | 询问 | 询问 | 自动 |
| safe command | 禁止 | 询问 | 自动 | 自动 |
| network | 禁止 | 询问 | 询问 | 自动 |
| dangerous command | 禁止 | 禁止 | 禁止 | 询问或禁止 |

### 需要补充

- persistent allowlist
- session allowlist
- command risk explanation
- network permission
- sandbox doctor
- macOS Seatbelt 不可用时的 fallback 提示
- 每次权限决策写入 transcript

## 第六阶段：Memory 分层

**不要一开始就重 Chroma。** 先做透明、可审查的 memory。

### 建议结构

```text
.codex-mini/
  memory/
    user.md
    project.md
    task.md
    preferences.json
```

### 分层定义

| 层级 | 内容 |
| --- | --- |
| User Memory | 用户偏好，例如喜欢 pnpm、单引号、中文解释 |
| Project Memory | 项目规则、架构约定、常用命令 |
| Session Memory | 当前会话摘要 |
| Task Memory | 当前任务目标、已尝试方案、阻塞点 |
| Vector Memory | 后期再加，用于语义搜索代码片段 |

### 工具

```text
remember_preference
forget_memory
search_memory
summarize_session
```

### 原则

- 用户可查看
- 用户可删除
- 默认不记录敏感内容
- 每条 memory 标记来源和时间
- 注入前经过 ContextManager 控制 token

## 第七阶段：Skills / Hooks / MCP

**这是从“项目工具”变成“平台”的关键。**

### Skills

```text
.codex-mini/skills/
  python-refactor/
    SKILL.md
    scripts/
  frontend-design/
    SKILL.md
```

`SKILL.md` 可包含：

```yaml
name:
description:
when_to_use:
allowed_tools:
preferred_model:
instructions:
```

### Hooks

```text
before_tool_call
after_tool_call
before_apply_patch
after_apply_patch
on_test_failure
on_session_resume
```

### MCP

```text
mcp/
  config.py
  client.py
  registry_adapter.py
```

### 整合方向

```text
ToolRegistry
├── Built-in tools
├── Skill tools
├── MCP tools
├── IDE tools
└── Git tools
```

### 验收标准

- 能配置一个 MCP server
- MCP tools 和内置 tools 一起暴露给模型
- MCP tool 也走权限策略
- skills 可以被项目级启用

## 第八阶段：LSP / IDE 能力

**LSP 不要太早做，但做了以后很有价值。**

### 先做 Python

```text
lsp/
  diagnostics.py
  symbols.py
  references.py
  hover.py
```

### 优先能力

- 获取语法错误
- 获取诊断
- 找 symbol
- 找引用
- 修改后自动重新诊断
- 把 diagnostics 注入模型上下文

### 工具

```text
get_diagnostics
find_symbol
find_references
```

### Desktop / IDE 结合

- 问题列表
- 点击跳转文件
- 修改后显示错误减少/增加

## 第九阶段：Subagents / Multi-Model / Automation

**这个最后做，别一开始就炫技。**

### Subagents

```text
agent/
  coordinator.py
  worker.py
  sidechain.py
```

### 场景

- 一个 agent 读后端
- 一个 agent 读前端
- 主 agent 汇总方案
- 写入权限仍由主 session 控制

### Multi-model

```text
model_router.py
```

### 策略

| 场景 | 模型选择 |
| --- | --- |
| 简单问答 | 便宜快速模型 |
| 代码解释 | 中等模型 |
| 复杂重构 | 强模型 |
| 总结 compact | 小模型 |
| 安全判断 | 稳定模型 |

### Automation

```text
codex-mini exec "run tests and summarize"
codex-mini watch "每天检查 CI"
```

## 最终优先级

建议按以下顺序实施：

1. **Session / Transcript / Resume**
2. **ContextManager / Auto Compact**
3. **Project Profile / AGENTS.md 注入 / `.gitignore`**
4. **Patch Preview / Diff Review / Apply Patch**
5. **Permission Mode / Sandbox Policy**
6. **Memory 分层**
7. **Skills / Hooks**
8. **MCP**
9. **LSP**
10. **Subagents / Multi-model / Automation**

## 最小可发布版本

如果要定义一个阶段四第一个可发布版本，建议命名：

```text
v0.4.0 Durable Agent Runtime
```

包含以下特性：

- append-only transcript
- session resume
- context compact
- project profile
- diff preview
- permission mode
- Desktop session state 展示

这版做完，Codex-mini 就会从 **“能聊天、能调工具”** 变成 **“可以连续干活、断了能接、改动能审”** 的产品。

## 一句话路线

> **先学 Codex 的产品入口和治理体系，再学 Claude Code 的 transcript/context/memory/runtime 深度。**  
> 不要先追多模型、LSP、Chroma。真正的核心是：  
> **会话可恢复、上下文可控、修改可审查、权限可治理、工具可扩展。**

## 参考

- [OpenAI Codex GitHub](https://github.com/openai/codex)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)
- [Codex IDE Extension](https://developers.openai.com/codex/ide/)
- [claude-code-analysis README](https://github.com/liuup/claude-code-analysis)
- [Session Storage / Resume 分析](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04i-session-storage-resume.md)
- [Context Management 分析](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)

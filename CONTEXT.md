# Project Glossary

## Codex 流量

Codex 流量指本机 Codex App 和 Codex CLI 产生的 token 消耗记录，以及 Codex 本地记录中暴露的 rate-limit 窗口占用。

Do not use this term for network bandwidth, upload/download bytes, or OS-level adapter traffic.

## 桌面码表

桌面码表指一个 Windows 桌面仪表盘，用仪表环、指标卡、分布图和最近会话列表展示 Codex 流量。

## 同步状态

同步状态指桌面码表读取、解析、校准 Codex 流量记录时展示给用户的当前进展。

## 同步进度

同步进度指同步状态中的可量化部分，用于帮助用户判断桌面码表仍在工作而不是卡死。

## 非侵入读取

非侵入读取指桌面码表只短暂读取 Codex 流量记录，不写入、不修改、不锁定 Codex 的本地文件，也不影响 Codex App 或 Codex CLI 正常写入。

## 5 小时窗口

5 小时窗口指 Codex 本地 `token_count` 事件里的 primary rate-limit window.

## 7 天窗口

7 天窗口指 Codex 本地 `token_count` 事件里的 secondary rate-limit window.

## 限额风险

限额风险指用户继续使用 Codex 时，5 小时窗口或 7 天窗口可能被耗尽、接近耗尽或需要等待恢复的风险。

## 限额风险提醒

限额风险提醒指桌面码表在限额风险达到用户关注阈值时给出的提示，包括首页状态提示和 Windows 可用时的系统通知。

Do not use this term for automatic control of Codex App, Codex CLI, or any process interruption.

## 风险阈值

风险阈值指用户可配置的限额风险分级规则，用于决定正常、注意、紧张和耗尽预警等状态何时出现。

Do not hardcode these thresholds as permanent product behavior.

## 项目用量

项目用量指 Codex 流量按本机项目、工作目录或会话所属任务归因后的 token 消耗分布。

## 工作目录

工作目录指 Codex 会话实际发生的本地文件系统路径。

Do not use this term for a Git repository, product project, or user-facing project grouping unless they are intentionally the same.

## 代码库

代码库指通过 Git root、remote URL 或 repository name 识别出的同一个 source repository。

Do not use this term for a single working directory when multiple clones or worktrees may point to the same repository.

## 项目

项目指桌面码表里用于归因、汇总和分摊 Codex 流量的用户可见分组。项目默认可以来自工作目录或代码库识别结果，但应允许用户手动合并、改名或拆分。

Do not assume one project always equals one working directory.

## 项目标签

项目标签指用户在本机为项目或任务添加的筛选标记，用于过滤、分组和查看 Codex 流量、项目用量与分摊成本。

Do not use this term for team permissions, shared taxonomy, cloud sync, or organization-level project management.

## 成本估算

成本估算指桌面码表基于本机 Codex 流量和用户配置的模型单价规则推算出的参考成本。

Do not use this term for official billing totals, invoice amounts, organization-wide spend, or guaranteed OpenAI account charges.

## 成本套餐

成本套餐指用户手动配置的 Codex 使用成本档位，例如 `5x = 780` 或 `20x = 1280`，用于把一个统计周期内的 Codex 流量换算成内部参考成本。

Do not use this term for model name, rate-limit window, OpenAI account plan, or official subscription plan.

## 成本周期

成本周期指当前成本套餐用于计算分摊成本的起止时间范围。成本周期默认由用户自定义，也可以切换为自然月。

## 分摊成本

分摊成本指按项目用量、任务用量或会话用量占比，把当前成本套餐的总成本分配到对应项目、任务或会话上的内部参考成本。

## 任务

任务指用户在桌面码表中用于理解和分摊 Codex 流量的一组工作活动。任务默认可以由单个会话生成，也可以由用户手动合并多个会话形成。

Do not assume one task always equals one Codex session.

## 会话内容预览

会话内容预览指用户打开任务或会话详情时，桌面码表按需读取并展示本机 Codex 会话中的用户 prompt 原文和 assistant 回复原文。

Do not use this term for full-history indexing, homepage content display, remote sync, or rewriting Codex session files.

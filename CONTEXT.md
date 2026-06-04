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

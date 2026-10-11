---
version: alpha
name: "821 刷题"
description: "集中作答的数通备考工具"
colors:
  primary: "#315CEC"
  ink: "#16253C"
  background: "#F3F6FA"
  surface: "#FFFFFF"
  muted: "#596984"
  border: "#D6DFEB"
  success: "#168253"
  danger: "#C03945"
  warning: "#8D5D12"
typography:
  sans:
    fontFamily: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
  mono:
    fontFamily: '"Cascadia Code", Consolas, monospace'
rounded:
  DEFAULT: "7px"
  panel: "12px"
spacing:
  page: "30px"
  panel: "25px"
components:
  button: { minHeight: "44px" }
  option: { minHeight: "64px" }
  dialog: { maxWidth: "700px" }
---

# 821 刷题 Design System

## Overview

### Creative North Star

把网络工程师的端口面板用于答题导航：有序、清楚、有状态。深蓝侧栏与白色题面保持专注，答题卡是唯一密集的状态矩阵。

### Product context and register

- Audience: 用户基础薄弱，3–7 天复习 H12-821；主要任务是独立判断、核对解析、订正错题。
- Evidence: 用户明确选择仅 821；本地 catalog.json 提供 485 道技术题，learning_outline.json 提供 21 章。
- Locale: zh-CN；网络缩写与命令保留原文。日本市场不适用。
- Usage scene: 桌面连续刷题、手机窄屏查看；不展示虚构学习分数。
- Register: product/tool。没有营销首页。
- Signature: 按题序排列的答题状态矩阵，体现真实作答状态。
- Restraint: 题干、选项、解析占视觉中心；不使用装饰图、渐变或卡片网格。
- Anti-references: 销售落地页、排行榜游戏、假数据仪表盘。
- Token ownership/runtime mapping: src/styles.css 的 :root 为运行时唯一 token 源；本文镜像规范值。colors.primary → --color-primary → Button/选中选项/答题位置；其他同名语义色亦经 CSS 变量消费。font-body/font-mono 与 radius-control/radius-panel 由同一处定义。
- Accepted visual reference: design/practice-concept.png，1536×1024。

## Colors

白色题面，冷灰背景，深蓝侧栏，钴蓝操作。成功、错误和人工核对配文字说明，不能只靠颜色。

## Typography

中文正文用系统黑体，题干桌面 24–28px、手机 19px；选项桌面 16–18px、手机 14px；导航和控件明确设字号。等宽字体用于题号与数值。无外部字体加载。

## Layout

桌面 260px 侧栏，主区加 316px 答题卡；主区自然文档滚动。1000px 以下答题卡移至题目下方；700px 以下主导航变为可横向滚动的工具栏，选项保持完整。题目卡是主要容器，其他数据使用开放列表和表格。

## Elevation & Depth

题面和答题卡细边框，无阴影；只有模态和提示使用轻阴影。图片区域保留尺寸并明确加载/失败状态。

## Shapes

控件 7px，题面与答题卡 12px；选项圆形序号强调选择。边框与状态保持一致。

## Components

### Foundational visual states

hover 加深边框，focus-visible 3px 蓝色描边，disabled 降低透明度且禁用事件。已选蓝色、正确绿色、错误红色、人工核对琥珀色并显示文字。加载使用真实状态文本。

### Buttons and actions

components.tsx Button 统一 primary/outline/ghost/danger。查看答案是题面主操作；结束本轮是答题卡次级操作。清空进度只在学习数据页出现，使用 app-owned dialog。

### Navigation and data display

App 主导航持久；答题卡按 30 道分页，保留题序、当前题和状态。21 章数据使用语义表格；章节精讲使用列表加正文。

### Forms and overlays

筛选使用浏览器原生 select，平台弹出菜单的外观与几何可接受。文本域不可拖动改变布局。Modal 使用原生 dialog.showModal 管理焦点、Escape 与背景隔离；所有弹窗共享此 owner。通知使用一个 live-region。

### Iconography

Lucide 2px 线性图标，16–23px；主标识为三节点网络 SVG，38px。所有动作有文本或中文 accessible name。

### Motion

仅 hover 和提示 140–150ms 过渡；prefers-reduced-motion 去掉所有过渡。

### Content and data visualization

保留原题技术内容，不以概念图的缩写文案替换题干。首次打开无虚构成绩；覆盖题数不称“掌握”。图片直接引用原始远程地址，加载失败有重试和原图链接。

## Do's and Don'ts

- Do: 独立作答后才显示答案图与解析。
- Do: 同一操作使用同一标签、控件与反馈。
- Don't: 争议题或无文本答案题计入自动正确率。
- Don't: 用生成的截图代替可操作网页。

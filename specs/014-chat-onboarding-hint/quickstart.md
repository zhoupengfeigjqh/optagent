# 快速验证：聊天页头部对齐与空数据新手引导

**Feature**: `014-chat-onboarding-hint` | **Date**: 2026-10-29

本文件只描述"怎么跑起来、怎么证明它对"。实现细节见 `plan.md`，字段语义见
`contracts/workspace-dir-predefined.md` 与 `contracts/onboarding-hint-ui.md`。

## 1. 前置

- Node ≥ 20、npm 可用；四个子项目依赖已安装。
- `agent-backend/.env.local` 与 `config.yaml` 已配好（模型可用）；`admin-backend/.env.local` 存在。
- 至少一个已部署数字人，其场景包含平台预定义目录「算法规则」+ 至少一个自定义目录（如「生产计划」）。

本地四进程（各占一个终端，均从仓库根目录进入子目录）：

```powershell
cd agent-backend; npm run dev      # :3000
cd frontend;      npm run dev      # :5173
cd admin-backend; npm run dev      # :3001
cd admin-frontend; npm run dev     # :5174/admin/
```

健康检查：

```powershell
curl http://localhost:3000/api/monitor/health
curl http://localhost:3001/api/admin/platform/health
curl -o /dev/null -w '%{http_code}`n' http://localhost:5173/
curl -o /dev/null -w '%{http_code}`n' http://localhost:5174/admin/
```

## 2. 自动化门禁（宿主机本地执行）

```powershell
cd agent-backend; npm run typecheck; npm run lint; npm run test:all; npm run build
cd frontend;      npm run typecheck; npm run lint; npm run test:coverage; npm run build
```

预期：

- 后端新增 `workspace-view` 单测全绿；`files-scenario` 集成断言 `predefined` 通过。
- 前端新增 `empty-data-hint` / `useEmptyDataHint` / `UploadHintBubble` / `McpStatusList` 测试全绿，且存量测试因夹具补字段后仍全绿。
- 新增模块语句覆盖率 ≥ 80%；`lint` / `typecheck` 零错误。

## 3. 手工验收场景

在 http://localhost:5173 操作。以下场景中"空目录"指该二级目录下没有任何文件。

| 编号 | 前置 | 操作 | 预期 |
|---|---|---|---|
| S1 | 数字人 A：数据准备含「算法规则」+「生产计划」，两者均空 | 从数字人 B 切换到 A | 「+」上方出现气泡，文案逐字为「当前您还没有准备数据，请点击 “+” 上传吧。」 |
| S2 | 承接 S1，气泡展示中 | 点击气泡右上角「×」 | 气泡消失；不切换到别处时不再出现 |
| S3 | 承接 S2（已关闭，当前仍是 A） | 打开工作空间、发送一条消息、刷新清单 | 气泡始终不再出现 |
| S4 | 承接 S2 | 切换到同样全空的数字人 C | 针对 C 重新判定，气泡再次出现 |
| S5 | 气泡展示中 | 点击「+」并上传一个文件到「生产计划」 | 上传菜单正常打开；上传成功后气泡自动消失，无需点「×」 |
| S6 | 数字人 D：仅「算法规则」一个目录（无自定义目录） | 切换到 D | 不出现气泡 |
| S7 | 数字人 E：未配置场景（部署时无 scenario） | 切换到 E | 不出现气泡；文件空间报错照旧，不被引导逻辑替换 |

补充边界（快速抽查）：

- 在「算法规则」里上传文件、其余自定义目录仍空 → 气泡**仍然**出现（预定义目录不参与判定）。
- 自定义目录里放一个 0 字节文件 → 气泡**不**出现。
- 切换数字人失败（例如数字人已不可用）→ 提示"不可用"，不弹气泡、不改变当前数字人。

## 4. 头部对齐核验

1. 选中一个配置了 2 个以上 MCP 服务的数字人，打开 http://localhost:5173 。
2. 用 DevTools 量取「切换」按钮左边缘与 MCP 状态首个服务项的左边缘。
3. 预期：两者 X 坐标一致（偏差 ≤ 1px）；1280 / 1440 / 1920 三种宽度下均成立。
4. 把数字人名称换成长名称、MCP 服务增多触发换行，重复第 2~3 步，对齐关系不变，右侧搜索/工作空间按钮位置不变。
5. 未选中数字人时：只显示"请选择数字人"，无 MCP 状态区域、无多余留白。

## 5. 无障碍抽查

- 键盘：Tab 能聚焦气泡「×」；Enter 或 Space 关闭气泡；关闭后焦点不跳到意外位置。
- 读屏：气泡文本与「×」名称可读出（`role="status"` + 可读 `aria-label`）。
- 系统开启"减少动效"：气泡无淡入/位移动画，内容照常显示。

## 6. 接口侧核验（后端）

切换数字人后直接看响应即可（无需额外工具）：

```powershell
curl http://localhost:3000/api/files/workspace
```

预期：`数据准备` 下「算法规则」目录项 `predefined: true`，其余目录与共享/临时空间目录项 `predefined: false`；
其余字段与既有行为一致（`fields`、`upload_extensions`、`files`、`deletable` 不变）。

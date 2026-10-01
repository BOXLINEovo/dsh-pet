# 🐟 dsh-pet — DeepSeek 余额桌面宠物

> 爱吃白饭的蓝色大肥鱼：DSH Web 的桌面宠物插件，实时汇报你的 DeepSeek 余额。

## 功能

- 🐟 页面右下角常驻的蓝色大肥鱼（可**拖拽**、可**翻转**，转向屏幕中心）
- 💬 气泡**随机可爱发言**，实时显示 DeepSeek 账户余额，例如：
  - 「白饭就剩¥110.00了！」
  - 「今天的口粮还有¥110.00，够吃~」
  - 「咕噜…白饭就剩¥110.00了，好想吃！」
- 👆 **点击抚摸** → 爱心动画 + 立即刷新余额
- 🌙 **峰谷时段提示**：自动标注 DeepSeek 错峰优惠时段（北京时间 00:30–08:30 为低谷「白饭打折」，其余为高峰「原价」），并倒计时到下一次切换
- 🍚 「🍚白饭，想吃~」按钮 → 一键跳转 DeepSeek 官方充值页
- 🎨 气泡**主题自适应**（跟随 DSH 亮/暗主题）
- ⏱️ 每 5 分钟自动静默刷新
- 🔝 最高层级，不被任何 UI 覆盖

## 架构

- **节点半**（`src/index.ts`）：通过 webServer 注册 `/dsh-pet/balance` 路由，使用 DSH 凭据服务解析 `DEEPSEEK_API_KEY` 后请求官方余额 API —— **密钥不落地浏览器**。
- **浏览器半**（`src/client/index.ts`）：纯 DOM 实现宠物 UI（无 React 依赖），图片以内联 data URL 打包。

## 安装

```bash
# 从 GitHub 安装
dsh plugin --profile web add git+https://github.com/BOXLINEovo/dsh-pet.git

# 或本地目录（开发模式）
dsh plugin --profile web add /path/to/dsh-pet
```

安装后**重启 DSH Web** 生效。

## 构建

```bash
pnpm install
pnpm build
# 产物：lib/index.js（节点半）+ lib/client.js（浏览器半）
```

## 素材版权

角色图片来源于 **B 站 UP 主「这个刀子真甜」**：

- Bilibili 主页：https://space.bilibili.com/23315338

图片仅作标注使用，**版权归原作者所有**；MIT 许可仅覆盖本插件的代码，不包含图片素材。再分发/商用图片请先取得原作者授权。详见 [NOTICE](./NOTICE)。

## 许可

代码：MIT License，见 [LICENSE](./LICENSE)。

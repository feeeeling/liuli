# 应用图标（液态玻璃）

定稿前景：**L2 双层括号弧**（透明 PNG，供 Icon Composer 当前景层）。

## 资源

| 文件 | 用途 |
| --- | --- |
| `app/Resources/AppIcon-foreground-L2-1024.png` | Icon Composer 前景母版 |
| `docs/assets/icon.png` | README 展示用（可与前景同图或加浅色底板预览） |
| `app/Resources/AppIcon-1024.png` | 非液态玻璃回退用的整图标（旧磨砂底板 + 双弧，可选） |

## macOS 液态玻璃流程

1. 打开 **Icon Composer**（Xcode / 开发者工具）。
2. 新建 macOS App Icon；**底板**使用系统 Liquid Glass / 默认玻璃层，不要自己烤一张磨砂方板。
3. 将 `AppIcon-foreground-L2-1024.png` 作为 **前景层** 导入，居中，留足边距。
4. 导出分层图标资源，放进 `Liuli.app` / Asset Catalog。
5. `scripts/bundle.sh` 在有 `iconutil` 时仍可为旧式 `.icns` 打回退包。

> 预渲染整图「假玻璃」无法获得系统真实折射；必须前景透明 + Composer 分层。

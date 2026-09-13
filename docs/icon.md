# 应用图标（玻璃叶子）

定稿前景：一片透明玻璃叶子，给 Icon Composer 当前景层。系统在 macOS 26 上叠液态玻璃底板；旧系统用合成后的 `.icns`。

## 资源

| 文件 | 用途 |
| --- | --- |
| `app/Resources/AppIcon-foreground-leaf-1024.png` | Icon Composer 前景（真 alpha，无方板、无投影） |
| `app/Resources/AppIcon-1024.png` | 旧系统 / `.icns` 回退（浅色圆角底板 + 叶子） |
| `app/Resources/MenuBarLeaf.png` | 菜单栏 template（黑剪影） |
| `docs/assets/icon.png` | README 预览 |

## macOS 液态玻璃流程

1. 打开 **Icon Composer**（Xcode / 开发者工具）。
2. 新建 macOS App Icon；**底板**用系统 Liquid Glass，不要自己烤磨砂方板。
3. 将 `AppIcon-foreground-leaf-1024.png` 作为前景层导入，居中，留边距。
4. 导出分层 `.icon` 后可再放进 bundle；当前打包仍用 `scripts/embed-icons.sh` 生成 `AppIcon.icns`。

预渲染整图无法获得系统折射；Tahoe 上应以透明叶子 + Composer 分层为准。

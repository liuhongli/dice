# 骰子派对 · 微信小程序

这是微信原生小程序项目，使用 WXML、WXSS 和微信 API，无需后端，也不依赖 GitHub Pages 网页。

支持 1–6 颗骰子、约两秒翻滚动画、以顶面为准的点数、总和、撒花、可关闭的音效、最近八次记录，以及单张照片铺满六面或分别设置六个面的背景。照片压缩后保存到当前设备的小程序私有目录，不会上传。

## 导入预览

1. 从[微信官方页面](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)安装微信开发者工具，使用微信扫码登录。
2. 选择“导入项目”，项目目录选择整个 `dice` 仓库根目录，也就是包含 `project.config.json` 的目录，不是当前 `miniprogram` 子目录。
3. 已有小程序 AppID 时，填入自己的 AppID。仓库中的 `touristappid` 是开发预览占位值；开发者工具是否允许测试号及可用接口，以工具提示为准。
4. 选择“小程序”项目，使用稳定版基础库，至少 2.32.3。点击“编译”。原生项目不需要执行“构建 npm”。
5. 使用真实 AppID 后，点击“预览”，用有权限的微信账号扫码检查实际手机效果。

开发基础库使用开发者工具中可用的较新稳定版。

## 发布前完成的配置

- 注册并管理自己的[微信小程序账号](https://mp.weixin.qq.com/)，在开发者工具填写该账号的 AppID。
- 在小程序后台配置《用户隐私保护指引》：选择照片的用途是设置骰子背景，处理和保存均在当前设备上，不会传输至服务器。项目已接入微信官方隐私授权按钮及相册选择流程。
- 在真机上检查投掷动画、音效开关、选图与取消授权、六面更换、后台切换以及再次打开后的照片恢复。不同微信系统的 3D 渲染和音频行为需要通过真机确认。
- 完成平台要求的账号信息、类目和备案，使用开发者工具“上传”，然后在微信后台提交审核并发布。

没有 AppID 时可以准备与检查代码，但不能替代账号拥有者完成真机发布、后台配置或微信审核。这个仓库的 GitHub Actions 仍然只发布网页版，不会自动发布小程序。

## 数据与实现

- 点数优先使用 `wx.getUserCryptoManager().getRandomValues()` 并拒绝取模偏差；缺少该 API 的旧环境使用普通随机数，仅用于亲子桌游。
- 顶面映射与网页版相同，六组旋转均有自动测试。
- 选择照片使用 `wx.chooseMedia`，来源限定为相册。单张最大 20 MB，保存前压缩至长边不超过 640 像素。
- 图片设置写入成功后才清理被替换的旧图片。准备一批照片失败时保留原设置。
- “原色骰子”仅切换外观；“恢复原色并清除照片”会删除小程序保存的照片副本，不影响系统相册原图。
- 程序进入后台时取消未完成的投掷并停止声音，避免回来后出现不明结果。

项目根目录执行 `npm test` 运行网页及小程序逻辑测试。音效为项目内生成的短 WAV 文件，不需要网络媒体或外部授权素材。

## 官方 API 参考

- [选择照片](https://developers.weixin.qq.com/miniprogram/dev/api/media/video/wx.chooseMedia.html)
- [随机数](https://developers.weixin.qq.com/miniprogram/dev/api/base/crypto/UserCryptoManager.getRandomValues.html)
- [隐私授权](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html)
- [隐私授权事件](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.onNeedPrivacyAuthorization.html)

# vrcnext-plugin-system

A plugin runtime for [VRCNext](https://github.com/shinyflvre/VRCNext) that never touches VRCNext: the host, the typed `@vrcnext/plugin-api`, and the installer.

**Documentation:** <https://vrcnext-plugins.github.io/> · internals: <https://vrcnext-plugins.github.io/plugin-system.html>

```bash
# install (Linux / macOS); Windows and details: https://vrcnext-plugins.github.io/install.html
curl -fsSL https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.sh | bash

# develop
git submodule update --init && npm ci && npm run check
```

Part of [VRCNext Plugins](https://vrcnext-plugins.github.io/). Released into the public domain under the [Unlicense](LICENSE).

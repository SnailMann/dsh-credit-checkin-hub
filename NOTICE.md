This plugin is an independent project for DeepSeek Harness, Trae CN, WorkBuddy, Qoder CN, and MiniMax Code.

`src/trae-vault.js` and the authenticated envelope decoder in `src/credentials.js`
adapt portions of https://github.com/yembors64632/dsh-connect (MIT),
Copyright (c) 2026 yembors64632. Its complete license is in THIRD-PARTY-LICENSE.

Check-in request formats were cross-checked against the installed Trae CN and
WorkBuddy desktop clients on 2026-10-16. These are client interfaces, not a
published, stable third-party check-in API.

Qoder CN campaign request shapes reference dsh-connect and
https://docs.qoder.cn/events/100credits. Version 0.5.0 removes native desktop
credential decryption and Keychain access. The independent browser device flow,
PKCE parameters, identity endpoint and refresh protocol were cross-checked against
the official @qodercn-ai/qoderclicn npm package 1.1.72 (Apache-2.0).
Its license is included as QODER-LICENSE. The package was inspected, not executed.
A real Qoder daily claim of 100 Credits was verified on 2026-10-17 after user login; the bundled UI screenshot still contains simulated records.

MiniMax Code public gateway attribution, OAuth device flow, local auth discovery,
and sign-in response validation in `src/minimax.js` adapt the official MIT source
https://github.com/MiniMax-AI/minimax-code (version 0.6.5, inspected 2026-10-16).
Its complete license is in MINIMAX-LICENSE. The official device authorization
endpoint was verified; live credit receipt requires user authorization and has
not been verified. MiniMax points already include bonus_points.

Version 0.5.1 uses the public desktop authentication client identifier and client
type from the installed Qoder CN 0.4.8 product profile. Daily credits are documented
as a desktop-only campaign. Campaign matching also reads multilingual popup
placement titles and excludes unrelated credit gifts.

Version 0.5.1 also invokes the user-installed official macOS Qoder CN
`Contents/Resources/umid/runtime-info` helper with environment 0 and account on
stdin, as the desktop client does, to obtain device identity for campaign
requests. The helper is not copied or redistributed. Device fields are cached
in memory only; login vaults and Keychain are not accessed. The missing device
identity, rather than OAuth client ID alone, was confirmed as the cause of the
missing daily campaign in this case.

Version 0.6.0 adds the global Qoder region with an independent browser session,
fixed openapi.qoder.sh API origin, qoder.com authorization origin and
qoder-app:// redirect. Public authentication constants and UMID environment 3
were checked against the official Qoder 0.4.11 macOS arm64 installer from the
vendor download page. Its inner Qoder application ZIP SHA-256 was verified
against installer-manifest.json. The native device helper is not redistributed
in this npm package. A user-installed helper may be discovered in the plugin's
private data directory; source URL and hashes are retained beside that helper.
Global live login was verified; actual credit receipt remains unverified due
to the official SDK's initialization timeout on the verification machine.

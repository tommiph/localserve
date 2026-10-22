# QR encoder

Localserve bundles the unmodified compiled JavaScript from Project Nayuki's
[QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library).
It is used only to create Phone Home handoff codes in the administrator.
No network request is needed to encode or display a code.

- Source: https://www.nayuki.io/res/qr-code-generator-library/qrcodegen.js
- License: MIT; the complete notice is retained at the top of qrcodegen.js.
- SHA-256: `2511bc17f40a3c41d4a0578995db956b38997334d3d20113a5d4dc5c49c69480`

Codes contain the bound private HTTP origin and `/home` only. They contain no
administrator token, credentials or saved content. A four-module white quiet
zone and black modules are retained independently of the administrator theme.

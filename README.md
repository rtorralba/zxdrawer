ZXDrawer
======

**ZXDrawer** is a modern, feature-rich pixel art editor specifically designed for the **ZX Spectrum**. Built as a cross-platform desktop application using Electron, it provides a streamlined workflow for retro game developers and pixel artists who want to create graphics while strictly respecting the hardware constraints of the Sinclair machine.

Key Features
------------
- **Spectrum-Native Workflow**: Edit graphics with full support for 8x8 attribute blocks (Ink, Paper, Bright, Flash).
- **Attribute Locking**: A unique feature that allows you to paint pixels without altering the existing attribute colors on the canvas.
- **Professional Sprites & Tiles**: Tools for creating spritesets and tilesets with specific support for popular engines.
- **Transparency Masks**: Generate silhouette masks automatically or edit them manually with a dedicated overlay editor.
- **Animation Preview**: Real-time preview panel for multi-frame animations.
- **Image Conversion**: Import and convert standard images into Spectrum-compatible graphics with adjustable contrast, brightness, and saturation.
- **Advanced Exporting**: Support for multiple formats including ASM, BIN, and specialized exporters for **Boriel Basic** (PutChars and GuSprites).
- **Smart Interface**: Centered zoom, grid toggles (8x8 and 1x1), and a consistent dark-themed UI.
- **Multilingual Support**: Available in English, Español, and Português.

Supported Formats
-----------------
- **.zxp**: Native project format that preserves application-specific metadata.
- **.scr**: Standard ZX Spectrum binary screen files (6912 bytes).
- **.bas**: Export and recovery support for Boriel Basic putchars declarations.

License
-------
This project is licensed under the GNU Affero General Public License v3 (AGPLv3).
See the `LICENSE` file for the full terms.

Copyright
---------
© 2026 Raül Torralba Adsuara

Privacy Policy
--------------
ZXDrawer does not collect, store, or transmit any personal data or usage information. All files created or edited remain local to your device.

Quick start
-----------
Requirements:
- Node.js 16+ (or compatible)
- npm

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm start
```

Build (bundle + obfuscate + package):

```bash
npm run build
```

Supporters
----------
Special thanks to the project supporters:

- [Ariel Endaraues](https://endaraues.itch.io/)
- [El SPECTRUMERO Javi Ortiz](https://www.youtube.com/@ElSpectrumeroJaviOrtiz)
- [Mananuk](https://mananuk.itch.io/)
- [Andrés Hirunatan](https://xarxa.cloud/@hirunatan)
- DennisKenny
- Oldsoft

Contributing
------------
Contributions are welcome under the terms of the AGPLv3. Please open issues or PRs on the repository.

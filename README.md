# 🌾 Harvest Tag

**Tap your jar. Know your harvest.**

NFC jar labels for the home & garden. Write what's in your jar with a tap — or just speak it.

## Project Structure

```
harvest-tag/
├── app/                  # PWA — the app itself (open in browser, install to home screen)
│   ├── index.html        # Main app — write, read, history, voice input
│   ├── manifest.json     # PWA manifest for installability
│   ├── sw.js             # Service worker for offline support
│   ├── icon-192.svg      # App icon (192px)
│   └── icon-512.svg      # App icon (512px)
├── landing/              # Product website (harvesttag.com)
│   └── index.html        # Landing page — product, pricing, FAQ
├── sticker-card/         # Printable packaging card for sticker tags
│   └── index.html        # 10cm × 15cm card with 6 NFC tag cutouts
└── capacitor/            # Native Android APK wrapper (for future builds)
    ├── package.json
    ├── capacitor.config.ts
    ├── src/nfc.ts        # TypeScript NFC plugin interface
    └── nfc-plugin/       # Custom native Android NFC plugin
        └── android/src/main/java/com/harvesttag/nfc/NFCPlugin.java
```

## How to Use

### Option 1: PWA (Works Now)

1. Open `app/index.html` in Chrome on Android or Safari on iOS
2. On Android: tap the browser menu → "Add to Home Screen" for the full app experience
3. Tap the 🎤 mic button and speak what's in your jar, or type it
4. Tap phone to an NFC tag to write the data
5. Later, tap any tagged jar — contents pop up automatically

**NFC Support:**
- **Android (Chrome)**: Web NFC API — full read/write support
- **iOS (Safari)**: Reading works natively (iPhone reads NFC tags without any app). Writing requires the native app (ad-hoc distribution).
- **Desktop**: Type mode only — good for testing and managing jar history

### Option 2: Native Android APK (Requires Build)

The Capacitor project wraps the PWA with a native Android NFC plugin for more reliable NFC access. See "Building the APK" below.

## Building the Android APK

Prerequisites (need a machine with Android SDK):
- Java 17+
- Android SDK (API 34+)
- Node.js 18+

```bash
cd capacitor/
npm install
npx cap init
npx cap add android
# Copy the NFC plugin to the android project
cp -r nfc-plugin/android/* android/
npx cap sync
npx cap open android   # Opens Android Studio — build from there
# Or build from CLI:
cd android && ./gradlew assembleDebug
```

The APK will be at: `capacitor/android/app/build/outputs/apk/debug/app-debug.apk`

## iOS Distribution

iOS is trickier — Apple doesn't allow sideloading. Options:

1. **Ad-hoc OTA** ($99 Apple Developer account): Sign the app, host it on your site for direct download. Up to ~100 registered device UDIDs.
2. **App Store** (later): Submit once the product is validated.
3. **PWA fallback**: iOS users read tags natively (iPhone reads NFC out of the box). The PWA lets them type/speak contents and manage history, even if they can't write tags without the native app.

## Product Pricing

| Pack | Tags | Price | Per Tag |
|------|------|-------|---------|
| Starter | 10 | $5 | $0.50 |
| Garden | 30 | $12 | $0.40 |
| Bumper Crop | 100 | $30 | $0.30 |

**Premium art tags**: Custom printed NFC tags with decorative designs — ~$1/tag (premium tier).

## Features

- 🎤 **Voice input** — speak jar contents, app parses automatically
- 📱 **Tap to read** — no app needed for reading (iPhone native support)
- 🔄 **Reusable** — wipe and rewrite thousands of times
- 🔌 **Works offline** — data lives on the NFC sticker, not the cloud
- 🧼 **Dishwasher safe** — survive wash cycles
- 📋 **Jar history** — searchable log of every jar you've tagged
- 📤 **Export** — download jar history as CSV

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (PWA)
- **NFC**: Web NFC API (Android Chrome) + Custom Capacitor plugin (native Android)
- **Voice**: Web Speech API
- **Storage**: localStorage (no accounts, no servers)
- **Native wrapper**: Capacitor 8 (optional — for Android APK build)

## Notes

- NFC tags used: NTAG216 (888 bytes writable memory, ~$0.10 each in bulk)
- Tags attach to jar lids (metal lids OK — NFC can read through thin plastic/metal
- The app collects zero data. Everything stays on your phone and your tags.
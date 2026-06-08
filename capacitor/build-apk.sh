#!/usr/bin/env bash
set -euo pipefail

# ==============================================
# Harvest Tag — One-Shot APK Build & Deploy
# ==============================================
# This is THE single source of truth for building.
# Edit source in: ../app/index.html  (webDir)
# Run this from:  capacitor/
# ==============================================

echo "=== 1. Copy web assets to Android project ==="
npx cap copy android

echo ""
echo "=== 2. Build APK ==="
export ANDROID_HOME=$HOME/android-sdk
export JAVA_HOME=$HOME/jdk21
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
cd android
./gradlew assembleDebug
cd ..

echo ""
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
APK_SIZE=$(stat --format=%s "$APK_PATH")
echo "=== 3. APK built: $APK_PATH ($(( APK_SIZE / 1024 )) KB) ==="
sha256sum "$APK_PATH"

echo ""
echo "=== 4. Upload to VPS ==="
scp -i ~/.ssh/agent_deck_vps "$APK_PATH" root@129.121.78.85:/var/www/harvesttag/app/HarvestTag.apk
REMOTE_HASH=$(ssh -i ~/.ssh/agent_deck_vps root@129.121.78.85 "sha256sum /var/www/harvesttag/app/HarvestTag.apk" | cut -d' ' -f1)
LOCAL_HASH=$(sha256sum "$APK_PATH" | cut -d' ' -f1)

echo ""
echo "=== 5. Verify ==="
echo "Local:  $LOCAL_HASH"
echo "Remote: $REMOTE_HASH"
if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
  echo "MATCH — upload successful"
  echo ""
  echo "Download URL: https://harvesttag.com/app/HarvestTag.apk"
else
  echo "MISMATCH — upload may have failed"
  exit 1
fi

echo ""
echo "=== DONE ==="
echo "Install instructions for Brad:"
echo "1. UNINSTALL the old Harvest Tag app from your phone"
echo "2. Reboot your phone"
echo "3. Open https://harvesttag.com/app/HarvestTag.apk in Chrome on your phone"
echo "4. Accept the install prompt"
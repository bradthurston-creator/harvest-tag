
// === STATE ===
let history = JSON.parse(localStorage.getItem('harvestTagHistory') || '[]');
const nfcInBrowser = 'NDEFReader' in window;
const getCapacitorPlugin = (name) => (window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null);
const getNfcPlugin = () => getCapacitorPlugin('CapacitorNfc');
const hasNativeNfc = () => !!getNfcPlugin();
const hasNfcSupport = () => hasNativeNfc() || nfcInBrowser;
const getSpeechPlugin = () => getCapacitorPlugin('SpeechRecognition');
const hasCapacitorSpeech = () => !!getSpeechPlugin();
let nfcReading = false;
const MAX_JAR_LENGTH = 120;
const MAX_NFC_BYTES = 240; // Generous payload budget; NTAG213+ handles ~240 bytes comfortably
const NFC_LANGUAGE_CODE = 'en';

function buildTextPayload(text) {
  const encoder = new TextEncoder();
  const langBytes = encoder.encode(NFC_LANGUAGE_CODE);
  const textBytes = encoder.encode(text);
  const payload = new Uint8Array(1 + langBytes.length + textBytes.length);
  payload[0] = langBytes.length & 0x3f; // status byte, UTF-8 encoding
  payload.set(langBytes, 1);
  payload.set(textBytes, 1 + langBytes.length);
  return payload;
}

function decodeTextPayload(payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.length === 0) return '';
  const langLength = bytes[0] & 0x3f;
  const textBytes = bytes.slice(1 + langLength);
  try {
    return new TextDecoder('utf-8').decode(textBytes);
  } catch {
    return new TextDecoder().decode(textBytes);
  }
}



// === DOM REFS ===
const $ = id => document.getElementById(id);
const writePanel = $('panel-write');
const readPanel = $('panel-read');
const historyPanel = $('panel-history');
const tabs = document.querySelectorAll('.tab');
const voiceBtn = $('voiceBtn');
const voiceStatus = $('voiceStatus');
const jarName = $('jarName');
const jarDate = $('jarDate');
const writeBtn = $('writeBtn');
const writeResult = $('writeResult');
const readBtn = $('readBtn');
const readResult = $('readResult');
const readIcon = $('readIcon');
const readLabel = $('readLabel');
const historyList = $('historyList');
const historySearch = $('historySearch');
const recentJarsCard = $('recentJarsCard');
const recentWriteList = $('recentWriteList');
const lastScannedCard = $('lastScannedCard');
const lastScannedContent = $('lastScannedContent');
const toast = $('toast');
const nfcSupport = $('nfcSupport');
const installBanner = $('installBanner');
const debugCard = $('debugCard');
const debugLog = $('debugLog');
const clearDebugBtn = $('clearDebugBtn');
let debugVisible = false;
const debugLines = [];
const MAX_DEBUG_LINES = 30;

function appendDebugLine(line) {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
  debugLines.push(stamped);
  if (debugLines.length > MAX_DEBUG_LINES) debugLines.shift();
  debugLog.textContent = debugLines.join('\n');
  if (!debugVisible) {
    debugVisible = true;
    debugCard.style.display = 'block';
  }
}

clearDebugBtn?.addEventListener('click', () => {
  debugLines.length = 0;
  debugLog.textContent = '';
  debugCard.style.display = 'none';
  debugVisible = false;
});
appendDebugLine('📄 App loaded, ready.');
appendDebugLine(`🌐 hasNativeNfc: ${hasNativeNfc()}`);
appendDebugLine(`🌐 hasWebNfc: ${nfcInBrowser}`);
appendDebugLine(`🌐 hasCapacitorSpeech: ${hasCapacitorSpeech()}`);

// === SET DEFAULT DATE ===
jarDate.value = new Date().toISOString().split('T')[0];

// === TABS ===
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    $('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'history') renderHistory();
  });
});

// === VOICE INPUT ===
let recognition = null;
let isListening = false;
let speechListenerHandles = [];
let latestSpeechTranscript = '';

const useCapacitorSpeech = hasCapacitorSpeech();
const speechPlugin = useCapacitorSpeech ? getSpeechPlugin() : null;

if (!useCapacitorSpeech && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
  const WebkitSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new WebkitSpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    voiceStatus.textContent = '✅ Got it!';
    voiceStatus.className = 'status-bar success';
    voiceBtn.classList.remove('listening');
    isListening = false;
    
    parseVoiceInput(transcript);
  };
  
  recognition.onerror = (e) => {
    voiceStatus.textContent = `❌ Voice error: ${e.error}. Try typing instead.`;
    voiceStatus.className = 'status-bar error';
    voiceBtn.classList.remove('listening');
    isListening = false;
  };
  
  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
    isListening = false;
    if (voiceStatus.className === 'status-bar') {
      voiceStatus.textContent = 'Tap the mic to speak';
    }
  };
}

voiceBtn.addEventListener('click', async () => {
  if (useCapacitorSpeech) {
    await handleCapacitorSpeech();
  } else {
    await handleWebSpeech();
  }
});

async function ensureSpeechPermission() {
  if (!speechPlugin) return false;
  const current = await speechPlugin.checkPermissions();
  if ((current?.speechRecognition || '').toLowerCase() === 'granted') return true;
  const requested = await speechPlugin.requestPermissions();
  return (requested?.speechRecognition || '').toLowerCase() === 'granted';
}

async function handleCapacitorSpeech() {
  if (!speechPlugin) return;
  if (isListening) {
    await speechPlugin.stop();
    cleanupSpeech();
    return;
  }

  try {
    const { available } = await speechPlugin.available();
    if (!available) {
      voiceStatus.textContent = '❌ Speech recognition not available on this device.';
      voiceStatus.className = 'status-bar error';
      return;
    }

    const granted = await ensureSpeechPermission();
    if (!granted) {
      voiceStatus.textContent = '❌ Microphone permission denied. Go to Settings → Apps → Harvest Tag → Permissions → enable Microphone.';
      voiceStatus.className = 'status-bar error';
      return;
    }

    cleanupSpeech();
    speechListenerHandles.push(await speechPlugin.addListener('partialResults', event => {
      const transcript = event.matches && event.matches[0];
      if (!transcript) return;
      latestSpeechTranscript = transcript;
      voiceStatus.textContent = '✅ Got it!';
      voiceStatus.className = 'status-bar success';
      parseVoiceInput(transcript);
    }));

    speechListenerHandles.push(await speechPlugin.addListener('error', event => {
      voiceStatus.textContent = `❌ Voice error: ${event.message || event.code || 'Unknown error'}`;
      voiceStatus.className = 'status-bar error';
      cleanupSpeech();
    }));

    speechListenerHandles.push(await speechPlugin.addListener('readyForNextSession', () => {
      cleanupSpeech();
    }));

    await speechPlugin.start({
      language: 'en-US',
      partialResults: true,
      displayPopup: false,
      popup: false,
      addPunctuation: true,
      maxResults: 3,
    });

    latestSpeechTranscript = '';
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceStatus.textContent = '🎤 Listening... speak now';
    voiceStatus.className = 'status-bar';
  } catch (err) {
    cleanupSpeech();
    voiceStatus.textContent = `❌ Voice error: ${err.message || 'Unknown error'}. Try typing instead.`;
    voiceStatus.className = 'status-bar error';
  }
}

async function handleWebSpeech() {
  if (!recognition) {
    voiceStatus.textContent = '❌ Voice input not available in this browser. Try Chrome on Android or Safari on iOS.';
    voiceStatus.className = 'status-bar error';
    return;
  }
  if (isListening) {
    recognition.stop();
    return;
  }
  
  try {
    recognition.start();
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceStatus.textContent = '🎤 Listening... speak now';
    voiceStatus.className = 'status-bar';
  } catch(e) {
    voiceStatus.textContent = `❌ Speech error: ${e.message || 'Unknown error'}. Try typing instead.`;
    voiceStatus.className = 'status-bar error';
  }
}

function cleanupSpeech() {
  isListening = false;
  voiceBtn.classList.remove('listening');
  speechListenerHandles.forEach(h => h.remove());
  speechListenerHandles = [];
  speechPlugin?.stop?.().catch(() => {});
}


function parseVoiceInput(text) {
  // Try to extract date mentions
  const today = new Date();
  let dateStr = jarDate.value;
  
  // Look for dates like "June 2nd 2026", "today", "yesterday"
  const datePatterns = [
    { re: /(today|tonight)/i, offset: 0 },
    { re: /(yesterday)/i, offset: -1 },
    { re: /(tomorrow)/i, offset: 1 },
    { re: /(last\s+night)/i, offset: -1 },
  ];
  
  for (const dp of datePatterns) {
    if (dp.re.test(text)) {
      const d = new Date(today);
      d.setDate(d.getDate() + dp.offset);
      dateStr = d.toISOString().split('T')[0];
      break;
    }
  }
  
  // Try to parse "June 2, 2026" or "6/2/26" style dates
  const dateMatch = text.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (!dateMatch) {
    // Try "June 2nd 2026"
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const namedDate = text.toLowerCase().match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i);
    if (namedDate) {
      const month = monthNames.indexOf(namedDate[1].toLowerCase());
      const day = parseInt(namedDate[2]);
      const year = namedDate[3] ? parseInt(namedDate[3]) : today.getFullYear();
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) dateStr = d.toISOString().split('T')[0];
    }
  }
  
  // Clean the text: remove date parts to get the jar contents
  let clean = text
    .replace(/(today|tonight|yesterday|tomorrow|last\s+night)/gi, '')
    .replace(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}/gi, '')
    .replace(/\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/g, '')
    .replace(/^(made|put|jarred|canned|preserved|packed|stored|saved)\s+/i, '')
    .replace(/\s+/g, ' ').trim();
  
  jarName.value = clean.charAt(0).toUpperCase() + clean.slice(1);
  jarName.dispatchEvent(new Event('input'));
  jarDate.value = dateStr;
  validateWriteForm();
}

// === VALIDATE WRITE FORM ===
function validateWriteForm() {
  const trimmed = jarName.value.trim();
  writeBtn.disabled = !trimmed;
  $('jarNameCounter').textContent = `${trimmed.length} / 120`;
}
jarName.addEventListener('input', validateWriteForm);
jarDate.addEventListener('input', validateWriteForm);
validateWriteForm();

// === NFC WRITE ===
async function writeToTag() {
  if (!jarName.value.trim()) return;
  
  writeBtn.disabled = true;
  writeBtn.textContent = '⏳ Hold near tag...';
  writeResult.style.display = 'block';
  writeResult.className = 'status-bar';
  writeResult.textContent = 'Hold your phone near the Harvest Tag sticker...';
  
    const name = jarName.value.trim().slice(0, MAX_JAR_LENGTH);
  jarName.value = name;
  const content = `🥫 ${name}\n📅 ${jarDate.value}`;
  
  try {
    const nfcPlugin = getNfcPlugin();

    if (nfcPlugin) {
      // Use Capacitor native NFC plugin
      const nfc = nfcPlugin;
      const payload = buildTextPayload(content);
 
      if (payload.length > MAX_NFC_BYTES) {
        throw new Error(`Message is too long (${payload.length} bytes). Shorten the jar description.`);
      }
      
      appendDebugLine('🛰️ Native NFC plugin detected. Starting write...');
      appendDebugLine(`   payload bytes: ${payload.length}`);
      appendDebugLine('   waiting for tag discovery...');

      cleanupSpeech();

      const removeTagListener = await nfc.addListener('ndefDiscovered', async (event) => {
        appendDebugLine('📡 ndefDiscovered fired');
        try {
          const tag = event?.tag;
          appendDebugLine(`   tag techTypes: ${JSON.stringify(tag?.techTypes || [])}`);
          if (!tag || !tag.techTypes || !tag.techTypes.includes('android.nfc.tech.Ndef')) {
            throw new Error('Tag is not NDEF formatted. Use the NFC Tools app to format as NDEF first.');
          }

          const messagePayload = Array.from(payload);
          appendDebugLine(`   writing ${messagePayload.length} bytes via native plugin`);

          await nfc.write({
            records: [{
              tnf: 1,
              type: [0x54],
              id: [],
              payload: messagePayload,
              languageCode: NFC_LANGUAGE_CODE,
              encoding: 'utf-8'
            }]
          });
          appendDebugLine('   write() resolved without throwing');

          const data = decodeTextPayload(payload);
          const parsedName = data.split('\n').find(line => line.startsWith('🥫'))?.replace('🥫 ', '') || jarName.value.trim();
          addToHistory(parsedName, jarDate.value);
          writeResult.className = 'status-bar success';
          writeResult.textContent = `✅ Written! Tap your phone to the jar to read "${parsedName}"`;

          setTimeout(() => {
            jarName.value = '';
            jarDate.value = new Date().toISOString().split('T')[0];
            validateWriteForm();
          }, 2000);
        } catch (error) {
          appendDebugLine(`❗ write failed: ${error.message || error}`);
          writeResult.className = 'status-bar error';
          writeResult.textContent = `❌ Write failed: ${error.message || 'Unknown error'}`;
        } finally {
          appendDebugLine('↩️ Stopping scan session');
          await nfc.stopScanning();
          writeBtn.disabled = false;
          writeBtn.textContent = '📱 Write to Tag';
          removeTagListener.remove();
        }
      });

      await nfc.startScanning({ invalidateAfterFirstRead: true });
      appendDebugLine('   startScanning() resolved');
      if (nfc.enableReaderMode) {
        appendDebugLine('   enableReaderMode() available — enabling');
        await nfc.enableReaderMode();
      }
    } else if (hasNfcSupport()) {
      appendDebugLine('🌐 Falling back to Web NFC (NDEFReader)');
      const ndef = new NDEFReader();

      await ndef.write({
        records: [{
          recordType: "text",
          data: content
        }]
      });
      
      // Save to history
      addToHistory(jarName.value.trim(), jarDate.value);
      
      writeResult.className = 'status-bar success';
      writeResult.textContent = `✅ Written! Tap your phone to the jar to read "${jarName.value.trim()}"`;
      
      // Reset
      setTimeout(() => {
        jarName.value = '';
        jarDate.value = new Date().toISOString().split('T')[0];
        validateWriteForm();
      }, 2000);
    } else {
      appendDebugLine('⚠️ No NFC support detected on this device');
      // No NFC   show the data to copy (render via DOM nodes to avoid innerHTML injection)
      writeResult.className = 'status-bar success';
      writeResult.textContent = '  Saved! NFC not available in this browser. Data ready to write:';
      const codeBlock = document.createElement('code');
      codeBlock.style.cssText = 'background:#f0ebe4;padding:4px 8px;border-radius:4px;display:block;margin-top:6px;font-size:12px;';
      codeBlock.textContent = content;
      writeResult.appendChild(document.createElement('br'));
      writeResult.appendChild(codeBlock);
      
      // Still save to history so they can track it
      addToHistory(jarName.value.trim(), jarDate.value);

  } catch(err) {
    appendDebugLine(`❌ Unhandled error: ${err.message || err}`);
    writeResult.className = 'status-bar error';
    writeResult.textContent = `❌ Write failed: ${err.message || 'Unknown error'}`;
  }
 
  writeBtn.disabled = false;
  writeBtn.textContent = '📱 Write to Tag';
  renderRecentJars();
}



writeBtn.addEventListener('click', writeToTag);

// === NFC READ ===
async function startReading() {
  appendDebugLine('🛰️ Read button tapped');
  if (!hasNfcSupport()) {
    appendDebugLine('⚠️ Read aborted: no NFC support');
    readResult.style.display = 'block';
    readResult.className = 'status-bar error';
    readResult.textContent = '❌ NFC reading not available in this browser. Use an Android device with Chrome.';
    return;
  }
  
  try {
    appendDebugLine('   Starting read scan...');
    readBtn.disabled = true;
    readBtn.textContent = '⏳ Scanning...';
    readResult.style.display = 'block';
    readResult.className = 'status-bar';
    readResult.textContent = 'Hold near a tagged jar...';
    readIcon.textContent = '📱';
    readIcon.className = 'nfc-icon nfc-pulse';
    readLabel.textContent = 'Scanning...';
    appendDebugLine('   UI ready, awaiting read events');

    const nfcPlugin = getNfcPlugin();

    if (nfcPlugin) {
      // Use Capacitor native NFC plugin
      const nfc = nfcPlugin;
      appendDebugLine('   Native plugin available for read');
      
      // Listen for discovered tag (before startScanning to avoid race)
      nfc.addListener('ndefDiscovered', (event) => {
        appendDebugLine('   ndefDiscovered (read) fired');
        const tag = event.tag;
        appendDebugLine(`      techTypes: ${JSON.stringify(tag?.techTypes || [])}`);
        let text = '';
        const tag = event.tag;
        let text = '';
        if (tag.ndefMessage) {
          for (const record of tag.ndefMessage) {
            if (record.tnf === 1 && record.type[0] === 0x54) {
              // Text record - decode payload
              const decoder = new TextDecoder('utf-8');
              text += decoder.decode(new Uint8Array(record.payload));
            }
          }
        }
        handleReadResult(text || 'Tag read (empty)');
      });

      // Also listen for raw tag discovery
      nfc.addListener('tagDiscovered', (event) => {
        const tag = event.tag;
        let text = '';
        if (tag.ndefMessage) {
          for (const record of tag.ndefMessage) {
            if (record.tnf === 1 && record.type[0] === 0x54) {
              const decoder = new TextDecoder('utf-8');
              text += decoder.decode(new Uint8Array(record.payload));
            }
          }
        }
        handleReadResult(text || 'Tag read (empty)');
      });

      function handleReadResult(text) {
        appendDebugLine(`      decoded text: ${JSON.stringify(text)}`);
        readIcon.textContent = '✅';
        readIcon.className = 'nfc-icon';
        readLabel.textContent = 'Tag read!';
        readResult.className = 'status-bar success';
        readResult.textContent = text || 'Tag read successfully';
        
        // Render safely without innerHTML injection
        lastScannedContent.innerHTML = '';
        const lines = text.split('\n');
        lines.forEach(line => {
          const div = document.createElement('div');
          if (line.startsWith('🥫')) {
            div.style.cssText = 'font-size:18px;font-weight:600;color:#5a3e2b;margin-bottom:4px';
          } else if (line.startsWith('📅')) {
            div.style.cssText = 'font-size:14px;color:#7a6a5a';
          } else if (line.startsWith('📝')) {
            div.style.cssText = 'font-size:14px;color:#7a6a5a;margin-top:4px';
          } else {
            div.style.cssText = 'font-size:14px;color:#5a3e2b';
          }
          div.textContent = line;
          lastScannedContent.appendChild(div);
        });
        lastScannedCard.style.display = 'block';
        
        readBtn.disabled = false;
        readBtn.textContent = '📖 Read Another';
        
        // Stop scanning after read
        setTimeout(() => nfc.stopScanning(), 500);
      }

      // Start scanning (after listeners are registered)
      await nfc.startScanning({ invalidateAfterFirstRead: true });

    } else {
      // Use Web NFC (browser/PWA fallback)
      const ndef = new NDEFReader();
      await ndef.scan();

    ndef.addEventListener("reading", ({ message, serialNumber }) => {
      let text = '';
      for (const record of message.records) {
        if (record.recordType === "text") {
          const decoder = new TextDecoder(record.encoding || 'utf-8');
          text += decoder.decode(record.data);
        }
      }
      
      readIcon.textContent = '✅';
      readIcon.className = 'nfc-icon';
      readLabel.textContent = 'Tag read!';
      readResult.className = 'status-bar success';
      readResult.textContent = text || 'Tag read successfully';
      
      // Show in card
      // Render safely without innerHTML injection
      lastScannedContent.innerHTML = '';
      const lines = text.split('\n');
      lines.forEach(line => {
        const div = document.createElement('div');
        if (line.startsWith('🥫')) {
          div.style.cssText = 'font-size:18px;font-weight:600;color:#5a3e2b;margin-bottom:4px';
        } else if (line.startsWith('📅')) {
          div.style.cssText = 'font-size:14px;color:#7a6a5a';
        } else if (line.startsWith('📝')) {
          div.style.cssText = 'font-size:14px;color:#7a6a5a;margin-top:4px';
        } else {
          div.style.cssText = 'font-size:14px;color:#5a3e2b';
        }
        div.textContent = line;
        lastScannedContent.appendChild(div);
      });
      lastScannedCard.style.display = 'block';
      
      readBtn.disabled = false;
      readBtn.textContent = '📖 Read Another';
    });
    
    ndef.addEventListener("readingerror", () => {
      readResult.className = 'status-bar error';
      readResult.textContent = '❌ Could not read the tag. Try again.';
      readIcon.textContent = '📱';
      readIcon.className = 'nfc-icon';
      readLabel.textContent = 'Tap to try again';
      readBtn.disabled = false;
      readBtn.textContent = '📖 Start Reading';
    });
    
    } // Close the Web NFC else block
  } catch(err) {
    readResult.style.display = 'block';
    readResult.className = 'status-bar error';
    readResult.textContent = `❌ ${err.message || 'NFC scan failed'}`;
    readBtn.disabled = false;
    readBtn.textContent = '📖 Start Reading';
    readIcon.textContent = '📱';
    readIcon.className = 'nfc-icon';
    readLabel.textContent = 'Tap to try again';
  }
}

readBtn.addEventListener('click', startReading);

// === HISTORY ===
function addToHistory(name, date) {
  history.unshift({
    id: Date.now(),
    name,
    date,
    timestamp: new Date().toLocaleString()
  });
  localStorage.setItem('harvestTagHistory', JSON.stringify(history));
  renderRecentJars();
}

function renderHistory() {
  const q = historySearch.value.toLowerCase().trim();
  const filtered = q ? history.filter(h => h.name.toLowerCase().includes(q)) : history;
  
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const icon = document.createElement('span');
    icon.className = 'he-icon';
    icon.textContent = '🏺';
    const message = document.createTextNode(q ? 'No jars match your search.' : 'No jars tagged yet. Start with the Write tab!');
    empty.appendChild(icon);
    empty.appendChild(message);
    historyList.innerHTML = '';
    historyList.appendChild(empty);
    return;
  }
  
  const fragment = document.createDocumentFragment();
  filtered.forEach(h => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const content = document.createElement('div');
    content.className = 'hi-content';

    const nameEl = document.createElement('div');
    nameEl.className = 'hi-name';
    nameEl.textContent = h.name;

    const dateEl = document.createElement('div');
    dateEl.className = 'hi-date';
    dateEl.textContent = `📅 ${h.date}`;

    const tagEl = document.createElement('span');
    tagEl.className = 'hi-tag';
    tagEl.textContent = h.timestamp;

    content.appendChild(nameEl);
    content.appendChild(dateEl);
    content.appendChild(tagEl);
    item.appendChild(content);
    fragment.appendChild(item);
  });

  historyList.innerHTML = '';
  historyList.appendChild(fragment);
}

historySearch.addEventListener('input', renderHistory);

function renderRecentJars() {
  if (history.length === 0) {
    recentJarsCard.style.display = 'none';
    return;
  }
  recentJarsCard.style.display = 'block';
  recentWriteList.innerHTML = history.slice(0, 5).map(h => `
    <div class="history-item">
      <div class="hi-content">
        <div class="hi-name">${h.name}</div>
        <div class="hi-date">📅 ${h.date}</div>
      </div>
    </div>
  `).join('');
}

$('exportBtn').addEventListener('click', () => {
  if (history.length === 0) {
    showToast('No jars to export yet!');
    return;
  }
  const csv = 'Name,Date,Timestamp\n' + history.map(h => 
    `"${h.name.replace(/"/g,'""')}","${h.date}","${h.timestamp.replace(/"/g,'""')}"`
  ).join('\n');

  const blob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harvest-tag-history-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 History exported!');
});

$('clearBtn').addEventListener('click', () => {
  if (history.length === 0) return;
  if (confirm('Clear all jar history? This cannot be undone.')) {
    history = [];
    localStorage.setItem('harvestTagHistory', JSON.stringify(history));
    renderHistory();
    renderRecentJars();
    showToast('🗑️ History cleared');
  }
});

// === NFC SUPPORT CHECK ===
if (!hasNfcSupport()) {
  nfcSupport.style.display = 'block';
}

// Check if running as PWA / standalone
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
  installBanner.style.display = 'none';
} else if (hasNfcSupport()) {
  // Show install banner on Android Chrome where WebNFC works
  installBanner.style.display = 'block';
}

// iOS PWA detection (standalone mode)
if (window.navigator.standalone) {
  installBanner.style.display = 'none';
}

// === TOAST ===
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// === INIT ===
renderRecentJars();

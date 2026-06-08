package com.harvesttag.nfc;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.content.Intent;
import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NFC")
public class NFCPlugin extends Plugin {

    private NfcAdapter nfcAdapter;
    private PluginCall pendingWriteCall;
    private PluginCall pendingReadCall;

    @Override
    public void load() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", nfcAdapter != null && nfcAdapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (nfcAdapter == null || !nfcAdapter.isEnabled()) {
            call.reject("NFC not available");
            return;
        }

        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Text is required");
            return;
        }

        pendingWriteCall = call;
        // Enable foreground dispatch to catch NFC tag
        enableForegroundDispatch();
    }

    @PluginMethod
    public void read(PluginCall call) {
        if (nfcAdapter == null || !nfcAdapter.isEnabled()) {
            call.reject("NFC not available");
            return;
        }

        pendingReadCall = call;
        enableForegroundDispatch();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        
        if (NfcAdapter.ACTION_TAG_DISCOVERED.equals(intent.getAction()) ||
            NfcAdapter.ACTION_NDEF_DISCOVERED.equals(intent.getAction()) ||
            NfcAdapter.ACTION_TECH_DISCOVERED.equals(intent.getAction())) {
            
            Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
            
            if (pendingWriteCall != null) {
                handleWrite(tag);
            } else if (pendingReadCall != null) {
                handleRead(tag);
            }
        }
    }

    private void handleWrite(Tag tag) {
        String text = pendingWriteCall.getString("text");
        try {
            NdefRecord textRecord = NdefRecord.createTextRecord("en", text);
            NdefMessage message = new NdefMessage(new NdefRecord[]{textRecord});
            
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                ndef.writeNdefMessage(message);
                ndef.close();
                
                JSObject ret = new JSObject();
                ret.put("success", true);
                pendingWriteCall.resolve(ret);
            } else {
                pendingWriteCall.reject("Tag does not support NDEF");
            }
        } catch (Exception e) {
            pendingWriteCall.reject("Write failed: " + e.getMessage());
        }
        pendingWriteCall = null;
        disableForegroundDispatch();
    }

    private void handleRead(Tag tag) {
        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                NdefMessage message = ndef.getNdefMessage();
                ndef.close();

                if (message != null) {
                    StringBuilder text = new StringBuilder();
                    for (NdefRecord record : message.getRecords()) {
                        if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN &&
                            record.getType() != null &&
                            java.util.Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                            byte[] payload = record.getPayload();
                            String textContent = new String(payload, "UTF-8");
                            // Skip the status byte (first byte)
                            text.append(textContent.substring(1));
                        }
                    }

                    JSObject ret = new JSObject();
                    ret.put("text", text.toString());
                    pendingReadCall.resolve(ret);
                } else {
                    pendingReadCall.reject("Empty tag");
                }
            } else {
                pendingReadCall.reject("Not an NDEF tag");
            }
        } catch (Exception e) {
            pendingReadCall.reject("Read failed: " + e.getMessage());
        }
        pendingReadCall = null;
        disableForegroundDispatch();
    }

    private void enableForegroundDispatch() {
        Activity activity = getActivity();
        if (activity != null) {
            NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
            if (adapter != null) {
                android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
                    activity, 0,
                    new Intent(activity, activity.getClass())
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    android.app.PendingIntent.FLAG_MUTABLE
                );
                android.content.IntentFilter[] filters = new android.content.IntentFilter[]{
                    new android.content.IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED),
                    new android.content.IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED)
                };
                String[][] techLists = new String[][]{
                    new String[]{android.nfc.tech.Ndef.class.getName()}
                };
                adapter.enableForegroundDispatch(activity, pendingIntent, filters, techLists);
            }
        }
    }

    private void disableForegroundDispatch() {
        Activity activity = getActivity();
        if (activity != null) {
            NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
            if (adapter != null) {
                adapter.disableForegroundDispatch(activity);
            }
        }
    }
}
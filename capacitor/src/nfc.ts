import { registerPlugin } from '@capacitor/core';

export interface NFCPlugin {
  write(options: { text: string }): Promise<{ success: boolean }>;
  read(): Promise<{ text: string }>;
  isAvailable(): Promise<{ available: boolean }>;
}

const NFC = registerPlugin<NFCPlugin>('NFC');

export default NFC;
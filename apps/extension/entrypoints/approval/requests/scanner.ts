export type QrScanner = { start(video: HTMLVideoElement, onText: (text: string) => void): Promise<() => void> };

/** Continuous QR decoding from the default camera; zxing is loaded only when a scan starts. */
export const cameraScanner: QrScanner = {
  async start(video, onText) {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const controls = await new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video, (result) => {
      if (result) onText(result.getText());
    });
    return () => controls.stop();
  },
};

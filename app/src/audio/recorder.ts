export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async requestMicAccess(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (error) {
      console.error('Microphone access denied:', error);
      return false;
    }
  }

  hasMicAccess(): boolean {
    return this.stream !== null;
  }

  /**
   * Phase 13B: Release microphone access and stop all tracks
   * This stops the browser's "mic in use" indicator and frees the resource
   */
  releaseMicAccess(): void {
    if (this.stream) {
      // Stop all tracks in the stream (releases the microphone)
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    // Also clear any active recording
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }

  startRecording(): void {
    if (!this.stream) {
      console.warn('No microphone access');
      return;
    }

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No recording in progress'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.chunks = [];
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  // Convert blob to ArrayBuffer
  async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return blob.arrayBuffer();
  }
}

// Singleton instance
export const recorder = new Recorder();

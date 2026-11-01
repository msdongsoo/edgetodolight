let audioContext;

async function playAlarm() {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("Audio playback was blocked. Check Edge's sound settings.");
  const start = audioContext.currentTime + 0.04;
  const notes = [880, 1108.73, 1318.51, 880, 1108.73, 1318.51];
  for (const [index, frequency] of notes.entries()) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const at = start + index * 0.28;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.21);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.23);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "alarm.play") return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "The audio request came from an invalid source." });
    return false;
  }
  playAlarm().then(
    () => sendResponse({ ok: true }),
    (error) => {
      console.error("Focus alarm audio failed:", error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  );
  return true;
});

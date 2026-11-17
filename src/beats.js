// Detect transients in short overlapping windows, then keep the strongest nearby onset.
export function detectBeats(buffer) {
  const rate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.floor(rate * 0.02));
  const energies = [];
  for (let start = 0; start < data.length; start += windowSize) {
    let sum = 0;
    for (let i = start; i < Math.min(start + windowSize, data.length); i++) sum += data[i] * data[i];
    energies.push(Math.sqrt(sum / windowSize));
  }
  const candidates = [];
  for (let i = 2; i < energies.length - 1; i++) {
    const baseline = energies.slice(Math.max(0, i - 12), i).reduce((a, b) => a + b, 0) / Math.min(i, 12);
    const strength = energies[i] - baseline;
    const time = i * windowSize / rate;
    if (time >= 1.8 && time < buffer.duration - 0.15 && strength > 0.008 &&
        energies[i] > baseline * 1.25 && energies[i] >= energies[i - 1] && energies[i] > energies[i + 1]) {
      candidates.push({ time, strength });
    }
  }
  const selected = [];
  for (const candidate of candidates) {
    const previous = selected[selected.length - 1];
    if (previous && candidate.time - previous.time < 0.3) {
      if (candidate.strength > previous.strength) selected[selected.length - 1] = candidate;
    } else selected.push(candidate);
  }
  return selected.map((beat, index) => ({ time: beat.time, lane: laneFor(index), hit: false }));
}

// Fallback grid for previews the browser cannot decode — keeps every song playable.
export function syntheticBeats(duration) {
  const beats = [];
  for (let time = 2, index = 0; time < duration - 0.3; time += 0.5, index++) {
    beats.push({ time, lane: laneFor(index), hit: false });
  }
  return beats;
}

function laneFor(index) {
  // A deterministic pattern avoids adjacent repeated lanes without feeling random.
  return [0, 2, 1, 3, 1, 0, 3, 2, 0, 3, 2, 1][index % 12];
}

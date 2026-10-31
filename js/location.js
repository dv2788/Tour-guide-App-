// Where are you? Either the phone's GPS, or a simulated trip along the planned route
// (so you can try a tour of Rome from your couch).

import { buildPath, pointAlongPath } from './geo.js';

export class GpsSource {
  constructor({ onPosition, onError }) {
    this.onPosition = onPosition;
    this.onError = onError;
    this.watchId = null;
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.onError?.(new Error('This browser cannot share your location.'));
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        this.onPosition({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
          speed: p.coords.speed,
          timestamp: p.timestamp,
        }),
      (err) => this.onError?.(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

export class SimulatedSource {
  constructor({ points, speedMps, multiplier = 1, onPosition, onEnd, intervalMs = 1000 }) {
    this.path = buildPath(points);
    this.speedMps = speedMps;
    this.multiplier = multiplier;
    this.onPosition = onPosition;
    this.onEnd = onEnd;
    this.intervalMs = intervalMs;
    this.travelled = 0;
    this.timer = null;
  }

  start() {
    this.#emit();
    this.timer = setInterval(() => {
      this.travelled += this.speedMps * this.multiplier * (this.intervalMs / 1000);
      this.#emit();
      if (this.travelled >= this.path.length) {
        this.stop();
        this.onEnd?.();
      }
    }, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  #emit() {
    const p = pointAlongPath(this.path, this.travelled);
    if (!p) return;
    this.onPosition({
      lat: p.lat,
      lon: p.lon,
      heading: p.heading,
      speed: this.speedMps,
      accuracy: 5,
      timestamp: Date.now(),
      simulated: true,
    });
  }
}

// How the guide behaves for each way of getting around.
// Faster travel = bigger radii (you cover ground quickly) and shorter stories (you pass things quickly).

export const MODES = {
  walk: {
    id: 'walk',
    label: 'Walk',
    icon: '🚶',
    speedMps: 1.4, // used by the trip simulator
    routeProfile: 'foot',
    triggerRadius: 80, // talk about places within this distance
    searchRadius: 600, // how far to look for places when fetching
    arrivalRadius: 60, // "you have arrived" distance for itinerary stops
    sentences: 4, // story length for places you pass
    stopSentences: 6, // story length for your own itinerary stops
    gapSeconds: 6, // quiet time between two stories
    announceDistance: false,
  },
  hike: {
    id: 'hike',
    label: 'Hike',
    icon: '🥾',
    speedMps: 1.0, // paths, slopes, stops for the view
    routeProfile: 'foot',
    triggerRadius: 150, // fewer, more spread-out places in the hills
    searchRadius: 1500,
    arrivalRadius: 80,
    sentences: 4,
    stopSentences: 6,
    gapSeconds: 10,
    announceDistance: false,
  },
  run: {
    id: 'run',
    label: 'Run',
    icon: '🏃',
    speedMps: 2.8,
    routeProfile: 'foot',
    triggerRadius: 100,
    searchRadius: 800,
    arrivalRadius: 80,
    sentences: 2,
    stopSentences: 3,
    gapSeconds: 20,
    announceDistance: false,
  },
  cycle: {
    id: 'cycle',
    label: 'Cycle',
    icon: '🚴',
    speedMps: 4.5,
    routeProfile: 'bike',
    triggerRadius: 150,
    searchRadius: 1200,
    arrivalRadius: 100,
    sentences: 3,
    stopSentences: 4,
    gapSeconds: 8,
    announceDistance: false,
  },
  drive: {
    id: 'drive',
    label: 'Drive',
    icon: '🚗',
    speedMps: 11,
    routeProfile: 'car',
    triggerRadius: 350,
    searchRadius: 2500,
    arrivalRadius: 200,
    sentences: 2,
    stopSentences: 3,
    gapSeconds: 4,
    announceDistance: true, // "On your right, in 300 meters: …"
  },
};

export function getMode(id) {
  return MODES[id] ?? MODES.walk;
}

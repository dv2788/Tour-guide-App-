// Sample tours to try straight away (and to show what Roamie can do). Each one was checked
// against the real services: every stop is found on OpenStreetMap under this name, a real
// walking (or driving) route joins them, and each has a Wikipedia article to tell.
// The names are what the guide will say: local names where OpenStreetMap only knows those.

export const SAMPLES = [
  {
    id: 'barcelona',
    region: 'europe',
    label: 'Barcelona',
    city: 'Barcelona',
    blurb: 'Gaudí, La Rambla and the Gothic Quarter',
    mode: 'walk',
    km: 3,
    stops: ['Casa Batlló', 'Plaça de Catalunya', 'La Boqueria', 'Plaça Reial', 'Barcelona Cathedral', 'Santa Maria del Mar'],
  },
  {
    id: 'brussels',
    region: 'europe',
    label: 'Brussels',
    city: 'Brussels',
    blurb: 'From Manneken Pis to the Royal Palace',
    mode: 'walk',
    km: 2.3,
    stops: ['Manneken Pis', 'Grand-Place', 'Galeries Royales Saint-Hubert', 'Cathedral of St. Michael and St. Gudula', 'Mont des Arts', 'Palais Royal de Bruxelles'],
  },
  {
    id: 'cape-town',
    region: 'africa',
    label: 'Cape Town',
    city: 'Cape Town',
    blurb: 'The Castle, the old city and the Bo-Kaap',
    mode: 'walk',
    km: 2.9,
    stops: ['Castle of Good Hope', 'Cape Town City Hall', 'Greenmarket Square', 'Bo-Kaap Museum', "St. George's Cathedral", "Company's Garden"],
  },
  {
    id: 'kinshasa',
    region: 'africa',
    label: 'Kinshasa',
    city: 'Kinshasa',
    blurb: 'A drive past the landmarks of Lingwala and Gombe',
    mode: 'drive',
    km: 16,
    stops: ['Palais du Peuple', 'Stade des Martyrs', 'Cathédrale Notre-Dame du Congo', 'Jardin botanique de Kinshasa', 'Palais de la Nation'],
  },
  {
    id: 'miami',
    region: 'americas',
    label: 'Miami Beach',
    city: 'Miami Beach',
    blurb: 'Art Deco South Beach and the Versace mansion',
    mode: 'walk',
    km: 2.9,
    stops: ['Art Deco Welcome Center', 'Casa Casuarina', 'The Wolfsonian–FIU', 'Española Way', 'Lincoln Road'],
  },
  {
    id: 'paris',
    region: 'europe',
    label: 'Paris',
    city: 'Paris',
    blurb: 'From the Eiffel Tower to the Louvre',
    mode: 'walk',
    km: 4.5,
    stops: ['Eiffel Tower', "Pont de l'Alma", 'Grand Palais', 'Place de la Concorde', 'Louvre Museum'],
  },
  {
    id: 'san-francisco',
    region: 'americas',
    label: 'San Francisco',
    city: 'San Francisco',
    blurb: 'California: the Ferry Building up to Coit Tower',
    mode: 'walk',
    km: 3.7,
    stops: ['Ferry Building', 'Transamerica Pyramid', 'Dragon Gate', 'Washington Square', 'Coit Tower'],
  },
  {
    id: 'shenzhen',
    region: 'asia',
    label: 'Shenzhen',
    city: 'Shenzhen',
    blurb: 'Lotus Hill to the Ping An tower, along Futian’s axis',
    mode: 'walk',
    km: 4,
    stops: ['Lianhuashan Park', 'Shenzhen Library', 'Shenzhen Civic Center', 'Shenzhen Museum', 'Ping An Finance Center'],
  },
  {
    id: 'tokyo',
    region: 'asia',
    label: 'Tokyo',
    city: 'Tokyo',
    blurb: 'Asakusa’s temples to the Skytree',
    mode: 'walk',
    km: 2.9,
    stops: ['Kaminarimon', 'Sensō-ji', 'Asakusa Shrine', 'Sumida Park', 'Tokyo Skytree'],
  },
];

export const DEFAULT_SAMPLE = 'barcelona';

/** Parts of the world, for filtering the sample tours ('' = all). */
export const REGIONS = [
  ['', 'All'],
  ['europe', 'Europe'],
  ['africa', 'Africa'],
  ['americas', 'Americas'],
  ['asia', 'Asia'],
];

export const sampleById = (id) => SAMPLES.find((s) => s.id === id) ?? SAMPLES.find((s) => s.id === DEFAULT_SAMPLE);

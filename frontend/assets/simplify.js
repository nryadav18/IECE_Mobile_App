const fs = require('fs');

try {
  const data = fs.readFileSync('./india_states.json', 'utf8');
  const geojson = JSON.parse(data);

  // Helper to recursively round coordinates
  const roundCoords = (coords) => {
    if (typeof coords[0] === 'number') {
      return [parseFloat(coords[0].toFixed(1)), parseFloat(coords[1].toFixed(1))];
    }
    return coords.map(roundCoords);
  };

  geojson.features.forEach(feature => {
    if (feature.geometry && feature.geometry.coordinates) {
      feature.geometry.coordinates = roundCoords(feature.geometry.coordinates);
    }
    // Remove heavy unnecessary properties
    const name = feature.properties.NAME_1;
    feature.properties = { name };
  });

  fs.writeFileSync('./india_states_simplified.json', JSON.stringify(geojson));
  console.log('Successfully simplified!');
} catch(err) {
  console.error(err);
}

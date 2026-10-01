const { join } = require('path');

// Keep the downloaded Chrome inside the project so it ships with the build on Render
// (the default ~/.cache/puppeteer is not available at runtime there).
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

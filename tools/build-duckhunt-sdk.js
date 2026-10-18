// Bundles @discord/embedded-app-sdk into a single browser ES module for the
// Duck Hunt Activity. Discord's Activity proxy blocks third-party CDNs, so the
// SDK must be served from this app. Re-run after upgrading the SDK:
//   npm run build:duckhunt-sdk
const path = require('path');
const esbuild = require('esbuild');

esbuild.buildSync({
  stdin: {
    contents: "export { DiscordSDK, DiscordSDKMock } from '@discord/embedded-app-sdk';",
    resolveDir: path.join(__dirname, '..'),
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'inline',
  outfile: path.join(__dirname, '..', 'public', 'duckhunt', 'vendor', 'discord-sdk.js'),
});

console.log('Built public/duckhunt/vendor/discord-sdk.js');

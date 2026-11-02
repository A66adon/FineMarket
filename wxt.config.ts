import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DeckCart',
    description:
      'Turn a Moxfield deck into a cheaper Cardmarket cart, postage included.',
    version: '0.1.8',
    minimum_chrome_version: '114',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: [
      'https://moxfield.com/*',
      'https://www.moxfield.com/*',
      'https://api2.moxfield.com/*',
      'https://www.cardmarket.com/*',
      'https://help.cardmarket.com/*',
      'https://api.scryfall.com/*',
    ],
    action: {
      default_title: 'Open DeckCart',
    },
  },
});

import { registerRootComponent } from 'expo';

import App from './App';

// In production/release builds, silence non-error console output so debug logs
// (which can include user/network data) never reach the device log. Warnings
// and errors are kept so real problems remain visible to crash reporting.
if (!__DEV__) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

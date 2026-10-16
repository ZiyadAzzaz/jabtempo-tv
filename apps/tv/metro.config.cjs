const path = require('path');
const fs = require('fs');
const cachedApp = path.resolve(__dirname, '../../.cache/amazon-tv-sample/apps/expo-multi-tv/node_modules');
const cachedRoot = path.resolve(__dirname, '../../.cache/amazon-tv-sample/node_modules');
// Temporary fallback permits source verification using the already installed official sample.
const expoConfig = require.resolve('expo/metro-config', { paths: [__dirname, cachedApp, cachedRoot] });
const { getDefaultConfig } = require(expoConfig);
const config = getDefaultConfig(__dirname);
// Do not crawl the whole cached sample once this app has its own installed dependencies.
const fallback = fs.existsSync(path.resolve(__dirname,'node_modules/expo/package.json')) ? [] : [cachedApp,cachedRoot];
config.watchFolders = [path.resolve(__dirname, '../../packages'), ...fallback].filter(p => fs.existsSync(p));
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), ...fallback, path.resolve(__dirname, '../../node_modules')].filter(p => fs.existsSync(p));
config.resolver.unstable_enableSymlinks = true;
config.resolver.sourceExts = [...config.resolver.sourceExts.map(e => `tv.${e}`), ...config.resolver.sourceExts];
module.exports = config;

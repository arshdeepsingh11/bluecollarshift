// Metro config: lets the app import ../shared (business rules shared with web and server).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  '@bluecollar/shared': path.join(sharedRoot, 'src'),
};
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

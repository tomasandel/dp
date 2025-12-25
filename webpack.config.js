const path = require('path');

module.exports = [
  // SCT Parser bundle
  {
    entry: './src/utils/sct-parser.js',
    output: {
      filename: 'sct-parser-bundled.js',
      path: path.resolve(__dirname, 'dist'),
      library: {
        name: 'sctParser',
        type: 'var',
        export: 'default'
      }
    },
    mode: 'production',
    target: 'web'
  },
  // CT Verify bundle
  {
    entry: './src/utils/ct-verify.js',
    output: {
      filename: 'ct-verify-bundled.js',
      path: path.resolve(__dirname, 'dist'),
      library: {
        name: 'ctVerify',
        type: 'var',
        export: 'default'
      }
    },
    mode: 'production',
    target: 'web'
  },
  // Background script bundle
  {
    entry: './src/background/background.js',
    output: {
      filename: 'background-bundled.js',
      path: path.resolve(__dirname, 'dist')
    },
    mode: 'production',
    target: 'web'
  }
];

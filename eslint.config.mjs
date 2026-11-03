import hanaboso from '@hanaboso/eslint-plugin';

export default [
  ...hanaboso.configs.orchesty,
  {
    rules: {
      'jest/expect-expect': ['error', {
        assertFunctionNames: ['expect', '*.testBatch', '*.testConnector', '*.testCustomNode'],
      }],
    },
  }
];

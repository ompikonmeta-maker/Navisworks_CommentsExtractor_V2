import { defineConfig } from 'vitest/config';

// Dates in the app are local time; pin the zone so the tests give the same
// answer on every machine.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
  },
});

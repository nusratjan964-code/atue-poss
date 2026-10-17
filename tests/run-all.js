const runCryptoTests = require('./crypto.test');
const runAdapterTests = require('./adapters.test');
const runGeminiTests = require('./gemini.test');
const runDuplicateTests = require('./duplicate.test');
const runSchedulerTests = require('./scheduler.test');
const runFullIntegrationTests = require('./full-integrations.test');

async function runAllTests() {
  console.log('====================================================');
  console.log('🚀 Starting Drive2Social AI Full Automated Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const suites = [
    { name: 'Crypto Security', fn: runCryptoTests },
    { name: 'Social Adapters', fn: runAdapterTests },
    { name: 'Gemini AI Analysis & Schema', fn: runGeminiTests },
    { name: 'Duplicate Prevention', fn: runDuplicateTests },
    { name: 'Daily Scheduler & Limit (3/day)', fn: runSchedulerTests },
    { name: 'Full Platform Integrations', fn: runFullIntegrationTests }
  ];

  for (const suite of suites) {
    try {
      await suite.fn();
      passed++;
    } catch (err) {
      console.error(`❌ SUITE FAILED: ${suite.name}`);
      console.error(err.stack || err.message);
      failed++;
    }
    console.log('');
  }

  console.log('====================================================');
  console.log(`Test Execution Summary:`);
  console.log(`  ✅ Passed Suites: ${passed}`);
  console.log(`  ❌ Failed Suites: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION & UNIT TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  }
}

runAllTests();

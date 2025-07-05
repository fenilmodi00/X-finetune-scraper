// index.js
import 'dotenv/config';
import { Command } from 'commander';
import TwitterPipeline from './TwitterPipeline.js';
import Logger from './Logger.js';

process.on('unhandledRejection', (error) => {
  Logger.error(`❌ Unhandled promise rejection: ${error.message}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  Logger.error(`❌ Uncaught exception: ${error.message}`);
  process.exit(1);
});

let pipeline;

const program = new Command();

program
  .name('twitter-scraper')
  .description('A pipeline to scrape data from Twitter.')
  .argument('[username]', 'The Twitter username to scrape', 'degenspartan')
  .option('-s, --start-date <date>', 'The start date for tweet collection (YYYY-MM-DD)')
  .option('-e, --end-date <date>', 'The end date for tweet collection (YYYY-MM-DD)')
  .action(async (username, options) => {
    pipeline = new TwitterPipeline(username, options.startDate, options.endDate);
    await pipeline.run();
  });

const cleanup = async () => {
  Logger.warn('\n🛑 Received termination signal. Cleaning up...');
  try {
    if (pipeline && pipeline.scraper) {
      await pipeline.scraper.logout();
      Logger.success('🔒 Logged out successfully.');
    }
  } catch (error) {
    Logger.error(`❌ Error during cleanup: ${error.message}`);
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const main = async () => {
  await program.parseAsync(process.argv);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    Logger.error(`An unhandled error occurred: ${error.message}`);
    process.exit(1);
  });

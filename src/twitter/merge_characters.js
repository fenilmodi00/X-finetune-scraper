import DataOrganizer from './DataOrganizer.js';
import Logger from './Logger.js';
import inquirer from 'inquirer';
import chalk from 'chalk';

// Get arguments directly from process.argv
const args = process.argv.slice(2);
const newCharacterName = args[0];
const sourceAccounts = args.slice(1);

async function promptForMergeOptions(availableTweets) {
  console.log('\n📊 Available Tweets:');
  Object.entries(availableTweets).forEach(([account, count]) => {
    console.log(chalk.cyan(`@${account}: ${count} tweets`));
  });

  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'tweetsPerAccount',
      message: 'How many top tweets to include from each account?',
      default: 50
    },
    {
      type: 'confirm',
      name: 'excludeRetweets',
      message: 'Exclude retweets?',
      default: true
    },
    {
      type: 'list',
      name: 'rankingMethod',
      message: 'How should tweets be ranked?',
      choices: ['Total engagement (likes + retweets)', 'Likes only', 'Retweets only'],
      default: 'Total engagement (likes + retweets)'
    }
  ]);

  return answers;
}

async function displayTweetSample(tweets, sourceAccounts) {
  // This function is no longer used in the new version
}

async function main() {
  if (!newCharacterName || sourceAccounts.length < 2) {
    Logger.error("Usage: npm run merge-characters -- <new_name> <account1> <account2> ...");
    Logger.info("Example: npm run merge-characters -- merged_gurus cryptocito alfaketchum");
    process.exit(1);
  }

  try {
    const dataOrganizer = new DataOrganizer('pipeline', newCharacterName);
    
    // Get available tweet counts for each account
    const availableTweets = {};
    for (const account of sourceAccounts) {
      try {
        const tweets = await dataOrganizer.getTweetsForAccount(account);
        availableTweets[account] = tweets.length;
      } catch (error) {
        Logger.warn(`Could not get tweet count for @${account}: ${error.message}`);
        availableTweets[account] = 0;
      }
    }

    // Get merge options
    const options = await promptForMergeOptions(availableTweets);
    
    // Create merged character with options
    await dataOrganizer.createMergedCharacter(sourceAccounts, {
      tweetsPerAccount: options.tweetsPerAccount,
      excludeRetweets: options.excludeRetweets,
      rankingMethod: options.rankingMethod
    });

    Logger.success('✨ Character merge completed successfully!');
    Logger.info(`New character created: ${newCharacterName}`);
    Logger.info(`Find the data in: ${dataOrganizer.getPaths().baseDir}`);

  } catch (error) {
    Logger.error(`Failed to create merged character: ${error.message}`);
    process.exit(1);
  }
}

main(); 
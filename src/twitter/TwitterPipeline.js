import inquirer from "inquirer";
import chalk from "chalk";
import { format } from "date-fns";
import path from "path";
import fs from "fs/promises";
import { program } from 'commander';

// Imported Files
import Logger from "./Logger.js";
import DataOrganizer from "./DataOrganizer.js";
import TweetFilter from "./TweetFilter.js";

// @the-convocation/twitter-scraper
import { Scraper, SearchMode } from "@the-convocation/twitter-scraper";

// Puppeteer
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Cluster } from "puppeteer-cluster";

// Configure puppeteer stealth once
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Setup command line options to work with both formats:
// npm run twitter -- username --start-date 2024-01-01
// node src/twitter/index.js username --start-date 2024-01-01
program
  .allowExcessArguments(true)
  .argument('[username]', 'Twitter username to collect')
  .option('-s, --start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end-date <date>', 'End date (YYYY-MM-DD)')
  .parse(process.argv);

const options = program.opts();
const username = program.args[0];

class TwitterPipeline {
  constructor(username, startDate, endDate) {
    this.username = username;
    this.startDate = startDate;
    this.endDate = endDate;
    this.dataOrganizer = new DataOrganizer("pipeline", username);
    this.paths = this.dataOrganizer.getPaths();
    this.tweetFilter = new TweetFilter();

    // Update cookie path to be in top-level cookies directory
    this.paths.cookies = path.join(
      process.cwd(),
      'cookies',
      `${process.env.TWITTER_USERNAME}_cookies.json`
    );

    // Enhanced configuration with fallback handling
    this.config = {
      twitter: {
        maxTweets: parseInt(process.env.MAX_TWEETS) || 50000,
        maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
        retryDelay: parseInt(process.env.RETRY_DELAY) || 5000,
        minDelayBetweenRequests: parseInt(process.env.MIN_DELAY) || 1000,
        maxDelayBetweenRequests: parseInt(process.env.MAX_DELAY) || 3000,
        rateLimitThreshold: 3, // Number of rate limits before considering fallback
      },
      fallback: {
        enabled: true,
        sessionDuration: 30 * 60 * 1000, // 30 minutes
        viewport: {
          width: 1366,
          height: 768,
          deviceScaleFactor: 1,
          hasTouch: false,
          isLandscape: true,
        },
      },
    };

    const scraperOptions = {};
    if (process.env.PROXY_URL) {
        scraperOptions.transform = {
            request: (input, init) => {
                const proxy = process.env.PROXY_URL;
                if (typeof input === 'string') {
                    return [proxy + encodeURIComponent(input), init];
                }
                if (input instanceof URL) {
                    return [proxy + encodeURIComponent(input.toString()), init];
                }
                return [input, init];
            }
        }
    }

    this.scraper = new Scraper(scraperOptions);
    this.cluster = null;

    // Enhanced statistics tracking
    this.stats = {
      requestCount: 0,
      rateLimitHits: 0,
      retriesCount: 0,
      uniqueTweets: 0,
      fallbackCount: 0,
      startTime: Date.now(),
      oldestTweetDate: null,
      newestTweetDate: null,
      fallbackUsed: false,
    };
  }

  async initializeFallback() {
    if (!this.cluster) {
      this.cluster = await Cluster.launch({
        puppeteer,
        maxConcurrency: 1, // Single instance for consistency
        timeout: 30000,
        puppeteerOptions: {
          headless: "new",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
          ],
        },
      });

      this.cluster.on("taskerror", async (err) => {
        Logger.warn(`Fallback error: ${err.message}`);
        this.stats.retriesCount++;
      });
    }
  }

  async setupFallbackPage(page) {
    await page.setViewport(this.config.fallback.viewport);

    // Basic evasion only - maintain consistency
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }

  async validateEnvironment() {
    Logger.startSpinner("Validating environment");
    const required = ["TWITTER_USERNAME", "TWITTER_PASSWORD"];
    const missing = required.filter((var_) => !process.env[var_]);

    if (missing.length > 0) {
      Logger.stopSpinner(false);
      Logger.error("Missing required environment variables:");
      missing.forEach((var_) => Logger.error(`- ${var_}`));
      console.log("\n📝 Create a .env file with your Twitter credentials:");
      console.log(`TWITTER_USERNAME=your_username`);
      console.log(`TWITTER_PASSWORD=your_password`);
      process.exit(1);
    }
    Logger.stopSpinner();
  }

  async loadCookies() {
    try {
      // Corrected path using this.paths.cookies
      const cookiesPath = this.paths.cookies;
      await fs.access(cookiesPath);
      const cookiesData = await fs.readFile(cookiesPath, 'utf-8');
      const cookies = JSON.parse(cookiesData);
      await this.scraper.setCookies(cookies);
      return true;
    } catch (error) {
      Logger.warn(`Could not load cookies: ${error.message}`);
      return false;
    }
  }

  async saveCookies() {
    try {
      const cookies = await this.scraper.getCookies();
      const cookiesPath = this.paths.cookies;
      // Ensure the directory exists
      await fs.mkdir(path.dirname(cookiesPath), { recursive: true });
      await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
      Logger.success('Authentication cookies saved successfully.');
    } catch (error) {
      Logger.warn(`Failed to save cookies: ${error.message}`);
    }
  }

  async initializeScraper() {
    Logger.startSpinner("Initializing Twitter scraper");

    const authToken = process.env.TWITTER_AUTH_TOKEN;
    const ct0 = process.env.TWITTER_CT0;

    if (authToken && ct0) {
      try {
        const cookies = [
          `auth_token=${authToken}`,
          `ct0=${ct0}`
        ];
        await this.scraper.setCookies(cookies);
        if (await this.scraper.isLoggedIn()) {
          Logger.success("✅ Successfully authenticated with provided cookies");
          Logger.stopSpinner();
          return true;
        } else {
          Logger.warn("⚠️  The provided cookies are invalid. Please update them.");
        }
      } catch (error) {
        Logger.warn(`⚠️  Cookie authentication failed: ${error.message}.`);
      }
    }
    
    Logger.error("Authentication failed. Please provide valid TWITTER_AUTH_TOKEN and TWITTER_CT0 in your .env file.");
    Logger.stopSpinner(false);
    return false;
  }

  async randomDelay(min, max) {
    // Gaussian distribution for more natural delays
    const gaussianRand = () => {
      let rand = 0;
      for (let i = 0; i < 6; i++) rand += Math.random();
      return rand / 6;
    };

    const delay = Math.floor(min + gaussianRand() * (max - min));
    Logger.info(`Waiting ${(delay / 1000).toFixed(1)} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  processTweetData(tweet) {
    try {
      if (!tweet || !tweet.id) return null;

      let timestamp = tweet.timestamp;
      if (!timestamp) {
        timestamp = tweet.timeParsed?.getTime();
      }

      if (!timestamp) return null;

      if (timestamp < 1e12) timestamp *= 1000;

      if (isNaN(timestamp) || timestamp <= 0) {
        Logger.warn(`⚠️  Invalid timestamp for tweet ${tweet.id}`);
        return null;
      }

      const tweetDate = new Date(timestamp);
      if (
        !this.stats.oldestTweetDate ||
        tweetDate < this.stats.oldestTweetDate
      ) {
        this.stats.oldestTweetDate = tweetDate;
      }
      if (
        !this.stats.newestTweetDate ||
        tweetDate > this.stats.newestTweetDate
      ) {
        this.stats.newestTweetDate = tweetDate;
      }

      return {
        id: tweet.id,
        text: tweet.text,
        username: tweet.username || this.username,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        isReply: Boolean(tweet.isReply),
        isRetweet: Boolean(tweet.isRetweet),
        likes: tweet.likes || 0,
        retweetCount: tweet.retweets || 0,
        replies: tweet.replies || 0,
        photos: tweet.photos || [],
        videos: tweet.videos || [],
        urls: tweet.urls || [],
        permanentUrl: tweet.permanentUrl,
        quotedStatusId: tweet.quotedStatusId,
        inReplyToStatusId: tweet.inReplyToStatusId,
        hashtags: tweet.hashtags || [],
      };
    } catch (error) {
      Logger.warn(`⚠️  Error processing tweet ${tweet?.id}: ${error.message}`);
      return null;
    }
  }

  async collectTweets(profile, fromDate, toDate) {
    const collectedTweets = [];
    const { startDate, endDate } = this;
    const maxTweets = this.config.twitter.maxTweets;
    let tweetIterator;

    const fromDateObj = fromDate ? new Date(fromDate) : null;
    const toDateObj = toDate ? new Date(toDate) : null;
    let searchQuery = `from:${this.username}`;
    if (fromDateObj) searchQuery += ` since:${format(fromDateObj, "yyyy-MM-dd")}`;
    if (toDateObj) searchQuery += ` until:${format(toDateObj, "yyyy-MM-dd")}`;

    Logger.startSpinner(`Collecting tweets for ${this.username}`);

    try {
      if (searchQuery) {
        tweetIterator = this.scraper.searchTweets(
          searchQuery,
          maxTweets,
          SearchMode.Latest
        );
      } else {
        tweetIterator = this.scraper.getTweets(this.username, maxTweets);
      }

      for await (const tweet of tweetIterator) {
        this.stats.requestCount++;
        if (this.tweetFilter.shouldIncludeTweet(tweet)) {
          const processedTweet = this.processTweetData(tweet);
          if (processedTweet) {
            collectedTweets.push(processedTweet);
            this.stats.uniqueTweets++;
          }
        }
      }

      Logger.stopSpinner();
      return collectedTweets;
    } catch (error) {
      Logger.error(`Failed to collect tweets: ${error.message}`);
      // The library's default rate-limit strategy will handle this.
      // We can re-throw or handle other specific errors here if needed.
      throw error;
    }
  }

  async getProfile() {
    Logger.startSpinner('Fetching profile information');
    try {
      const profile = await this.scraper.getProfile(this.username);
      this.stats.profile = {
        following: profile.following,
        likes: profile.likes,
      };
      return this.stats.profile;
    } catch (error) {
      Logger.fail(`Failed to fetch profile: ${error.message}`);
      return null;
    }
  }

  async run() {
    const startTime = Date.now();

    console.log("\n" + chalk.bold.blue("🐦 Twitter Data Collection Pipeline"));
    console.log(
      chalk.bold(`Target Account: ${chalk.cyan("@" + this.username)}\n`)
    );

    try {
      await this.validateEnvironment();

      let filterOptions;
      if (this.startDate && this.endDate) {
        Logger.info('🗓️ Using date range from command-line flags.');
        filterOptions = {
          mode: 'Date Range',
          fromDate: this.startDate,
          toDate: this.endDate,
          // Include everything by default when using flags
          tweetTypes: ['original', 'replies', 'quotes', 'retweets'],
          contentTypes: ['text', 'images', 'videos', 'links'],
        };
      } else {
        filterOptions = await this.tweetFilter.promptCollectionMode();
      }
      
      this.tweetFilter.setOptions(filterOptions);
      
      if (!filterOptions) {
        Logger.warn("No filter configuration provided. Exiting.");
        return;
      }

      if (await this.initializeScraper()) {
        const profile = await this.getProfile();

        if (profile) {
          Logger.startSpinner(`Collecting tweets for ${this.username}`);
          const collectedTweets = await this.collectTweets(
            profile,
            filterOptions.fromDate,
            filterOptions.toDate
          );
          Logger.stopSpinner();

          if (collectedTweets.length > 0) {
            Logger.startSpinner('Processing and saving data');
            const analytics = await this.dataOrganizer.saveTweets(
              collectedTweets
            );
            Logger.success('Processing and saving data');
            await this.displaySummary(analytics, startTime);
          } else {
            Logger.warn('No tweets collected. Nothing to process or save.');
          }
        }
      }
    } catch (error) {
      Logger.error(`Pipeline failed: ${error.message}`);
      await this.cleanup();
      return null;
    }
  }

  async displaySummary(analytics, startTime) {
    // Calculate final statistics
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const tweetsPerMinute =
      analytics.totalTweets > 0
        ? (analytics.totalTweets / (duration / 60)).toFixed(1)
        : '0.0';
    const successRate = (
      (analytics.totalTweets / this.stats.requestCount) *
      100
    ).toFixed(1);

    // Display final results
    Logger.stats('📊 📈 Collection Results:', {
      'Total Tweets': analytics.totalTweets.toLocaleString(),
      'Original Tweets': analytics.directTweets.toLocaleString(),
      Replies: analytics.replies.toLocaleString(),
      Retweets: analytics.retweets.toLocaleString(),
      'Date Range': `${analytics.timeRange.start} to ${analytics.timeRange.end}`,
      Runtime: `${duration} seconds`,
      'Collection Rate': `${tweetsPerMinute} tweets/minute`,
      'Success Rate': `${successRate}%`,
      'Rate Limit Hits': this.stats.rateLimitHits.toLocaleString(),
      'Fallback Collections': '0',
      'Storage Location': chalk.gray(this.dataOrganizer.baseDir),
    });

    // Content type breakdown
    Logger.info('\n Content Type Breakdown:');
    console.log(
      chalk.cyan(
        `• Text Only: ${analytics.contentTypes.textOnly.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(
        `• With Images: ${analytics.contentTypes.withImages.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(
        `• With Videos: ${analytics.contentTypes.withVideos.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(
        `• With Links: ${analytics.contentTypes.withLinks.toLocaleString()}`
      )
    );

    // Engagement statistics
    Logger.info('\n💫 Engagement Statistics:');
    console.log(
      chalk.cyan(
        `• Total Likes: ${analytics.engagement.totalLikes.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(
        `• Total Retweets: ${analytics.engagement.totalRetweetCount.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(
        `• Total Replies: ${analytics.engagement.totalReplies.toLocaleString()}`
      )
    );
    console.log(
      chalk.cyan(`• Average Likes: ${analytics.engagement.averageLikes}`)
    );

    Logger.info('\n🌟 Sample Tweets (Most Engaging):');
    analytics.engagement.topTweets.forEach((tweet, index) => {
      const date = tweet.timestamp
        ? format(new Date(tweet.timestamp), 'yyyy-MM-dd')
        : 'N/A';
      console.log(`\n${index + 1}. [${date}]`);
      console.log(tweet.text);
      console.log(
        chalk.red(`❤️ ${tweet.likes?.toLocaleString() || 0}`) +
          ` | ` +
          chalk.green(`🔄 ${tweet.retweetCount?.toLocaleString() || 0}`) +
          ` | ` +
          chalk.blue(`💬 ${tweet.replies?.toLocaleString() || 0}`)
      );
      console.log(chalk.gray(`🔗 ${tweet.url}`));
    });
  }

  async cleanup() {
    try {
      // Cleanup main scraper
      if (this.scraper) {
        await this.scraper.logout();
        Logger.success("🔒 Logged out of primary system");
      }

      // Cleanup fallback system
      if (this.cluster) {
        await this.cluster.close();
        Logger.success("🔒 Cleaned up fallback system");
      }

      await this.saveProgress(null, null, this.stats.uniqueTweets, {
        completed: true,
        endTime: new Date().toISOString(),
        fallbackUsed: this.stats.fallbackUsed,
        fallbackCount: this.stats.fallbackCount,
        rateLimitHits: this.stats.rateLimitHits,
      });

      Logger.success("✨ Cleanup complete");
    } catch (error) {
      Logger.warn(`⚠️  Cleanup error: ${error.message}`);
      await this.saveProgress(null, null, this.stats.uniqueTweets, {
        completed: true,
        endTime: new Date().toISOString(),
        error: error.message,
      });
    }
  }

  async logError(error, context = {}) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
      },
      context: {
        ...context,
        username: this.username,
        sessionDuration: Date.now() - this.stats.startTime,
        rateLimitHits: this.stats.rateLimitHits,
        fallbackUsed: this.stats.fallbackUsed,
        fallbackCount: this.stats.fallbackCount,
      },
      stats: this.stats,
      config: {
        delays: {
          min: this.config.twitter.minDelayBetweenRequests,
          max: this.config.twitter.maxDelayBetweenRequests,
        },
        retries: this.config.twitter.maxRetries,
        fallback: {
          enabled: this.config.fallback.enabled,
          sessionDuration: this.config.fallback.sessionDuration,
        },
      },
    };

    const errorLogPath = path.join(
      this.dataOrganizer.baseDir,
      "meta",
      "error_log.json"
    );

    try {
      let existingLogs = [];
      try {
        const existing = await fs.readFile(errorLogPath, "utf-8");
        existingLogs = JSON.parse(existing);
      } catch {
        // File doesn't exist yet
      }

      existingLogs.push(errorLog);

      // Keep only recent errors
      if (existingLogs.length > 100) {
        existingLogs = existingLogs.slice(-100);
      }

      await fs.writeFile(errorLogPath, JSON.stringify(existingLogs, null, 2));
    } catch (logError) {
      Logger.error(`Failed to save error log: ${logError.message}`);
    }
  }

  async saveProgress(startDate, endDate, totalTweets, progress) {
    const progressPath = path.join(this.dataOrganizer.baseDir, 'meta', 'progress.json');
    let existingProgress = {};

    try {
      const existing = await fs.readFile(progressPath, 'utf-8');
      existingProgress = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    existingProgress.progress = progress;
    existingProgress.totalTweets = totalTweets;
    existingProgress.startDate = startDate;
    existingProgress.endDate = endDate;

    await fs.writeFile(progressPath, JSON.stringify(existingProgress, null, 2));
  }
}

export default TwitterPipeline;
// src/utils/DataOrganizer.js
import fs from 'fs/promises';
import path from 'path';
import { format } from 'date-fns';
import Logger from './Logger.js';

class DataOrganizer {
  constructor(baseDir, username) {
    this.baseDir = path.join(
      baseDir,
      username.toLowerCase(),
      format(new Date(), 'yyyy-MM-dd')
    );
    this.createDirectories();
  }

  /**
   * Creates necessary directories for storing data.
   */
  async createDirectories() {
    const dirs = ['raw', 'processed', 'analytics', 'exports', 'meta'];
    for (const dir of dirs) {
      const fullPath = path.join(this.baseDir, dir);
      try {
        await fs.mkdir(fullPath, { recursive: true });
        Logger.info(`✅ Created directory: ${path.join(this.baseDir, dir)}`);
      } catch (error) {
        Logger.warn(`⚠️  Failed to create directory ${fullPath}: ${error.message}`);
      }
    }
  }

  /**
   * Returns the file paths for various data categories.
   */
  getPaths() {
    return {
      raw: {
        tweets: path.join(this.baseDir, 'raw', 'tweets.json'),
        urls: path.join(this.baseDir, 'raw', 'urls.txt'),
      },
      processed: {
        finetuning: path.join(this.baseDir, 'processed', 'finetuning.jsonl'),
      },
      analytics: {
        stats: path.join(this.baseDir, 'analytics', 'stats.json'),
      },
      exports: {
        summary: path.join(this.baseDir, 'exports', 'summary.md'),
      },
      meta: {
        nextToken: path.join(this.baseDir, 'meta', 'next_token.txt'),
      },
    };
  }

  /**
   * Saves collected tweets and related data.
   * @param {object[]} tweets - Array of tweet objects.
   * @returns {object} analytics - Generated analytics from tweets.
   */
  async saveTweets(tweets) {
    const paths = this.getPaths();

    try {
      // Save raw tweets
      await fs.writeFile(
        paths.raw.tweets,
        JSON.stringify(tweets, null, 2),
        'utf-8'
      );
      Logger.success(`✅ Saved tweets to ${paths.raw.tweets}`);

      // Save tweet URLs
      const urls = tweets.map((t) => t.permanentUrl);
      await fs.writeFile(paths.raw.urls, urls.join('\n'), 'utf-8');
      Logger.success(`✅ Saved tweet URLs to ${paths.raw.urls}`);

      // Generate and save analytics
      const analytics = this.generateAnalytics(tweets);
      await fs.writeFile(
        paths.analytics.stats,
        JSON.stringify(analytics, null, 2),
        'utf-8'
      );
      Logger.success(`✅ Saved analytics to ${paths.analytics.stats}`);

      // Generate and save fine-tuning data
      const finetuningData = this.generateFinetuningData(tweets);
      Logger.info(
        `ℹ️  Generating fine-tuning data with ${finetuningData.length} entries`
      );

      if (finetuningData.length > 0) {
        await fs.writeFile(
          paths.processed.finetuning,
          finetuningData.map((d) => JSON.stringify(d)).join('\n'),
          'utf-8'
        );
        Logger.success(
          `✅ Saved fine-tuning data to ${paths.processed.finetuning}`
        );
      } else {
        Logger.warn('⚠️  No fine-tuning data to save.');
      }

      // Generate and save summary
      const summary = this.generateSummary(tweets, analytics);
      await fs.writeFile(paths.exports.summary, summary, 'utf-8');
      Logger.success(`✅ Saved summary to ${paths.exports.summary}`);

      return analytics;
    } catch (error) {
      Logger.error(`❌ Error saving data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generates analytics from tweets.
   * @param {object[]} tweets - Array of tweet objects.
   * @returns {object} analytics - Generated analytics data.
   */
  generateAnalytics(tweets) {
    if (tweets.length === 0) {
      Logger.warn('⚠️  No tweets to analyze.');
      return {
        totalTweets: 0,
        directTweets: 0,
        replies: 0,
        retweets: 0,
        engagement: {
          totalLikes: 0,
          totalRetweetCount: 0,
          totalReplies: 0,
          averageLikes: '0.00',
          topTweets: [],
        },
        timeRange: {
          start: 'N/A',
          end: 'N/A',
        },
        contentTypes: {
          withImages: 0,
          withVideos: 0,
          withLinks: 0,
          textOnly: 0,
        },
      };
    }

    const validTweets = tweets.filter((t) => t.timestamp !== null);
    const invalidTweets = tweets.filter((t) => t.timestamp === null);

    if (invalidTweets.length > 0) {
      Logger.warn(
        `⚠️  Found ${invalidTweets.length} tweets with invalid or missing dates. They will be excluded from analytics.`
      );
    }

    const validDates = validTweets
      .map((t) => t.timestamp)
      .sort((a, b) => a - b);

    const tweetsForEngagement = tweets.filter((t) => !t.isRetweet);

    return {
      totalTweets: tweets.length,
      directTweets: tweets.filter((t) => !t.isReply && !t.isRetweet).length,
      replies: tweets.filter((t) => t.isReply).length,
      retweets: tweets.filter((t) => t.isRetweet).length,
      engagement: {
        totalLikes: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.likes || 0),
          0
        ),
        totalRetweetCount: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.retweetCount || 0),
          0
        ),
        totalReplies: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.replies || 0),
          0
        ),
        averageLikes: (
          tweetsForEngagement.reduce((sum, t) => sum + (t.likes || 0), 0) /
          tweetsForEngagement.length
        ).toFixed(2),
        topTweets: tweetsForEngagement
          .sort((a, b) => (b.likes || 0) - (a.likes || 0))
          .slice(0, 5)
          .map((t) => ({
            id: t.id,
            text: t.text,
            likes: t.likes,
            retweetCount: t.retweetCount,
            replies: t.replies,
            timestamp: t.timestamp,
            url: t.permanentUrl,
          })),
      },
      timeRange: {
        start: format(new Date(validDates[0]), 'yyyy-MM-dd'),
        end: format(new Date(validDates[validDates.length - 1]), 'yyyy-MM-dd'),
      },
      contentTypes: {
        withImages: tweets.filter((t) => t.photos.length > 0).length,
        withVideos: tweets.filter((t) => t.videos.length > 0).length,
        withLinks: tweets.filter((t) => t.urls.length > 0).length,
        textOnly: tweets.filter(
          (t) =>
            t.photos.length === 0 &&
            t.videos.length === 0 &&
            t.urls.length === 0
        ).length,
      },
    };
  }

  /**
   * Generates fine-tuning data from tweets.
   * @param {object[]} tweets - Array of tweet objects.
   * @returns {object[]} fineTuningData - Array of fine-tuning data objects.
   */
  generateFinetuningData(tweets) {
    return tweets
      .filter(
        (tweet) => !tweet.isRetweet && tweet.text && tweet.timestamp !== null
      )
      .map((tweet) => {
        let cleanText = tweet.text
          .replace(/(?:https?:\/\/|www\.)[^\s]+/g, '') // Remove URLs
          .replace(/#[^\s#]+/g, '') // Remove Hashtags
          .replace(/\s+/g, ' ')
          .trim();

        if (!cleanText) return null;

        return {
          text: cleanText,
        };
      })
      .filter((entry) => {
        if (!entry) return false;
        return typeof entry.text === 'string' && entry.text.length > 0;
      });
  }

  /**
   * Generates a summary of the collected data.
   * @param {object[]} tweets - Array of tweet objects.
   * @param {object} analytics - Generated analytics data.
   * @returns {string} summary - Markdown formatted summary.
   */
  generateSummary(tweets, analytics) {
    return `# Twitter Data Collection Summary

## Overview
- **Collection Date:** ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
- **Total Tweets:** ${analytics.totalTweets}
- **Date Range:** ${analytics.timeRange.start} to ${analytics.timeRange.end}

## Tweet Distribution
- **Direct Tweets:** ${analytics.directTweets}
- **Replies:** ${analytics.replies}
- **Retweets (retweeted tweets):** ${analytics.retweets}

## Content Types
- **With Images:** ${analytics.contentTypes.withImages}
- **With Videos:** ${analytics.contentTypes.withVideos}
- **With Links:** ${analytics.contentTypes.withLinks}
- **Text Only:** ${analytics.contentTypes.textOnly}

## Engagement Statistics (Original Tweets and Replies)
- **Total Likes:** ${analytics.engagement.totalLikes.toLocaleString()}
- **Total Retweet Count:** ${analytics.engagement.totalRetweetCount.toLocaleString()}
- **Total Replies:** ${analytics.engagement.totalReplies.toLocaleString()}
- **Average Likes per Tweet:** ${analytics.engagement.averageLikes}

## Top Tweets
${analytics.engagement.topTweets
  .map((t) => `- [${t.likes} likes] ${t.text}...\n  • ${t.url}`)
  .join('\n\n')}

## Storage Details
Raw data, analytics, and exports can be found in:
**${this.baseDir}**
`;
  }

  async getTweetsForAccount(accountName) {
    const accountDir = path.resolve(this.baseDir, '..', '..', accountName);
    const dateFolders = await fs.readdir(accountDir);

    let allTweets = [];
    for (const dateFolder of dateFolders) {
        const rawTweetsPath = path.join(accountDir, dateFolder, 'raw', 'tweets.json');
        try {
            const data = await fs.readFile(rawTweetsPath, 'utf-8');
            allTweets = allTweets.concat(JSON.parse(data));
        } catch (error) {
            // Ignore if file doesn't exist for a particular day
        }
    }
    return allTweets;
  }

  async createMergedCharacter(sourceAccounts, options) {
    let allTweets = [];
    for (const account of sourceAccounts) {
      const tweets = await this.getTweetsForAccount(account);
      allTweets.push(...tweets);
    }

    if (options.excludeRetweets) {
      allTweets = allTweets.filter(tweet => !tweet.isRetweet);
    }
    
    // Rank tweets
    allTweets.sort((a, b) => {
      const engagementA = (a.likes || 0) + (a.retweetCount || 0);
      const engagementB = (b.likes || 0) + (b.retweetCount || 0);
      return engagementB - engagementA;
    });

    const topTweets = allTweets.slice(0, options.tweetsPerAccount || 50);

    // Save the merged character data
    await this.saveTweets(topTweets);
  }
}

export default DataOrganizer;

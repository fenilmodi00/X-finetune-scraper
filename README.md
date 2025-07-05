# Twitter Scraper & Finetuning Pipeline

This project provides a pipeline for generating AI character files and training datasets by scraping public figures' online presence, primarily from Twitter. It includes tools for collecting, merging, and preparing data for fine-tuning large language models.

## Disclaimer

This tool is intended for educational and research purposes only. The data collected is publicly available, but you should respect Twitter's terms of service and the privacy of individuals. The authors are not responsible for any misuse of this tool. Use at your own risk.

> ⚠️ **IMPORTANT**: To avoid potential account restrictions, it is strongly recommended to create a new, separate Twitter account for using this tool. **DO NOT use your main account.**

## Features

-   **Comprehensive Twitter Scraping**: Collect tweets from any public Twitter profile, with options to filter by date range.
-   **Multi-Account Merging**: Combine the tweet data from multiple scraped accounts into a single, unified character profile.
-   **Automated Data Processing**: Automatically processes raw tweet data into a structured format, ready for analysis or training.
-   **Finetuning-Ready Exports**: Generates `.jsonl` files formatted specifically for fine-tuning large language models.
-   **Character Profile Generation**: Creates detailed character profiles based on the user's online activity, including topics of interest and common phrases.
-   **Integrated Fine-Tuning**: Includes a simple command to start a fine-tuning job on the Together AI platform with your collected data.
-   **Secure Authentication**: Uses browser cookies (`auth_token` and `ct0`) for a more secure and reliable connection to Twitter, avoiding the need to store passwords.
-   **Blog Content Scraping**: Optional module to scrape text content from a list of blog article URLs.

## Acknowledgements

This project is built upon the great work of others in the open-source community. It is a fork of and gives special thanks to:

-   **[clydedevv/twitter-scraper-finetune](https://github.com/clydedevv/twitter-scraper-finetune)** for the original pipeline structure.
-   **[the-convocation/twitter-scraper](https://github.com/the-convocation/twitter-scraper)** for the underlying Node.js scraping library.

## Setup

1.  **Install dependencies:**
    ```bash
    bun install
    ```

2.  **Create and configure your `.env` file:**
    Copy the `.env.example` to a new file named `.env`. You must fill it out with your Twitter authentication cookies.

   ```properties
    # --- Instructions for your .env file ---
    #
    # 1. Log in to twitter.com in your web browser.
    # 2. Open your browser's developer tools (usually F12).
    # 3. Go to the "Application" (Chrome) or "Storage" (Firefox) tab.
    # 4. Find the cookies for "https://twitter.com".
    # 5. Copy the values for "auth_token" and "ct0" into the fields below.

    TWITTER_AUTH_TOKEN=your_auth_token_here
    TWITTER_CT0=your_ct0_value_here
    TWITTER_USERNAME=your_twitter_username_without_the_at_symbol
   ```

## Usage

All commands should be run from the root of the project.

### 1. Collect Tweets

-   **Collect all tweets for a user:**
    ```bash
    bun run twitter -- <username>
    ```
    *Example:* `bun run twitter -- pmarca`

-   **Collect tweets within a specific date range:**
    The `username` is a positional argument, while the dates are named flags.
    ```bash
    bun run twitter -- <username> --start-date YYYY-MM-DD --end-date YYYY-MM-DD
    ```
    *Example:* `bun run twitter -- gregosuri --start-date 2024-01-01 --end-date 2024-07-01`

### 2. Merge Multiple Characters

This combines the scraped data from several users into a single new character.

```bash
bun run merge-characters -- <new_character_name> <user1> <user2> <user3> ...
```
*Example:* `bun run merge-characters -- crypto_gurus pmarca gregosuri cobie`

### 3. Generate a Character Profile

This processes the scraped tweets for a single user to generate a character profile.

```bash
bun run character -- <username>
```
*Example:* `bun run character -- pmarca`

### 4. Fine-Tune a Model

This script uses the collected data to fine-tune a model on the Together AI platform.

-   **Run the fine-tuning process:**
    ```bash
    bun run finetune
    ```

-   **Run in test mode (no actual job started):**
    ```bash
    bun run finetune:test
    ```

### (Optional) Blog Collection

This script scrapes blog articles listed in a file.

```bash
bun run blog
```
See `src/blog/readme.md` for instructions on setting up the blog list file.

### Generate Virtuals Character Card
https://whitepaper.virtuals.io/developer-documents/agent-contribution/contribute-to-cognitive-core#character-card-and-goal-samples

Run this after Twitter Collection step 
```bash
bun run generate-virtuals -- username date 
```

Example: `bun run generate-virtuals -- pmarca 2024-11-29`
Example without date: `bun run generate-virtuals -- pmarca`

The generated character file will be in the `pipeline/[username]/[date]/character/character.json` directory.
The generated tweet dataset file will be in `pipeline/[username]/[date]/raw/tweets.json`.

### Generate Merged Character
```bash
bun run generate-merged-virtuals -- username date
```
Example: `bun run generate-merged-virtuals -- pmarca 2024-11-29`

The generated merged character file will be in `pipeline/[username]/[date]/character/merged_character.json` directory.
§
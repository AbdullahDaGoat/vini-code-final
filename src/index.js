// index.js
import 'dotenv/config';
import { startBot } from './bot.js';
import { startServer } from './server.js';

// Start the bot
startBot();

// Start the Express server
startServer();
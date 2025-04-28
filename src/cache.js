const LRU = require('lru-cache');
require('dotenv').config();

const options = {
  max: parseInt(process.env.CACHE_MAX, 10) || 100,
  ttl: 1000 * 60 * 5, // 5 minutes
};

const cache = new LRU(options);

module.exports = cache;

// Cluster workers
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
if (cluster.isMaster) {
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died, forking...`);
    cluster.fork();
  });
  return;
}

// Worker processes continue
let sequelize;
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const Redis = require('ioredis');
const Joi = require('joi');
const clientProm = require('prom-client');
const cache = require('./cache');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
// Security & CORS
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// Rate limiting
app.use(rateLimit({ windowMs: parseInt(process.env.RATE_LIMIT_WINDOW,10) || 15*60*1000, max: parseInt(process.env.RATE_LIMIT_MAX,10) || 100 }));
// Logging
app.use(morgan('combined'));
// Body parser
app.use(express.json());

// Redis client
const redis = new Redis({ host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT || 6379 });
redis.on('error', (e) => console.error('Redis error', e));

// Metrics
clientProm.collectDefaultMetrics();
const cacheHitCounter = new clientProm.Counter({ name: 'cache_hits_total', help: 'Total cache hits' });
const cacheMissCounter = new clientProm.Counter({ name: 'cache_misses_total', help: 'Total cache misses' });

// Swagger/OpenAPI setup (baseURL /v1)
const PORT = process.env.PORT || 3000;
const swaggerDefinition = {
  openapi: '3.0.0',
  info: { title: 'LRU Caching Server API', version: '1.0.0' },
  servers: [{ url: `http://localhost:${PORT}/v1` }],
  components: { schemas: { Item: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, value: { type: 'string' } } } } }
};
const options = { definition: swaggerDefinition, apis: ['src/**/*.js'] };
const swaggerSpec = swaggerJsdoc(options);
app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', clientProm.register.contentType);
  res.end(await clientProm.register.metrics());
});
// Health endpoint
app.get('/health', async (req, res) => {
  let db = 'up'; try { await sequelize.authenticate(); } catch { db = 'down'; }
  let red = 'up'; try { await redis.ping(); } catch { red = 'down'; }
  res.json({ db, redis: red, memoryCacheSize: cache.size });
});

// Initialize DB + models + routes under /v1
(async () => {
  const { Sequelize, DataTypes } = require('sequelize');
  try {
    sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, { host: process.env.DB_HOST, port: process.env.DB_PORT || 3306, dialect: 'mariadb', logging: false });
    await sequelize.authenticate(); console.log('DB connected (MariaDB)');
  } catch (e) {
    console.error('MariaDB error:', e.message);
    console.log('Fallback to SQLite');
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  }
  const Item = sequelize.define('Item', { id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, name: { type: DataTypes.STRING, allowNull: false }, value: { type: DataTypes.TEXT } }, { tableName: 'items', timestamps: false });
  await sequelize.sync(); console.log('Models synced');

  const router = express.Router();
  /**
   * @swagger
   * /items/{id}:
   *   get:
   *     summary: Retrieve an item by ID
   *     tags:
   *       - Items
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Item'
   *       404:
   *         description: Not found
   */
  router.get('/items/:id', async (req, res) => {
    const id = req.params.id;
    let item = cache.get(id);
    if (item) { cacheHitCounter.inc(); return res.json({ source: 'memory', item }); }
    const r = await redis.get(id);
    if (r) { const parsed = JSON.parse(r); cache.set(id, parsed); cacheHitCounter.inc(); return res.json({ source: 'redis', item: parsed }); }
    cacheMissCounter.inc();
    item = await Item.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    cache.set(id, item); redis.set(id, JSON.stringify(item), 'EX', Math.floor((process.env.CACHE_TTL||300000)/1000));
    res.json({ source: 'db', item });
  });
  /**
   * @swagger
   * /items:
   *   post:
   *     summary: Create a new item
   *     tags:
   *       - Items
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *               value:
   *                 type: string
   *     responses:
   *       201:
   *         description: Created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Item'
   *       400:
   *         description: Bad Request
   */
  const schema = Joi.object({ name: Joi.string().required(), value: Joi.string().allow('', null) });
  router.post('/items', async (req, res) => {
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });
    const newItem = await Item.create(value);
    cache.set(newItem.id.toString(), newItem);
    redis.set(newItem.id.toString(), JSON.stringify(newItem), 'EX', Math.floor((process.env.CACHE_TTL||300000)/1000));
    res.status(201).json(newItem);
  });

  app.use('/v1', router);

  const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => { sequelize.close(); redis.quit(); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();

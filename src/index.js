// Force IPv4 DNS resolution order and ensure DB_HOST uses IPv4
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
require('dotenv').config();
if (process.env.DB_HOST === 'localhost') {
  process.env.DB_HOST = '127.0.0.1';
}

const express = require('express');
const cache = require('./cache');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(express.json());

// Swagger/OpenAPI setup
const swaggerDefinition = {
  openapi: '3.0.0',
  info: { title: 'LRU Caching Server API', version: '1.0.0', description: 'API documentation for LRU Caching Server' },
  servers: [{ url: `http://localhost:${process.env.PORT || 3000}` }],
  components: {
    schemas: {
      Item: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
};
const options = { swaggerDefinition, apis: ['./src/index.js'] };
const swaggerSpec = swaggerJsdoc(options);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const PORT = process.env.PORT || 3000;

// Initialize DB with MariaDB, fallback to SQLite
async function initDb() {
  const { Sequelize, DataTypes } = require('sequelize');
  let sequelize;
  try {
    sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      dialect: 'mariadb',
      logging: false,
    });
    await sequelize.authenticate();
    console.log('DB connected (MariaDB)');
  } catch (err) {
    console.error('MariaDB connection error:', err.message);
    console.log('Falling back to SQLite in-memory DB');
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  }

  const Item = sequelize.define('Item', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'items',
    timestamps: false,
  });

  await sequelize.sync();
  console.log('Models synced');
  return Item;
}

initDb().then((Item) => {
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
   *               type: object
   *               properties:
   *                 source:
   *                   type: string
   *                 item:
   *                   $ref: '#/components/schemas/Item'
   *       404:
   *         description: Not found
   */
  app.get('/items/:id', async (req, res) => {
    const id = req.params.id;
    let item = cache.get(id);
    if (item) {
      return res.json({ source: 'cache', item });
    }
    item = await Item.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    cache.set(id, item);
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
  app.post('/items', async (req, res) => {
    const { name, value } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const newItem = await Item.create({ name, value });
    cache.set(newItem.id.toString(), newItem);
    res.status(201).json(newItem);
  });

  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch((err) => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});

const express = require('express');
const { sequelize, Item } = require('./models');
const cache = require('./cache');
require('dotenv').config();
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(express.json());

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
          value: { type: 'string' }
        }
      }
    }
  }
};
const options = { swaggerDefinition, apis: ['./src/index.js'] };
const swaggerSpec = swaggerJsdoc(options);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Sync DB
(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB connected');
    await sequelize.sync();
    console.log('Models synced');
  } catch (err) {
    console.error('DB connection error:', err);
    process.exit(1);
  }
})();

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
// GET item by id
app.get('/items/:id', async (req, res) => {
  const id = req.params.id;
  // Check cache
  let item = cache.get(id);
  if (item) {
    return res.json({ source: 'cache', item });
  }

  // Fetch from DB
  item = await Item.findByPk(id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  // Populate cache
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
// POST create item
app.post('/items', async (req, res) => {
  const { name, value } = req.body;
  const item = await Item.create({ name, value });
  cache.set(item.id.toString(), item);
  res.status(201).json(item);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

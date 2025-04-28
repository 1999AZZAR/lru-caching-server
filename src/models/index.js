const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

// Ensure IPv4 host to avoid IPv6 resolution issues
const dbHost = process.env.DB_HOST === 'localhost'
  ? '127.0.0.1'
  : process.env.DB_HOST;
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: dbHost || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    dialect: 'mariadb',
    logging: false,
  }
);

const Item = sequelize.define('Item', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'items',
  timestamps: false,
});

module.exports = { sequelize, Item };

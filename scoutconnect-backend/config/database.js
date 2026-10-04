const { Sequelize } = require('sequelize');
require('dotenv').config();

// This ensures the backend connects to Supabase securely using SSL
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false // Required for Supabase pooling
    }
  },
  logging: false
});

module.exports = sequelize;
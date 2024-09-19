const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  prefix: { type: String, default: '!' },
  name: { type: String, required: true },
  id: { type: String, required: true }
});

module.exports = mongoose.model('Token', tokenSchema);

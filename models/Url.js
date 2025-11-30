const mongoose = require('mongoose');

const urlSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    longUrl: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Optional TTL-style index for automatic cleanup of expired URLs
urlSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $ne: null } } }
);

module.exports = mongoose.model('Url', urlSchema);

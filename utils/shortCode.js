const crypto = require('crypto');

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function bufferToBase62(buffer, length = 7) {
  let value = BigInt('0x' + buffer.toString('hex'));
  const base = BigInt(62);
  const chars = [];

  while (chars.length < length) {
    const remainder = value % base;
    chars.push(BASE62_ALPHABET[Number(remainder)]);
    value = value / base;
  }

  return chars.join('');
}

function generateShortCode(longUrl, attempt = 0, length = 7) {
  const hash = crypto
    .createHash('sha256')
    .update(longUrl + String(attempt))
    .digest();

  return bufferToBase62(hash, length);
}

module.exports = {
  generateShortCode,
};

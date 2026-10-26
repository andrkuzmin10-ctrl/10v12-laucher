'use strict';
const { createHash } = require('node:crypto');
// Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name): deterministic offline identity.
function localProfile(value) {
  if (typeof value !== 'string') throw new Error('Ник должен быть строкой.');
  const name = value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: от 3 до 16 символов — латинские буквы, цифры и _.');
  const bytes = createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return { name, id: bytes.toString('hex') };
}
module.exports = { localProfile };

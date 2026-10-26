import selfsigned from 'selfsigned';
import fs from 'node:fs';
import os from 'node:os';

const ips = [];
for (const list of Object.values(os.networkInterfaces())) {
  for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
}
const altNames = [
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },
  ...ips.map(ip => ({ type: 7, ip })),
];
console.log('SAN:', JSON.stringify(altNames));

// selfsigned v5 is async (built on @peculiar/x509).
const pems = await selfsigned.generate(
  [{ name: 'commonName', value: 'poolcore.local' }],
  {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  }
);
if (!pems || !pems.cert || !pems.private) {
  console.error('unexpected shape:', Object.keys(pems || {}));
  process.exit(1);
}
fs.writeFileSync('tools/dev-cert.pem', pems.cert);
fs.writeFileSync('tools/dev-key.pem', pems.private);
console.log('wrote tools/dev-cert.pem', pems.cert.length, 'bytes');
console.log('wrote tools/dev-key.pem', pems.private.length, 'bytes');

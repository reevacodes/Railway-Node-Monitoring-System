const fs = require('fs');

function parseCSV(text) {
  const rows = [];
  let row = [];
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(current.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some(cell => cell.length > 0)) rows.push(row);
  }
  return rows;
}

console.log('=== ANALYZING INVENTORY.CSV ===');
const invText = fs.readFileSync('./data/inventory.csv', 'utf8');
const invRows = parseCSV(invText);
console.log('Headers:', invRows[0]);
console.log('Total inventory data rows:', invRows.length - 1);

const macRegex = /([0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2})/g;

let totalMacs = 0;
let uniqueNormalizedMacs = new Set();
let multiMacRows = [];
let singleMacRows = [];
let noMacRows = [];

invRows.slice(1).forEach((r, idx) => {
  const rawMac = r[0] || '';
  const matches = rawMac.match(macRegex) || [];
  totalMacs += matches.length;
  matches.forEach(m => uniqueNormalizedMacs.add(m.replace(/[^0-9a-fA-F]/g, '').toLowerCase()));

  if (matches.length > 1) {
    multiMacRows.push({ row: idx + 2, rawMac, count: matches.length, matches, name: r[1], loc: r[3] });
  } else if (matches.length === 1) {
    singleMacRows.push({ row: idx + 2, mac: matches[0], name: r[1], loc: r[3] });
  } else {
    noMacRows.push({ row: idx + 2, rawMac, r });
  }
});

console.log('Total individual MAC instances in inventory:', totalMacs);
console.log('Unique normalized MACs:', uniqueNormalizedMacs.size);
console.log('Multi-MAC rows count:', multiMacRows.length);
console.log('Multi-MAC details:', multiMacRows);
console.log('No-MAC rows count:', noMacRows.length);

console.log('\n=== ANALYZING ARP-IPV4-PARSED.CSV ===');
const arpText = fs.readFileSync('./data/arp-ipv4-parsed.csv', 'utf8');
const arpRows = parseCSV(arpText);
console.log('Headers:', arpRows[0]);
console.log('Total ARP entries:', arpRows.length - 1);

let arpWithMac = 0;
let arpWithoutMac = 0;
let arpNormalizedMacs = new Set();
let states = {};
let interfaces = {};

arpRows.slice(1).forEach((r) => {
  const ip = r[0];
  const mac = r[1];
  const iface = r[2];
  const state = r[3];
  const hasMac = r[4];
  const isRouter = r[5];

  states[state] = (states[state] || 0) + 1;
  interfaces[iface] = (interfaces[iface] || 0) + 1;

  if (mac && mac.trim().length > 0) {
    arpWithMac++;
    const norm = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    arpNormalizedMacs.add(norm);
  } else {
    arpWithoutMac++;
  }
});

console.log('ARP entries with MAC:', arpWithMac);
console.log('ARP entries without MAC (FAILED, etc.):', arpWithoutMac);
console.log('Unique ARP normalized MACs:', arpNormalizedMacs.size);
console.log('States distribution:', states);
console.log('Interfaces distribution:', interfaces);

// Calculate overlap / matches!
let matchedInventoryMacs = 0;
let matchedArpEntries = 0;

uniqueNormalizedMacs.forEach(norm => {
  if (arpNormalizedMacs.has(norm)) {
    matchedInventoryMacs++;
  }
});

console.log('\n=== INVENTORY vs ARP MATCHING ===');
console.log(`Matched unique inventory MACs against ARP: ${matchedInventoryMacs} / ${uniqueNormalizedMacs.size}`);

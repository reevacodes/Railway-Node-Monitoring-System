#!/usr/bin/env node

/**
 * CLI Runner for Sophos ARP Snapshot Import (Module 2)
 * 
 * Usage:
 *   node backend/import_arp_cli.js [--file=<path>] [--name=<name>] [--dry-run]
 * 
 * Examples:
 *   node backend/import_arp_cli.js --file="../sophos-arp-test/arp-snapshot.json"
 *   node backend/import_arp_cli.js --dry-run
 */

const path = require('path');
const pool = require('./db');
const { importArpSnapshot } = require('./arp_importer');

function printUsage() {
  console.log(`
======================================================
 Sophos ARP Snapshot CLI Importer
======================================================
Usage:
  node backend/import_arp_cli.js [options]

Options:
  --file=<path>       Path to snapshot file (JSON or CSV).
                      Default: ../sophos-arp-test/arp-snapshot.json
  --name=<name>       Custom name for this snapshot.
  --dry-run           Run transaction and ROLLBACK at the end (preview mode).
  --help              Show this help message.

Examples:
  node backend/import_arp_cli.js --file="../sophos-arp-test/arp-snapshot.json"
  node backend/import_arp_cli.js --dry-run
======================================================
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');

  let filePath = null;
  let snapshotName = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--file=')) {
      filePath = arg.substring('--file='.length);
    } else if (arg === '--file' && args[i + 1]) {
      filePath = args[i + 1];
      i++;
    } else if (arg.startsWith('--name=')) {
      snapshotName = arg.substring('--name='.length);
    } else if (arg === '--name' && args[i + 1]) {
      snapshotName = args[i + 1];
      i++;
    } else if (!arg.startsWith('--') && !filePath) {
      filePath = arg;
    }
  }

  const defaultCanonical = path.resolve(__dirname, '../sophos-arp-test/arp-snapshot.json');
  const targetFile = filePath ? path.resolve(process.cwd(), filePath) : defaultCanonical;

  console.log(`\n======================================================`);
  console.log(` Starting ARP Snapshot Import`);
  console.log(` Source File:  ${targetFile}`);
  console.log(` Mode:         ${dryRun ? 'DRY-RUN (will ROLLBACK, zero DB mutation)' : 'PRODUCTION IMPORT (will COMMIT to DB)'}`);
  if (snapshotName) {
    console.log(` Custom Name:  ${snapshotName}`);
  }
  console.log(`======================================================\n`);

  try {
    const result = await importArpSnapshot(targetFile, {
      snapshotName: snapshotName || undefined,
      dryRun
    });

    console.log(`Import Result Summary:`);
    console.log(`------------------------------------------------------`);
    console.log(` Snapshot ID:             ${result.snapshotId}`);
    console.log(` Snapshot Name:           ${result.snapshotName}`);
    console.log(` Total Entries Processed: ${result.totalEntries}`);
    console.log(` Entries with Valid MAC:  ${result.entriesWithMac}`);
    console.log(` Incomplete / No MAC:     ${result.invalidEntriesCount}`);
    console.log(` Matched Inventory Items: ${result.matchedInventoryCount} (out of ${result.totalInventoryRecords} total)`);
    console.log(` Unmatched Discovered:    ${result.unmatchedCount}`);
    console.log(` Unobserved Inventory:    ${result.unobservedInventoryCount}`);
    console.log(` Status:                  ${result.dryRun ? 'Rolled back (DRY-RUN mode)' : 'Successfully Committed'}`);
    console.log(`------------------------------------------------------\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n[ERROR] Import failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

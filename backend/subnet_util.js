/**
 * IPv4 Subnet and CIDR Calculation Utilities
 * Railway Node Monitoring System
 */

const net = require('net');

/**
 * Validates whether a string is a valid IPv4 address
 */
function isValidIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  if (!net.isIPv4(trimmed)) return false;
  const parts = trimmed.split('.').map(Number);
  return parts.length === 4 && parts.every(p => p >= 0 && p <= 255);
}

/**
 * Converts dotted-decimal IPv4 to 32-bit unsigned integer
 */
function ipToInt(ip) {
  const parts = ip.trim().split('.').map(Number);
  return (((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0)) >>> 0;
}

/**
 * Converts 32-bit unsigned integer to dotted-decimal IPv4
 */
function intToIp(intVal) {
  const p1 = (intVal >>> 24) & 255;
  const p2 = (intVal >>> 16) & 255;
  const p3 = (intVal >>> 8) & 255;
  const p4 = intVal & 255;
  return `${p1}.${p2}.${p3}.${p4}`;
}

/**
 * Converts CIDR prefix (e.g. 24) to subnet mask integer
 */
function cidrToMaskInt(cidr) {
  if (cidr === 0) return 0;
  return ((0xFFFFFFFF << (32 - cidr)) >>> 0);
}

/**
 * Converts CIDR prefix (e.g. 24) to dotted-decimal subnet mask (e.g. '255.255.255.0')
 */
function cidrToMask(cidr) {
  return intToIp(cidrToMaskInt(cidr));
}

/**
 * Converts dotted-decimal subnet mask to CIDR prefix (e.g. '255.255.254.0' -> 23)
 * Returns -1 if invalid mask.
 */
function maskToCidr(mask) {
  if (!isValidIpv4(mask)) return -1;
  const maskInt = ipToInt(mask);
  // A valid subnet mask has contiguous 1s followed by contiguous 0s
  const inverted = (~maskInt) >>> 0;
  // If inverted + 1 is a power of 2, it's contiguous
  if ((inverted & (inverted + 1)) !== 0) return -1;
  
  let count = 0;
  for (let i = 31; i >= 0; i--) {
    if ((maskInt & (1 << i)) !== 0) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Calculates network address, broadcast address, host range, and capacity
 * given an IP/network address and a CIDR prefix.
 */
function getSubnetDetails(ipOrNetwork, cidrPrefix) {
  const cidr = Number(cidrPrefix);
  if (!isValidIpv4(ipOrNetwork) || isNaN(cidr) || cidr < 8 || cidr > 30) {
    throw new Error(`Invalid IPv4 address or CIDR prefix (prefix must be 8-30): ${ipOrNetwork}/${cidrPrefix}`);
  }

  const maskInt = cidrToMaskInt(cidr);
  const rawIpInt = ipToInt(ipOrNetwork);
  const networkInt = (rawIpInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | ((~maskInt) >>> 0)) >>> 0;

  const networkAddress = intToIp(networkInt);
  const broadcastAddress = intToIp(broadcastInt);
  const subnetMask = cidrToMask(cidr);

  // Usable host range
  const firstUsableInt = (networkInt + 1) >>> 0;
  const lastUsableInt = (broadcastInt - 1) >>> 0;

  const firstUsableIp = intToIp(firstUsableInt);
  const lastUsableIp = intToIp(lastUsableInt);
  const totalAddresses = Math.pow(2, 32 - cidr);
  const totalUsableHosts = Math.max(0, totalAddresses - 2);

  return {
    networkAddress,
    cidrPrefix: cidr,
    subnetMask,
    broadcastAddress,
    firstUsableIp,
    lastUsableIp,
    usableIpRange: `${firstUsableIp} – ${lastUsableIp}`,
    totalAddresses,
    totalUsableHosts,
    networkInt,
    broadcastInt,
  };
}

/**
 * Checks if a given IP address falls within the specified subnet
 */
function isIpInSubnet(ip, networkAddress, cidrPrefix) {
  if (!isValidIpv4(ip)) return false;
  try {
    const details = getSubnetDetails(networkAddress, cidrPrefix);
    const targetInt = ipToInt(ip);
    return targetInt >= details.networkInt && targetInt <= details.broadcastInt;
  } catch {
    return false;
  }
}

/**
 * Checks if two subnets overlap in address space
 */
function doSubnetsOverlap(netA, prefixA, netB, prefixB) {
  const subA = getSubnetDetails(netA, prefixA);
  const subB = getSubnetDetails(netB, prefixB);

  // Subnets overlap if:
  // subA.networkInt <= subB.broadcastInt AND subB.networkInt <= subA.broadcastInt
  return subA.networkInt <= subB.broadcastInt && subB.networkInt <= subA.broadcastInt;
}

/**
 * Given an IP and a list of active subnets, finds the best matching subnet (Longest Prefix Match)
 */
function matchIpToSubnets(ip, subnets) {
  if (!isValidIpv4(ip) || !Array.isArray(subnets) || subnets.length === 0) {
    return null;
  }

  const targetInt = ipToInt(ip);
  let bestMatch = null;
  let highestCidr = -1;

  for (const subnet of subnets) {
    if (subnet.is_active === false) continue;
    try {
      const details = getSubnetDetails(subnet.network_address, subnet.cidr_prefix);
      if (targetInt >= details.networkInt && targetInt <= details.broadcastInt) {
        // Longest Prefix Match (higher cidr_prefix means more specific network)
        if (subnet.cidr_prefix > highestCidr) {
          highestCidr = subnet.cidr_prefix;
          bestMatch = {
            ...subnet,
            usableIpRange: details.usableIpRange,
            totalUsableHosts: details.totalUsableHosts,
            firstUsableIp: details.firstUsableIp,
            lastUsableIp: details.lastUsableIp,
          };
        }
      }
    } catch {
      // skip invalid subnets
    }
  }

  return bestMatch;
}

module.exports = {
  isValidIpv4,
  ipToInt,
  intToIp,
  cidrToMaskInt,
  cidrToMask,
  maskToCidr,
  getSubnetDetails,
  isIpInSubnet,
  doSubnetsOverlap,
  matchIpToSubnets,
};

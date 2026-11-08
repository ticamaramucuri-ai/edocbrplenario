/** Canonical request bytes shared by the SaaS verifier and the desktop signer. */
export function localDeviceRequestMessage(args: {
  tenantId: string; deviceId: string; method: string; pathAndQuery: string; timestamp: string; nonce: string
}): Buffer {
  return Buffer.from(['edocbr.local-device.request.v1', args.tenantId, args.deviceId,
    args.method.toUpperCase(), args.pathAndQuery, args.timestamp, args.nonce].join('\n'), 'utf8')
}

/** POST requests bind the exact UTF-8 body bytes to the device signature. */
export function localDeviceRequestMessageV2(args: {
  tenantId: string; deviceId: string; method: string; pathAndQuery: string;
  timestamp: string; nonce: string; bodySha256: string
}): Buffer {
  return Buffer.from(['edocbr.local-device.request.v2', args.tenantId, args.deviceId,
    args.method.toUpperCase(), args.pathAndQuery, args.timestamp, args.nonce,
    args.bodySha256].join('\n'), 'utf8')
}

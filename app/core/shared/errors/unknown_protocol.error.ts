// app/core/shared/errors/unknown_protocol.error.ts

export class UnknownProtocolError extends Error {
  constructor(protocolId: string) {
    super(`Unknown protocol: "${protocolId}"`);

    this.name = 'UnknownProtocolError';
  }
}

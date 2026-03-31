export type DNSPrivateState = {
  secretKey: string; // hex-encoded 32 bytes
};

export const witnesses = {
  secretKey: ({ privateState }: { privateState: DNSPrivateState }): [DNSPrivateState, Uint8Array] =>
    [privateState, new Uint8Array(Buffer.from(privateState.secretKey, "hex"))],
};

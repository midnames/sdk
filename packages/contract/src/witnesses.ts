export type DNSPrivateState = {
  secretKey: Uint8Array;
};

export const witnesses = {
  secretKey: ({ privateState }: { privateState: DNSPrivateState }): [DNSPrivateState, Uint8Array] =>
    [privateState, privateState.secretKey],
};

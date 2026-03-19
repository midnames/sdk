/**
 * Controller Types for the Nameservice SDK
 *
 * These types define the interface for the LeafContractController
 * which manages domain contract interactions with RxJS observable state.
 *
 * Note: The full LeafContractController implementation is in the frontend
 * module at: modules/midnight/nameservice-sdk/api/leafContractController.ts
 */

import type { Observable, Subject } from 'rxjs';

/**
 * Target address - domains can point to either a wallet (CoinPublicKey) or another contract
 */
export interface EitherTarget {
  is_left: boolean;
  left: { bytes: Uint8Array };   // CoinPublicKey (wallet address)
  right: { bytes: Uint8Array };  // ContractAddress
}

/**
 * Subdomain data stored in the parent contract
 */
export interface SubdomainData {
  owner: { bytes: Uint8Array };     // CoinPublicKey
  resolver: { bytes: Uint8Array };  // ContractAddress
}

/**
 * Observable state for a single domain contract
 */
export interface DomainState {
  contractAddress: string;
  target: EitherTarget;
  fields: Map<string, string>;
  subdomains: Map<string, SubdomainData>;
  coinColor: Uint8Array;
  costs: {
    short: bigint;   // ≤3 chars
    medium: bigint;  // 4 chars
    long: bigint;    // 5+ chars
  };
}

/**
 * Operation status for tracking async operations
 */
export type OperationStatus =
  | { type: 'idle' }
  | { type: 'proving'; message?: string }
  | { type: 'signing'; message?: string }
  | { type: 'submitting'; message?: string }
  | { type: 'complete'; txHash?: string }
  | { type: 'error'; error: Error };

/**
 * Result of a transaction operation
 */
export interface TxResult {
  txHash: string;
  blockHeight?: bigint;
}

/**
 * Derived state combining contract state with operation status
 */
export interface DerivedDomainState {
  domain: DomainState | null;
  operationStatus: OperationStatus;
}

/**
 * Interface for the LeafContractController
 *
 * This interface defines the contract for managing domain operations.
 * The implementation uses RxJS observables for reactive state updates.
 */
export interface LeafContractControllerInterface {
  /** The contract address this controller is connected to */
  readonly contractAddress: string;

  /** Observable stream of domain state */
  readonly state$: Observable<DerivedDomainState>;

  /** Subject for operation status updates */
  readonly operations$: Subject<OperationStatus>;

  // Operations
  updateTarget(target: EitherTarget): Promise<TxResult>;
  insertField(key: string, value: string): Promise<TxResult>;
  clearField(key: string): Promise<TxResult>;
  clearAllFields(): Promise<TxResult>;
  addMultipleFields(kvs: Array<[string, string]>): Promise<TxResult>;
  registerDomainFor(ownerCoinPublicKey: Uint8Array, domainName: string, resolverAddress: string): Promise<TxResult>;
  transferDomain(domainName: string, newOwnerCoinPublicKey: Uint8Array): Promise<TxResult>;
}

/**
 * Empty initial state constant
 */
export const emptyDomainState: DerivedDomainState = {
  domain: null,
  operationStatus: { type: 'idle' },
};

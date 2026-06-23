import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  AddressType,
  type Ledger,
  type Maybe,
  type Either,
  ledger
} from "../managed/leaf/contract/index.js";
import { type DNSPrivateState, witnesses } from "../witnesses.js";
import { deriveOwnerPublicKey, hexToBytes } from "./derive.js";

export class NSSimulator {
  readonly contract: Contract<DNSPrivateState>;
  circuitContext: CircuitContext<DNSPrivateState>;

  /**
   * @param secretKey  Hex secret used as the witness for this instance's circuit calls.
   * @param ownerPubkey  Explicit owner key stored on-chain. Defaults to the key derived
   *   from `secretKey`, i.e. the deployer is the owner. Pass a different value to model
   *   a migration deploy where the resolver is bound to the buyer's key, not the deployer's.
   */
  constructor(secretKey: string = "0".repeat(64), ownerPubkey?: Uint8Array) {
    this.contract = new Contract<DNSPrivateState>(witnesses);
    const parentDomain: Maybe<Uint8Array> = { is_some: false, value: new Uint8Array(32) };
    const parentResolver = { bytes: new Uint8Array(32) };
    const target: [Uint8Array, AddressType] = [new Uint8Array(32), AddressType.ZswapCPKAddr];
    const domain: Maybe<Uint8Array> = { is_some: false, value: new Uint8Array(32) };
    const coinColor = new Uint8Array(32);
    const costShort = 100n;
    const costMed = 50n;
    const costLong = 10n;
    const defaultField: Maybe<string> = { is_some: false, value: "" };
    const buyEnabled = true;
    const ownerPublicKey = ownerPubkey ?? deriveOwnerPublicKey(hexToBytes(secretKey));
    const ownerAddress = { bytes: new Uint8Array(32) };
    const noneKv: Maybe<[string, string]> = { is_some: false, value: ["", ""] };
    const kvs: Maybe<[string, string]>[] = Array(10).fill(noneKv);

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext({ secretKey } as DNSPrivateState, "0".repeat(64)),
      parentDomain,
      parentResolver,
      target,
      domain,
      coinColor,
      costShort,
      costMed,
      costLong,
      defaultField,
      buyEnabled,
      ownerPublicKey,
      ownerAddress,
      kvs
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState
    );
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): DNSPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public getDerivedPublicKey(): Uint8Array {
    return this.getLedger().DOMAIN_OWNER[0];
  }

  public registerDomainFor(owner: Uint8Array, domain: Uint8Array, len: bigint, resolver: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.register_domain_for(
      this.circuitContext,
      owner,
      domain,
      len,
      resolver
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public setResolver(domain: Uint8Array, resolver: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.set_resolver(
      this.circuitContext,
      domain,
      resolver
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public transferDomain(domain: Uint8Array, newOwner: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.transfer_domain(
      this.circuitContext,
      domain,
      newOwner
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public changeOwner(newOwner: Uint8Array, newAddress: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.change_owner(
      this.circuitContext,
      newOwner,
      newAddress
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public clearField(key: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.clear_field(
      this.circuitContext,
      key
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public clearAllFields(): Ledger {
    this.circuitContext = this.contract.impureCircuits.clear_all_fields(
      this.circuitContext
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public addMultipleFields(kvs: Maybe<[string, string]>[]): Ledger {
    this.circuitContext = this.contract.impureCircuits.add_multiple_fields(
      this.circuitContext,
      kvs
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public updateColor(color: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_color(
      this.circuitContext,
      color
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public updateCosts(costShort: bigint, costMed: bigint, costLong: bigint, enabled: boolean = true): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_costs(
      this.circuitContext,
      costShort,
      costMed,
      costLong,
      enabled
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public updateDefaultField(d: Maybe<string>): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_default_field(
      this.circuitContext,
      d
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public updateDomainTarget(
    newTarget: Either<{ bytes: Uint8Array }, Either<{ bytes: Uint8Array }, { bytes: Uint8Array }>>
  ): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_domain_target(
      this.circuitContext,
      newTarget
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}

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

export class NSSimulator {
  readonly contract: Contract<DNSPrivateState>;
  circuitContext: CircuitContext<DNSPrivateState>;

  constructor() {
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
    const ownerAddress = { bytes: new Uint8Array(32) };
    const noneKv: Maybe<[string, string]> = { is_some: false, value: ["", ""] };
    const kvs: Maybe<[string, string]>[] = Array(10).fill(noneKv);

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext({ phantom: true } as DNSPrivateState, "0".repeat(64)),
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

  public buyDomainFor(owner: { bytes: Uint8Array }, domain: Uint8Array, len: bigint, resolver: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.buy_domain_for(
      this.circuitContext,
      owner,
      domain,
      len,
      resolver
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public registerDomainFor(owner: { bytes: Uint8Array }, domain: Uint8Array, len: bigint, resolver: { bytes: Uint8Array }): Ledger {
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

  public transferDomain(domain: Uint8Array, newOwner: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.transfer_domain(
      this.circuitContext,
      domain,
      newOwner
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public changeOwner(newOwner: { bytes: Uint8Array }, newAddress: { bytes: Uint8Array }): Ledger {
    this.circuitContext = this.contract.impureCircuits.change_owner(
      this.circuitContext,
      newOwner,
      newAddress
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public insertField(key: string, value: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.insert_field(
      this.circuitContext,
      key,
      value
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

  public updateCosts(costShort: bigint, costMed: bigint, costLong: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_costs(
      this.circuitContext,
      costShort,
      costMed,
      costLong
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

  public updateTargetAndFields(
    newTarget: Either<{ bytes: Uint8Array }, Either<{ bytes: Uint8Array }, { bytes: Uint8Array }>>,
    kvs: Maybe<[string, string]>[]
  ): Ledger {
    this.circuitContext = this.contract.impureCircuits.update_target_and_fields(
      this.circuitContext,
      newTarget,
      kvs
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

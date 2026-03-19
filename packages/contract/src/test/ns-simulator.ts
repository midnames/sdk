import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
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
    const target: Either<{ bytes: Uint8Array }, { bytes: Uint8Array }> = {
      is_left: true,
      left: { bytes: new Uint8Array(32) },
      right: { bytes: new Uint8Array(32) }
    };
    const domain: Maybe<Uint8Array> = { is_some: false, value: new Uint8Array(32) };
    const coinColor = new Uint8Array(32);
    const costShort = 100n;
    const costMed = 50n;
    const costLong = 10n;
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

  public clearAllFields(): Ledger {
    this.circuitContext = this.contract.impureCircuits.clear_all_fields(
      this.circuitContext
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}

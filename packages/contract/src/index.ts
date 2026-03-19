export * as Leaf from "./managed/leaf/contract/index.js";
export {
  type DomainData,
  type Either,
  type Maybe,
  type Witnesses,
  type Ledger,
  ledger,
  Contract
} from "./managed/leaf/contract/index.js";
export { domainToKey, keyToDomain } from "./utils.js";
export { witnesses, type DNSPrivateState } from "./witnesses.js";
export const MANAGED_DIR = new URL("./managed/leaf", import.meta.url).href;

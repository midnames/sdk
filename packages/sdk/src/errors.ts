// Error handling types
export class MidnamesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'MidnamesError';
  }
}

export class NetworkError extends MidnamesError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class ContractNotFoundError extends MidnamesError {
  constructor(contractAddress: string, details?: unknown) {
    super(`Contract not found: ${contractAddress}`, 'CONTRACT_NOT_FOUND', details);
    this.name = 'ContractNotFoundError';
  }
}

export class DomainNotFoundError extends MidnamesError {
  constructor(domain: string, details?: unknown) {
    super(`Domain not found: ${domain}`, 'DOMAIN_NOT_FOUND', details);
    this.name = 'DomainNotFoundError';
  }
}

export class InvalidDomainError extends MidnamesError {
  constructor(domain: string, reason: string, details?: unknown) {
    super(`Invalid domain "${domain}": ${reason}`, 'INVALID_DOMAIN', details);
    this.name = 'InvalidDomainError';
  }
}

export class ProviderError extends MidnamesError {
  constructor(message: string, details?: unknown) {
    super(message, 'PROVIDER_ERROR', details);
    this.name = 'ProviderError';
  }
}
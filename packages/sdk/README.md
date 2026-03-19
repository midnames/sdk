># @midnames/sdk

SDK to resolve Midnames domains, and render a profile widget.

## Build

Run the `build` script with `npm`, `bun`, etc.

## Usage

Resolve a domain:

```ts
import { resolveDomain, getDomainProfile } from '@midnames/sdk';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';

async function demo(provider: PublicDataProvider) {
  const target = await resolveDomain(provider, 'alice.night');
  const profile = await getDomainProfile(provider, 'id.alice.night');
  console.log(target, profile.fields);
}
```

React widget:

```tsx
import '@midnames/sdk/styles.css';
import { DomainProfileWidget } from '@midnames/sdk/react';

<DomainProfileWidget fullDomain="id.alice.night" publicDataProvider={provider} />
```

Fields recognized for display: `name`, `bio`, `avatar`, `banner`, `website`, `twitter`, `github`, `location`, and `epk`.

## API

- `resolveDomain(provider, domain): Promise<string|null>`
- `getDomainProfile(provider, fullDomain): Promise<{ fullDomain, resolvedTarget, info, fields, settings }>`

```ts
export interface DomainInfo { owner: string; resolver: string; contractAddress?: string; }
export interface DomainSettings { coinColor: Uint8Array; costs: { short: bigint; medium: bigint; long: bigint }; }
```

Notes: Uses TestNet TLD contract by default. Provide a custom TLD address in `resolveDomain` if needed.


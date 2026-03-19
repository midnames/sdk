// import { getZswapNetworkId, NetworkId, setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionSecretKey } from "@midnight-ntwrk/wallet-sdk-address-format";
// import { SecretKeys } from "@midnight-ntwrk/zswap";
import * as whd from "@midnight-ntwrk/wallet-sdk-hd"
import * as bip39 from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english";
import { exit } from "process";

async function main() {
  const cliArgs = process.argv.slice(2);
  let seed: string;

  if (cliArgs.length > 0) {
    seed = cliArgs.join(' ').trim();
  } else {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    seed = await new Promise((resolve) => {
      rl.question("mnemonic seed phrase: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!bip39.validateMnemonic(seed, english)) { exit(1) }

  // Convert mnemonic to BIP39 seed (512 bits)
  const bip39Seed = await bip39.mnemonicToSeed(seed, ""); // Empty passphrase

  // Use HD derivation with Midnight's path: m/44'/2400'/0'/3/0 (Zswap role)
  const hdWalletResult = whd.HDWallet.fromSeed(bip39Seed);

  if (hdWalletResult.type !== 'seedOk') {
    console.error("Failed to create HD wallet:", hdWalletResult.error);
    exit(1);
  }

  // Derive key for Zswap role (role 3, index 0)
  const derivationResult = hdWalletResult.hdWallet
    .selectAccount(0)
    .selectRole(whd.Roles.Zswap)  // Role 3
    .deriveKeyAt(0);

  if (derivationResult.type !== 'keyDerived') {
    console.error("Failed to derive key");
    exit(1);
  }

  // Convert to hex string (32 bytes)
  const hexseed = Buffer.from(derivationResult.key).toString('hex')

  console.log(hexseed)
/*
  const v = SecretKeys.fromSeed(derivationResult.key)

  setNetworkId(NetworkId.TestNet)

  console.log(
    v.coinPublicKey
  )
  console.log(
    Buffer.from(
      v.coinSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize(getZswapNetworkId())
    ).toString('hex')
  )
  console.log(
    v.encryptionPublicKey
  )
  console.log(
    Buffer.from(
      v.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize(getZswapNetworkId())
    ).toString('hex')
  )
  
  console.log(
    ShieldedCoinPublicKey.codec.encode(
      getZswapNetworkId(), 
      new ShieldedCoinPublicKey(
        Buffer.from(
          derivationResult.key)
        )
    ).asString()
  ) 

  console.log(
    ShieldedEncryptionSecretKey.codec.encode(
      getZswapNetworkId(), 
      new ShieldedEncryptionSecretKey(
        v.encryptionSecretKey
      )
    ).asString()
  )

*/
}

main().catch(console.error)
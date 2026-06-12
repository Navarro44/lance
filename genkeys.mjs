import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
for (const name of ["SIGNER", "EXECUTOR"]) {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  console.log(`${name}_PRIVATE_KEY=${key}`);
  console.log(`# ${name} address: ${address}`);
}

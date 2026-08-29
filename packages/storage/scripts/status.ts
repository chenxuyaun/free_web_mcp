import { Client } from "@bnb-chain/greenfield-js-sdk";
const client = Client.create("https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org", "5600");
const head = (await client.object.headObject("free-web-mcp-evidence", process.env.OBJECT_NAME!)) as any;
const info = head.objectInfo ?? head;
console.log("objectStatus:", info.objectStatus, "(1=created,2=sealed)");
console.log("primarySpAddress:", info.primarySpAddress);
console.log("payloadSize:", JSON.stringify(info.payloadSize));

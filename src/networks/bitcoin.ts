/** Iterate over new blocks added to the Bitcoin blockchain.
 */
import { Event, Network, Transaction } from "../types";
import {parse} from "url";
import * as jayson from "jayson/promise";

export default class BitcoinNetwork implements Network {
  client: jayson.Client;

  id: string = "bitcoin";

  constructor(rpcUrl: string) {
    let rpc = parse(rpcUrl);
    this.client = jayson.client.https({
      ...rpc,
      headers: {
        'X-API-Key': '43d998a84a549e92783fa9e207dc2b263245f39b'
      }
    });
  }

  async processBlock(blockNum: number) {
    const responseGetblockhash = await this.client.request("getblockhash", [blockNum]);
    const responseGetblock = await this.client.request("getblock", [responseGetblockhash.result, 2]);

    let transactions: Transaction[] = [];

    for (const tx of responseGetblock.result.tx) {
      let events: Event[] = [];

      // // for each output, track the target address and prepare a payload
      if (tx.vout) {
        for (const output of tx.vout) {
          if (output.scriptPubKey && output.scriptPubKey.addresses) {
            for (const address of output.scriptPubKey.addresses) {
              events.push({
                type: "payment-received",
                network: "bip122:000000000019d6689c085ae165831e93",
                address,
                amount: Math.floor(output.value * 100000000).toString(),
                currency: "bip122:000000000019d6689c085ae165831e93/slip44:0",
              });
            }
          }
        }
      }

      transactions.push({
        transactionId: tx.id,
        events,
      });
    }

    return transactions;
  }

  async *iterateBlocks(lastBlockProcessed: number|null) {
    while (true) {
      const chainHeadBlock: number = (await this.client.request("getblockcount", [])).result;
      console.log("current chain head is is:", chainHeadBlock);
      lastBlockProcessed =  lastBlockProcessed ?? chainHeadBlock;

      if (chainHeadBlock <= lastBlockProcessed) {
        console.log("waiting for new bitcoin block");
        await new Promise((resolve) => setTimeout(resolve, 60000, false));
        continue;
      }

      const nextBlockToProcess = lastBlockProcessed + 1; // or +responseGetblockcount.result to aways process last block and skip intermediate blocks
      yield nextBlockToProcess;
      lastBlockProcessed = nextBlockToProcess;
    }
  }
}

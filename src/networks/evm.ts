import { Event, Network, Transaction } from "../types";
import * as url from "url";
import * as jayson from "jayson/promise";
import {Interface} from '@ethersproject/abi';

export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const erc20 = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
]);


export function findEventsInTransaction(txReceiptData: any): Event[] {
  let events: Event[] = [];

  //console.log(JSON.stringify(txReceiptData, null, 4));

  for (const log of txReceiptData['logs']) {
    const topic0 = log['topics']?.[0];
    if (topic0 == ERC20_TRANSFER_TOPIC) {
      const decoded = erc20.decodeEventLog('Transfer', log['data'], log['topics']);

      events.push({
        type: "payment-received",
        network: "eip155:1",
        address: decoded.to,
        amount: decoded.amount.toString(),
        currency: "eip155:1/erc20:" + log['address'],
      });
    }
  }

  return events;
}

export default class EVMNetwork implements Network {
  client: jayson.Client;

  constructor(networkId: string, rpcUrl: string) {
    let rpc = url.parse(rpcUrl);
    this.client = jayson.client.https(rpc);
  }

  async processBlock(blockNum: number): Promise<Transaction[]> {
    let transactions: Transaction[] = [];

    const blockData: any = (await this.client.request("eth_getBlockByNumber", [
      '0x' + blockNum.toString(16), false
    ])).result;

    // NB: Alchemy has a special api `alchemy_getTransactionReceipts` which allows querying
    // of of these in one go, but we don't want to tie ourselves to them.
    for (const txHash of blockData.transactions) {
      console.log('fetching txHash', txHash);
      const responses = await Promise.all([
        this.client.request("eth_getTransactionReceipt", [txHash]),
        this.client.request("eth_getTransactionByHash", [txHash])
      ]);
      const [receiptData, txData] = [responses[0].result, responses[1].result]

      const events = [];
      if (txData.value > 0) {
        events.push({
          type: "payment-received",
          network: "eip155:1",
          address: txData.to,
          amount: Math.floor(txData.value).toString(),
          currency: "eip155:1/slip44:60",
        });
      }

      transactions.push({
        transactionId: txData.transactionHash,
        events: [...events, findEventsInTransaction(receiptData)],
      })
    }

    return transactions;
  }

  async *iterateBlocks(lastBlockProcessed: number|null) {
    while (true) {
      // TODO: Use websocket
      const chainHeadBlock: number = (await this.client.request("eth_blockNumber", [])).result;
      lastBlockProcessed =  lastBlockProcessed ?? chainHeadBlock;

      if (+chainHeadBlock <= +lastBlockProcessed) {
        await new Promise((resolve) => setTimeout(resolve, 5000, false));
        continue;
      }

      const nextBlockToProcess = lastBlockProcessed + 1;
      yield nextBlockToProcess;
      lastBlockProcessed = nextBlockToProcess;
    }
  }

  id: string = "ethereum";
}

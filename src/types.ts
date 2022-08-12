export interface PaymentReceivedEvent {
  type: "payment-received";
  network: string; // https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md
  amount: string;
  currency: string;
  address: string;
}

export type Event = PaymentReceivedEvent;

export interface Transaction {
  // Usually a hash.
  transactionId: string;

  //
  events: Event[];
}

export interface Network {
  id: string;
  iterateBlocks(lastBlockProcessed: number|null): AsyncGenerator<number, void, unknown>;
  processBlock(blockNum: number): Promise<Transaction[]>;
}
